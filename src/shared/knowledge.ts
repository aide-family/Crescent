export const MEMORY_CATEGORIES = [
  'environment',
  'architecture',
  'operation',
  'troubleshooting',
  'preference'
] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]
export type MemoryStatus = 'candidate' | 'approved' | 'archived'
export interface MemoryItem {
  id: string
  title: string
  content: string
  category: MemoryCategory
  status: MemoryStatus
  confidence: number
  source: string
  scope: string
  createdAt: string
  updatedAt: string
}
export type MemoryInput = Pick<MemoryItem, 'title' | 'content' | 'category' | 'scope'> & {
  id?: string
  status?: MemoryStatus
}
export interface MemorySettings {
  recall: boolean
  autoLearn: boolean
  learningSelection?: MemoryModelSelection
}
export interface MemoryModelSelection {
  providerId: string
  model: string
}
export interface MemoryLearningTarget extends MemoryModelSelection {
  providerName: string
  endpoint: string
  local: boolean
  authorized: boolean
  consentKey: string
}
export interface MemoryLearnOptions {
  selection?: MemoryModelSelection
  targetKey?: string
}
export interface LearningHistory {
  tabId: string
  title: string
  scope: string
  state: 'pending' | 'review' | 'learned' | 'archived' | 'changed'
  learnedAt?: string
}
export interface MemoryRelation {
  source: string
  target: string
  relation: string
}
export interface MemorySnapshot {
  items: MemoryItem[]
  history: LearningHistory[]
  relations: MemoryRelation[]
  settings: MemorySettings
  autoLearnError?: string
}
export interface CodeIndexStatus {
  root: string
  files: number
  symbols: number
  updatedAt?: string
  indexing: boolean
  skipped: number
  errors: number
  limited: boolean
}
export interface CodeSymbol {
  path: string
  name: string
  kind: string
  start: number
  end: number
}
export interface CodeReference {
  path: string
  name: string
  kind: string
  line: number
  from?: string
}
export interface CodeHit {
  path: string
  line: number
  text: string
}
