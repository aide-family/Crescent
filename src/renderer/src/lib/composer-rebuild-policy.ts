export function shouldSkipComposerDomRebuild(input: {
  composing: boolean
  isEcho: boolean
  valueLength: number
  composerFocused: boolean
  newlineWarmup?: boolean
  canonicalEmpty?: boolean
}): boolean {
  if (input.composing || input.newlineWarmup) return true
  // Leftover Chromium BR after select-all delete is an empty echo but not the
  // pad-only surface; rebuild so the placeholder can show.
  if (input.isEcho && input.valueLength === 0 && input.canonicalEmpty === false) return false
  // Echo rebuilds abort IME (especially empty+focused after send). The first
  // non-echo clear after submit already writes the placeholder BR.
  return input.isEcho
}
