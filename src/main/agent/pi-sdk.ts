/**
 * Lazy ESM loader for @earendil-works/pi-coding-agent.
 *
 * Pi packages are ESM-only (`exports.import`, no `require`). Electron main is
 * CJS, so static imports become `require()` and throw ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Dynamic `import()` uses the ESM export map and works in Electron main.
 */
export type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')

let piModulePromise: Promise<PiCodingAgentModule> | undefined

export function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  if (!piModulePromise) {
    piModulePromise = import('@earendil-works/pi-coding-agent').catch((error) => {
      piModulePromise = undefined
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to load Pi coding agent SDK (ESM). Ensure @earendil-works/pi-coding-agent is installed and unpackaged. ${detail}`
      )
    })
  }
  return piModulePromise
}
