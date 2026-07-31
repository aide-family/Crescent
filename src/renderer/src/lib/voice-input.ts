export type VoiceLiveSession = {
  stop: () => Promise<string>
  cancel: () => void
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionResultEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export function isBrowserSpeechAvailable(): boolean {
  return Boolean(getSpeechRecognitionConstructor())
}

export function isWhisperUnavailableError(message: string): boolean {
  return /404|not found|does not support|unsupported.*transcription|audio\/transcriptions/i.test(
    message
  )
}

/**
 * Voice input with live transcript updates.
 * Prefers browser speech for instant text; optionally refines with Whisper when the provider supports it.
 * If Whisper returns 404, keeps browser speech only and stops retrying Whisper.
 */
export async function startVoiceInputSession(options: {
  speechLanguage: string
  whisperLanguage?: string
  intervalMs?: number
  transcribe?: (input: { base64: string; mimeType: string; language?: string }) => Promise<string>
  onTranscript: (text: string) => void
  onEngine?: (engine: 'speech' | 'whisper' | 'speech+whisper') => void
  onError?: (error: Error) => void
}): Promise<VoiceLiveSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone is not available in this environment.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1
    }
  })

  const hasSpeech = isBrowserSpeechAvailable()
  const hasWhisper = typeof options.transcribe === 'function'
  if (!hasSpeech && !hasWhisper) {
    for (const track of stream.getTracks()) track.stop()
    throw new Error('No speech recognition engine is available.')
  }

  options.onEngine?.(hasSpeech && hasWhisper ? 'speech+whisper' : hasSpeech ? 'speech' : 'whisper')

  let settled = false
  let speechText = ''
  let whisperText = ''
  let whisperDisabled = !hasWhisper
  let transcribeInFlight = false
  let queuedRefresh = false
  let intervalId: number | null = null
  let resolveStop: ((text: string) => void) | null = null
  let speechSession: VoiceLiveSession | null = null
  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []
  const mimeType = pickRecorderMimeType()

  const emitBest = (): void => {
    const text = pickBestTranscript(speechText, whisperText)
    if (text) options.onTranscript(text)
  }

  const cleanup = (): void => {
    if (intervalId !== null) {
      window.clearInterval(intervalId)
      intervalId = null
    }
    speechSession?.cancel()
    speechSession = null
    for (const track of stream.getTracks()) track.stop()
  }

  if (hasWhisper && typeof MediaRecorder !== 'undefined') {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.start(250)
  }

  if (hasSpeech) {
    speechSession = startBrowserSpeech({
      language: options.speechLanguage,
      onTranscript: (text) => {
        speechText = text
        // Prefer live speech while Whisper hasn't produced text yet.
        if (!whisperText.trim() || text.length >= whisperText.length) {
          options.onTranscript(text)
        }
      },
      shouldRestart: () => !settled,
      onError: (error) => {
        if (settled) return
        // If Whisper is still available, keep going; otherwise surface the error.
        if (whisperDisabled) options.onError?.(error)
      }
    })
  }

  const refreshWhisper = async (finalPass: boolean): Promise<string> => {
    if (whisperDisabled || !options.transcribe || !recorder) return whisperText
    if (chunks.length === 0) return whisperText

    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
    if (blob.size < 1200 && !finalPass) return whisperText

    try {
      const base64 = await blobToBase64(blob)
      const text = (
        await options.transcribe({
          base64,
          mimeType: blob.type || mimeType || 'audio/webm',
          language: options.whisperLanguage
        })
      ).trim()
      if (text) {
        whisperText = text
        emitBest()
      }
      return whisperText
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isWhisperUnavailableError(message)) {
        whisperDisabled = true
        if (intervalId !== null) {
          window.clearInterval(intervalId)
          intervalId = null
        }
        if (!speechText.trim()) {
          options.onError?.(
            new Error(
              'Current model provider does not support audio transcription (/audio/transcriptions).'
            )
          )
        }
        return whisperText
      }
      if (finalPass) throw error instanceof Error ? error : new Error(message)
      return whisperText
    }
  }

  const scheduleWhisper = (): void => {
    if (settled || whisperDisabled) return
    if (transcribeInFlight) {
      queuedRefresh = true
      return
    }
    transcribeInFlight = true
    void refreshWhisper(false)
      .catch(() => undefined)
      .finally(() => {
        transcribeInFlight = false
        if (queuedRefresh && !settled && !whisperDisabled) {
          queuedRefresh = false
          scheduleWhisper()
        }
      })
  }

  if (hasWhisper && recorder) {
    const intervalMs = Math.max(1500, options.intervalMs ?? 2800)
    intervalId = window.setInterval(() => scheduleWhisper(), intervalMs)
    window.setTimeout(() => scheduleWhisper(), Math.min(1800, intervalMs))
  }

  return {
    stop: () =>
      new Promise((resolve, reject) => {
        if (settled) {
          resolve(pickBestTranscript(speechText, whisperText))
          return
        }
        settled = true
        if (intervalId !== null) {
          window.clearInterval(intervalId)
          intervalId = null
        }

        const finish = async (): Promise<void> => {
          try {
            const speechFinal = speechSession ? (await speechSession.stop()).trim() : speechText
            if (speechFinal) speechText = speechFinal

            for (let attempt = 0; attempt < 20 && transcribeInFlight; attempt += 1) {
              await wait(50)
            }

            if (!whisperDisabled) {
              try {
                await refreshWhisper(true)
              } catch {
                // Prefer speech text if final Whisper fails.
              }
            }

            const text = pickBestTranscript(speechText, whisperText)
            resolve(text)
          } catch (error) {
            const text = pickBestTranscript(speechText, whisperText)
            if (text) resolve(text)
            else reject(error instanceof Error ? error : new Error(String(error)))
          } finally {
            cleanup()
            resolveStop = null
          }
        }

        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = () => {
            void finish()
          }
          try {
            recorder.stop()
          } catch {
            void finish()
          }
        } else {
          void finish()
        }

        resolveStop = resolve
        window.setTimeout(() => {
          if (!resolveStop) return
          cleanup()
          resolveStop(pickBestTranscript(speechText, whisperText))
          resolveStop = null
        }, 20_000)
      }),
    cancel: () => {
      if (settled) return
      settled = true
      resolveStop = null
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        // ignore
      }
      cleanup()
    }
  }
}

