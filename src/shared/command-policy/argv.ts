export function findVerbIndex(argv: string[], verb: string): number {
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '--') break
    if (token.startsWith('-')) continue
    if (token.toLowerCase() === verb) return i
  }
  return -1
}

export function firstKnownVerb(
  argv: string[],
  write: Set<string>,
  read: Set<string>
): string | undefined {
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
