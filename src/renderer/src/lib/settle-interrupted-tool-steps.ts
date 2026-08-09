import type { AgentRunStep } from './terminal-tabs'

/**
 * Defensive UI settle: when a run is manually stopped, force any still-running
 * tool cards to `finished` + `interrupted` so the spinner never sticks.
 * Main `command/finished` with interrupted remains the fact source when it arrives.
 */
export function settleRunningToolStepsAsInterrupted(steps: AgentRunStep[]): AgentRunStep[] {
  return steps.map((step) => {
    if (step.kind !== 'tool' || step.phase !== 'started') return step
    return {
      ...step,
      phase: 'finished',
      interrupted: true,
      isError: true
    }
  })
}
