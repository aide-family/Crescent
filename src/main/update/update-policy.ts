/** Opt-in so unpackaged `npm run dev` can still exercise GitHub update checks. */
export const CRESCENT_DEV_UPDATES_ENV = 'CRESCENT_DEV_UPDATES'

export function shouldForceDevUpdateConfig(
  env: NodeJS.Dict<string> | NodeJS.ProcessEnv = process.env
): boolean {
  return env[CRESCENT_DEV_UPDATES_ENV] === '1'
}

export function isAppUpdateCheckEnabled(options: {
  isPackaged: boolean
  forceDevUpdates: boolean
}): boolean {
  return options.isPackaged || options.forceDevUpdates
}

const EXPECTED_NETWORK_ERROR_RE =
  /net::ERR_(CONNECTION_TIMED_OUT|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_REFUSED)|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i

export function isExpectedUpdateNetworkError(message: string): boolean {
  return EXPECTED_NETWORK_ERROR_RE.test(message)
}

export function summarizeUpdateNetworkError(message: string): string {
  const match = message.match(EXPECTED_NETWORK_ERROR_RE)
  return match ? match[0] : 'network error'
}
