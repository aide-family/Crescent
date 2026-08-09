import { homedir } from 'os'
import { resolve } from 'path'

import type { WebContents } from 'electron'

import { buildLocalInstructionContext } from './instruction-files'
import { extractAssistantTextFromMessages, mapPiSessionEventToAgentEvents } from './pi-event-bridge'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { getCrescentPiAgentDir, getCrescentPiSkillsDir } from './pi-paths'
import {
  resolvePiModel,
  resolveThinkingLevelForModel,
  syncCrescentProvidersToModelRuntime
} from './pi-model-runtime'
import { loadPiCodingAgent, type PiCodingAgentModule } from './pi-sdk'
import {
  clearPtyBashExecContext,
  createPtyBashToolDefinition,
  interruptPtyCommandsForRun,
  settlePtyInterruptsBeforeSessionAbort,
  setPtyBashExecContext
} from './pi-terminal-bash'
import {
  createOpenSubterminalToolDefinition,
  OPEN_SUBTERMINAL_DISCIPLINE
} from './pi-open-subterminal'
import { rejectPendingApprovalsForRun } from './command-approval'
import {
  buildQuotaResetHint,
  classifyProviderError,
  isQuotaExhaustedError
} from '../../shared/provider-error'
import { buildPromptText } from '../../shared/agent-run-prompt'
import { RUNTIME_SUPPLEMENT_DISCIPLINE } from '../../shared/runtime-supplement'
import type { AgentConfig, AgentEvent } from './types'
import type { SkillPromptPart, SopWikiPromptPart } from '../../shared/agent-run-prompt'

type AgentSession = Awaited<ReturnType<PiCodingAgentModule['createAgentSession']>>['session']

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const
/** Pi `tools` is an allowlist — custom tools must be listed here to be model-callable. */
const ACTIVE_TOOLS = [...DEFAULT_TOOLS, 'open_subterminal'] as const

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  toolProfile: string
  unsubscribe?: () => void
}

const TOOL_PROFILE = 'pty-bash-open-subterminal-v2'

interface ActiveRun {
  runId: string
  sessionKey: string
  abortRequested: boolean
  abortController: AbortController
}

const hostedSessions = new Map<string, HostedSession>()
const activeRuns = new Map<string, ActiveRun>()
const runIdBySessionKey = new Map<string, string>()

export interface PiHostRunInput {
  runId: string
  sessionKey: string
  input: string
  config: AgentConfig
  tabId?: string
  conversationContext?: string
  webContents: WebContents
  executionTabId: string
  terminalContext?: string
  locale?: string
  activeWikiDocs?: SopWikiPromptPart[]
  activeSkillDocs?: SkillPromptPart[]
  emit: (event: AgentEvent) => void
}

export interface PiHostRunResult {
  ok: boolean
  text?: string
  error?: string
  canceled?: boolean
}

