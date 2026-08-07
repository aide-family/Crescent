import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

const INSTRUCTION_FILE_NAMES = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md'
] as const
type InstructionFileName = (typeof INSTRUCTION_FILE_NAMES)[number]

const MAX_INSTRUCTION_FILE_CHARS = 12_000
const MAX_INSTRUCTION_CONTEXT_CHARS = 48_000

const DEFAULT_INSTRUCTION_TEMPLATES: Record<InstructionFileName, string> = {
  'IDENTITY.md': `# IDENTITY.md

# Crescent local identity

- Name: Crescent
- Role: AI operations assistant embedded beside an interactive terminal
- Focus: Linux, SSH, shell, debugging, and day-to-day ops work
- Voice: concise, terminal-friendly; match the operator's preferred UI language for all replies and reasoning (do not mix languages in prose; keep commands/paths/tool names original)


Edit this file to customize how Crescent introduces itself.
`,
  'SOUL.md': `# SOUL.md

# Operating principles

- Prefer evidence from the live terminal over speculation.
- Prefer safe, reversible checks before state-changing actions.
- Ask one concise clarifying question when the target host or scope is ambiguous.
- Guide the operator like a senior engineer: state the goal before each check, interpret evidence briefly, then choose the next step.
- Keep final answers short and actionable (status, risks, next actions).
- Use one language consistently for thinking and replies (follow the UI locale / Language directive in the prompt).
- Never invent hosts, credentials, or tool results.

Edit this file to shape Crescent's judgment and tone.
`,
  'USER.md': `# USER.md

# About the operator

- Preferred language:
- Timezone / working hours:
- Common environments (local / bastion / prod):
- Risk tolerance for destructive commands:
- Things Crescent should always confirm first:

Fill this in so Crescent can adapt to your workflow.
`,
  'AGENTS.md': `# AGENTS.md

# Agent workflow defaults

- Default mode preference: ReAct unless planning is clearly needed.
- Prefer the current/focused terminal; use peer terminals or sub-terminals when the task would disturb the active session.
- For inventory/report requests, gather normalized evidence first, narrating each step briefly, then summarize.
- Between tools, leave short operator-facing guidance (why this check, what the output means, what is next).
- Stop and ask when blocked by missing access, credentials, or ambiguous targets.
- After enough evidence, summarize instead of repeating checks.

Edit this file to encode team or personal agent conventions.
`,
  'TOOLS.md': `# TOOLS.md

# Tool usage preferences

- Prefer built-in terminal tools for shell work.
- Prefer OpenAPI / MCP tools when they match the request better than ad-hoc shell.
- Keep command allow/deny and approval rules in Settings; do not bypass them here.
- Prefer read-only discovery before write/update/delete operations.
- When writing local files or Wiki docs, use clear paths and confirm destinations when unsure.

Edit this file to record preferred tools and constraints.
`
}

export interface LocalInstructionFile {
  name: string
  path: string
  content: string
}

export interface EditableInstructionFile extends LocalInstructionFile {
  exists: boolean
}

export interface EnsureDefaultInstructionFilesResult {
  root: string
  created: string[]
  skipped: string[]
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

/**
 * Create missing default instruction files under ~/.crescent (or the given root).
 * Existing files are never overwritten.
 */
export function ensureDefaultInstructionFiles(
  root = join(homedir(), '.crescent')
): EnsureDefaultInstructionFilesResult {
  mkdirSync(root, { recursive: true })

  const created: string[] = []
  const skipped: string[] = []

  for (const name of INSTRUCTION_FILE_NAMES) {
    const path = join(root, name)
    if (existsSync(path)) {
      skipped.push(name)
      continue
    }

    writeFileSync(path, DEFAULT_INSTRUCTION_TEMPLATES[name], 'utf8')
    created.push(name)
  }

  return { root, created, skipped }
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

function normalizeInstructionFileName(value: string): InstructionFileName {
  const name = value.trim()
  if (!(INSTRUCTION_FILE_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unsupported instruction file: ${value}`)
  }

  return name as InstructionFileName
}

function readInstructionFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').slice(0, MAX_INSTRUCTION_FILE_CHARS)
  } catch (error) {
    return `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`
  }
}
