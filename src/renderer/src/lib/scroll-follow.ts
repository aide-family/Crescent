export const DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX = 48
export const DEFAULT_SCROLL_FOLLOW_IDLE_MS = 1500

export interface ScrollFollowDecisionInput {
  force: boolean
  nearBottom: boolean
  userScrolling: boolean
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
  return input.force || input.nearBottom || !input.userScrolling
}

/**
 * Scroll to the bottom after layout settles. Uses two animation frames so
 * markdown/mermaid/async DOM updates can affect scrollHeight first.
 */
export function scrollToBottom(el: HTMLElement): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight })
    })
  })
}
