import type { AgentLongTermMemory, AgentMemoryRecord, ChatMessage } from './types'

export interface AgentMemoryState {
  shortTerm: AgentMemoryRecord[]
  longTerm: AgentLongTermMemory
}

export class AgentMemory {
  constructor(
    private readonly state: AgentMemoryState,
    private readonly persist: (state: AgentMemoryState) => void
  ) {}

  getPromptBlock(): string {
    const preferences = this.state.longTerm.preferences
    const notes = this.state.longTerm.notes
    const operations = this.state.longTerm.operations

    if (preferences.length === 0 && notes.length === 0 && operations.length === 0) {
      return 'No long-term memory has been recorded yet.'
    }

    return [
      preferences.length
        ? `User preferences:\n${preferences.map((item) => `- ${item}`).join('\n')}`
        : '',
      notes.length ? `Persistent notes:\n${notes.map((item) => `- ${item}`).join('\n')}` : '',
      operations.length
        ? `Recent operations:\n${operations
            .slice(0, 10)
            .map((item) => `- ${item.createdAt} ${item.connectionName ?? ''} ${item.summary}`)
            .join('\n')}`
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  getShortTermMessages(limit = 12): ChatMessage[] {
    return this.state.shortTerm.slice(-limit).map((record) => ({
      role: record.role,
      content: record.content
    }))
  }

  rememberTurn(userInput: string, assistantOutput: string): void {
    const createdAt = new Date().toISOString()

    const userRecord: AgentMemoryRecord = { role: 'user', content: userInput, createdAt }
    const assistantRecord: AgentMemoryRecord = {
      role: 'assistant',
      content: assistantOutput,
      createdAt
    }

    this.state.shortTerm = [...this.state.shortTerm, userRecord, assistantRecord].slice(-24)

    this.persist(this.state)
  }

  addLongTermNote(note: string): void {
    const trimmed = note.trim()
    if (!trimmed) return

    this.state.longTerm.notes = [...this.state.longTerm.notes, trimmed].slice(-100)
    this.persist(this.state)
  }
}
