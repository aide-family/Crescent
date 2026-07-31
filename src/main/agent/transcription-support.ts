import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type { AgentConfig, TranscriptionSupportResult } from '../../shared/agent-types'
import { AgentBrain } from './brain'
import { resolveAgentRuntimeProvider } from './runtime-provider'

const supportCache = new Map<string, { supported: boolean; checkedAt: number; reason?: string }>()
const SUPPORT_CACHE_TTL_MS = 30 * 60_000

export async function checkTranscriptionSupport(
  config: AgentConfig,
  options?: { forceRefresh?: boolean; providerId?: string; model?: string }
): Promise<TranscriptionSupportResult> {
  const effectiveConfig: AgentConfig = {
    ...config,
    ...(options?.providerId ? { providerId: options.providerId } : {}),
    ...(options?.model ? { model: options.model } : {})
  }
  const provider = resolveAgentRuntimeProvider(effectiveConfig)
  const cacheKey = `${provider.providerId}::${provider.baseUrl}::${hashKey(provider.apiKey)}`
  const cached = supportCache.get(cacheKey)
  if (!options?.forceRefresh && cached && Date.now() - cached.checkedAt < SUPPORT_CACHE_TTL_MS) {
    return {
      supported: cached.supported,
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      reason: cached.reason
    }
  }

  if (!provider.apiKey.trim() || !provider.baseUrl.trim()) {
    const result: TranscriptionSupportResult = {
      supported: false,
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      reason: 'missing-provider'
    }
    supportCache.set(cacheKey, {
      supported: false,
      checkedAt: Date.now(),
      reason: result.reason
    })
    return result
  }

  const probeDir = mkdtempSync(join(tmpdir(), 'crescent-voice-probe-'))
  const probePath = join(probeDir, 'probe.wav')

  try {
    writeFileSync(probePath, buildSilentWav(0.05))
    await new AgentBrain(effectiveConfig).transcribeAudio({
      path: probePath,
      model: 'whisper-1',
      language: 'en'
    })
    supportCache.set(cacheKey, { supported: true, checkedAt: Date.now() })
    return {
      supported: true,
      providerId: provider.providerId,
      baseUrl: provider.baseUrl
    }
  } catch (error) {
    const supported = isTranscriptionEndpointPresent(error)
    const reason = supported ? undefined : classifyUnsupportedReason(error)
    supportCache.set(cacheKey, { supported, checkedAt: Date.now(), reason })
    return {
      supported,
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      reason
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

export function clearTranscriptionSupportCache(): void {
  supportCache.clear()
}

/** Endpoint exists if we get auth/validation errors instead of 404/not-found. */
function isTranscriptionEndpointPresent(error: unknown): boolean {
  const status = readErrorStatus(error)
  if (status === 404) return false
  if (status === 401 || status === 403 || status === 400 || status === 413 || status === 415) {
    return true
  }
  if (status === 422 || status === 429) return true

  const message = error instanceof Error ? error.message : String(error)
  if (/404|Not Found|no body|does not support|audio\/transcriptions/i.test(message)) {
    if (/401|403|invalid.*api.?key|unauthorized|forbidden/i.test(message)) return true
    return false
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(message)) return false
  if (status && status >= 500) return false
  return false
}

function classifyUnsupportedReason(error: unknown): string {
  const status = readErrorStatus(error)
  if (status === 404 || /404|Not Found|no body/i.test(String(error))) return 'endpoint-missing'
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(String(error))) return 'network'
  return 'unsupported'
}

function readErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status
  }
  return undefined
}

function hashKey(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return String(hash)
}

/** Minimal mono 16-bit PCM WAV. */
function buildSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 16000
  const channels = 1
  const bitsPerSample = 16
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds))
  const dataSize = sampleCount * channels * (bitsPerSample / 8)
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}
