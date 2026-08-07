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
  setPtyBashExecContext
} from './pi-terminal-bash'
import { rejectPendingApprovalsForRun } from './command-approval'
import type { AgentConfig, AgentEvent } from './types'

type AgentSession = Awaited<ReturnType<PiCodingAgentModule['createAgentSession']>>['session']

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const

interface HostedSession {
  sessionKey: string
  session: AgentSession
  cwd: string
  toolProfile: string
  unsubscribe?: () => void
}

const TOOL_PROFILE = 'pty-bash-v1'

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
    hosted.unsubscribe?.()
    hosted.unsubscribe = hosted.session.subscribe((event) => {
      for (const agentEvent of mapPiSessionEventToAgentEvents(event, {
        runId,
        tabId: input.tabId
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
        emit(agentEvent)
      }
    })

    const promptText = buildPromptText(input)
    await hosted.session.prompt(promptText)

    const active = activeRuns.get(runId)
    if (active?.abortRequested) {
      return { ok: false, canceled: true, error: 'Canceled.', text: collectedText.trim() }
    }

    const messages = hosted.session.messages as unknown[]
    const finalText =
      extractAssistantTextFromMessages(messages).trim() || collectedText.trim()

    if (!finalText && lastRetryError) {
      emit({ type: 'error', message: lastRetryError, runId, tabId: input.tabId })
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
    emit({ type: 'error', message, runId, tabId: input.tabId })
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
  active.abortController.abort()
  rejectPendingApprovalsForRun(runId, 'Agent run was canceled.')
  const hosted = hostedSessions.get(active.sessionKey)
  try {
    await hosted?.session.abort()
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
        '# 命令粒度',
        '- 单次调用 ≤3 段子命令且同质（全只读）；「状态查询」与「日志抽取」不混在同一条链里。',
        '',
        '# 采集效率',
        '- 规划阶段先列出所需数据，尽量用最少 bash 批量采集；同一资源本 run 已采集则复用，禁止重复 get。',
        '- 架构/巡检推荐批次（每批一次 bash，批内用 ; 或 && 连接，仍遵守 ≤3 段同质只读）：',
        '  1) 环境确认：whoami/hostname/kubectl version/current-context',
        '  2) 库存：nodes + namespaces + 关键 workload/svc 概览',
        '  3) 网络：ingress/CNI/LB/NetworkPolicy（按需）',
        '',
        '# 集群全量巡检流程',
        '1. 一条概览命令定位异常：kubectl get pods -A --no-headers | awk \'$4!="Running"&&$4!="Completed"\'',
        '2. 只深钻异常 Pod：每个异常 Pod 独立一次 describe + 一次 logs --tail。',
        '3. 健康服务按命名空间聚合为一行，不逐 Pod 列表。',
        '4. 节点资源（free -h && df -h）合并进环境确认命令。',
        '',
        '# 叙述纪律',
        '- 用户可见的阶段间文字 ≤1 句（当前判断 + 下一步）；思考每轮 ≤3 句，禁止引用命令输出原文。',
        '- 禁止在中间消息用大段 bullet/标题预演或复述最终报告',
        '  （异常服务表、修复建议、架构章节、健康摘要等）；详细内容只在最终报告出现一次。',
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
        '- 目标环境未就绪时等待工具结果，不要改口问用户怎么连；直接执行任务。'
      ]
        .filter(Boolean)
        .join('\n')
  })
  await resourceLoader.reload()

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: resolveThinkingLevelForModel(model ?? undefined),
    modelRuntime,
    resourceLoader,
    tools: [...DEFAULT_TOOLS],
    customTools: [ptyBashTool as never],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const hosted: HostedSession = { sessionKey, session, cwd, toolProfile: TOOL_PROFILE }
  hostedSessions.set(sessionKey, hosted)
  return hosted
}

function buildPromptText(input: PiHostRunInput): string {
  const parts: string[] = []
  const languageDirective = buildLanguageDirective(input.locale)
  if (languageDirective) parts.push(languageDirective)
  if (input.conversationContext?.trim()) {
    parts.push(`# Recent conversation\n${input.conversationContext.trim()}\n`)
  }
  if (input.terminalContext?.trim()) {
    parts.push(`# Current terminal context\n${input.terminalContext.trim()}\n`)
  }
  parts.push(input.input.trim())
  return parts.join('\n')
}

function buildLanguageDirective(locale: string | undefined): string {
  const normalized = locale?.trim().toLowerCase() ?? ''
  if (normalized.startsWith('zh')) {
    return [
      '# Language',
      'Write all user-facing replies AND internal thinking/reasoning entirely in Simplified Chinese (简体中文).',
      'Do not mix Chinese and English in prose.',
      'Keep commands, paths, tool names, package names, and log identifiers in their original form.',
      ''
    ].join('\n')
  }
  return [
    '# Language',
    'Write all user-facing replies AND internal thinking/reasoning entirely in English.',
    'Do not mix languages in prose.',
    'Keep commands, paths, tool names, package names, and log identifiers in their original form.',
    ''
  ].join('\n')
}

function collectSkillRoots(skillRoot: string): string[] {
  const roots = [getCrescentPiSkillsDir()]
  const configured = skillRoot?.trim()
  if (configured) {
    roots.push(resolve(configured.replace(/^~(?=$|[/\\])/, homedir())))
  }
  return [...new Set(roots)]
}
