import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'

import type { AgentExtensionCommand, AgentExtensionOption } from './types'
import { getCrescentPiExtensionsDir } from './pi-paths'

const MAX_EXTENSION_PREVIEW_CHARS = 16_000
const EXTENSION_FILE_SUFFIX = '.ts'

export interface ExtensionLoadSnapshot {
  toolsById: Record<string, string[]>
  commandsById: Record<string, string[]>
  errorsById: Record<string, string>
}

export interface ExtensionFileEntry {
  id: string
  name: string
  path: string
  kind: 'file' | 'directory'
  mtimeMs: number
  size: number
}

let loadSnapshot: ExtensionLoadSnapshot = { toolsById: {}, commandsById: {}, errorsById: {} }

export function rememberExtensionLoadSnapshot(snapshot: ExtensionLoadSnapshot): void {
  loadSnapshot = {
    toolsById: { ...snapshot.toolsById },
    commandsById: { ...snapshot.commandsById },
    errorsById: { ...snapshot.errorsById }
  }
}

export function getExtensionLoadSnapshot(): ExtensionLoadSnapshot {
  return loadSnapshot
}

export function resetExtensionLoadSnapshot(): void {
  loadSnapshot = { toolsById: {}, commandsById: {}, errorsById: {} }
}

export function listExtensionFiles(
  extensionsDir = getCrescentPiExtensionsDir()
): ExtensionFileEntry[] {
  const root = resolve(extensionsDir)
  if (!existsSync(root)) return []

  const entries: ExtensionFileEntry[] = []
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) continue
    const path = join(root, dirent.name)
    if (dirent.isFile() && dirent.name.endsWith(EXTENSION_FILE_SUFFIX)) {
      const stats = statSync(path)
      const id = extensionIdFromFileName(dirent.name)
      entries.push({
        id,
        name: id,
        path,
        kind: 'file',
        mtimeMs: stats.mtimeMs,
        size: stats.size
      })
      continue
    }
    if (!dirent.isDirectory()) continue
    const indexPath = join(path, 'index.ts')
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) continue
    const stats = statSync(indexPath)
    entries.push({
      id: dirent.name,
      name: dirent.name,
      path: indexPath,
      kind: 'directory',
      mtimeMs: stats.mtimeMs,
      size: stats.size
    })
  }

  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

export function listAgentExtensions(
  options: {
    disabledExtensions?: string[]
    extensionsDir?: string
    snapshot?: ExtensionLoadSnapshot
  } = {}
): AgentExtensionOption[] {
  const disabled = new Set(normalizeDisabledExtensions(options.disabledExtensions))
  const snapshot = options.snapshot ?? loadSnapshot
  return listExtensionFiles(options.extensionsDir).map((entry) => ({
    id: entry.id,
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    enabled: !disabled.has(entry.id),
    tools: snapshot.toolsById[entry.id] ?? [],
    commands: snapshot.commandsById[entry.id] ?? [],
    loadError: snapshot.errorsById[entry.id]
  }))
}

export function listEnabledExtensionPaths(
  options: {
    disabledExtensions?: string[]
    extensionsDir?: string
  } = {}
): string[] {
  const disabled = new Set(normalizeDisabledExtensions(options.disabledExtensions))
  return listExtensionFiles(options.extensionsDir)
    .filter((entry) => !disabled.has(entry.id))
    .map((entry) => entry.path)
}

export function computeExtensionFingerprint(
  options: {
    disabledExtensions?: string[]
    extensionsDir?: string
    packageFingerprint?: string
  } = {}
): string {
  const disabled = normalizeDisabledExtensions(options.disabledExtensions)
  const enabled = listExtensionFiles(options.extensionsDir)
    .filter((entry) => !disabled.includes(entry.id))
    .map((entry) => `${entry.id}:${entry.mtimeMs}:${entry.size}`)
  const payload = `disabled=${disabled.join(',')};enabled=${enabled.join(',')};packages=${options.packageFingerprint ?? ''}`
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

export function extensionIdFromPath(
  path: string,
  extensionsDir = getCrescentPiExtensionsDir()
): string {
  const resolved = resolve(path)
  const root = resolve(extensionsDir)
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return extensionIdFromFileName(basename(resolved))
  }
  const first = rel.split(/[/\\]/)[0] ?? basename(resolved)
  return extensionIdFromFileName(first)
}

export function importAgentExtension(
  sourcePath: string,
  extensionsDir = getCrescentPiExtensionsDir()
): AgentExtensionOption[] {
  const source = resolve(sourcePath)
  if (!existsSync(source)) throw new Error('Extension source does not exist.')

  const root = ensureExtensionsDir(extensionsDir)
  const stats = statSync(source)
  if (stats.isFile()) {
    if (extname(source) !== EXTENSION_FILE_SUFFIX) {
      throw new Error('Extension files must use a .ts suffix.')
    }
    const dest = resolveExtensionImportDest(root, source)
    cpSync(source, dest)
    return listAgentExtensions({ extensionsDir: root })
  }

  if (!stats.isDirectory()) throw new Error('Extension source must be a .ts file or a directory.')
  const indexPath = join(source, 'index.ts')
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error('Extension directories must contain index.ts.')
  }
  const dest = resolveExtensionImportDest(root, source)
  cpSync(source, dest, { recursive: true })
  return listAgentExtensions({ extensionsDir: root })
}

