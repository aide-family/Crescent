export function shouldCommitImeChange(composing: boolean): boolean {
  return !composing
}

/** Keep the in-progress composition; apply parent value only when idle. */
export function applyExternalImeValue(input: {
  composing: boolean
  local: string
  external: string
}): string {
  return input.composing ? input.local : input.external
}
