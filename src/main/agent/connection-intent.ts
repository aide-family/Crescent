import {
  explainLocalFileOperationBypass,
  hasExplicitLocalWorkIntent
} from '../../shared/agent-local-intent'
import { parseJsonFromModelContent } from '../../shared/json-parse'
import type { AgentConnectionIntentResult, ConnectionConfig } from './types'

export function buildLocalOnlyConnectionIntentResult(
  input: string
): AgentConnectionIntentResult | undefined {
  if (!hasExplicitLocalWorkIntent(input)) return undefined

  return {
    ok: false,
    shouldConnect: false,
    confidence: 100,
    executeAfterLogin: false,
    matchBasis: 'none',
    reason: explainLocalFileOperationBypass()
  }
}

export function summarizeConnectionForAi(connection: ConnectionConfig): Record<string, unknown> {
  return {
    id: connection.id,
    matchingPriority:
      'name is primary; host/user-visible identifiers are secondary; description is weak context only',
    source: connection.source,
    name: connection.name,
    normalizedName: normalizeConnectionIntentText(connection.name),
    host: connection.host,
    user: connection.user,
    port: connection.port,
    identityFile: connection.identityFile,
    description: connection.description,
    normalizedDescription: normalizeConnectionIntentText(connection.description ?? ''),
    sshOptions: connection.sshOptions
  }
}

export function parseConnectionIntentResponse(
  content: string,
  connections: ConnectionConfig[]
): AgentConnectionIntentResult {
  try {
    const parsed = parseJsonFromModelContent<{
      shouldConnect?: unknown
      connectionId?: unknown
      confidence?: unknown
      executeAfterLogin?: unknown
      userGoal?: unknown
      matchBasis?: unknown
      needsClarification?: unknown
      clarificationQuestion?: unknown
      reason?: unknown
    }>(content)
    const needsClarification = parsed.needsClarification === true
    const clarificationQuestion =
      typeof parsed.clarificationQuestion === 'string' && parsed.clarificationQuestion.trim()
        ? parsed.clarificationQuestion.trim()
        : undefined
    const shouldConnect = parsed.shouldConnect === true && !needsClarification
    const connectionId = typeof parsed.connectionId === 'string' ? parsed.connectionId : undefined
    const confidence = Number(parsed.confidence)
    const executeAfterLogin = parsed.executeAfterLogin === true
    const knownIds = new Set(connections.map((connection) => connection.id))
    const userGoal = typeof parsed.userGoal === 'string' ? parsed.userGoal : undefined
    const matchBasis = parseConnectionMatchBasis(parsed.matchBasis)
    const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined

    if (needsClarification) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        needsClarification: true,
        clarificationQuestion:
          clarificationQuestion ||
          reason ||
          'Please clarify which connection or terminal context to use.',
        reason: reason || 'clarification required'
      }
    }

    if (!shouldConnect) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        reason: reason || 'no connection needed'
      }
    }

    if (!connectionId || !knownIds.has(connectionId) || !Number.isFinite(confidence)) {
      return {
        ok: false,
        shouldConnect: false,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        needsClarification: true,
        clarificationQuestion:
          clarificationQuestion ||
          'I could not uniquely match a configured SSH connection. Which connection should I use, or should I stay in the current terminal?',
        reason: reason || 'no match'
      }
    }

    if (confidence < 60) {
      return {
        ok: false,
        shouldConnect: false,
        confidence,
        executeAfterLogin: false,
        userGoal,
        matchBasis,
        needsClarification: true,
        clarificationQuestion:
          clarificationQuestion ||
          `I am not sure whether to use connection "${
            connections.find((connection) => connection.id === connectionId)?.name ?? connectionId
          }". Should I connect to it, or stay in the current terminal?`,
        reason: reason || 'low confidence'
      }
    }

    return {
      ok: true,
      shouldConnect: true,
      connectionId,
      confidence,
      executeAfterLogin,
      userGoal,
      matchBasis,
      reason
    }
  } catch {
    return {
      ok: false,
      shouldConnect: false,
      confidence: 0,
      needsClarification: true,
      clarificationQuestion:
        'I could not determine the target connection from that request. Which configured SSH connection should I use, or should I continue in the current terminal?',
      reason: 'invalid model response'
    }
  }
}

export const CONNECTION_INTENT_SYSTEM_PROMPT = [
  'You analyze a user request before any terminal or connection action. Decide whether the request needs opening one configured SSH connection, which configured connection best matches, whether work must continue after login, or whether you must ask the user a clarifying question first.',
  'Return strict JSON only: {"shouldConnect":true|false,"connectionId":"..."|null,"confidence":0-100,"executeAfterLogin":true|false,"userGoal":"...","matchBasis":"name|host|user|description|none","needsClarification":true|false,"clarificationQuestion":"..."|null,"reason":"..."}.',
  'Interpret the user request with the provided conversation context, current terminal summary, and configured connections. Do not rely on fixed business rules for a specific cluster or site.',
  'Set needsClarification=true and provide one short clarificationQuestion when the target connection, whether to login first, or whether to stay in the current terminal is ambiguous. In that case set shouldConnect=false and connectionId=null.',
  'Set shouldConnect=true only when the user is asking to log in, open SSH, or clearly work on a named remote host/connection. If they did not ask to log in and did not name a connection, set shouldConnect=false and stay on the current terminal.',
  'Do not guess a last-used host or the only configured connection when login intent is absent. Generic verbs such as 打开/open are not login intent by themselves.',
  'Set shouldConnect=false for general chat, local-only work, or when clarification is required.',
  'Local-only work includes local paths such as /etc/hosts, ~, $HOME, pasted local shell prompts, and requests that explicitly say the work is local/this machine — including viewing a local git repo.',
  'Do not treat path fragments such as aide-family as a connection named aide. IP addresses inside pasted file contents are data to edit, not SSH targets.',
  'Set executeAfterLogin=true when the user asks for any concrete task beyond merely logging in or opening the connection.',
  'Matching priority: a clear unique connection-name match wins first; then host/alias/user when the user clearly asks for a remote connection; description is weak context only.',
  'Chinese shorthand like "登录aide集群" or "检查aide状态" should match a connection named aide when that name is unique among configured connections.',
  'If multiple connections could match or confidence would be below 60, prefer needsClarification over guessing. Do not invent connection ids.',
  'Write clarificationQuestion in the same language as the user request.'
].join('\n')

function normalizeConnectionIntentText(value: string): string {
  return value.toLowerCase().replace(/[\s"'`,.:;/\\|()[\]{}_-]+/g, '')
}

function parseConnectionMatchBasis(value: unknown): AgentConnectionIntentResult['matchBasis'] {
  return value === 'name' ||
    value === 'host' ||
    value === 'user' ||
    value === 'description' ||
    value === 'none'
    ? value
    : undefined
}
