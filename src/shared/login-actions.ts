export function looksLikeLoginCommand(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\s/.test(trimmed)) return true
  return /^(ssh|sudo|su|cd|ls|pwd|kubectl|docker|systemctl|journalctl|cat|tail|grep|vim|vi|export|bash|zsh|sh|fish|enable|exit|tmux|screen|source|passwd|env|unset|alias|history|clear|whoami|id|hostname)\b/.test(
    trimmed
  )
}
