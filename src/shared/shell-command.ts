/**
 * Bounded POSIX simple-command parser for command-risk classification.
 * Covers lists (`;` `&&` `||`), pipelines (`|`), quotes, redirects, and
 * `$(...)` / backtick substitution. Not a full bash grammar.
 */

export type RedirectKind = 'file' | 'fd-dup' | 'dev-null' | 'input'

export interface ShellRedirect {
  operator: string
  target: string
  kind: RedirectKind
}

export interface SimpleCommand {
  argv: string[]
  redirects: ShellRedirect[]
  raw: string
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * Walk a script into simple commands, including those inside `$(...)`
 * and backticks. Returns null when quotes or substitutions are unclosed.
 */
export function collectSimpleCommands(script: string): SimpleCommand[] | null {
  const top = parseSimpleCommands(script)
  if (!top) return null

  const substitutions = extractTopLevelSubstitutions(script)
  if (!substitutions) return null

  const all = [...top]
  for (const inner of substitutions) {
    const nested = collectSimpleCommands(inner)
    if (!nested) return null
    all.push(...nested)
  }
  return all
}

function parseSimpleCommands(script: string): SimpleCommand[] | null {
  const lists = splitList(script)
  if (!lists) return null

  const commands: SimpleCommand[] = []
  for (const list of lists) {
    const stages = splitPipeline(list)
    if (!stages) return null
    for (const stage of stages) {
      const parsed = parseSimpleCommand(stage)
      if (!parsed) return null
      if (parsed.argv.length === 0 && parsed.redirects.length === 0) continue
      commands.push(parsed)
    }
  }
  return commands
}

function splitList(script: string): string[] | null {
  return splitOnMeta(script, 'list')
}

function splitPipeline(script: string): string[] | null {
  return splitOnMeta(script, 'pipe')
}

function splitOnMeta(script: string, mode: 'list' | 'pipe'): string[] | null {
  const parts: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let inBacktick = false
  let substDepth = 0

  const push = (): void => {
    const trimmed = current.trim()
    if (trimmed) parts.push(trimmed)
    current = ''
  }

  for (let i = 0; i < script.length; i++) {
    const ch = script[i]
    const next = script[i + 1] ?? ''

    if (quote === "'") {
      current += ch
      if (ch === "'") quote = null
      continue
    }

    if (quote === '"') {
      current += ch
      if (ch === '\\') {
        current += next
        i += 1
        continue
      }
      if (ch === '"') quote = null
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }

    if (ch === '`') {
      inBacktick = !inBacktick
      current += ch
      continue
    }

    if (!inBacktick && ch === '$' && next === '(') {
      substDepth += 1
      current += '$('
      i += 1
      continue
    }

    if (substDepth > 0 && ch === '(') {
      substDepth += 1
      current += ch
      continue
    }

    if (substDepth > 0 && ch === ')') {
      substDepth -= 1
      current += ch
      continue
    }

    if (substDepth > 0 || inBacktick) {
      current += ch
      continue
    }

    if (mode === 'list') {
      if (ch === '\n' || ch === '\r') {
        push()
        continue
      }
      if (ch === ';') {
        push()
        continue
      }
      if (ch === '&' && next === '&') {
        push()
        i += 1
        continue
      }
      if (ch === '|' && next === '|') {
        push()
        i += 1
        continue
      }
      if (ch === '&' && next !== '>' && script[i - 1] !== '>' && script[i - 1] !== '<') {
        push()
        continue
      }
    } else if (ch === '|' && next !== '|') {
      push()
      continue
    }

    current += ch
  }

  if (quote || substDepth > 0 || inBacktick) return null
  push()
  return parts
}

function parseSimpleCommand(raw: string): SimpleCommand | null {
  const argv: string[] = []
  const redirects: ShellRedirect[] = []
  let i = 0
  const s = raw.trim()
  if (!s) return { argv, redirects, raw: s }

  while (i < s.length) {
    while (i < s.length && isWs(s[i] ?? '')) i += 1
    if (i >= s.length) break

    const redirect = tryParseRedirect(s, i)
    if (redirect) {
      redirects.push(redirect.redirect)
      i = redirect.next
      continue
    }

    const word = tryParseWord(s, i)
    if (!word) return null
    if (argv.length === 0 && ASSIGN.test(word.value) && !word.value.includes(' ')) {
      i = word.next
      continue
    }
    argv.push(word.value)
    i = word.next
  }

  return { argv, redirects, raw: s }
}

function tryParseRedirect(s: string, i: number): { redirect: ShellRedirect; next: number } | null {
  let j = i
  while (j < s.length && isDigit(s[j] ?? '')) j += 1

  let operator = ''
  if (s[j] === '&' && s[j + 1] === '>') {
    operator = s[j + 2] === '>' ? '&>>' : '&>'
    j += operator.length
  } else if (s[j] === '>' && s[j + 1] === '>') {
    operator = '>>'
    j += 2
  } else if (s[j] === '>') {
    operator = '>'
    j += 1
  } else if (s[j] === '<' && s[j + 1] === '<') {
    operator = '<<'
    j += 2
  } else if (s[j] === '<') {
    operator = '<'
    j += 1
  } else {
    return null
  }

  if (j < s.length && s[j] === '&' && operator !== '&>' && operator !== '&>>') {
    const fdStart = j
    j += 1
    if (s[j] === '-') {
      j += 1
    } else {
      while (j < s.length && isDigit(s[j] ?? '')) j += 1
    }
    const target = s.slice(fdStart, j)
    return {
      redirect: { operator, target, kind: classifyRedirect(operator, target) },
      next: j
    }
  }

  while (j < s.length && isWs(s[j] ?? '')) j += 1
  const targetWord = tryParseWord(s, j)
  if (!targetWord) return null
  const target = targetWord.value
  return {
    redirect: { operator, target, kind: classifyRedirect(operator, target) },
    next: targetWord.next
  }
}

function classifyRedirect(operator: string, target: string): RedirectKind {
  if (operator.startsWith('<')) return 'input'
  if (target === '/dev/null') return 'dev-null'
  if (/^&\d+$/.test(target) || target === '&-') return 'fd-dup'
  return 'file'
}

function tryParseWord(s: string, i: number): { value: string; next: number } | null {
  if (i >= s.length) return null
  let j = i
  let value = ''
  let consumed = false

  while (j < s.length && !isWs(s[j] ?? '') && !isUnquotedMeta(s, j)) {
    const ch = s[j] ?? ''
    if (ch === "'") {
      const end = s.indexOf("'", j + 1)
      if (end < 0) return null
      value += s.slice(j + 1, end)
      j = end + 1
      consumed = true
      continue
    }
    if (ch === '"') {
      const quoted = readDoubleQuoted(s, j)
      if (!quoted) return null
      value += quoted.value
      j = quoted.next
      consumed = true
      continue
    }
    if (ch === '$' && s[j + 1] === '(') {
      const subst = readSubst(s, j)
      if (!subst) return null
      value += subst.raw
      j = subst.next
      consumed = true
      continue
    }
    if (ch === '`') {
      const tick = readBacktick(s, j)
      if (!tick) return null
      value += tick.raw
      j = tick.next
      consumed = true
      continue
    }
    value += ch
    j += 1
    consumed = true
  }

  if (!consumed) return null
  return { value, next: j }
}

function readDoubleQuoted(s: string, i: number): { value: string; next: number } | null {
  let j = i + 1
  let value = ''
  while (j < s.length) {
    const ch = s[j] ?? ''
    if (ch === '\\') {
      value += s[j + 1] ?? ''
      j += 2
      continue
    }
    if (ch === '"') return { value, next: j + 1 }
    value += ch
    j += 1
  }
  return null
}

function readSubst(s: string, i: number): { inner: string; raw: string; next: number } | null {
  if (s[i] !== '$' || s[i + 1] !== '(') return null
  let j = i + 2
  let depth = 1
  let quote: "'" | '"' | null = null
  const innerStart = j
  while (j < s.length && depth > 0) {
    const ch = s[j] ?? ''
    if (quote === "'") {
      if (ch === "'") quote = null
      j += 1
      continue
    }
    if (quote === '"') {
      if (ch === '\\') {
        j += 2
        continue
      }
      if (ch === '"') quote = null
      j += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      j += 1
      continue
    }
    if (ch === '(') {
      depth += 1
      j += 1
      continue
    }
    if (ch === ')') {
      depth -= 1
      if (depth === 0) break
      j += 1
      continue
    }
    j += 1
  }
  if (depth !== 0) return null
  return { inner: s.slice(innerStart, j), raw: s.slice(i, j + 1), next: j + 1 }
}

function readBacktick(s: string, i: number): { inner: string; raw: string; next: number } | null {
  const end = s.indexOf('`', i + 1)
  if (end < 0) return null
  return { inner: s.slice(i + 1, end), raw: s.slice(i, end + 1), next: end + 1 }
}

function extractTopLevelSubstitutions(script: string): string[] | null {
  const out: string[] = []
  let i = 0
  let quote: "'" | '"' | null = null
  while (i < script.length) {
    const ch = script[i] ?? ''
    if (quote === "'") {
      if (ch === "'") quote = null
      i += 1
      continue
    }
    if (quote === '"') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '"') {
        quote = null
        i += 1
        continue
      }
      if (ch === '$' && script[i + 1] === '(') {
        const subst = readSubst(script, i)
        if (!subst) return null
        out.push(subst.inner)
        i = subst.next
        continue
      }
      if (ch === '`') {
        const tick = readBacktick(script, i)
        if (!tick) return null
        out.push(tick.inner)
        i = tick.next
        continue
      }
      i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      i += 1
      continue
    }
    if (ch === '$' && script[i + 1] === '(') {
      const subst = readSubst(script, i)
      if (!subst) return null
      out.push(subst.inner)
      i = subst.next
      continue
    }
    if (ch === '`') {
      const tick = readBacktick(script, i)
      if (!tick) return null
      out.push(tick.inner)
      i = tick.next
      continue
    }
    i += 1
  }
  if (quote) return null
  return out
}

function isUnquotedMeta(s: string, i: number): boolean {
  const ch = s[i] ?? ''
  if (ch === '|' || ch === ';' || ch === '<' || ch === '>' || ch === '(' || ch === ')') return true
  if (ch === '&') return true
  return false
}

function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}
