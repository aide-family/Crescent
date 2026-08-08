import { randomUUID } from 'crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { SkillTemplate, SkillTemplateSaveInput } from '../../shared/agent-types'

export type { SkillTemplate, SkillTemplateSaveInput }

interface SkillTemplateRow {
  id: string
  name: string
  prompt_template: string
  tags: string | null
  created_at: number
}

export function listSkillTemplatesFromDb(db: DatabaseSync): SkillTemplate[] {
  const rows = db
    .prepare(
      `
      SELECT id, name, prompt_template, tags, created_at
      FROM skill_templates
      ORDER BY created_at DESC
    `
    )
    .all() as unknown as SkillTemplateRow[]

  return rows.map(mapSkillTemplateRow)
}

export function saveSkillTemplateToDb(
  db: DatabaseSync,
  input: SkillTemplateSaveInput
): SkillTemplate {
  const name = input.name.trim()
  const promptTemplate = input.promptTemplate
  if (!name) throw new Error('Skill template name is required')
  if (!promptTemplate.trim()) throw new Error('Skill template prompt is required')

  const id = input.id?.trim() || randomUUID()
  const tags = (input.tags ?? '').trim()
  const existing = db.prepare(`SELECT id, created_at FROM skill_templates WHERE id = ?`).get(id) as
    | { id: string; created_at: number }
    | undefined

  const createdAt = existing?.created_at ?? Date.now()
  db.prepare(
    `
    INSERT INTO skill_templates (id, name, prompt_template, tags, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      prompt_template = excluded.prompt_template,
      tags = excluded.tags
  `
  ).run(id, name, promptTemplate, tags || null, createdAt)

  return {
    id,
    name,
    promptTemplate,
    tags,
    createdAt
  }
}

function mapSkillTemplateRow(row: SkillTemplateRow): SkillTemplate {
  return {
    id: row.id,
    name: row.name,
    promptTemplate: row.prompt_template,
    tags: row.tags ?? '',
    createdAt: row.created_at
  }
}
