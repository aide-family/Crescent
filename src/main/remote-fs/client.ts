import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'

import type { ConnectionConfig } from '../agent/types'
import { listConnections } from '../connections/ipc'

const IDLE_MS = 60_000
const CONNECT_TIMEOUT_MS = 20_000

type PooledSession = {
  connectionId: string
  client: Client
  sftp: SFTPWrapper
  idleTimer: NodeJS.Timeout | null
  inUse: number
}

const pool = new Map<string, PooledSession>()
/** Serialize SFTP ops per connection so list/read never share the channel concurrently. */
const opQueues = new Map<string, Promise<unknown>>()

/** Resolve a non-local connection with fresh secrets. */
export async function resolveRemoteFsConnection(connectionId: string): Promise<ConnectionConfig> {
  const id = String(connectionId ?? '').trim()
  if (!id) throw new Error('Missing connection id.')

  const connections = await listConnections({ forceRefreshSecrets: true })
  const connection = connections.find((item) => item.id === id)
  if (!connection) throw new Error(`Unknown connection: ${id}`)
  if (connection.source === 'local') {
    throw new Error('Local terminal has no remote filesystem.')
  }
  if (!connection.host?.trim()) {
    throw new Error(`Connection "${connection.name}" has no host.`)
  }
  return connection
}

/** Format ssh2 / Error into a readable message (includes SFTP code when present). */
export function formatSftpError(error: unknown, username?: string): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error))
  }
  const record = error as Error & { code?: string | number; lang?: string }
  const parts = [error.message || 'SFTP error']
  if (record.code != null && String(record.code).length > 0) {
    parts.push(`code=${record.code}`)
  }
  if (record.lang) parts.push(`lang=${record.lang}`)

  const codeNum = typeof record.code === 'number' ? record.code : Number(record.code)
  const isPermission =
    codeNum === 3 ||
    /permission denied/i.test(error.message) ||
    (codeNum === 4 && /permission/i.test(error.message))
  if (isPermission) {
    const userHint = username?.trim()
      ? `SFTP user "${username.trim()}" cannot access this path (terminal login actions do not elevate SFTP).`
      : 'SFTP user cannot access this path (terminal login actions do not elevate SFTP).'
    parts.push(userHint)
  }

  const message = parts.join(' · ')
  if (message === error.message) return error
  const wrapped = new Error(message)
  wrapped.cause = error
  return wrapped
}

/**
 * Retry only on channel/connection symptoms — not bare SSH_FX_FAILURE (code=4),
 * which is usually a path-level server error and must not poison the pool.
 */
