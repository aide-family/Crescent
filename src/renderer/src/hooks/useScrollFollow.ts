import { useCallback, useEffect, useRef, type RefObject } from 'react'

import {
  DEFAULT_SCROLL_FOLLOW_IDLE_MS,
  DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX,
  isNearScrollBottom,
  scrollToBottom,
  shouldFollowScroll
} from '@renderer/lib/scroll-follow'

export interface UseScrollFollowOptions {
  thresholdPx?: number
  idleMs?: number
  /** When true, scroll to bottom regardless of user scroll state. */
  forceFollow?: boolean
}

/**
 * Auto-follow scroll for overflow containers. Pauses while the user scrolls away
 * from the bottom; resumes after idle timeout or when scrolled back near bottom.
 */
export function useScrollFollow(
  containerRef: RefObject<HTMLElement | null>,
  followSignals: readonly unknown[],
  options: UseScrollFollowOptions = {}
): {
  followNow: (force?: boolean) => void
  isFollowing: () => boolean
} {
  const thresholdPx = options.thresholdPx ?? DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX
  const idleMs = options.idleMs ?? DEFAULT_SCROLL_FOLLOW_IDLE_MS
  const forceFollow = options.forceFollow ?? false

  const userScrollingRef = useRef(false)
  const userScrollIdleTimerRef = useRef<number | null>(null)

  const followNow = useCallback(
    (force = false): void => {
      const el = containerRef.current
      if (!el) return
      const nearBottom = isNearScrollBottom(el, thresholdPx)
      if (
        shouldFollowScroll({
          force,
          nearBottom,
          userScrolling: userScrollingRef.current
        })
      ) {
        scrollToBottom(el)
      }
    },
    [containerRef, thresholdPx]
  )

  const isFollowing = useCallback((): boolean => {
    const el = containerRef.current
    if (!el) return true
    return !userScrollingRef.current || isNearScrollBottom(el, thresholdPx)
  }, [containerRef, thresholdPx])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observedNodes = new Set<Element>()

    const observeNode = (node: Element): void => {
      if (observedNodes.has(node)) return
      observedNodes.add(node)
      resizeObserver.observe(node)
    }

    const observeSubtree = (root: Element): void => {
      observeNode(root)
      for (const child of root.children) {
        observeSubtree(child)
      }
    }

    const resizeObserver = new ResizeObserver(() => followNow(false))
    observeSubtree(el)

    let mutationFrame: number | null = null
    const mutationObserver = new MutationObserver(() => {
      if (mutationFrame != null) return
      mutationFrame = window.requestAnimationFrame(() => {
        mutationFrame = null
        for (const node of observedNodes) {
          if (!el.contains(node)) observedNodes.delete(node)
        }
        observeSubtree(el)
        followNow(false)
      })
    })
    mutationObserver.observe(el, { childList: true, subtree: true })

    const handleScroll = (): void => {
      const nearBottom = isNearScrollBottom(el, thresholdPx)
      if (nearBottom) {
        userScrollingRef.current = false
        if (userScrollIdleTimerRef.current != null) {
          window.clearTimeout(userScrollIdleTimerRef.current)
          userScrollIdleTimerRef.current = null
        }
        return
      }
      userScrollingRef.current = true
      if (userScrollIdleTimerRef.current != null) {
        window.clearTimeout(userScrollIdleTimerRef.current)
      }
      userScrollIdleTimerRef.current = window.setTimeout(() => {
        userScrollingRef.current = false
        userScrollIdleTimerRef.current = null
      }, idleMs)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    followNow(forceFollow)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (userScrollIdleTimerRef.current != null) {
        window.clearTimeout(userScrollIdleTimerRef.current)
        userScrollIdleTimerRef.current = null
      }
      if (mutationFrame != null) {
        window.cancelAnimationFrame(mutationFrame)
      }
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      observedNodes.clear()
    }
    // followSignals + forceFollow drive re-follow when content or policy changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, followNow, forceFollow, idleMs, thresholdPx, ...followSignals])

  return { followNow, isFollowing }
}
