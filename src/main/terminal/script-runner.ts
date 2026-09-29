/**
 * Keep every physical PTY input line below the canonical line-buffer limit
 * (macOS commonly uses 1024 bytes). Never duplicate a long encoded script on
 * one interactive input line. A compound block is parsed before execution.
 */
export function createPtyScriptRunner(script: string): string {
  const encoded = Buffer.from(script, 'utf8').toString('base64')
  const chunks = encoded.match(/.{1,256}/g) ?? ['']
  return [
    '{',
    '__crescent_script=$(mktemp "${TMPDIR:-/tmp}/crescent.XXXXXX") &&',
    `__crescent_encoded='${chunks.join('\n')}' &&`,
    '{ printf %s "$__crescent_encoded" | base64 -d > "$__crescent_script" 2>/dev/null ||',
    'printf %s "$__crescent_encoded" | base64 -D > "$__crescent_script"; } &&',
    '. "$__crescent_script"',
    'rm -f "$__crescent_script"',
    'stty echo 2>/dev/null',
    'unset __crescent_script __crescent_encoded __crescent_status',
    '}\r'
  ].join('\n')
}
