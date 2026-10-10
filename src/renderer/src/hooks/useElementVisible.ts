import { useEffect, useState, type RefObject } from 'react'

/** Defer costly diagram work until it enters the scroll viewport. */
export function useElementVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(Boolean(entry?.isIntersecting))
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return visible
}
