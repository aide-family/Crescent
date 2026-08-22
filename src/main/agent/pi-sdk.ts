import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { traceStartup } from '../startup-trace'

/**
 * Lazy ESM loader for @earendil-works/pi-coding-agent.
 *
 * Pi packages are ESM-only (`exports.import`, no `require`). Electron main is
 * CJS, so static imports become `require()` and throw ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Dynamic `import()` uses the ESM export map and works in Electron main.
 *
 * Avoid importing the package barrel (`dist/index.js`): it eagerly loads the
 * native clipboard addon via `utils/clipboard-native.js`. Host integrations
 * should import only the SDK submodules Crescent actually uses.
 */
export type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')
export type PiAiModule = typeof import('@earendil-works/pi-ai')

export type PiSdkFacade = Pick<
  PiCodingAgentModule,
  | 'ModelRuntime'
  | 'SettingsManager'
  | 'DefaultPackageManager'
  | 'DefaultResourceLoader'
  | 'SessionManager'
  | 'createAgentSession'
  | 'defineTool'
  | 'createBashToolDefinition'
>

type PiModelRuntimeModule = Pick<PiCodingAgentModule, 'ModelRuntime'>
type PiSdkModule = Pick<PiCodingAgentModule, 'createAgentSession' | 'createBashToolDefinition'>
type PiSettingsModule = Pick<PiCodingAgentModule, 'SettingsManager'>
type PiPackageManagerModule = Pick<PiCodingAgentModule, 'DefaultPackageManager'>
type PiResourceLoaderModule = Pick<PiCodingAgentModule, 'DefaultResourceLoader'>
type PiSessionManagerModule = Pick<PiCodingAgentModule, 'SessionManager'>
type PiExtensionsModule = Pick<PiCodingAgentModule, 'defineTool'>

let piPackageRoot: string | undefined
let piModelRuntimePromise: Promise<PiModelRuntimeModule> | undefined
let piSdkFacadePromise: Promise<PiSdkFacade> | undefined
let piAiPromise: Promise<PiAiModule> | undefined

const PI_MODEL_RUNTIME_RELATIVE = join('dist', 'core', 'model-runtime.js')
const PI_PACKAGE_SEGMENTS = join('node_modules', '@earendil-works', 'pi-coding-agent')

function locatePiPackageRoot(): string {
  const roots = new Set<string>([dirname(__filename), process.cwd()])

  for (const start of roots) {
    let dir = start
    for (let depth = 0; depth < 12; depth += 1) {
      for (const prefix of ['', join('app.asar.unpacked')]) {
        const candidate = join(dir, prefix, PI_PACKAGE_SEGMENTS)
        if (existsSync(join(candidate, PI_MODEL_RUNTIME_RELATIVE))) {
          return candidate
        }
      }

      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  throw new Error(
    'Could not locate @earendil-works/pi-coding-agent on disk. Ensure the dependency is installed and unpackaged.'
  )
}

function getPiPackageRoot(): string {
  if (!piPackageRoot) {
    piPackageRoot = locatePiPackageRoot()
  }
  return piPackageRoot
}

async function importPiSubpath<T>(relativePath: string, label: string): Promise<T> {
  const start = traceStartup(`${label}:start`)
  const url = pathToFileURL(join(getPiPackageRoot(), relativePath)).href
  try {
    const module = (await import(url)) as T
    traceStartup(`${label}:done`, start)
    return module
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load Pi coding agent module ${relativePath}. Ensure @earendil-works/pi-coding-agent is installed and unpackaged. ${detail}`
    )
  }
}

export function loadPiModelRuntime(): Promise<PiModelRuntimeModule> {
  if (!piModelRuntimePromise) {
    piModelRuntimePromise = importPiSubpath<PiModelRuntimeModule>(
      'dist/core/model-runtime.js',
      'pi-model-runtime'
    ).catch((error) => {
      piModelRuntimePromise = undefined
      throw error
    })
  }
  return piModelRuntimePromise
}

export function loadPiSdk(): Promise<PiSdkFacade> {
  if (!piSdkFacadePromise) {
    piSdkFacadePromise = (async () => {
      const start = traceStartup('pi-sdk-facade:start')
      const [sdk, settings, packageManager, resourceLoader, sessionManager, extensions] =
        await Promise.all([
          importPiSubpath<PiSdkModule>('dist/core/sdk.js', 'pi-sdk'),
          importPiSubpath<PiSettingsModule>('dist/core/settings-manager.js', 'pi-settings'),
          importPiSubpath<PiPackageManagerModule>(
            'dist/core/package-manager.js',
            'pi-package-manager'
          ),
          importPiSubpath<PiResourceLoaderModule>(
            'dist/core/resource-loader.js',
            'pi-resource-loader'
          ),
          importPiSubpath<PiSessionManagerModule>(
            'dist/core/session-manager.js',
            'pi-session-manager'
          ),
          importPiSubpath<PiExtensionsModule>('dist/core/extensions/index.js', 'pi-extensions')
        ])
      traceStartup('pi-sdk-facade:done', start)
      return {
        ModelRuntime: (await loadPiModelRuntime()).ModelRuntime,
        SettingsManager: settings.SettingsManager,
        DefaultPackageManager: packageManager.DefaultPackageManager,
        DefaultResourceLoader: resourceLoader.DefaultResourceLoader,
        SessionManager: sessionManager.SessionManager,
        createAgentSession: sdk.createAgentSession,
        defineTool: extensions.defineTool,
        createBashToolDefinition: sdk.createBashToolDefinition
      }
    })().catch((error) => {
      piSdkFacadePromise = undefined
      throw error
    })
  }
  return piSdkFacadePromise
}

/** @deprecated Use loadPiSdk() or loadPiModelRuntime() to avoid the clipboard barrel import. */
export function loadPiCodingAgent(): Promise<PiSdkFacade> {
  return loadPiSdk()
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

export function getPiPackageRootForTests(): string {
  return getPiPackageRoot()
}