export function shouldRetrySftp(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('general failure')) return false
  if (/\bcode=4\b/.test(message) && !message.includes('connection')) return false
  return (
    message.includes('not connected') ||
    message.includes('econn') ||
    message.includes('connection lost') ||
    message.includes('no connection') ||
    (message.includes('closed') && !message.includes('permission')) ||
    message.includes('no response') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

/** Callback for a borrowed SFTP session (plus the parent ssh2 Client for exec fallback). */
export type WithSftpRun<T> = (
  sftp: SFTPWrapper,
  connection: ConnectionConfig,
  client: Client
) => Promise<T>

/**
 * Borrow an SFTP session. Ops for the same connectionId are serialized.
 * On channel-level failure, dispose the pool entry and retry once.
 */
export async function withSftp<T>(connectionId: string, run: WithSftpRun<T>): Promise<T> {
  const connection = await resolveRemoteFsConnection(connectionId)
  const prev = opQueues.get(connection.id) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(() => runWithRetry(connection, run))
  opQueues.set(
    connection.id,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

async function runWithRetry<T>(connection: ConnectionConfig, run: WithSftpRun<T>): Promise<T> {
  const username = connection.user?.trim() || undefined
  try {
    return await runOnce(connection, run)
  } catch (firstError) {
    if (!shouldRetrySftp(firstError)) {
      throw formatSftpError(firstError, username)
    }
    invalidateSession(connection.id)
    try {
      return await runOnce(connection, run)
    } catch (secondError) {
      throw formatSftpError(secondError ?? firstError, username)
    }
  }
}

async function runOnce<T>(connection: ConnectionConfig, run: WithSftpRun<T>): Promise<T> {
  const session = await acquireSession(connection)
  session.inUse += 1
  clearIdle(session)
  try {
    return await run(session.sftp, connection, session.client)
  } catch (error) {
    // Only invalidate on channel-level errors — not path-level SSH_FX_FAILURE.
    if (shouldRetrySftp(error)) {
      invalidateSession(connection.id)
    }
    throw error
  } finally {
    const stillPooled = pool.get(connection.id) === session
    if (stillPooled) {
      session.inUse = Math.max(0, session.inUse - 1)
      scheduleIdleDispose(session)
    }
  }
}

/** Force-drop a pooled session (e.g. after SFTP failure). */
export function invalidateSession(connectionId: string): void {
  const session = pool.get(connectionId)
  if (session) disposeSession(session)
}

async function acquireSession(connection: ConnectionConfig): Promise<PooledSession> {
  const existing = pool.get(connection.id)
  if (existing) return existing

  const { client, sftp } = await openSftp(connection)
  const session: PooledSession = {
    connectionId: connection.id,
    client,
    sftp,
    idleTimer: null,
    inUse: 0
  }
  pool.set(connection.id, session)

  client.on('close', () => {
    if (pool.get(connection.id) === session) {
      clearIdle(session)
      pool.delete(connection.id)
    }
  })
  client.on('error', () => {
    disposeSession(session)
  })

  return session
}

function scheduleIdleDispose(session: PooledSession): void {
  if (session.inUse > 0) return
  clearIdle(session)
  session.idleTimer = setTimeout(() => {
    if (session.inUse > 0) return
    disposeSession(session)
  }, IDLE_MS)
  session.idleTimer.unref?.()
}

function clearIdle(session: PooledSession): void {
  if (!session.idleTimer) return
  clearTimeout(session.idleTimer)
  session.idleTimer = null
}

function disposeSession(session: PooledSession): void {
  clearIdle(session)
  if (pool.get(session.connectionId) === session) {
    pool.delete(session.connectionId)
  }
  try {
    session.sftp.end()
  } catch {
    // ignore
  }
  try {
    session.client.end()
  } catch {
    // ignore
  }
}

/** Drop all pooled SFTP sessions (app shutdown). */
export function disposeAllRemoteFsSessions(): void {
  for (const session of [...pool.values()]) {
    disposeSession(session)
  }
  opQueues.clear()
}

function openSftp(connection: ConnectionConfig): Promise<{ client: Client; sftp: SFTPWrapper }> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      try {
        client.end()
      } catch {
        // ignore
      }
      reject(formatSftpError(error))
    }

    const timer = setTimeout(() => {
      fail(new Error(`SSH connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s.`))
    }, CONNECT_TIMEOUT_MS)
    timer.unref?.()

    client.on('ready', () => {
      client.sftp((error, sftp) => {
        clearTimeout(timer)
        if (error || !sftp) {
          fail(error instanceof Error ? error : new Error(String(error ?? 'SFTP unavailable.')))
          return
        }
        if (settled) {
          try {
            sftp.end()
          } catch {
            // ignore
          }
          return
        }
        settled = true
        resolve({ client, sftp })
      })
    })

    client.on('error', (error) => {
      clearTimeout(timer)
      fail(error instanceof Error ? error : new Error(String(error)))
    })

    try {
      client.connect(buildConnectConfig(connection))
    } catch (error) {
      clearTimeout(timer)
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function buildConnectConfig(connection: ConnectionConfig): ConnectConfig {
  const password = connection.password?.trim() || connection.resolvedPassword?.trim() || undefined
  const identityPath = expandHome(connection.identityFile?.trim())
  let privateKey: Buffer | undefined
  if (identityPath) {
    try {
      privateKey = readFileSync(identityPath)
    } catch (error) {
      throw new Error(
        `Cannot read identity file ${identityPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port && connection.port > 0 ? connection.port : 22,
    username: connection.user?.trim() || undefined,
    password,
    privateKey,
    readyTimeout: CONNECT_TIMEOUT_MS,
    tryKeyboard: false,
    agent: process.env.SSH_AUTH_SOCK,
    agentForward: false
  }

  applySshOptions(config, connection.sshOptions)
  return config
}

function expandHome(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return `${homedir()}${path.slice(1)}`
  }
  return path
}

/** Apply a subset of OpenSSH-style `-o Key=Value` flags from connection.sshOptions. */
function applySshOptions(config: ConnectConfig, options: string[] | undefined): void {
  if (!options?.length) return
  for (const raw of options) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^-o\s*([^=\s]+)=(.*)$/i) || trimmed.match(/^([^=\s]+)=(.*)$/)
    if (!match) continue
    const key = match[1]?.toLowerCase()
    const value = match[2]?.trim()
    if (!key || value == null) continue
    if (key === 'hostname') config.host = value
    if (key === 'user' || key === 'username') config.username = value
    if (key === 'port') {
      const port = Number(value)
      if (Number.isFinite(port) && port > 0) config.port = Math.round(port)
    }
    if (key === 'identityfile') {
      try {
        config.privateKey = readFileSync(expandHome(value)!)
      } catch {
        // keep existing key
      }
    }
  }
}
