/**
 * kubectl may place flags/args between the binary and the verb
 * (`kubectl -n ns get cm`). Match non-greedily up to the first verb token.
 */
const KUBECTL_BEFORE_VERB = String.raw`\bkubectl(?:\s+[^\s]+)*?\s+`

/** Destructive / state-changing shell patterns (checked before READONLY). */
export const HIGH = new RegExp(
  String.raw`\b(rm|mv|dd|kill|reboot)\b|systemctl\s+(restart|stop|start|enable|disable)|` +
    KUBECTL_BEFORE_VERB +
    String.raw`(delete|apply|patch|edit|rollout|scale|drain|cordon|create|replace|exec)|` +
    String.raw`docker\s+(rm|rmi|restart|stop|run)|\b(chmod|chown|tee)\b|(?<!2)>(?!\/dev\/null)`
)

/** Clearly read-only inspection patterns. */
export const READONLY = new RegExp(
  KUBECTL_BEFORE_VERB +
    String.raw`(get|describe|logs|top|explain|cluster-info|version|api-resources|config|auth|diff|wait)|` +
    String.raw`docker\s+(ps|inspect|logs|images|stats|version|info|history|port)|` +
    String.raw`docker\s+compose\s+(ps|logs|config)|` +
    String.raw`systemctl\s+(status|is-active|list-units|show|list-timers)|journalctl|` +
    String.raw`\b(cat|ls|echo|hostname|whoami|uname|ps|df|free|top|ss|awk|grep|head|tail|wc|which|find|stat|id|pwd|env|printenv|lsof|du|uptime|ip)\b|` +
    String.raw`curl\s+(-[a-zA-Z]*s|--max-time)`
)
export type StaticCommandLevel = 'high' | 'low' | 'gray'

const IPV4_PORT =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?\b/g
const PURE_NUMBER = /^\d+$/
const FLAG = /^--?[A-Za-z][\w-]*(?:=.*)?$/

/** Subcommand / tool verbs that should never be replaced by `*`. */
const PRESERVE_TOKENS = new Set([
  'kubectl',
  'docker',
  'systemctl',
  'journalctl',
  'curl',
  'get',
  'describe',
  'logs',
  'top',
  'explain',
  'cluster-info',
  'version',
  'api-resources',
  'config',
  'auth',
  'diff',
  'wait',
  'delete',
  'apply',
  'patch',
  'edit',
  'rollout',
  'scale',
  'drain',
  'cordon',
  'create',
  'replace',
  'exec',
  'ps',
  'inspect',
  'images',
  'stats',
  'info',
  'history',
  'port',
  'compose',
  'rm',
  'rmi',
  'restart',
  'stop',
  'run',
  'status',
  'is-active',
  'list-units',
  'show',
  'list-timers',
  'cat',
  'ls',
  'echo',
  'hostname',
  'whoami',
  'uname',
  'df',
  'free',
  'ss',
  'awk',
  'grep',
  'head',
  'tail',
  'wc',
  'which',
  'find',
  'stat',
  'id',
  'pwd',
  'env',
  'printenv',
  'lsof',
  'du',
  'uptime',
  'ip',
  'mv',
  'dd',
  'kill',
  'reboot',
  'chmod',
  'chown',
  'tee',
  'pod',
  'pods',
  'deploy',
  'deployment',
  'deployments',
  'svc',
  'service',
  'services',
  'ns',
  'namespace',
  'namespaces',
  'node',
  'nodes',
  'configmap',
  'secret',
  'secrets',
  '&&',
  '||',
  '|',
  ';',
  '>',
  '>>',
  '2>',
  '2>&1'
])

/**
 * Classify with static rules only: HIGH first, then READONLY, else gray.
 */
export function classifyByStaticRules(cmd: string): StaticCommandLevel {
  if (HIGH.test(cmd)) return 'high'
  if (READONLY.test(cmd)) return 'low'
  return 'gray'
}

/** True when the command matches HIGH (used for timeout fallback). */
export function hasHighWriteVerb(cmd: string): boolean {
  return HIGH.test(cmd)
}

/**
 * Extract a human-readable verb for approval copy.
 * Prefers write verbs (`kubectl exec`); falls back to readonly verbs (`kubectl get`)
 * instead of the opaque label `change`.
 */
