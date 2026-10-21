import type { HostTool } from './types.ts'

/** Ordering is enforced by the host, including when a provider emits parallel calls. */
export function serializeHostTools(tools: HostTool[]): HostTool[] {
  let tail: Promise<unknown> = Promise.resolve()
  return tools.map((host) => ({
    ...host,
    execute(input, signal) {
      const result = tail.then(() => {
        signal?.throwIfAborted()
        return host.execute(input, signal)
      })
      tail = result.catch(() => undefined)
      return result
    }
  }))
}
