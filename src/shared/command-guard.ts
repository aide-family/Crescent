import { collectSimpleCommands, type SimpleCommand } from './shell-command'

/**
 * kubectl may place flags/args between the binary and the verb
 * (`kubectl -n ns get cm`). Match non-greedily up to the first verb token.
 */
const KUBECTL_BEFORE_VERB = String.raw`\bkubectl(?:\s+[^\s]+)*?\s+`

/** Destructive / state-changing shell verbs (substring regex; redirects use the AST). */
export const HIGH = new RegExp(
  String.raw`\b(rm|mv|dd|kill|reboot)\b|systemctl\s+(restart|stop|start|enable|disable)|` +
    KUBECTL_BEFORE_VERB +
    String.raw`(delete|apply|patch|edit|rollout|scale|drain|cordon|create|replace)|` +
    String.raw`docker\s+(rm|rmi|restart|stop|run)|\b(chmod|chown|tee)\b`
)

/** Clearly read-only inspection patterns. */
export const READONLY = new RegExp(
  KUBECTL_BEFORE_VERB +
    String.raw`(get|describe|logs|top|explain|cluster-info|version|api-resources|config|auth|diff|wait)|` +
    String.raw`docker\s+(ps|inspect|logs|images|stats|version|info|history|port)|` +
    String.raw`docker\s+compose\s+(ps|logs|config)|` +
    String.raw`systemctl\s+(status|is-active|list-units|show|list-timers)|journalctl|` +
    String.raw`\b(cat|ls|echo|hostname|whoami|uname|ps|df|free|top|ss|awk|grep|head|tail|wc|which|find|stat|id|pwd|env|printenv|lsof|du|uptime|ip|sort|uniq|cut|tr|column|date|hostnamectl|jq|printf|sed)\b|` +
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

const KUBECTL_WRITE = new Set([
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
  'port-forward'
])
const KUBECTL_READ = new Set([
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
  'wait'
])
const DOCKER_WRITE = new Set(['rm', 'rmi', 'restart', 'stop', 'run'])
const DOCKER_READ = new Set([
  'ps',
  'inspect',
  'logs',
  'images',
  'stats',
  'version',
  'info',
  'history',
  'port'
])
const DOCKER_COMPOSE_READ = new Set(['ps', 'logs', 'config'])
const SYSTEMCTL_WRITE = new Set(['restart', 'reload', 'stop', 'start', 'enable', 'disable'])
const SYSTEMCTL_READ = new Set(['status', 'is-active', 'list-units', 'show', 'list-timers'])
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
const DURATION = /^(?:\d+(?:\.\d+)?)[smhd]?$/

const KUBECTL_EXEC_FLAGS_WITH_VALUE = new Set([
  '-c',
  '--container',
  '-n',
  '--namespace',
  '--kubeconfig',
  '--context'
])
const DOCKER_EXEC_FLAGS_WITH_VALUE = new Set(['-e', '--env', '-u', '--user', '-w', '--workdir'])
const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

interface SimpleCommandRisk {
  level: StaticCommandLevel
  verb: string
}

/**
 * Classify with static rules only: walk every simple command (including `$(...)`).
 * HIGH if any write verb or file redirect; LOW only if every command is inspection.
 */
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

/** True when the command is statically HIGH (used for timeout fallback). */
export function hasHighWriteVerb(cmd: string): boolean {
  return classifyByStaticRules(cmd) === 'high'
}

/**
 * Extract a human-readable verb for approval copy.
 * Prefers write verbs from inner commands; falls back to readonly verbs (`kubectl get`)
 * instead of the opaque label `change`.
 */
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

/** True when every simple command is a known inspection command. */
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
    return classifyPeeledInner(argv)
  }
  if (argv0 === 'sudo') return classifyReadonlySudo(argv)
  if (/[$`]/.test(command.raw) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(command.raw))
    return { level: 'gray', verb: argv0 }
  if (SIMPLE_WRITE.has(argv0)) return { level: 'high', verb: argv0 }

  if (argv0 === 'kubectl') {
    const verb = firstKnownVerb(argv, KUBECTL_WRITE, KUBECTL_READ)
    if (verb === 'exec' || findVerbIndex(argv, 'exec') >= 0) {
      const inner = extractKubectlExecInner(argv)
      if (!inner) return { level: 'gray', verb: 'kubectl exec' }
      return classifyPeeledInner(inner)
    }
    if (verb && KUBECTL_WRITE.has(verb)) return { level: 'high', verb: `kubectl ${verb}` }
    if (
      verb === 'config' &&
      !argv.some((arg) => ['current-context', 'get-contexts', 'view'].includes(arg))
    )
      return { level: 'gray', verb: 'kubectl config' }
    if (verb === 'auth' && !argv.includes('can-i')) return { level: 'gray', verb: 'kubectl auth' }
    if (argv.some((arg) => /^(secrets?|--raw)(=|$)/i.test(arg)))
      return { level: 'gray', verb: 'kubectl sensitive query' }
    if (verb && KUBECTL_READ.has(verb)) return { level: 'low', verb: `kubectl ${verb}` }
    return { level: 'gray', verb: 'kubectl' }
  }

  if (argv0 === 'ssh') {
    const remote = extractSshRemoteCommand(argv)
    if (!remote) return { level: 'gray', verb: 'ssh' }
    return classifyPeeledInner(remote)
  }

  if (argv0 === 'docker') {
    const parsed = dockerSubcommand(argv)
    if (parsed.compose) {
      if (DOCKER_COMPOSE_READ.has(parsed.verb)) {
        return { level: 'low', verb: `docker compose ${parsed.verb}` }
      }
      return { level: 'gray', verb: 'docker compose' }
    }
    if (parsed.verb === 'exec') {
      if (argv.some((arg) => /^(-e|--env|--privileged)(=|$)/.test(arg)))
        return { level: 'gray', verb: 'docker exec environment' }
      const inner = extractDockerExecInner(argv)
      if (!inner) return { level: 'gray', verb: 'docker exec' }
      return classifyPeeledInner(inner)
    }
    if (DOCKER_WRITE.has(parsed.verb)) return { level: 'high', verb: `docker ${parsed.verb}` }
    if (DOCKER_READ.has(parsed.verb)) return { level: 'low', verb: `docker ${parsed.verb}` }
    return { level: 'gray', verb: 'docker' }
  }

  if (argv0 === 'systemctl') {
    const verb = firstKnownVerb(argv, SYSTEMCTL_WRITE, SYSTEMCTL_READ)
    if (verb && SYSTEMCTL_WRITE.has(verb)) return { level: 'high', verb: `systemctl ${verb}` }
    if (argv.includes('--root') || argv.some((arg) => arg.startsWith('--root=')))
      return { level: 'gray', verb: 'systemctl root' }
    if (verb && SYSTEMCTL_READ.has(verb)) return { level: 'low', verb: `systemctl ${verb}` }
    return { level: 'gray', verb: 'systemctl' }
  }

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

function stripWrappers(argv: string[]): string[] {
  let current = [...argv]
  for (let guard = 0; guard < 8 && current.length > 0; guard++) {
    const cmd = commandBasename(current[0] ?? '')
    if (cmd === 'timeout') {
      current = skipTimeout(current)
      continue
    }
    if (cmd === 'command') {
      current = current.slice(1)
      while (current[0]?.startsWith('-')) current = current.slice(1)
      continue
    }
    if (cmd === 'nice' || cmd === 'stdbuf' || cmd === 'nohup' || cmd === 'time') {
      current = current.slice(1)
      while (current[0]?.startsWith('-')) {
        const flag = current[0]
        if (
          (flag === '-n' || flag === '-e' || flag === '-o' || flag === '-i') &&
          !flag.includes('=')
        ) {
          current = current.slice(2)
          continue
        }
        current = current.slice(1)
      }
      continue
    }
    if (cmd === 'env') {
      let i = 1
      while (i < current.length && current[i]?.startsWith('-') && !ASSIGN.test(current[i] ?? '')) {
        if (current[i] === '-u' || current[i] === '--unset') i += 2
        else i += 1
      }
      while (i < current.length && ASSIGN.test(current[i] ?? '')) i += 1
      if (i >= current.length) return current
      current = current.slice(i)
      continue
    }
    break
  }
  return current
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

function skipTimeout(argv: string[]): string[] {
  let i = 1
  while (i < argv.length && argv[i]?.startsWith('-')) {
    const flag = argv[i] ?? ''
    if (
      (flag === '-k' || flag === '--kill-after' || flag === '-s' || flag === '--signal') &&
      !flag.includes('=')
    ) {
      i += 2
      continue
    }
    i += 1
  }
  if (i < argv.length && DURATION.test(argv[i] ?? '')) i += 1
  return argv.slice(i)
}

function commandBasename(token: string): string {
  const parts = token.replace(/\\/g, '/').split('/')
  return (parts[parts.length - 1] ?? token).toLowerCase()
}

/**
 * Classify the inner/remote command after peeling kubectl exec, ssh, or docker exec.
 * Also unwraps `sh -c 'script'` before classification.
 */
function classifyPeeledInner(innerArgv: string[]): SimpleCommandRisk {
  const unwrapped = unwrapShellScript(innerArgv)
  const innerStr = unwrapped ?? innerArgv.join(' ')
  if (!innerStr.trim()) return { level: 'gray', verb: 'change' }

  const commands = collectSimpleCommands(innerStr)
  if (!commands || commands.length === 0) return { level: 'gray', verb: 'change' }

  let sawGray = false
  let firstVerb: string | undefined
  for (const cmd of commands) {
    const risk = classifySimpleCommand(cmd)
    if (risk.level === 'high') return risk
    if (risk.level === 'gray') sawGray = true
    firstVerb ??= risk.verb
  }
  if (sawGray) return { level: 'gray', verb: firstVerb ?? 'change' }
  return { level: 'low', verb: firstVerb ?? 'change' }
}

function unwrapShellScript(argv: string[]): string | null {
  if (argv.length < 2) return null
  const shell = commandBasename(argv[0] ?? '')
  if (!SHELL_NAMES.has(shell)) return null

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '-c' || token === '--command') {
      return argv[i + 1] ?? null
    }
    if (token.startsWith('-c') && token.length > 2) {
      return token.slice(2)
    }
  }
  return null
}

function findVerbIndex(argv: string[], verb: string): number {
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '--') break
    if (token.startsWith('-')) continue
    if (token.toLowerCase() === verb) return i
  }
  return -1
}

function skipKubectlExecFlags(argv: string[], start: number): number {
  let i = start
  while (i < argv.length) {
    const token = argv[i] ?? ''
    if (token === '--') return i
    if (!token.startsWith('-')) return i

    const eq = token.indexOf('=')
    if (eq > 0) {
      i += 1
      continue
    }
    const lower = token.toLowerCase()
    if (KUBECTL_EXEC_FLAGS_WITH_VALUE.has(lower)) {
      i += 2
      continue
    }
    if (lower === '-i' || lower === '-t' || lower === '-it') {
      i += 1
      continue
    }
    i += 1
  }
  return i
}

function extractKubectlExecInner(argv: string[]): string[] | null {
  const execIdx = findVerbIndex(argv, 'exec')
  if (execIdx < 0) return null

  let i = skipKubectlExecFlags(argv, execIdx + 1)
  if (i >= argv.length) return null

  if (argv[i] === '--') {
    const rest = argv.slice(i + 1)
    return rest.length > 0 ? rest : null
  }

  i += 1
  if (i >= argv.length) return null

  if (argv[i] === '--') {
    const rest = argv.slice(i + 1)
    return rest.length > 0 ? rest : null
  }

  const rest = argv.slice(i)
  return rest.length > 0 ? rest : null
}

function skipDockerExecFlags(argv: string[], start: number): number {
  let i = start
  while (i < argv.length) {
    const token = argv[i] ?? ''
    if (token === '--') return i
    if (!token.startsWith('-')) return i

    const eq = token.indexOf('=')
    if (eq > 0) {
      i += 1
      continue
    }
    const lower = token.toLowerCase()
    if (DOCKER_EXEC_FLAGS_WITH_VALUE.has(lower)) {
      i += 2
      continue
    }
    if (lower === '-i' || lower === '-t' || lower === '-it') {
      i += 1
      continue
    }
    i += 1
  }
  return i
}

function extractDockerExecInner(argv: string[]): string[] | null {
  const execIdx = findVerbIndex(argv, 'exec')
  if (execIdx < 0) return null

  let i = skipDockerExecFlags(argv, execIdx + 1)
  if (i >= argv.length) return null

  if (argv[i] === '--') {
    const rest = argv.slice(i + 1)
    return rest.length > 0 ? rest : null
  }

  i += 1
  if (i >= argv.length) return null

  if (argv[i] === '--') {
    const rest = argv.slice(i + 1)
    return rest.length > 0 ? rest : null
  }

  const rest = argv.slice(i)
  return rest.length > 0 ? rest : null
}

function extractSshRemoteCommand(argv: string[]): string[] | null {
  let i = 1
  while (i < argv.length && argv[i].startsWith('-')) {
    const token = argv[i++]
    if (['-T', '-n', '-q', '-4', '-6'].includes(token)) continue
    if (['-p', '-l', '-i'].includes(token)) {
      if (!argv[i] || argv[i].startsWith('-')) return null
      i++
      continue
    }
    if (token === '-o' || token.startsWith('-o')) {
      const option = token === '-o' ? argv[i++] : token.slice(2)
      if (
        !option ||
        !/^(BatchMode=yes|ConnectTimeout=\d+|StrictHostKeyChecking=yes|IdentitiesOnly=yes)$/i.test(
          option
        )
      )
        return null
      continue
    }
    // Forwards, local commands, alternate config and interactive flags are not queries.
    return null
  }
  const host = argv[i++]
  if (!host || !/^[\w.@:[\]-]+$/.test(host) || i >= argv.length) return null
  return argv.slice(i)
}

function classifyReadonlySudo(argv: string[]): SimpleCommandRisk {
  let i = 1
  if (argv[i] === '-n' || argv[i] === '--non-interactive') i++
  if (argv[i] === '--') i++
  const inner = argv.slice(i)
  const name = commandBasename(inner[0] ?? '')
  // Deliberately narrow: no shell, arbitrary file reader, env override, pager or script.
  if (
    !['systemctl', 'kubectl', 'docker', 'ss', 'df', 'free', 'stat', 'id', 'uname'].includes(name)
  ) {
    return { level: 'high', verb: 'sudo' }
  }
  if (
    inner.some((arg) =>
      /secret|token|credential|shadow|kubeconfig|exec|config|inspect|logs/i.test(arg)
    )
  ) {
    return { level: 'high', verb: 'sudo sensitive/indirect command' }
  }
  if (name === 'systemctl' && !inner.includes('--no-pager'))
    return { level: 'high', verb: 'sudo pager' }
  const risk = classifySimpleCommand({ argv: inner, redirects: [], raw: inner.join(' ') })
  return risk.level === 'low' ? risk : { level: 'high', verb: 'sudo ' + risk.verb }
}

function hasUnsafeInspectionArguments(name: string, argv: string[]): boolean {
  const args = argv.slice(1)
  if (
    args.some((arg) =>
      /(?:^|\/)(?:shadow|gshadow|id_rsa|id_ed25519|credentials|\.env)(?:$|[./])/.test(arg)
    )
  )
    return true
  if (['env', 'printenv', 'awk', 'sed', 'yq'].includes(name)) return true
  if (name === 'find' && args.some((arg) => ['-fprint', '-fprintf', '-fls'].includes(arg)))
    return true
  if (name === 'sort' && args.some((arg) => /^(-o|--output|--compress-program)/.test(arg)))
    return true
  if (name === 'uniq' && args.filter((arg) => !arg.startsWith('-')).length > 1) return true
  if (name === 'ss' && args.some((arg) => ['-K', '--kill'].includes(arg))) return true
  if (name === 'shasum' && args.some((arg) => ['-c', '--check'].includes(arg))) return true
  if (
    name === 'jq' &&
    args.some((arg) => /^(-L|--argfile|--rawfile|--slurpfile|--from-file|-f)/.test(arg))
  )
    return true
  if (name === 'date' && args.some((arg) => /^(-s|--set)/.test(arg))) return true
  if (name === 'hostname' && args.some((arg) => !arg.startsWith('-'))) return true
  if (name === 'hostnamectl' && args.some((arg) => arg.startsWith('set-'))) return true
  if (
    name === 'ip' &&
    args.some((arg) => /^(add|del|delete|replace|change|set|flush|exec|netns|batch)$/.test(arg))
  )
    return true
  if (
    name === 'journalctl' &&
    args.some((arg) => /vacuum|rotate|flush|sync|setup-keys|update-catalog/.test(arg))
  )
    return true
  return false
}

function firstKnownVerb(argv: string[], write: Set<string>, read: Set<string>): string | undefined {
  const valued = new Set([
    '-n',
    '--namespace',
    '--context',
    '--kubeconfig',
    '--server',
    '-s',
    '--as',
    '--as-group',
    '--request-timeout',
    '--field-selector',
    '--selector',
    '-l',
    '--type',
    '-t',
    '--state',
    '--property',
    '-p',
    '--host',
    '-H',
    '--machine',
    '-M'
  ])
  let i = 1
  while (i < argv.length && argv[i].startsWith('-')) {
    const flag = argv[i++]
    if (valued.has(flag)) i++
    else if (
      !flag.includes('=') &&
      ![
        '--no-pager',
        '--no-legend',
        '--plain',
        '--all',
        '-a',
        '--user',
        '--system',
        '--quiet',
        '-q'
      ].includes(flag)
    )
      return undefined
  }
  const verb = argv[i]
  return write.has(verb) || read.has(verb) ? verb : undefined
}

function dockerSubcommand(argv: string[]): { compose: boolean; verb: string } {
  let i = 1
  while (i < argv.length && argv[i]?.startsWith('-')) {
    const flag = argv[i] ?? ''
    if (
      (flag === '-H' || flag === '--host' || flag === '--context' || flag === '-c') &&
      !flag.includes('=')
    ) {
      i += 2
      continue
    }
    i += 1
  }
  if ((argv[i] ?? '').toLowerCase() === 'compose') {
    i += 1
    while (i < argv.length && argv[i]?.startsWith('-')) i += 1
    return { compose: true, verb: (argv[i] ?? '').toLowerCase() }
  }
  return { compose: false, verb: (argv[i] ?? '').toLowerCase() }
}

function hasSedInPlace(argv: string[]): boolean {
  return argv
    .slice(1)
    .some((arg) => arg === '-i' || arg.startsWith('--in-place') || /^-i./.test(arg))
}

function isSysctlWrite(argv: string[]): boolean {
  return argv
    .slice(1)
    .some(
      (arg) =>
        arg === '-w' ||
        arg === '--write' ||
        arg === '-p' ||
        arg === '--system' ||
        arg.startsWith('--load') ||
        (/^[^=-]+=/.test(arg) && !arg.startsWith('-'))
    )
}

function hasFindMutation(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === '-delete' ||
      arg === '-exec' ||
      arg === '-ok' ||
      arg === '-execdir' ||
      arg === '-okdir'
  )
}

function hasYqInPlace(argv: string[]): boolean {
  return argv.includes('-i') || argv.includes('--inplace') || argv.includes('--in-place')
}

function isReadonlyCurl(_argv: string[]): boolean {
  // HTTP GET endpoints can mutate state; transport flags cannot prove read-only semantics.
  return false
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
