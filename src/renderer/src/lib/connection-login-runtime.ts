import type { Dictionary } from '@renderer/i18n'
import type { AgentLogEntryInput } from '@renderer/lib/terminal-tabs'
import { findNewestPromptSignal } from '../../../shared/terminal-prompt-host'
import {
  formatConnectionActionLog,
  formatConnectionActionSkippedLog,
  looksLikeCommand
} from './connection-commands'
import {
  LOGIN_ACTION_CONSUMED_TIMEOUT_MS,
  LOGIN_TYPE_READY_TIMEOUT_MS,
  resolveLoginActionConsumed,
  resolveLoginTypeReady,
  shouldSkipSecretOnHost,
  waitForLoginActionConsumed,
  waitForLoginTypeReady,
  type LoginActionWaitDeps,
  type LoginStepConsumed,
  type LoginTypeReady
} from '@renderer/lib/login-action-wait'
const CONNECTION_SHELL_READY_TIMEOUT_MS = 15_000
/** CRESCENT_DEBUG_CONN=1 enables [conn-trace] logs in the renderer too. */
export function connTrace(...parts: unknown[]): void {
  // Renderer has no Node globals under context isolation; typeof guard keeps
  // this safe in both dev server and packaged app.
  if (typeof process === 'undefined' || process.env?.CRESCENT_DEBUG_CONN !== '1') return
  console.info('[conn-trace]', ...parts)
}

export async function runConnectionCommandSequence(
  commands: string[],
  tabId: string,
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => void,
  appendSystem: (text: string, tabId: string) => void,
  t: Dictionary,
  logTabId = tabId,
  options?: { hasLeadingAutoPassword?: boolean }
): Promise<boolean> {
  const [sshCommand, ...loginActions] = commands
  if (!sshCommand) return true

  // Paste into a shell that is still sourcing startup files can drop the
  // command: zsh's line editor discards input typed before the first prompt
  // (the PTY still echoes it, which is why the terminal shows the line). Wait
  // for an actual prompt and never dispatch if startup has not completed.
  const shellInteractive = await waitForShellInteractive(tabId, CONNECTION_SHELL_READY_TIMEOUT_MS)
  connTrace('login-stage', `tab=${tabId}`, `shellInteractive=${shellInteractive}`)
  if (!shellInteractive) {
    const message = t.terminal.connectionShellReadyTimeout.replace(
      '{ms}',
      String(Math.round(CONNECTION_SHELL_READY_TIMEOUT_MS / 1000))
    )
    appendLog({ kind: 'error', text: message }, logTabId)
    return false
  }

  const pasteResult = await window.api.terminal.pasteCommand(sshCommand, true, tabId)
  connTrace(
    'ssh-command-dispatch',
    `tab=${tabId}`,
    `ok=${pasteResult.ok}`,
    `error=${pasteResult.error ?? '-'}`
  )
  if (!pasteResult.ok) {
    appendLog(
      { kind: 'error', text: pasteResult.error || t.terminal.postLoginTaskAborted },
      logTabId
    )
    return false
  }

  if (loginActions.length === 0) return true

  return typeConnectionLoginActions(loginActions, tabId, appendLog, appendSystem, t, logTabId, {
    hasLeadingAutoPassword: Boolean(options?.hasLeadingAutoPassword)
  })
}

export async function runConnectionLoginActionSequence(
  loginActions: string[],
  tabId: string,
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => void,
  appendSystem: (text: string, tabId: string) => void,
  t: Dictionary,
  logTabId = tabId,
  options?: { hasLeadingAutoPassword?: boolean }
): Promise<boolean> {
  if (loginActions.length === 0) return true

  return typeConnectionLoginActions(loginActions, tabId, appendLog, appendSystem, t, logTabId, {
    hasLeadingAutoPassword: Boolean(options?.hasLeadingAutoPassword)
  })
}

function createLoginActionWaitDeps(tabId: string): LoginActionWaitDeps {
  return {
    getContext: async () => {
      const context = await window.api.terminal.getContext(tabId)
      return { output: context.output, promptHost: context.promptHost }
    },
    onData: (handler) => window.api.terminal.onData(handler),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id)
  }
}

