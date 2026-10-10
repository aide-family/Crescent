import { classifyDocker } from './command-policy/docker'
import {
  hasFindMutation,
  hasSedInPlace,
  hasUnsafeInspectionArguments,
  hasYqInPlace,
  isReadonlyCurl,
  isSysctlWrite
} from './command-policy/inspection'
import { classifyKubectl } from './command-policy/kubectl'
import {
  SHELL_NAMES,
  classifyPeeledInner,
  commandBasename,
  stripWrappers
} from './command-policy/shell-wrappers'
import { classifySsh } from './command-policy/ssh'
import { classifyReadonlySudo } from './command-policy/sudo'
import { classifySystemctl } from './command-policy/systemctl'
import { SimpleCommandRisk, StaticCommandLevel } from './command-policy/types'
import { collectSimpleCommands, type SimpleCommand } from './shell-command'
export type { StaticCommandLevel } from './command-policy/types'

const KUBECTL_BEFORE_VERB = String.raw`\bkubectl(?:\s+[^\s]+)*?\s+`

export const HIGH = new RegExp(
  String.raw`\b(rm|mv|dd|kill|reboot)\b|systemctl\s+(restart|stop|start|enable|disable)|` +
    KUBECTL_BEFORE_VERB +
    String.raw`(delete|apply|patch|edit|rollout|scale|drain|cordon|create|replace)|` +
    String.raw`docker\s+(rm|rmi|restart|stop|run)|\b(chmod|chown|tee)\b`
)

export const READONLY = new RegExp(
  KUBECTL_BEFORE_VERB +
    String.raw`(get|describe|logs|top|explain|cluster-info|version|api-resources|config|auth|diff|wait)|` +
    String.raw`docker\s+(ps|inspect|logs|images|stats|version|info|history|port)|` +
    String.raw`docker\s+compose\s+(ps|logs|config)|` +
    String.raw`systemctl\s+(status|is-active|list-units|show|list-timers)|journalctl|` +
    String.raw`\b(cat|ls|echo|hostname|whoami|uname|ps|df|free|top|ss|awk|grep|head|tail|wc|which|find|stat|id|pwd|env|printenv|lsof|du|uptime|ip|sort|uniq|cut|tr|column|date|hostnamectl|jq|printf|sed)\b|` +
    String.raw`curl\s+(-[a-zA-Z]*s|--max-time)`
)

const IPV4_PORT =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?\b/g

const PURE_NUMBER = /^\d+$/

const FLAG = /^--?[A-Za-z][\w-]*(?:=.*)?$/

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
  'sort',
  'uniq',
  'cut',
  'tr',
  'column',
  'date',
  'hostnamectl',
  'jq',
  'printf',
  'sed',
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

const SIMPLE_WRITE = new Set([
  'rm',
  'mv',
  'cp',
  'install',
  'mkdir',
  'touch',
  'dd',
  'kill',
  'reboot',
  'chmod',
  'chown',
  'tee'
])

const SIMPLE_READ = new Set([
  'cmp',
  'sha256sum',
  'shasum',
  'cat',
  'ls',
  'echo',
  'printf',
  'hostname',
  'hostnamectl',
  'whoami',
  'uname',
  'ps',
  'df',
  'free',
  'top',
  'ss',
  'awk',
  'grep',
  'egrep',
  'fgrep',
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
  'sort',
  'uniq',
  'cut',
  'tr',
  'column',
  'date',
  'jq',
  'sed',
  'journalctl',
  'test',
  '[',
  'true',
  'false',
  ':'
])

export function classifyByStaticRules(cmd: string): StaticCommandLevel {
  const commands = collectSimpleCommands(cmd)
  if (!commands || commands.length === 0) return 'gray'

  let sawGray = false
  for (const command of commands) {
    const risk = classifySimpleCommand(command)
    if (risk.level === 'high') return 'high'
    if (risk.level === 'gray') sawGray = true
  }
  return sawGray ? 'gray' : 'low'
}

