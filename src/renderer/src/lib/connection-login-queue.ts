import type { ConnectionConfig } from '../../../shared/agent-types'

export class ConnectionLoginQueueTimeout extends Error {
  constructor() {
    super('Cluster login queue wait timed out.')
    this.name = 'ConnectionLoginQueueTimeout'
  }
}

/** sww changes the jump host user's shared kubectl context before connecting. */
export function clusterLoginQueueKey(connection: ConnectionConfig): string | undefined {
  if (!connection.actions?.some((action) => /^\s*sww\s+/.test(action))) return undefined
  return JSON.stringify([
    connection.host.toLowerCase(),
    connection.port ?? 22,
    connection.user ?? ''
  ])
}

/** Serializes login attempts, never the lifetime of the resulting SSH sessions. */
export class ConnectionLoginQueue {
  private tails = new Map<string, Promise<void>>()

  hasPending(key: string): boolean {
    return this.tails.has(key)
  }

  run<T>(key: string, task: () => Promise<T>, waitTimeoutMs: number): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let expired = false
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true
        reject(new ConnectionLoginQueueTimeout())
      }, waitTimeoutMs)
    })
    const result = previous.then(() => {
      clearTimeout(timer)
      // A caller that has already timed out must never send a delayed login.
      if (expired) throw new ConnectionLoginQueueTimeout()
      return task()
    })
    // Failed/expired attempts release their position only after predecessors
    // settle, so a later request cannot overtake an active cluster switch.
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return Promise.race([result, timeout])
  }
}
