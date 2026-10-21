/** Parse option tokens without invoking a shell or expanding substitutions. */
export function tokenizeSshOptions(lines: string[]): string[] {
  const tokens: string[] = []
  for (const line of lines) {
    if (typeof line !== 'string' || /[\r\n\0]/.test(line)) throw new Error('Invalid SSH option')
    let token = ''
    let quote = ''
    let started = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '\\' && quote !== "'") {
        if (++i === line.length) throw new Error('Incomplete SSH option escape')
        token += line[i]
        started = true
      } else if (quote) {
        if (c === quote) quote = ''
        else token += c
      } else if (c === '"' || c === "'") {
        quote = c
        started = true
      } else if (/\s/.test(c)) {
        if (started) tokens.push(token)
        token = ''
        started = false
      } else {
        if (/[;&|<>`]/.test(c) || (c === '$' && line[i + 1] === '(')) {
          throw new Error('Shell operators are not valid SSH options')
        }
        token += c
        started = true
      }
    }
    if (quote) throw new Error('Unclosed SSH option quote')
    if (started) tokens.push(token)
  }
  const values = new Set('BbcDEeFIiJLlmOoPpQRSWw'.split(''))
  const flags = new Set('46AaCfGgKkMNnqsTtVvXxYy'.split(''))
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!/^-[A-Za-z0-9]+/.test(token)) throw new Error('Expected an SSH option flag')
    for (let j = 1; j < token.length; j++) {
      const flag = token[j]
      if (values.has(flag)) {
        if (j === token.length - 1 && ++i >= tokens.length)
          throw new Error('Missing SSH option value')
        break
      }
      if (!flags.has(flag)) throw new Error(`Unsupported SSH option: -${flag}`)
    }
  }
  return tokens
}

export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function quoteSshOptions(lines: string[]): string[] {
  return tokenizeSshOptions(lines).map(shellQuote)
}