function startBrowserSpeech(options: {
  language: string
  onTranscript: (text: string) => void
  shouldRestart: () => boolean
  onError?: (error: Error) => void
}): VoiceLiveSession {
  const Recognition = getSpeechRecognitionConstructor()
  if (!Recognition) {
    return {
      stop: async () => '',
      cancel: () => undefined
    }
  }

  const recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  recognition.lang = options.language

  let settled = false
  let committed = ''
  let interim = ''
  let restarting = false
  let resolveStop: ((text: string) => void) | null = null

  const emit = (): void => {
    options.onTranscript(`${committed}${interim}`.replace(/\s+/g, ' ').trim())
  }

  recognition.onresult = (event) => {
    let nextInterim = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const piece = result?.[0]?.transcript ?? ''
      if (!piece) continue
      if (result.isFinal) {
        committed = `${committed}${piece}`.replace(/\s+/g, ' ')
        if (committed && !/[。！？.!?]$/.test(committed)) committed += ' '
      } else {
        nextInterim += piece
      }
    }
    interim = nextInterim
    emit()
  }

  recognition.onerror = (event) => {
    const code = event.error ?? 'unknown'
    if (code === 'aborted' || code === 'no-speech') return
    if (settled) return
    options.onError?.(new Error(mapSpeechError(code)))
  }

  recognition.onend = () => {
    if (settled) {
      resolveStop?.(committed.replace(/\s+/g, ' ').trim())
      resolveStop = null
      return
    }
    if (!options.shouldRestart() || restarting) return
    restarting = true
    try {
      recognition.start()
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error : new Error('Live speech recognition stopped unexpectedly.')
      )
    } finally {
      restarting = false
    }
  }

  try {
    recognition.start()
  } catch (error) {
    options.onError?.(
      error instanceof Error ? error : new Error('Failed to start live speech recognition.')
    )
  }

  return {
    stop: () =>
      new Promise((resolve) => {
        if (settled) {
          resolve(committed.replace(/\s+/g, ' ').trim())
          return
        }
        settled = true
        interim = ''
        emit()
        resolveStop = resolve
        try {
          recognition.stop()
        } catch {
          resolve(committed.replace(/\s+/g, ' ').trim())
          resolveStop = null
        }
        window.setTimeout(() => {
          if (!resolveStop) return
          resolveStop(committed.replace(/\s+/g, ' ').trim())
          resolveStop = null
        }, 1200)
      }),
    cancel: () => {
      if (settled) return
      settled = true
      resolveStop = null
      try {
        recognition.abort()
      } catch {
        // ignore
      }
    }
  }
}

function pickBestTranscript(speechText: string, whisperText: string): string {
  const speech = speechText.trim()
  const whisper = whisperText.trim()
  if (speech && whisper) return whisper.length >= speech.length ? whisper : speech
  return whisper || speech
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const scope = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return scope.SpeechRecognition || scope.webkitSpeechRecognition
}

function mapSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech recognition network error.'
    default:
      return `Speech recognition failed (${code}).`
  }
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
