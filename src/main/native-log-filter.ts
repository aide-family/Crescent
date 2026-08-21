const MAC_IME_NOISE = [
  'TSM AdjustCapsLockLEDForKeyTransitionHandling',
  'error messaging the mach port for IMKCFRunLoopWakeUpReliable'
] as const

const CHROMIUM_NET_NOISE_RE =
  /net::ERR_(CONNECTION_TIMED_OUT|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_RESET)/

export function isKnownNativeLogNoise(text: string): boolean {
  if (MAC_IME_NOISE.some((snippet) => text.includes(snippet))) return true
  if (text.includes('tile memory limits exceeded')) return true
  if (text.includes('Error sending from webFrameMain')) return true
  if (text.includes('Render frame was disposed before WebFrameMain could be accessed')) return true
  return isChromiumUpdaterNetworkNoise(text)
}

/** electron-updater uses Electron net; Chromium dumps these even when the promise is caught. */
export function isChromiumUpdaterNetworkNoise(text: string): boolean {
  if (!CHROMIUM_NET_NOISE_RE.test(text)) return false
  return text.includes('SimpleURLLoaderWrapper') || text.includes('Error: Error: net::')
}
