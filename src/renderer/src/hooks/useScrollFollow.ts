import { useCallback, useEffect, useRef, type RefObject } from 'react'

import {
  DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX,
  isNearScrollBottom,
  scrollToBottom,
  shouldFollowScroll
} from '@renderer/lib/scroll-follow'

export interface UseScrollFollowOptions {
  thresholdPx?: number
  /** When true, scroll to bottom regardless of user scroll state. */
  forceFollow?: boolean
}

/**
 * Auto-follow scroll for overflow containers. Stays pinned to the bottom while
 * the user is at/near it; scrolling away stays parked until they return (or force).
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
  const forceFollow = options.forceFollow ?? false

  const followingRef = useRef(true)
  const ignoreScrollRef = useRef(false)

  const followNow = useCallback(
    (force = false): void => {
      const el = containerRef.current
      if (!el) return
      if (
        shouldFollowScroll({
          force,
          following: followingRef.current
        })
      ) {
        followingRef.current = true
        ignoreScrollRef.current = true
        scrollToBottom(el, () => {
          followingRef.current = true
          ignoreScrollRef.current = false
        })
      }
    },
    [containerRef]
  )

  const isFollowing = useCallback((): boolean => followingRef.current, [])

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
      if (ignoreScrollRef.current) return
      followingRef.current = isNearScrollBottom(el, thresholdPx)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    followNow(forceFollow)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (mutationFrame != null) {
        window.cancelAnimationFrame(mutationFrame)
      }
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      observedNodes.clear()
    }
    // followSignals + forceFollow drive re-follow when content or policy changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, followNow, forceFollow, thresholdPx, ...followSignals])

  return { followNow, isFollowing }
}