export function hasHighWriteVerb(cmd: string): boolean {
  return classifyByStaticRules(cmd) === 'high'
}

export function extractRiskVerb(cmd: string): string {
  const commands = collectSimpleCommands(cmd)
  if (!commands || commands.length === 0) return 'change'

  let firstLow: string | undefined
  let firstToolLow: string | undefined
  for (const command of commands) {
    const risk = classifySimpleCommand(command)
    if (risk.level === 'high') return risk.verb
    if (risk.level !== 'low') continue
    firstLow ??= risk.verb
    if (!firstToolLow && /^(kubectl|docker|systemctl)\b/.test(risk.verb)) {
      firstToolLow = risk.verb
    }
  }
  return firstToolLow ?? firstLow ?? 'change'
}

export function isStaticallyReadonly(cmd: string): boolean {
  return classifyByStaticRules(cmd) === 'low'
}

function classifySimpleCommand(command: SimpleCommand): SimpleCommandRisk {
  if (command.redirects.some((redirect) => redirect.kind === 'file')) {
    return { level: 'high', verb: '>' }
  }

  if (['env', 'nohup', 'time'].includes(commandBasename(command.argv[0] ?? '')))
    return { level: 'gray', verb: 'environment/wrapper' }
  let argv = stripWrappers(command.argv)
  if (argv[0] === '!') argv = argv.slice(1)
  const argv0 = commandBasename(argv[0] ?? '')
  if (!argv0) return { level: 'gray', verb: 'change' }

  if (SHELL_NAMES.has(argv0)) {
    if (argv.length !== 3 || argv[1] !== '-c') return { level: 'gray', verb: argv0 }
    return classifyPeeledInner(argv, classifySimpleCommand)
  }
  if (argv0 === 'sudo') return classifyReadonlySudo(argv, classifySimpleCommand)
  if (/[$`]/.test(command.raw) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(command.raw))
    return { level: 'gray', verb: argv0 }
  if (SIMPLE_WRITE.has(argv0)) return { level: 'high', verb: argv0 }

  if (argv0 === 'kubectl') return classifyKubectl(argv, classifySimpleCommand)

  if (argv0 === 'ssh') return classifySsh(argv, classifySimpleCommand)

  if (argv0 === 'docker') return classifyDocker(argv, classifySimpleCommand)

  if (argv0 === 'systemctl') return classifySystemctl(argv)

  if (argv0 === 'sed' && hasSedInPlace(argv)) return { level: 'high', verb: 'sed' }
  if (argv0 === 'sysctl' && isSysctlWrite(argv)) return { level: 'high', verb: 'sysctl' }
  if (argv0 === 'sysctl') return { level: 'low', verb: 'sysctl' }
  if (argv0 === 'find' && hasFindMutation(argv)) return { level: 'high', verb: 'find' }
  if ((argv0 === 'jq' && argv.includes('--in-place')) || (argv0 === 'yq' && hasYqInPlace(argv))) {
    return { level: 'high', verb: argv0 }
  }
  if (argv0 === 'yq') return { level: 'gray', verb: 'yq' }
  if (argv0 === 'curl') {
    return isReadonlyCurl(argv) ? { level: 'low', verb: 'curl' } : { level: 'gray', verb: 'curl' }
  }
  if (hasUnsafeInspectionArguments(argv0, argv)) return { level: 'gray', verb: argv0 }
  if (SIMPLE_READ.has(argv0)) return { level: 'low', verb: argv0 }
  return { level: 'gray', verb: argv0 }
}

export function shouldShowWhitelistEntry(input: {
  phase: 'pending' | 'approved' | 'rejected'
  risk: 'low' | 'medium' | 'high'
  alreadyAdded: boolean
}): boolean {
  return input.risk === 'high' && input.phase === 'approved' && !input.alreadyAdded
}

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