export function deleteAgentExtension(
  path: string,
  extensionsDir = getCrescentPiExtensionsDir()
): AgentExtensionOption[] {
  const root = resolve(extensionsDir)
  const extension = listAgentExtensions({ extensionsDir: root }).find(
    (candidate) => resolve(candidate.path) === resolve(path)
  )
  if (!extension) throw new Error('Extension not found.')
  if (!isPathInsideExtensionsDir(extension.path, root)) {
    throw new Error('Extension path is outside the extensions directory.')
  }

  if (extension.kind === 'directory') {
    rmSync(dirname(extension.path), { recursive: true, force: false })
  } else {
    rmSync(extension.path, { force: false })
  }
  return listAgentExtensions({ extensionsDir: root })
}

export function readAgentExtensionContent(
  path: string,
  extensionsDir = getCrescentPiExtensionsDir()
): string {
  const root = resolve(extensionsDir)
  const extension = listAgentExtensions({ extensionsDir: root }).find(
    (candidate) => resolve(candidate.path) === resolve(path)
  )
  if (!extension) throw new Error('Extension not found.')
  if (!isPathInsideExtensionsDir(extension.path, root)) {
    throw new Error('Extension path is outside the extensions directory.')
  }
  return readFileSync(extension.path, 'utf8').slice(0, MAX_EXTENSION_PREVIEW_CHARS)
}

export function writeStarterExtension(
  extensionsDir = getCrescentPiExtensionsDir()
): AgentExtensionOption[] {
  const root = ensureExtensionsDir(extensionsDir)
  const dest = join(root, 'hello.ts')
  if (existsSync(dest)) return listAgentExtensions({ extensionsDir: root })
  writeFileSync(dest, STARTER_EXTENSION_SOURCE, 'utf8')
  return listAgentExtensions({ extensionsDir: root })
}

export function isPathInsideExtensionsDir(path: string, extensionsDir: string): boolean {
  const resolvedChild = resolve(path)
  const resolvedParent = resolve(extensionsDir)
  const rel = relative(resolvedParent, resolvedChild)
  return Boolean(rel) && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

export function normalizeDisabledExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((item) => extensionIdFromFileName(item))
    )
  ].sort()
}

export function snapshotFromLoadedExtensions(input: {
  extensions: Array<{
    path: string
    tools?: Map<string, { definition?: { name?: string } }>
    commands?: Map<string, { name?: string }>
  }>
  errors: Array<{ path: string; error: string }>
  extensionsDir?: string
}): ExtensionLoadSnapshot {
  const extensionsDir = input.extensionsDir ?? getCrescentPiExtensionsDir()
  const toolsById: Record<string, string[]> = {}
  const commandsById: Record<string, string[]> = {}
  const errorsById: Record<string, string> = {}

  for (const extension of input.extensions) {
    const id = extensionIdFromPath(extension.path, extensionsDir)
    const tools = [...(extension.tools?.values() ?? [])]
      .map((tool) => tool.definition?.name?.trim() ?? '')
      .filter(Boolean)
    const commands = [...(extension.commands?.values() ?? [])]
      .map((command) => command.name?.trim() ?? '')
      .filter(Boolean)
    if (tools.length) toolsById[id] = [...new Set(tools)]
    if (commands.length) commandsById[id] = [...new Set(commands)]
  }

  for (const error of input.errors) {
    const id = extensionIdFromPath(error.path, extensionsDir)
    errorsById[id] = error.error
  }

  return { toolsById, commandsById, errorsById }
}

export function listCachedExtensionCommands(
  extensions: AgentExtensionOption[] = listAgentExtensions()
): AgentExtensionCommand[] {
  return extensions
    .filter((extension) => extension.enabled)
    .flatMap((extension) =>
      extension.commands.map((name) => ({
        name,
        description: `${extension.name} command`,
        extensionId: extension.id
      }))
    )
}

function resolveExtensionImportDest(root: string, source: string): string {
  const destName = basename(source)
  if (!destName || destName === '.' || destName === '..') {
    throw new Error('Invalid extension name.')
  }
  const dest = join(root, destName)
  if (!isPathInsideExtensionsDir(dest, root)) {
    throw new Error('Extension path is outside the extensions directory.')
  }
  if (existsSync(dest)) throw new Error(`Extension already exists: ${destName}`)
  return dest
}

function ensureExtensionsDir(extensionsDir: string): string {
  const root = resolve(extensionsDir)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function extensionIdFromFileName(name: string): string {
  return name.endsWith(EXTENSION_FILE_SUFFIX) ? name.slice(0, -EXTENSION_FILE_SUFFIX.length) : name
}

const STARTER_EXTENSION_SOURCE = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: \`Hello, \${params.name}!\` }],
        details: {},
      };
    },
  });

  pi.registerCommand("hello", {
    description: "Say hello from a Crescent extension",
    handler: async (args, ctx) => {
      ctx.ui.notify(\`Hello \${args || "world"}!\`, "info");
    },
  });
}
`
