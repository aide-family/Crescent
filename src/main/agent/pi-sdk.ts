/**
 * Lazy ESM loader for @earendil-works/pi-coding-agent.
 *
 * Pi packages are ESM-only (`exports.import`, no `require`). Electron main is
 * CJS, so static imports become `require()` and throw ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Dynamic `import()` uses the ESM export map and works in Electron main.
 */
export type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')
export type PiAiModule = typeof import('@earendil-works/pi-ai')

let piModulePromise: Promise<PiCodingAgentModule> | undefined
let piAiPromise: Promise<PiAiModule> | undefined

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

/**
 * Lazy ESM loader for @earendil-works/pi-ai.
 *
 * pi-ai is ESM-only like the other pi packages; in CJS Electron main it must
 * be loaded with dynamic `import()` (e.g. for `StringEnum` tool schemas).
 */
export function loadPiAi(): Promise<PiAiModule> {
  if (!piAiPromise) {
    piAiPromise = import('@earendil-works/pi-ai').catch((error) => {
      piAiPromise = undefined
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to load Pi AI SDK (ESM). Ensure @earendil-works/pi-ai is installed and unpackaged. ${detail}`
      )
    })
  }
  return piAiPromise
}
