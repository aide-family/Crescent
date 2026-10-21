import { parseCommandWhitelist } from '@renderer/lib/agent-config'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'
import { type AgentStyle } from '../../../shared/agent-style'
import { type AgentConfig, type AgentValidationResult } from '../../../shared/agent-types'

interface Parameters {
  setSaved: Dispatch<SetStateAction<boolean>>
  configRef: RefObject<AgentConfig>
  commandWhitelistTextRef: RefObject<string>
  setConfig: Dispatch<SetStateAction<AgentConfig>>
  setValidation: Dispatch<SetStateAction<AgentValidationResult | undefined>>
  saveAgentConfig: (nextConfigInput: AgentConfig) => Promise<AgentConfig>
  validateConfig: (nextConfigInput?: AgentConfig) => Promise<void>
  updateConfig: <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => void
}

export function useSessionPersistence({
  setSaved,
  configRef,
  commandWhitelistTextRef,
  setConfig,
  setValidation,
  saveAgentConfig,
  validateConfig,
  updateConfig
}: Parameters) {
  const workspaceCwdSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pendingWorkspaceCwdRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (workspaceCwdSaveTimerRef.current) {
        clearTimeout(workspaceCwdSaveTimerRef.current)
        workspaceCwdSaveTimerRef.current = null
      }
    }
  }, [])

  function flashSettingsSaved(): void {
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  async function persistAgentConfigPatch(patch: Partial<AgentConfig>): Promise<AgentConfig> {
    const optimisticConfig = {
      ...configRef.current,
      ...patch,
      commandWhitelist: parseCommandWhitelist(commandWhitelistTextRef.current)
    }
    setConfig(optimisticConfig)
    setValidation(undefined)
    const nextConfig = await saveAgentConfig(optimisticConfig)
    flashSettingsSaved()
    void validateConfig(nextConfig)
    return nextConfig
  }

  async function saveConfig(): Promise<void> {
    await persistAgentConfigPatch({})
  }

  function persistAgentStyle(style: AgentStyle): void {
    void persistAgentConfigPatch({ agentStyle: style })
  }

  function persistShowAgentThinking(value: boolean | undefined): void {
    void persistAgentConfigPatch({ showAgentThinking: value })
  }

  function scheduleWorkspaceCwdPersist(value: string): void {
    updateConfig('workspaceCwd', value.trim() || undefined)
    pendingWorkspaceCwdRef.current = value
    if (workspaceCwdSaveTimerRef.current) {
      clearTimeout(workspaceCwdSaveTimerRef.current)
    }
    workspaceCwdSaveTimerRef.current = setTimeout(() => {
      workspaceCwdSaveTimerRef.current = null
      const pending = pendingWorkspaceCwdRef.current
      pendingWorkspaceCwdRef.current = null
      if (pending === null) return
      void persistAgentConfigPatch({ workspaceCwd: pending.trim() || undefined })
    }, 400)
  }

  function flushWorkspaceCwdPersist(): void {
    if (workspaceCwdSaveTimerRef.current) {
      clearTimeout(workspaceCwdSaveTimerRef.current)
      workspaceCwdSaveTimerRef.current = null
    }
    const pending = pendingWorkspaceCwdRef.current
    if (pending === null) return
    pendingWorkspaceCwdRef.current = null
    void persistAgentConfigPatch({ workspaceCwd: pending.trim() || undefined })
  }
  return {
    workspaceCwdSaveTimerRef,
    pendingWorkspaceCwdRef,
    flashSettingsSaved,
    persistAgentConfigPatch,
    saveConfig,
    persistAgentStyle,
    persistShowAgentThinking,
    scheduleWorkspaceCwdPersist,
    flushWorkspaceCwdPersist
  }
}
