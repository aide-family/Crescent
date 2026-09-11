export const DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX = 48

export interface ScrollFollowDecisionInput {
  force: boolean
  /** Sticky pin: user was at the bottom before this update (or we just followed). */
  following: boolean
}

/** Whether the scroll viewport is within `thresholdPx` of the bottom edge. */
export function isNearScrollBottom(
  el: HTMLElement,
  thresholdPx = DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx
}

/** Whether auto-follow should scroll to the latest content. */
export function shouldFollowScroll(input: ScrollFollowDecisionInput): boolean {
  return input.force || input.following
}

/**
 * Scroll to the bottom after layout settles. Uses two animation frames so
 * markdown/mermaid/async DOM updates can affect scrollHeight first.
 */
export function scrollToBottom(el: HTMLElement, onSettled?: () => void): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight })
      onSettled?.()
    })
  })
}