export async function runPiAgent(input: PiHostRunInput): Promise<PiHostRunResult> {
  const { runId, sessionKey, emit } = input
  const abortController = new AbortController()
  activeRuns.set(runId, { runId, sessionKey, abortRequested: false, abortController })
  runIdBySessionKey.set(sessionKey, runId)

  try {
    if (!input.executionTabId?.trim()) {
      return {
        ok: false,
        error: 'Missing execution terminal tab. Open a terminal pane before running the agent.'
      }
    }

    const hosted = await ensureHostedSession(sessionKey, input.config)
    const modelRuntime = await syncCrescentProvidersToModelRuntime(input.config)
    const model = await resolvePiModel(input.config, modelRuntime)
    if (!model) {
      return {
        ok: false,
        error: 'No model available. Add an OpenAI-compatible provider with an API key in Settings.'
      }
    }

    if (
      hosted.session.model?.id !== model.id ||
      hosted.session.model?.provider !== model.provider
    ) {
      await hosted.session.setModel(model)
    }

    const thinkingLevel = resolveThinkingLevelForModel(model)
    try {
      hosted.session.setThinkingLevel(thinkingLevel)
    } catch {
      // Older sessions / models may reject unsupported thinking levels.
    }

    setPtyBashExecContext(sessionKey, {
      webContents: input.webContents,
      executionTabId: input.executionTabId.trim(),
      chatTabId: input.tabId,
      runId,
      userInput: input.input,
      terminalContext: input.terminalContext,
      locale: input.locale,
      config: input.config,
      emit,
      signal: abortController.signal
    })

    emit({
      type: 'status',
      message: `Using ${model.provider}/${model.id}; bash runs in the visible terminal pane.`,
      runId,
      tabId: input.tabId
    })

    let collectedText = ''
    let lastRetryError = ''
    let quotaExceeded:
      | {
          provider?: string
          resetHint: string
          retryAfterMs?: number
        }
      | undefined
    const bridgeLocale = input.locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    hosted.unsubscribe?.()
    hosted.unsubscribe = hosted.session.subscribe((event) => {
      if (event.type === 'auto_retry_start' && isQuotaExhaustedError(event.errorMessage ?? '')) {
        const classified = classifyProviderError(event.errorMessage ?? '')
        quotaExceeded = {
          provider: classified.provider ?? model.provider,
          resetHint: buildQuotaResetHint(classified.retryAfterMs, bridgeLocale),
          retryAfterMs: classified.retryAfterMs
        }
        // abortRetry() only works after _prepareRetry wires _retryAbortController
        // (created synchronously after this emit returns). Microtask is soon enough.
        queueMicrotask(() => {
          try {
            hosted.session.abortRetry()
          } catch {
            // ignore
          }
        })
      }

      for (const agentEvent of mapPiSessionEventToAgentEvents(event, {
        runId,
        tabId: input.tabId,
        locale: input.locale
      })) {
        if (agentEvent.type === 'token') {
          collectedText += agentEvent.text
        }
        if (
          agentEvent.type === 'status' &&
          typeof agentEvent.message === 'string' &&
          /^Retrying\b/i.test(agentEvent.message)
        ) {
          lastRetryError = agentEvent.message
        }
        if (agentEvent.type === 'error' && agentEvent.kind === 'quota' && !quotaExceeded) {
          quotaExceeded = {
            provider: agentEvent.provider ?? model.provider,
            resetHint:
              agentEvent.resetHint ?? buildQuotaResetHint(agentEvent.retryAfterMs, bridgeLocale),
            retryAfterMs: agentEvent.retryAfterMs
          }
        }
        emit(agentEvent)
      }
    })

    const promptText = buildPromptText(input)
    // Reused sessions can still be settling after abort; wait before a fresh prompt
    // so the SDK does not throw "Agent is already processing".
    if (hosted.session.isStreaming) {
      try {
        await Promise.race([
          hosted.session.waitForIdle(),
          new Promise<void>((resolve) => setTimeout(resolve, 3_000))
        ])
      } catch {
        // Continue; prompt may still fail and is localized in the renderer.
      }
    }
    await hosted.session.prompt(promptText)

    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.', text: collectedText.trim() }
    }

    if (quotaExceeded) {
      const message = 'AccountQuotaExceeded'
      emit({
        type: 'error',
        message,
        kind: 'quota',
        code: 'quota_exceeded',
        provider: quotaExceeded.provider,
        resetHint: quotaExceeded.resetHint,
        retryAfterMs: quotaExceeded.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: message }
    }

    const messages = hosted.session.messages as unknown[]
    const finalText = extractAssistantTextFromMessages(messages).trim() || collectedText.trim()

    if (!finalText && lastRetryError) {
      const classified = classifyProviderError(lastRetryError)
      if (classified.kind === 'quota_exceeded') {
        emit({
          type: 'error',
          message: 'AccountQuotaExceeded',
          kind: 'quota',
          code: 'quota_exceeded',
          provider: classified.provider ?? model.provider,
          resetHint: buildQuotaResetHint(classified.retryAfterMs, bridgeLocale),
          retryAfterMs: classified.retryAfterMs,
          runId,
          tabId: input.tabId
        })
        return { ok: false, error: 'AccountQuotaExceeded' }
      }
      emit({
        type: 'error',
        message: lastRetryError,
        kind:
          classified.kind === 'rate_limit' || classified.kind === 'transient'
            ? 'transient'
            : 'other',
        provider: classified.provider,
        retryAfterMs: classified.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: lastRetryError }
    }

    const text = finalText || 'Done.'
    emit({ type: 'done', message: text, runId, tabId: input.tabId })
    return { ok: true, text }
  } catch (error) {
    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.' }
    }
    const message = error instanceof Error ? error.message : String(error)
    const classified = classifyProviderError(message)
    if (classified.kind === 'quota_exceeded') {
      const locale = input.locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      emit({
        type: 'error',
        message: 'AccountQuotaExceeded',
        kind: 'quota',
        code: 'quota_exceeded',
        provider: classified.provider,
        resetHint: buildQuotaResetHint(classified.retryAfterMs, locale),
        retryAfterMs: classified.retryAfterMs,
        runId,
        tabId: input.tabId
      })
      return { ok: false, error: 'AccountQuotaExceeded' }
    }
    emit({
      type: 'error',
      message,
      kind:
        classified.kind === 'rate_limit' || classified.kind === 'transient' ? 'transient' : 'other',
      provider: classified.provider,
      retryAfterMs: classified.retryAfterMs,
      runId,
      tabId: input.tabId
    })
    return { ok: false, error: message }
  } finally {
    clearPtyBashExecContext(sessionKey)
    const hosted = hostedSessions.get(sessionKey)
    hosted?.unsubscribe?.()
    if (hosted) hosted.unsubscribe = undefined
    activeRuns.delete(runId)
    if (runIdBySessionKey.get(sessionKey) === runId) {
      runIdBySessionKey.delete(sessionKey)
    }
  }
}

