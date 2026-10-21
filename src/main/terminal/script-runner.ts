import { randomBytes } from 'node:crypto'
/** Decode in memory in the selected shell. Each bounded physical line has its own transport ACK. */
export function createPtyScriptRunner(script: string): string {
  const nonce = randomBytes(8).toString('hex')
  const chunks = Buffer.from(script, 'utf8')
    .toString('base64')
    .match(/.{1,256}/g) ?? ['']
  const lines = [`__crescent_encoded=''; printf '\\n__CRESCENT_DISPATCH_ACK_${nonce}_0__\\n'`]
  chunks.forEach((chunk, index) =>
    lines.push(
      `__crescent_encoded=$__crescent_encoded'${chunk}'; printf '\\n__CRESCENT_DISPATCH_ACK_${nonce}_${index + 1}__\\n'`
    )
  )
  lines.push(
    '__crescent_decoded=$(printf %s "$__crescent_encoded" | base64 -d 2>/dev/null) || __crescent_decoded=$(printf %s "$__crescent_encoded" | base64 -D 2>/dev/null); if [ $? -eq 0 ]; then eval "$__crescent_decoded"; fi; unset __crescent_encoded __crescent_decoded\r'
  )
  return lines.join('\n')
}
export interface PtyScriptWriteInput {
  payload: string
  write: (data: string) => void
  signal?: AbortSignal
  isCurrent: () => boolean
  /** Subscribe before writing, so an immediate echo/ACK cannot race the waiter. */
  observeOutput?: (listener: (data: string) => void) => () => void
  acknowledgementTimeoutMs?: number
  dispatchDeadline?: () => number
}
async function writeAcknowledgedLine(
  input: PtyScriptWriteInput,
  line: string,
  ack: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = ''
    const cleanup: { remove?: () => void } = {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false
    const finish = (error?: Error): void => {
      if (done) return
      done = true
      cleanup.remove?.()
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => finish(new Error('Terminal dispatch canceled by the run.'))
    cleanup.remove = input.observeOutput!((data) => {
      if (!input.isCurrent()) return finish(new Error('Terminal session replaced during dispatch.'))
      output = (output + data).slice(-8192)
      // An echoed printf argument is not an ACK. Require its own complete output line.
      if (new RegExp(`(?:^|[\\r\\n])${ack}[\\r\\n]`).test(output)) finish()
    })
    if (done) {
      cleanup.remove?.()
      return
    }
    let totalDeadline = input.dispatchDeadline?.()
    const timeout = (): void => {
      const latest = input.dispatchDeadline?.()
      if (
        latest !== undefined &&
        totalDeadline !== undefined &&
        latest > totalDeadline &&
        latest > Date.now()
      ) {
        totalDeadline = latest
        timer = setTimeout(timeout, Math.min(600000, latest - Date.now()))
      } else
        finish(
          new Error('PTY transport acknowledgement is unconfirmed. No further input was sent.')
        )
    }
    timer = setTimeout(
      timeout,
      Math.max(
        1,
        Math.min(
          600000,
          input.acknowledgementTimeoutMs ?? 60000,
          (totalDeadline ?? Date.now() + 600000) - Date.now()
        )
      )
    )
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted || !input.isCurrent()) {
      abort()
      return
    }
    try {
      input.write(line)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('PTY write failed'))
    }
  })
}
/** One outstanding input line per pane; transport waiting does not consume business runtime. */
export async function writePtyScript(input: PtyScriptWriteInput): Promise<void> {
  const lines = input.payload.match(/[^\n]*\n|[^\n]+$/g) ?? []
  for (let index = 0; index < lines.length; index++) {
    if (input.dispatchDeadline && Date.now() >= input.dispatchDeadline())
      throw new Error('PTY dispatch deadline exceeded; completion is unconfirmed.')
    if (input.signal?.aborted || !input.isCurrent())
      throw new Error('Terminal dispatch canceled or session replaced.')
    const line = lines[index]
    if (Buffer.byteLength(line) > 1024)
      throw new Error('PTY input line exceeds the transport bound.')
    const ack = line.match(/__CRESCENT_DISPATCH_ACK_[\w]+__/)?.[0]
    if (ack && input.observeOutput) await writeAcknowledgedLine(input, line, ack)
    else {
      input.write(line)
      if (index + 1 < lines.length) await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
  }
}