export function extractRiskVerb(cmd: string): string {
  const kubectlWrite = cmd.match(
    new RegExp(
      KUBECTL_BEFORE_VERB +
        String.raw`(delete|apply|patch|edit|rollout|scale|drain|cordon|create|replace|exec|port-forward)\b`,
      'i'
    )
  )
  if (kubectlWrite) return `kubectl ${kubectlWrite[1].toLowerCase()}`

  const docker = cmd.match(/\bdocker\s+(rm|rmi|restart|stop|run)\b/i)
  if (docker) return `docker ${docker[1].toLowerCase()}`

  const systemctl = cmd.match(/\bsystemctl\s+(restart|stop|start|enable|disable)\b/i)
  if (systemctl) return `systemctl ${systemctl[1].toLowerCase()}`

  const simple = cmd.match(/\b(rm|mv|dd|kill|reboot|chmod|chown|tee)\b/i)
  if (simple) return simple[1].toLowerCase()

  if (/(?<!2)>(?!\/dev\/null)/.test(cmd)) return '>'

  const kubectlRead = cmd.match(
    new RegExp(
      KUBECTL_BEFORE_VERB +
        String.raw`(get|describe|logs|top|explain|cluster-info|version|api-resources|config|auth|diff|wait)\b`,
      'i'
    )
  )
  if (kubectlRead) return `kubectl ${kubectlRead[1].toLowerCase()}`

  const dockerComposeRead = cmd.match(/\bdocker\s+compose\s+(ps|logs|config)\b/i)
  if (dockerComposeRead) return `docker compose ${dockerComposeRead[1].toLowerCase()}`

  const dockerRead = cmd.match(
    /\bdocker\s+(ps|inspect|logs|images|stats|version|info|history|port)\b/i
  )
  if (dockerRead) return `docker ${dockerRead[1].toLowerCase()}`

  return 'change'
}

/** True when static READONLY matches and HIGH does not. */
export function isStaticallyReadonly(cmd: string): boolean {
  return !HIGH.test(cmd) && READONLY.test(cmd)
}

/**
 * Whether the high-risk approval card should show the single whitelist entry.
 * Only after user approval; never while pending; hidden once already added.
 */
export function shouldShowWhitelistEntry(input: {
  phase: 'pending' | 'approved' | 'rejected'
  risk: 'low' | 'medium' | 'high'
  alreadyAdded: boolean
}): boolean {
  return input.risk === 'high' && input.phase === 'approved' && !input.alreadyAdded
}

/**
 * Normalize a command into a whitelist pattern:
 * replace pod names, namespace values, numbers, IP/ports with `*`;
 * keep flags and subcommand verbs.
 */
export function normalizeCommand(cmd: string): string {
  const trimmed = cmd.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''

  const withoutIps = trimmed.replace(IPV4_PORT, '*')
  const tokens = withoutIps.split(' ')
  const out: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue

    if (token === '*') {
      out.push('*')
      continue
    }

    // -n=ns / --namespace=ns
    const eqNs = token.match(/^(-n|--namespace)=(.*)$/)
    if (eqNs) {
      out.push(`${eqNs[1]}=*`)
      continue
    }

    // -n / --namespace followed by value
    if (token === '-n' || token === '--namespace') {
      out.push(token)
      const next = tokens[i + 1]
      if (next && !isFlagToken(next) && !PRESERVE_TOKENS.has(next.toLowerCase())) {
        out.push('*')
        i++
      }
      continue
    }

    if (isFlagToken(token)) {
      // Keep flag name; redact attached values like --tail=100 → --tail=*
      const eq = token.indexOf('=')
      if (eq > 0 && PURE_NUMBER.test(token.slice(eq + 1))) {
        out.push(`${token.slice(0, eq)}=*`)
      } else {
        out.push(token)
      }
      continue
    }

    const lower = token.toLowerCase()
    if (PRESERVE_TOKENS.has(lower)) {
      out.push(token)
      continue
    }

    if (PURE_NUMBER.test(token) || token === '/dev/null') {
      out.push(token === '/dev/null' ? token : '*')
      continue
    }

    // Resource names / hostnames / opaque identifiers → *
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(token)) {
      out.push('*')
      continue
    }

    out.push(token)
  }

  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Glob-match a command against a whitelist pattern.
 * Both sides are normalized; `*` matches one or more command tokens.
 */
export function matchGlobCommand(command: string, pattern: string): boolean {
  const cmd = normalizeCommand(command)
  const pat = normalizeCommand(pattern)
  if (!cmd || !pat) return false
  if (cmd === pat) return true

  return matchTokens(cmd.split(' '), pat.split(' '), 0, 0)
}

function matchTokens(cmd: string[], pat: string[], ci: number, pi: number): boolean {
  if (pi === pat.length) return ci === cmd.length
  if (ci > cmd.length) return false

  const p = pat[pi]
  if (p === '*') {
    if (pi === pat.length - 1) return ci < cmd.length
    for (let skip = 1; ci + skip <= cmd.length; skip++) {
      if (matchTokens(cmd, pat, ci + skip, pi + 1)) return true
    }
    return false
  }

  if (ci >= cmd.length) return false
  if (cmd[ci] !== p && cmd[ci] !== '*' && p !== '*') return false
  // Allow normalized `*` in command to match a concrete pattern token or `*`
  if (cmd[ci] === '*' || cmd[ci] === p) {
    return matchTokens(cmd, pat, ci + 1, pi + 1)
  }
  return false
}

function isFlagToken(token: string): boolean {
  return FLAG.test(token)
}