export async function cancelPiAgentRun(runId: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  active.abortRequested = true
  // Abort signal settles pending PTY waiters (interrupted); interrupt also writes ^C.
  active.abortController.abort()
  rejectPendingApprovalsForRun(runId, 'Agent run was canceled.')
  const hosted = hostedSessions.get(active.sessionKey)
  try {
    await settlePtyInterruptsBeforeSessionAbort({
      settleInterrupts: () => interruptPtyCommandsForRun(runId),
      abortSession: async () => {
        await hosted?.session.abort()
      }
    })
  } catch {
    // ignore abort errors
  }
  return true
}

export async function steerPiAgentRun(runId: string, text: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  const hosted = hostedSessions.get(active.sessionKey)
  if (!hosted) return false
  try {
    await hosted.session.steer(text)
    return true
  } catch {
    return false
  }
}

async function ensureHostedSession(
  sessionKey: string,
  config: AgentConfig
): Promise<HostedSession> {
  const existing = hostedSessions.get(sessionKey)
  const cwd = resolveAgentWorkspaceCwd(config)
  if (existing) {
    if (existing.toolProfile === TOOL_PROFILE && existing.cwd === cwd) {
      return existing
    }
    try {
      existing.unsubscribe?.()
      existing.session.dispose()
    } catch {
      // ignore dispose errors when recreating for tool profile upgrades
    }
    hostedSessions.delete(sessionKey)
  }

  const pi = await loadPiCodingAgent()
  const agentDir = getCrescentPiAgentDir()
  const modelRuntime = await syncCrescentProvidersToModelRuntime(config)
  const model = await resolvePiModel(config, modelRuntime)

  const settingsManager = pi.SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 }
  })

  const instructionContext = buildLocalInstructionContext()
  const additionalSkillPaths = collectSkillRoots(config.skillRoot)
  const ptyBashTool = createPtyBashToolDefinition(pi, cwd, sessionKey)

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths,
    systemPromptOverride: (base) =>
      [
        base,
        '',
        'You are Crescent, an Electron-hosted coding agent powered by Pi.',
        'File tools (read, write, edit) operate on the agent workspace cwd.',
        "The bash tool executes in the user's visible terminal pane (main terminal or a docked subterminal).",
        'Commands are pasted into the terminal so the user can see them; high-risk commands require in-chat approval before execution.',
        'Prefer bash for cluster/host inspection when the user is already in the target environment.',
        '',
        '# Expert guided execution',
        'Work like a senior ops engineer guiding the operator through the investigation:',
        '- Before each diagnostic bash command, write one short user-facing sentence with the goal or hypothesis.',
        '- After you receive evidence, briefly interpret what it means and say what you will check next.',
        '- Do not dump a long silent sequence of commands and only summarize at the end.',
        '- Put private reasoning in the thinking/reasoning channel; put operator-facing guidance in normal reply text.',
        '- When finished, give a structured conclusion: status, notable risks, and recommended next actions.',
        instructionContext ? `\n# Local instructions\n${instructionContext}` : '',
        '',
        '# 批量采集硬规范',
        '- 连续信息采集必须把多个只读命令写在同一个 bash 调用中（用 `;` 分隔），系统会自动拆分并结构化回传；写操作必须独立成单独调用。',
        '',
        '# 知识库 / SOP 存库硬规范',
        '- 知识库/SOP 存库一律经 wiki 机制写入 ~/.crescent/wiki；禁止存到 workspace 或远程主机；',
        '  禁止用 bash 写文件（mkdir / cat > / heredoc）或用 write/edit 工具落 SOP。',
        '- 用户说「存成 SOP / 保存到知识库」时：不要询问保存位置、不要三选一；说明应使用结果条「存为 SOP」或 Wiki 面板；',
        '  切勿自行在磁盘创建 SOP 文件。',
        '',
        '# 引用材料纪律',
        '- 用户引用的 Skill / SOP 仅作参考材料；简单任务不要强行套完整手册流程，按目标最小必要执行。',
        '',
        '# SOP 执行性能',
        '- 按 SOP 执行时，全部只读步骤合并到 ≤3 轮终端调用（多个异常对象的深钻同轮并发）；仅写操作独立。',
        '',
        '# 集群全量巡检流程',
        '1. 一条概览命令定位异常：kubectl get pods -A --no-headers | awk \'$4!="Running"&&$4!="Completed"\'',
        '2. 只深钻异常 Pod：每个异常对象独立成段，但可同一条 bash 调用并发（describe + logs --tail）。',
        '3. 健康服务按命名空间聚合为一行，不逐 Pod 列表。',
        '4. 节点资源（free -h && df -h）合并进环境确认命令。',
        '',
        '# 叙述纪律',
        '- 用户可见的阶段间文字 ≤1 句（当前判断 + 下一步）；思考每轮 ≤3 句，禁止引用命令输出原文。',
        '- 禁止在中间消息用大段 bullet/标题预演或复述最终报告',
        '  （异常服务表、修复建议、架构章节、健康摘要等）；详细内容只在最终报告出现一次。',
        `- ${RUNTIME_SUPPLEMENT_DISCIPLINE}`,
        '',
        '# 全量报告模板（问题前置，仅输出一次）',
        '## 📊 集群健康报告',
        '**❌ 异常服务**｜表格置顶：服务 / 命名空间 / 状态 / 原因',
        '**🔧 修复建议**｜编号列表，每条可直接执行',
        '**✅ 健康摘要**｜每命名空间一行',
        '**概览**｜节点 / 版本 / 运行时间 / 内存 / 磁盘',
        '**总体评价**｜≤2 句',
        '',
        '# 收尾与清理纪律',
        '- 禁止在任务末尾启动后台进程（& / nohup）、kill、port-forward 常驻；',
        '  需要临时 port-forward 时，用单条前台命令包住超时：',
        "  `timeout 8 sh -c 'kubectl port-forward ... & PF=$!; sleep 2; curl ...; kill $PF'`",
        '  整条视为一次调用，不留残留进程。',
        '- 收尾只允许只读汇总命令；任何含 kill/&/port-forward 的命令不得作为最后一步。',
        '- 同一命令执行失败后，不原样重试；先分析 stderr 再换方案',
        '  （已触发过审批的命令尤其如此，禁止重复弹审批）。',
        '# 集群内服务访问经验',
        '- 容器内常无 curl/wget；访问集群内服务优先 kubectl port-forward，',
        '  避免 exec curl → exec wget → port-forward 的试错链。',
        '',
        '# 图表输出纪律',
        '- 架构图 / 流程图 / 时序图 / 拓扑图一律用 mermaid 代码块输出',
        '  （```mermaid ... ```），禁止用 ASCII art、Unicode 框线或纯文本模拟图表。',
        '- 禁止输出类似 +--+ | | 的框线拓扑；若你写出 ASCII 图，视为错误，请改成 mermaid。',
        '- 常用类型映射：架构/拓扑 → graph LR/TD；流程 → flowchart；时序 → sequenceDiagram；',
        '  类/ER → classDiagram/erDiagram。',
        '- 节点文字简短，连线带语义标签；图过大时必须拆成多张分主题图（平台 / 流量 / 存储）。',
        '- 关键链路在图节点或配文用 ①②③ 标注，例如：外部→Ingress→Service→Pod；CNI/IPPool；日志双通道。',
        '',
        '# 连接与登录纪律',
        '- 目标终端/SSH/集群连接由系统路由层处理；你不要向用户询问或列举登录方式',
        '  （例如 Crescent 终端 / kubectl 直连 / SSH）。',
        '- 目标环境未就绪时等待工具结果，不要改口问用户怎么连；直接执行任务。',
        '',
        OPEN_SUBTERMINAL_DISCIPLINE
      ]
        .filter(Boolean)
        .join('\n')
  })
  await resourceLoader.reload()

  const openSubterminalTool = createOpenSubterminalToolDefinition(pi, sessionKey)

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: resolveThinkingLevelForModel(model ?? undefined),
    modelRuntime,
    resourceLoader,
    tools: [...ACTIVE_TOOLS],
    customTools: [ptyBashTool as never, openSubterminalTool as never],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const hosted: HostedSession = { sessionKey, session, cwd, toolProfile: TOOL_PROFILE }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

function collectSkillRoots(skillRoot: string): string[] {
  const roots = [getCrescentPiSkillsDir()]
  const configured = skillRoot?.trim()
  if (configured) {
    roots.push(resolve(configured.replace(/^~(?=$|[/\\])/, homedir())))
  }
  return [...new Set(roots)]
}