async function typeConnectionLoginActions(
  loginActions: string[],
  tabId: string,
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => void,
  appendSystem: (text: string, tabId: string) => void,
  t: Dictionary,
  logTabId: string,
  options?: { hasLeadingAutoPassword?: boolean }
): Promise<boolean> {
  const deps = createLoginActionWaitDeps(tabId)
  const hasLeadingAutoPassword = Boolean(options?.hasLeadingAutoPassword)
  let previousWasCommand = false
  let previousConsumedKind: Exclude<LoginStepConsumed['kind'], 'timeout'> | undefined

  for (let index = 0; index < loginActions.length; index += 1) {
    const action = loginActions[index]
    // The auto-prepended connection password is always a secret, even when its
    // text happens to collide with a shell command word (e.g. `enable`).
    const isAutoPassword = hasLeadingAutoPassword && index === 0
    const isSecret = isAutoPassword || !looksLikeCommand(action)
    const isLeadingAutoPassword = isAutoPassword
    const actionStart = Date.now()
    // Secrets (except unused leading SSH password / NOPASSWD after a command)
    // must wait for a password prompt — never type them into a bare host shell.
    const allowHostReady =
      isLeadingAutoPassword || (previousWasCommand && previousConsumedKind === 'host')
    let ready: LoginTypeReady = await waitForLoginTypeReady(deps, {
      tabId,
      timeoutMs: LOGIN_TYPE_READY_TIMEOUT_MS,
      requireWaiting: isSecret && !allowHostReady
    })
    if (ready.kind === 'timeout') {
      const context = await window.api.terminal.getContext(tabId)
      const recheck = resolveLoginTypeReady(context.output ?? '')
      if (recheck && !(isSecret && !allowHostReady && recheck.kind !== 'waiting')) {
        ready = recheck
      } else if (isSecret && recheck?.kind === 'host') {
        // Trailing unused secret (e.g. extra sudo password after hostname) while
        // already on a clean host — skip instead of marking the whole login failed.
        connTrace(
          'login-stage',
          `tab=${tabId}`,
          `action=${index + 1}`,
          'skip-secret-timeout-on-host'
        )
        appendSystem(formatConnectionActionSkippedLog(index + 1, t), logTabId)
        // Keep the host skip-chain alive for any further unused secrets.
        previousWasCommand = true
        previousConsumedKind = 'host'
        continue
      }
    }
    connTrace(
      'login-stage',
      `tab=${tabId}`,
      `action=${index + 1}`,
      `ready=${ready.kind}`,
      `readyAfterMs=${Date.now() - actionStart}`
    )

    if (ready.kind === 'timeout') {
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.outputSettleTimeout} (${index + 1})`
        },
        logTabId
      )
      return false
    }

    if (
      isSecret &&
      shouldSkipSecretOnHost({
        readyKind: ready.kind,
        isLeadingAutoPassword,
        previousWasCommand,
        previousConsumedKind
      })
    ) {
      connTrace('login-stage', `tab=${tabId}`, `action=${index + 1}`, 'skip-secret-already-host')
      appendSystem(formatConnectionActionSkippedLog(index + 1, t), logTabId)
      // Do not clear previousWasCommand — consecutive unused secrets (password,
      // enable, …) must keep skipping while the shell stays on a clean host.
      previousWasCommand = true
      previousConsumedKind = 'host'
      continue
    }

    const contextAtType = await window.api.terminal.getContext(tabId)
    const outputAtType = contextAtType.output ?? ''
    const waitingLine = ready.kind === 'waiting' ? ready.line : undefined
    sendTerminalInput(action, tabId)
    appendSystem(
      formatConnectionActionLog(action, index + 1, t, { forceMask: isAutoPassword }),
      logTabId
    )

    const consumed = await waitForLoginActionConsumed(deps, {
      tabId,
      mode: ready.kind === 'waiting' ? 'waiting' : 'shell',
      waitingLine,
      outputAtType,
      timeoutMs: LOGIN_ACTION_CONSUMED_TIMEOUT_MS
    })
    connTrace(
      'login-stage',
      `tab=${tabId}`,
      `action=${index + 1}`,
      `consumed=${consumed.kind}`,
      `consumedAfterMs=${Date.now() - actionStart}`
    )
    let settled = consumed
    if (settled.kind === 'timeout') {
      const context = await window.api.terminal.getContext(tabId)
      const recheck = resolveLoginActionConsumed(context.output ?? '', {
        mode: ready.kind === 'waiting' ? 'waiting' : 'shell',
        waitingLine,
        outputAtType,
        acceptQuietGrowth: true
      })
      if (recheck) settled = recheck
    }
    if (settled.kind === 'timeout') {
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.outputSettleTimeout} (${index + 1})`
        },
        logTabId
      )
      return false
    }

    previousWasCommand = !isSecret
    previousConsumedKind = settled.kind
  }

  return true
}

async function waitForShellInteractive(tabId: string, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const context = await window.api.terminal.getContext(tabId)
    const signal = findNewestPromptSignal(context.output)
    if (signal?.kind === 'local' || signal?.kind === 'host') return true
    await sleep(200)
  }

  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
function sendTerminalInput(value: string, tabId: string): void {
  window.api.terminal.write(`${value}\r`, tabId)
}
