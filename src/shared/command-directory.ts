import { redactSensitiveText } from './secret-redaction'
export interface CommandParameter {
  name: string
  type: 'text' | 'integer' | 'enum'
  values?: string[]
}
export interface CommandEntry {
  id: string
  name: string
  category: string
  description: string
  command: string
  tags: string[]
  environment: string
  risk: 'low' | 'high' | 'unknown'
  expectedOutput: string
  parameters: CommandParameter[]
  scope: 'global' | 'connection' | 'cluster'
  scopeId?: string
  favorite: boolean
  updatedAt: string
  source: string
  notes: string
}
export interface CommandDirectory {
  version: 1
  revision: number
  categories: string[]
  entries: CommandEntry[]
}
export const DEFAULT_COMMAND_CATEGORIES = [
  'Linux',
  'Kubernetes',
  'MongoDB / Redis / MySQL / ES',
  'Nginx / 网关',
  '日志',
  '网络',
  '备份',
  '故障排查'
]
export function validateCommandEntry(value: unknown): CommandEntry {
  const v = value as CommandEntry
  if (
    !v ||
    typeof v !== 'object' ||
    !/^[\w-]{1,100}$/.test(v.id) ||
    !['global', 'connection', 'cluster'].includes(v.scope) ||
    !['low', 'high', 'unknown'].includes(v.risk)
  )
    throw new Error('Invalid command entry')
  for (const key of [
    'name',
    'category',
    'description',
    'command',
    'environment',
    'expectedOutput',
    'source',
    'notes',
    'updatedAt'
  ] as const)
    if (typeof v[key] !== 'string' || v[key].length > (key === 'command' ? 16000 : 4000))
      throw new Error(`Invalid ${key}`)
  if (
    !v.name.trim() ||
    !v.command.trim() ||
    !v.category.trim() ||
    (v.scope !== 'global' && (typeof v.scopeId !== 'string' || !/^[\w:.-]{1,160}$/.test(v.scopeId)))
  )
    throw new Error('Name, command, category and stable scope ID are required')
  if (
    ['name', 'description', 'command', 'environment', 'expectedOutput', 'source', 'notes'].some(
      (key) => redactSensitiveText(v[key]) !== v[key]
    )
  )
    throw new Error('Commands must not contain plaintext credentials')
  if (
    !Array.isArray(v.tags) ||
    v.tags.length > 30 ||
    v.tags.some((tag) => typeof tag !== 'string' || tag.length > 100) ||
    typeof v.favorite !== 'boolean'
  )
    throw new Error('Invalid tags/favorite')
  if (!Array.isArray(v.parameters) || v.parameters.length > 30)
    throw new Error('Invalid parameters')
  const names = new Set<string>()
  for (const parameter of v.parameters) {
    if (
      !parameter ||
      !/^[A-Za-z][\w]{0,40}$/.test(parameter.name) ||
      names.has(parameter.name) ||
      !['text', 'integer', 'enum'].includes(parameter.type)
    )
      throw new Error('Invalid parameter')
    names.add(parameter.name)
    if (
      parameter.type === 'enum' &&
      (!Array.isArray(parameter.values) ||
        !parameter.values.length ||
        parameter.values.length > 100 ||
        parameter.values.some((item) => typeof item !== 'string' || item.length > 200))
    )
      throw new Error('Invalid enum')
  }
  // Whitelist fields so imports never carry connection credentials or tool authorization metadata.
  const fields = Object.fromEntries(
    [
      'id',
      'name',
      'category',
      'description',
      'command',
      'tags',
      'environment',
      'risk',
      'expectedOutput',
      'parameters',
      'scope',
      'scopeId',
      'favorite',
      'updatedAt',
      'source',
      'notes'
    ].map((key) => [key, v[key]])
  ) as unknown as CommandEntry
  return {
    ...fields,
    parameters: v.parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      ...(parameter.type === 'enum' ? { values: [...parameter.values!] } : {})
    }))
  }
}
export function validateCommandDirectory(value: unknown): CommandDirectory {
  const v = value as CommandDirectory
  if (
    !v ||
    v.version !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !Array.isArray(v.categories) ||
    v.categories.length > 100 ||
    v.categories.some((item) => typeof item !== 'string' || item.length > 100) ||
    !Array.isArray(v.entries) ||
    v.entries.length > 1000
  )
    throw new Error('Invalid directory')
  const entries = v.entries.map(validateCommandEntry)
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error('Duplicate command ID')
  return { version: 1, revision: v.revision, categories: [...new Set(v.categories)], entries }
}
export function renderCommandTemplate(entry: CommandEntry, values: Record<string, string>): string {
  validateCommandEntry(entry)
  const rendered = entry.command.replace(
    /\{\{([A-Za-z][\w]*)\}\}/g,
    (match, name: string, offset: number) => {
      const parameter = entry.parameters.find((p) => p.name === name)
      const value = values[name]
      if (!parameter || typeof value !== 'string' || value.length > 1000 || /[\r\n\0]/.test(value))
        throw new Error(`Invalid parameter: ${name}`)
      // Placeholders must be standalone shell words or unquoted --flag={{value}}.
      const before = entry.command.slice(0, offset)
      if (
        /['"\\]$/.test(before) ||
        /^['"\\]/.test(entry.command.slice(offset + match.length)) ||
        (before.match(/'/g)?.length ?? 0) % 2 ||
        (before.match(/"/g)?.length ?? 0) % 2
      )
        throw new Error('Placeholders must be outside quoted shell strings')
      if (parameter.type === 'integer' && !/^-?\d{1,9}$/.test(value))
        throw new Error(`${name}: integer required`)
      if (parameter.type === 'enum' && !parameter.values?.includes(value))
        throw new Error(`${name}: choose an enum value`)
      return `'${value.replace(/'/g, `'"'"'`)}'`
    }
  )
  if (/\{\{|\}\}/.test(rendered)) throw new Error('Unresolved template parameter')
  if (redactSensitiveText(rendered) !== rendered)
    throw new Error('Rendered command contains plaintext credentials')
  return rendered
}
