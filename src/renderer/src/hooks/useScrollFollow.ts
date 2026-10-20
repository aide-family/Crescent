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

    let followFrame: number | null = null
    const scheduleFollow = (): void => {
      if (followFrame != null) return
      followFrame = window.requestAnimationFrame(() => {
        followFrame = null
        followNow(false)
      })
    }

    // Watch the scrollport only. Observing every chart node re-enters Recharts'
    // ResizeObserver on each live-run update and nests setState until React aborts.
    const resizeObserver = new ResizeObserver(() => scheduleFollow())
    resizeObserver.observe(el)

    const mutationObserver = new MutationObserver((records) => {
      if (records.every(isChartInternalMutation)) return
      scheduleFollow()
    })
    mutationObserver.observe(el, { childList: true, subtree: true })

    const handleScroll = (): void => {
      if (ignoreScrollRef.current) return
      followingRef.current = isNearScrollBottom(el, thresholdPx)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (followFrame != null) {
        window.cancelAnimationFrame(followFrame)
      }
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [containerRef, followNow, thresholdPx])

  useEffect(() => {
    followNow(forceFollow)
    // followSignals drive a follow without rebuilding observers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followNow, forceFollow, ...followSignals])

  return { followNow, isFollowing }
}

function isChartInternalMutation(record: MutationRecord): boolean {
  const node = record.target instanceof Element ? record.target : record.target.parentElement
  return Boolean(node?.closest('[data-slot="chart"]'))
}
