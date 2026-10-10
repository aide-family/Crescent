import { type SimpleCommand } from '../shell-command'
import { classifyPeeledInner } from './shell-wrappers'
import { SimpleCommandRisk } from './types'

export function extractSshRemoteCommand(argv: string[]): string[] | null {
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

export function classifySsh(
  argv: string[],
  classify: (command: SimpleCommand) => SimpleCommandRisk
): SimpleCommandRisk {
  const remote = extractSshRemoteCommand(argv)
  if (!remote) return { level: 'gray', verb: 'ssh' }
  return classifyPeeledInner(remote, classify)
}
