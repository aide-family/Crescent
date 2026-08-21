export function shouldSkipComposerDomRebuild(input: {
  composing: boolean
  isEcho: boolean
  valueLength: number
  composerFocused: boolean
}): boolean {
  if (input.composing) return true
  if (!input.isEcho) return false
  if (input.valueLength > 0) return true
  return !input.composerFocused
}
