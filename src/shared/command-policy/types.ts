export type StaticCommandLevel = 'high' | 'low' | 'gray'

export interface SimpleCommandRisk {
  level: StaticCommandLevel
  verb: string
}
