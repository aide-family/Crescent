/**
 * Race a promise against a hard timeout. On timeout the onTimeout callback runs
 * and the result resolves to undefined; errors from the underlying promise are
 * still propagated so callers can settle the UI with a concrete failure.
 */
export function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout?.()
      resolve(undefined)
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
