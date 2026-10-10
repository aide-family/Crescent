import { type SimpleCommand } from '../shell-command'
import { findVerbIndex } from './argv'
import { classifyPeeledInner } from './shell-wrappers'
import { SimpleCommandRisk } from './types'

export const DOCKER_WRITE = new Set(['rm', 'rmi', 'restart', 'stop', 'run'])

export const DOCKER_READ = new Set([
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

export const DOCKER_COMPOSE_READ = new Set(['ps', 'logs', 'config'])

export const DOCKER_EXEC_FLAGS_WITH_VALUE = new Set([
  '-e',
  '--env',
  '-u',
  '--user',
  '-w',
  '--workdir'
])

export function skipDockerExecFlags(argv: string[], start: number): number {
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

export function extractDockerExecInner(argv: string[]): string[] | null {
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

export function dockerSubcommand(argv: string[]): { compose: boolean; verb: string } {
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

export function classifyDocker(
  argv: string[],
  classify: (command: SimpleCommand) => SimpleCommandRisk
): SimpleCommandRisk {
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
    return classifyPeeledInner(inner, classify)
  }
  if (DOCKER_WRITE.has(parsed.verb)) return { level: 'high', verb: `docker ${parsed.verb}` }
  if (DOCKER_READ.has(parsed.verb)) return { level: 'low', verb: `docker ${parsed.verb}` }
  return { level: 'gray', verb: 'docker' }
}
