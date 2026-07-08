import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

const INSTRUCTION_FILE_NAMES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'AGENTS.md', 'TOOLS.md']
const MAX_INSTRUCTION_FILE_CHARS = 12_000
const MAX_INSTRUCTION_CONTEXT_CHARS = 48_000

export interface LocalInstructionFile {
  name: string
  path: string
  content: string
}

export interface EditableInstructionFile extends LocalInstructionFile {
  exists: boolean
}

export function buildLocalInstructionContext(startDir = process.cwd()): string {
  return formatLocalInstructionContext(loadLocalInstructionFiles(startDir))
}

export function loadLocalInstructionFiles(startDir = process.cwd()): LocalInstructionFile[] {
  const roots = getInstructionRoots(startDir)
  const seen = new Set<string>()
  const files: LocalInstructionFile[] = []

  for (const root of roots) {
    for (const name of INSTRUCTION_FILE_NAMES) {
      const path = join(root, name)
      const key = resolve(path)
      if (seen.has(key) || !existsSync(path)) continue

      seen.add(key)
      files.push({
        name,
        path,
        content: readInstructionFile(path)
      })
    }
  }

  return files
}

export function listEditableInstructionFiles(
  root = join(homedir(), '.crescent')
): EditableInstructionFile[] {
  return INSTRUCTION_FILE_NAMES.map((name) => {
    const path = join(root, name)
    const exists = existsSync(path)

    return {
      name,
      path,
      exists,
      content: exists ? readInstructionFile(path) : ''
    }
  })
}

export function saveEditableInstructionFile(input: {
  name: string
  content: string
  root?: string
}): EditableInstructionFile {
  const name = normalizeInstructionFileName(input.name)
  const root = input.root ?? join(homedir(), '.crescent')
  const path = join(root, name)

  mkdirSync(root, { recursive: true })
  writeFileSync(path, input.content, 'utf8')

  return {
    name,
    path,
    exists: true,
    content: input.content
  }
}

export function formatLocalInstructionContext(files: LocalInstructionFile[]): string {
  if (files.length === 0) return ''

  const sections = [
    'Crescent local instruction files have already been read by the app process and are included below.',
    'Do not use terminal commands to read TOOLS.md, USER.md, SOUL.md, IDENTITY.md, AGENTS.md, or other local instruction files unless the user explicitly asks to inspect those files.',
    'Follow these instructions when they do not conflict with higher-priority system, developer, or user instructions.',
    '',
    ...files.flatMap((file) => [
      `## ${file.name}`,
      `Path: ${file.path}`,
      '```markdown',
      file.content,
      '```',
      ''
    ])
  ]

  return sections.join('\n').slice(0, MAX_INSTRUCTION_CONTEXT_CHARS)
}

function getInstructionRoots(startDir: string): string[] {
  const roots: string[] = [join(homedir(), '.crescent')]
  const home = resolve(homedir())
  let current = resolve(startDir || process.cwd())

  while (true) {
    roots.push(current)
    if (current === home || current === dirname(current)) break
    current = dirname(current)
  }

  return roots
}

function normalizeInstructionFileName(value: string): string {
  const name = value.trim()
  if (!INSTRUCTION_FILE_NAMES.includes(name)) {
    throw new Error(`Unsupported instruction file: ${value}`)
  }

  return name
}

function readInstructionFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').slice(0, MAX_INSTRUCTION_FILE_CHARS)
  } catch (error) {
    return `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`
  }
}
