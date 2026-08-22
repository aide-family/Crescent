export function deferAfterFirstPaint(task: () => void): void {
  const schedule = (): void => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => task(), { timeout: 2_000 })
      return
    }
    window.setTimeout(task, 0)
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(schedule)
    return
  }

  schedule()
}
