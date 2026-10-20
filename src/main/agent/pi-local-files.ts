import { localDocumentError } from '../local-document-errors'
import { normalizeCommandTimeoutPolicy } from '../../shared/command-timeouts'
import { Type, type TSchema } from 'typebox'
import { resolve, dirname, basename } from 'node:path'
import { readFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { PiSdkFacade, ToolDefinition } from './pi-sdk'
import { getPtyBashExecContext } from './pi-terminal-bash'
import { localDocumentReaderForOwner } from '../local-document-ipc'
import { requestCommandApproval } from './command-approval'
import { redactSensitiveText } from '../../shared/secret-redaction'
import { sensitiveDocumentPath } from '../local-document-reader'

export function createLocalFileTools(pi: PiSdkFacade, cwd: string, sessionKey: string) {
  const read = pi.defineTool({
    name: 'read',
    label: 'Read local document',
    description:
      'Read/list/search local client files and directories (absolute paths or workspace-relative paths; ~ means the client home) only, independently of the SSH bash target. Authorized workspace/selected roots only; bounded UTF-8/UTF-16 lines with citations. Reject secrets, symlinks and binaries. Never auto-upload an entire large file.',
    parameters: Type.Object({
      path: Type.String({ maxLength: 4096 }),
      offset: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      query: Type.Optional(Type.String({ maxLength: 200 }))
    }),
    executionMode: 'sequential',
    async execute(_id, params, signal) {
      const context = getPtyBashExecContext(sessionKey)
      if (!context || context.webContents.isDestroyed())
        throw new Error('No active local document scope')
      const reader = await localDocumentReaderForOwner(context.webContents.id, cwd)
      let result
      try {
        const path = await reader.resolvePath(params.path, cwd)
        if ((await lstat(path)).isDirectory()) {
          const entries = await reader.list(path, signal)
          let hasMore = entries.length === 200
          while (Buffer.byteLength(JSON.stringify({ path, entries })) > 45000 && entries.length) {
            entries.pop()
            hasMore = true
          }
          return {
            content: [
              { type: 'text', text: JSON.stringify({ path, entries, limit: 200, hasMore }) }
            ],
            details: { path, directory: true, hasMore }
          }
        }
        result = await reader.read({ ...params, path }, signal)
      } catch (error) {
        throw localDocumentError(error)
      }
      while (Buffer.byteLength(JSON.stringify(result)) > 50000 && result.lines.length) {
        result.lines.pop()
        result.hasMore = true
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { path: result.path, directory: false, hasMore: result.hasMore }
      }
    }
  })
  function wrapMutation<P extends TSchema, D, S>(
    tool: ToolDefinition<P, D, S>
  ): ToolDefinition<P, D, S> {
    const execute = tool.execute.bind(tool)
    return pi.defineTool({
      ...tool,
      description:
        tool.description +
        ' Local client workspace only. Every edit/write needs exact human approval; planned/manual-execution modes cannot mutate through this tool.',
      executionMode: 'sequential',
      async execute(id, params, signal, onUpdate, toolContext) {
        const context = getPtyBashExecContext(sessionKey)
        if (
          !context ||
          context.webContents.isDestroyed() ||
          context.executionMode === 'planned' ||
          context.mutationPolicy === 'manual-execution'
        )
          throw new Error(
            'Local mutation unavailable in this execution mode; show a plan/command for human execution'
          )
        const requestedPath = resolve(cwd, (params as { path: string }).path)
        if (sensitiveDocumentPath(requestedPath))
          throw new Error('Sensitive paths require manual file handling')
        const reader = await localDocumentReaderForOwner(context.webContents.id, cwd)
        let path: string
        try {
          path = await reader.authorize(requestedPath)
        } catch (error) {
          if (tool.name !== 'write' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error
          path = resolve(await reader.authorize(dirname(requestedPath)), basename(requestedPath))
        }
        const snapshot = async (): Promise<string> => {
          try {
            const file = await lstat(path)
            if (!file.isFile() || file.isSymbolicLink() || file.size > 1024 * 1024)
              throw new Error('Local mutations require a regular file of at most 1 MiB')
            await reader.authorize(path)
            return `${file.dev}:${file.ino}:${createHash('sha256')
              .update(await readFile(path))
              .digest('hex')}`
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
            throw error
          }
        }
        const initial = await snapshot()
        const preview = redactSensitiveText(JSON.stringify({ ...params, path }, null, 2))
        if (Buffer.byteLength(preview) > 50000)
          throw new Error('Mutation too large for human review; use manual execution')
        const payloadDigest = createHash('sha256').update(JSON.stringify(params)).digest('hex')
        const combinedSignal = AbortSignal.any(
          [signal, context.signal].filter((s): s is AbortSignal => Boolean(s))
        )
        const decision = await requestCommandApproval({
          webContents: context.webContents,
          runId: context.runId,
          tabId: context.executionTabId,
          chatTabId: context.chatTabId,
          signal: combinedSignal,
          timeoutMs: normalizeCommandTimeoutPolicy(context.config.commandTimeouts).approvalMs,
          command: `LOCAL CLIENT ${tool.name}: ${path}\nPayload SHA256: ${payloadDigest}\n${preview}`,
          locale: context.locale,
          config: context.config,
          audit: {
            summary: 'Local file mutation requires human approval.',
            operationReason: 'Review exact edits/content on the client filesystem.',
            risk: 'high',
            requiresApproval: true,
            riskPoints: [],
            impactAnalysis: '',
            recommendation: '',
            source: 'rule',
            elapsedMs: 0
          }
        })
        if (!decision.approved)
          throw new Error('Local file mutation rejected/expired; no file was changed')
        return pi.withFileMutationQueue(`host-approval:${path}`, async () => {
          combinedSignal.throwIfAborted()
          if (
            getPtyBashExecContext(sessionKey)?.runId !== context.runId ||
            context.webContents.isDestroyed() ||
            (await snapshot()) !== initial
          )
            throw new Error('File or run changed after approval; request a new review')
          return execute(id, { ...params, path } as never, combinedSignal, onUpdate, toolContext)
        })
      }
    })
  }
  return [
    read,
    wrapMutation(pi.createEditToolDefinition(cwd)),
    wrapMutation(pi.createWriteToolDefinition(cwd))
  ]
}
