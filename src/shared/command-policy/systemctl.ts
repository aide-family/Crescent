import { firstKnownVerb } from './argv'
import { SimpleCommandRisk } from './types'

export const SYSTEMCTL_WRITE = new Set(['restart', 'reload', 'stop', 'start', 'enable', 'disable'])

export const SYSTEMCTL_READ = new Set(['status', 'is-active', 'list-units', 'show', 'list-timers'])

export function classifySystemctl(argv: string[]): SimpleCommandRisk {
  const verb = firstKnownVerb(argv, SYSTEMCTL_WRITE, SYSTEMCTL_READ)
  if (verb && SYSTEMCTL_WRITE.has(verb)) return { level: 'high', verb: `systemctl ${verb}` }
  if (argv.includes('--root') || argv.some((arg) => arg.startsWith('--root=')))
    return { level: 'gray', verb: 'systemctl root' }
  if (verb && SYSTEMCTL_READ.has(verb)) return { level: 'low', verb: `systemctl ${verb}` }
  return { level: 'gray', verb: 'systemctl' }
}
