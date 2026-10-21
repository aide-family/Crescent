import { createHash } from 'node:crypto'
import { commandOutcome, type CommandOutcome } from '../../shared/command-outcome'

interface Failure {
  at: number
  count: number
  outcome: CommandOutcome
  readonly: boolean
}
/** Exact command digest; never normalizes away namespace/resource names. No command content retained. */
export class CommandFailures {
  private readonly entries = new Map<string, Failure>()
  key(command: string, target: string): string {
    return createHash('sha256')
      .update(JSON.stringify([command.trim(), target]))
      .digest('hex')
  }
  record(
    key: string,
    readonly: boolean,
    result: Parameters<typeof commandOutcome>[0],
    now = Date.now()
  ): void {
    const outcome = commandOutcome(result)
    if (result.ok || !result.dispatched || outcome === 'SSH_TARGET_UNAVAILABLE') {
      this.entries.delete(key)
      return
    }
    const previous = this.entries.get(key)
    this.entries.set(key, {
      at: now,
      count: previous && now - previous.at < 30000 ? previous.count + 1 : 1,
      outcome,
      readonly
    })
    if (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value!)
  }
  advice(key: string, now = Date.now()): { block: boolean; message?: string } {
    const failure = this.entries.get(key)
    if (!failure || now - failure.at >= 30000) return { block: false }
    if (failure.readonly)
      return {
        block: failure.count >= 3,
        message:
          'Repeated read-only failure; wait 30 seconds, obtain fresh evidence, or select a verified target.'
      }
    return {
      block: false,
      message: `Previous mutation outcome: ${failure.outcome}. Verify effects read-only before requesting a new exact human approval. Do not change command spelling to bypass verification.`
    }
  }
}
