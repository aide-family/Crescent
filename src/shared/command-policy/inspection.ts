export function hasUnsafeInspectionArguments(name: string, argv: string[]): boolean {
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

export function hasSedInPlace(argv: string[]): boolean {
  return argv
    .slice(1)
    .some((arg) => arg === '-i' || arg.startsWith('--in-place') || /^-i./.test(arg))
}

export function isSysctlWrite(argv: string[]): boolean {
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

export function hasFindMutation(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === '-delete' ||
      arg === '-exec' ||
      arg === '-ok' ||
      arg === '-execdir' ||
      arg === '-okdir'
  )
}

export function hasYqInPlace(argv: string[]): boolean {
  return argv.includes('-i') || argv.includes('--inplace') || argv.includes('--in-place')
}

export function isReadonlyCurl(_argv: string[]): boolean {
  // HTTP GET endpoints can mutate state; transport flags cannot prove read-only semantics.
  return false
}
