import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { listSkillTemplatesFromDb, saveSkillTemplateToDb } from './skill-templates'

function createMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      tags TEXT,
      created_at INTEGER NOT NULL
    );
  `)
  return db
}

describe('skill_templates CRUD', () => {
  it('saves and lists templates', () => {
    const db = createMemoryDb()
    const saved = saveSkillTemplateToDb(db, {
      name: 'K8s inspect',
      promptTemplate: 'kubectl get pods -A',
      tags: 'k8s,readonly'
    })
    expect(saved.id).toBeTruthy()
    expect(saved.name).toBe('K8s inspect')
    expect(saved.promptTemplate).toBe('kubectl get pods -A')
    expect(saved.tags).toBe('k8s,readonly')

    const listed = listSkillTemplatesFromDb(db)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: saved.id,
      name: 'K8s inspect',
      promptTemplate: 'kubectl get pods -A'
    })
  })

  it('updates existing template by id', () => {
    const db = createMemoryDb()
    const first = saveSkillTemplateToDb(db, {
      name: 'A',
      promptTemplate: 'echo a'
    })
    const updated = saveSkillTemplateToDb(db, {
      id: first.id,
      name: 'B',
      promptTemplate: 'echo b',
      tags: 'x'
    })
    expect(updated.id).toBe(first.id)
    expect(updated.createdAt).toBe(first.createdAt)
    expect(listSkillTemplatesFromDb(db)).toHaveLength(1)
    expect(listSkillTemplatesFromDb(db)[0]?.name).toBe('B')
  })
})
