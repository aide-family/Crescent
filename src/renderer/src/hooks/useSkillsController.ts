import { agentClient } from '@renderer/clients'
import type { Dictionary } from '@renderer/i18n'
import type { SkillPreviewState } from '@renderer/components/SkillManager'
import {
  type SkillInstallLogStatus,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { parseCommandWhitelist } from '@renderer/lib/agent-config'
import { omitRecordKey } from '@renderer/lib/app-controller-support'
import { removeComposerRefToken } from '@renderer/lib/composer-ref-tokens'
import { copyFeedback, copyText } from '@renderer/lib/operation-feedback'
import {
  buildInstalledSkillNameSet,
  buildSkillInstallCommand,
  catalogSkillPageUrl,
  filterLocalSkills
} from '@renderer/lib/skill-management'
import { type AgentTerminalTab } from '@renderer/lib/terminal-tabs'
import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type AgentConfig,
  type AgentSkillInstallEvent,
  type AgentSkillOption,
  type AgentSkillSearchResult
} from '../../../shared/agent-types'

interface Parameters {
  saveAgentConfig: (nextConfigInput: AgentConfig) => Promise<AgentConfig>
  config: AgentConfig
  commandWhitelistText: string
  t: Dictionary
  setConfig: Dispatch<SetStateAction<AgentConfig>>
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  sessionChatTab: AgentTerminalTab
  applyComposerInput: (
    tab: AgentTerminalTab,
    value: string,
    extras?: Partial<AgentTerminalTab>
  ) => AgentTerminalTab
}

export function useSkillsController({
  saveAgentConfig,
  config,
  commandWhitelistText,
  t,
  setConfig,
  updateTab,
  sessionChatTab,
  applyComposerInput
}: Parameters) {
  const skillInstallResultIdsRef = useRef(new Map<string, string>())

  const skillInstallNamesRef = useRef(new Map<string, string>())

  const [skills, setSkills] = useState<AgentSkillOption[]>([])

  const [localSkillSearchQuery, setLocalSkillSearchQuery] = useState('')

  const [skillSearchQuery, setSkillSearchQuery] = useState('')

  const [skillSearchResults, setSkillSearchResults] = useState<AgentSkillSearchResult[]>([])

  const [skillSearchLoading, setSkillSearchLoading] = useState(false)

  const [skillDeletingPath, setSkillDeletingPath] = useState<string | null>(null)

  const [copiedSkillCommandId, setCopiedSkillCommandId] = useState<string | null>(null)

  const [skillManageMessage, setSkillManageMessage] = useState<SkillManageMessage | null>(null)

  const [skillInstallIds, setSkillInstallIds] = useState<Record<string, string>>({})

  const [skillInstallLogs, setSkillInstallLogs] = useState<Record<string, string>>({})

  const [skillInstallLogNames, setSkillInstallLogNames] = useState<Record<string, string>>({})

  const [skillInstallLogStatuses, setSkillInstallLogStatuses] = useState<
    Record<string, SkillInstallLogStatus>
  >({})

  const [skillInstallLogCreatedAt, setSkillInstallLogCreatedAt] = useState<Record<string, number>>(
    {}
  )

  const [skillInstallLogResultId, setSkillInstallLogResultId] = useState<string | null>(null)

  const [selectedSkillPreview, setSelectedSkillPreview] = useState<SkillPreviewState | null>(null)

  const [skillPreviewLoadingPath, setSkillPreviewLoadingPath] = useState<string | null>(null)

  const [copiedSkillInstallLogId, setCopiedSkillInstallLogId] = useState<string | null>(null)

  const [skillInstallCancelingIds, setSkillInstallCancelingIds] = useState<Record<string, boolean>>(
    {}
  )

  const [skillOpen, setSkillOpen] = useState(false)

  const filteredLocalSkills = useMemo(
    () => filterLocalSkills(skills, localSkillSearchQuery),
    [localSkillSearchQuery, skills]
  )

  const installedSkillNames = useMemo(() => buildInstalledSkillNameSet(skills), [skills])

  useEffect(() => {
    return agentClient.onSkillInstallEvent((event) => {
      handleSkillInstallEvent(event)
    })
  })

  useEffect(() => {
    pruneExpiredSkillInstallLogs()

    const now = Date.now()
    const nextExpirationDelay = Object.entries(skillInstallLogCreatedAt)
      .filter(([resultId]) => !skillInstallIds[resultId])
      .map(([, createdAt]) => createdAt + 24 * 60 * 60 * 1000 - now)
      .filter((delay) => delay > 0)
      .sort((left, right) => left - right)[0]

    if (!nextExpirationDelay) return undefined

    const timeout = window.setTimeout(
      () => pruneExpiredSkillInstallLogs(),
      Math.max(1000, nextExpirationDelay)
    )

    return () => window.clearTimeout(timeout)
    // Rebuild this timer only when the tracked log state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillInstallIds, skillInstallLogCreatedAt])

  async function saveSkillRoot(): Promise<void> {
    try {
      const nextConfig = await saveAgentConfig({
        ...config,
        skillRoot: config.skillRoot.trim() || '~/.crescent/skills',
        commandWhitelist: parseCommandWhitelist(commandWhitelistText)
      })
      setSkillManageMessage({ type: 'success', text: t.settings.skillDirectorySaved })
      setSkills(await agentClient.listSkills())
      setConfig(nextConfig)
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function refreshSkills(): Promise<void> {
    try {
      setSkills(await agentClient.listSkills())
      setSkillManageMessage({ type: 'success', text: t.settings.skillsRefreshed })
    } catch (error) {
      setSkillManageMessage({ type: 'error', text: String(error) })
    }
  }

  async function searchSkills(): Promise<void> {
    const query = skillSearchQuery.trim()
    if (!query) return

    setSkillSearchLoading(true)
    setSkillManageMessage({ type: 'info', text: t.settings.skillsSearching })
    try {
      const results = await agentClient.searchSkills(query)
      setSkillSearchResults(results)
      setSkillManageMessage(
        results.length
          ? { type: 'success', text: t.settings.skillsSearchComplete }
          : { type: 'info', text: t.settings.skillsNoResults }
      )
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSkillSearchLoading(false)
    }
  }

  async function installSkill(result: AgentSkillSearchResult): Promise<void> {
    if (skillInstallIds[result.id]) {
      setSkillInstallLogResultId((current) => (current === result.id ? null : result.id))
      return
    }

    setSkillInstallLogNames((current) => ({ ...current, [result.id]: result.name }))
    setSkillInstallLogCreatedAt((current) => ({ ...current, [result.id]: Date.now() }))
    setSkillInstallLogStatuses((current) => ({ ...current, [result.id]: 'running' }))
    setSkillInstallLogs((current) => ({
      ...current,
      [result.id]: `${buildSkillInstallCommand(result)}\n\n`
    }))
    setSkillManageMessage({
      type: 'info',
      text: `${t.settings.skillInstalling}: ${result.name}`
    })
    try {
      const response = await agentClient.startSkillInstall({
        installSource: result.installSource,
        installSkill: result.installSkill
      })

      skillInstallResultIdsRef.current.set(response.installId, result.id)
      skillInstallNamesRef.current.set(response.installId, result.name)
      setSkillInstallIds((current) => ({ ...current, [result.id]: response.installId }))
      setSkillInstallLogResultId(result.id)
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: `${t.settings.skillInstallFailed}: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      setSkillInstallIds((current) => {
        const next = { ...current }
        delete next[result.id]
        return next
      })
      setSkillInstallLogStatuses((current) => ({ ...current, [result.id]: 'error' }))
    }
  }

  async function cancelSkillInstall(resultId: string): Promise<void> {
    const installId = skillInstallIds[resultId]
    if (!installId) return

    setSkillInstallCancelingIds((current) => ({ ...current, [resultId]: true }))
    try {
      await agentClient.cancelSkillInstall(installId)
    } finally {
      setSkillInstallCancelingIds((current) => {
        const next = { ...current }
        delete next[resultId]
        return next
      })
    }
  }

  function handleSkillInstallEvent(event: AgentSkillInstallEvent): void {
    const resultId = skillInstallResultIdsRef.current.get(event.installId)
    if (!resultId) return

    if (event.type === 'log') {
      setSkillInstallLogs((current) => ({
        ...current,
        [resultId]: `${current[resultId] ?? ''}${event.data}`
      }))
      return
    }

    const skillName = skillInstallNamesRef.current.get(event.installId) ?? resultId
    skillInstallResultIdsRef.current.delete(event.installId)
    skillInstallNamesRef.current.delete(event.installId)
    setSkillInstallIds((current) => {
      const next = { ...current }
      delete next[resultId]
      return next
    })
    setSkillInstallCancelingIds((current) => {
      const next = { ...current }
      delete next[resultId]
      return next
    })

    if (event.type === 'done') {
      setSkills(event.result.skills)
      setSkillInstallLogStatuses((current) => ({ ...current, [resultId]: 'success' }))
      setSkillInstallLogs((current) => ({
        ...current,
        [resultId]: `${current[resultId] ?? ''}\n${t.settings.skillInstalled}: ${skillName}\n`
      }))
      setSkillManageMessage({
        type: 'success',
        text: [
          `${t.settings.skillInstalled}: ${skillName}`,
          event.result.fallbackInstalledAll && event.result.requestedSkill
            ? `${t.settings.skillFallbackInstalledAll}: ${event.result.requestedSkill}`
            : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      })
      return
    }

    setSkillInstallLogStatuses((current) => ({ ...current, [resultId]: 'error' }))
    setSkillInstallLogs((current) => ({
      ...current,
      [resultId]: `${current[resultId] ?? ''}\n${event.error}\n`
    }))
    setSkillManageMessage({
      type: event.canceled ? 'info' : 'error',
      text: event.canceled
        ? `${t.settings.skillInstallCanceled}: ${skillName}`
        : `${t.settings.skillInstallFailed}: ${event.error}`
    })
  }

  function deleteSkillInstallLog(resultId: string): void {
    const installId = skillInstallIds[resultId]
    if (installId) void agentClient.cancelSkillInstall(installId)

    skillInstallResultIdsRef.current.forEach((mappedResultId, activeInstallId) => {
      if (mappedResultId === resultId) {
        skillInstallResultIdsRef.current.delete(activeInstallId)
        skillInstallNamesRef.current.delete(activeInstallId)
      }
    })
    setSkillInstallIds((current) => omitRecordKey(current, resultId))
    setSkillInstallLogs((current) => omitRecordKey(current, resultId))
    setSkillInstallLogNames((current) => omitRecordKey(current, resultId))
    setSkillInstallLogStatuses((current) => omitRecordKey(current, resultId))
    setSkillInstallLogCreatedAt((current) => omitRecordKey(current, resultId))
    setSkillInstallCancelingIds((current) => omitRecordKey(current, resultId))
    setSkillInstallLogResultId((current) => {
      if (current !== resultId) return current

      const nextIds = Object.keys(skillInstallLogs).filter((id) => id !== resultId)
      return nextIds[0] ?? null
    })
  }

  function pruneExpiredSkillInstallLogs(): void {
    const now = Date.now()
    const expiredIds = Object.entries(skillInstallLogCreatedAt)
      .filter(
        ([resultId, createdAt]) =>
          !skillInstallIds[resultId] && now - createdAt > 24 * 60 * 60 * 1000
      )
      .map(([resultId]) => resultId)

    for (const resultId of expiredIds) deleteSkillInstallLog(resultId)
  }

  async function copySkillInstallCommand(result: AgentSkillSearchResult): Promise<void> {
    await copyText(buildSkillInstallCommand(result), copyFeedback(t))
    setCopiedSkillCommandId(result.id)
    window.setTimeout(() => {
      setCopiedSkillCommandId((current) => (current === result.id ? null : current))
    }, 1400)
  }

  async function copySelectedSkillInstallLog(): Promise<void> {
    if (!skillInstallLogResultId) return

    const selectedText = window.getSelection()?.toString().trim()
    const text = selectedText || skillInstallLogs[skillInstallLogResultId] || ''
    if (!text) return

    await copyText(text, copyFeedback(t))
    setCopiedSkillInstallLogId(skillInstallLogResultId)
    window.setTimeout(() => {
      setCopiedSkillInstallLogId((current) =>
        current === skillInstallLogResultId ? null : current
      )
    }, 1400)
  }

  async function importSkillFromDisk(options?: {
    sourcePath?: string
    overwrite?: boolean
  }): Promise<void> {
    try {
      const result = await agentClient.importSkill(options)
      if (result.canceled) return
      if (result.conflict && result.sourcePath) {
        const names = (result.existingNames ?? []).join('\n')
        if (
          !window.confirm(
            t.settings.skillImportOverwriteConfirm.replace('{names}', names || result.sourcePath)
          )
        ) {
          return
        }
        await importSkillFromDisk({ sourcePath: result.sourcePath, overwrite: true })
        return
      }
      if (!result.ok) {
        setSkillManageMessage({
          type: 'error',
          text: result.error || t.settings.skillImportFailed
        })
        return
      }
      setSkills(result.skills ?? (await agentClient.listSkills()))
      const imported = result.imported?.filter(Boolean).join(', ')
      setSkillManageMessage({
        type: 'success',
        text: imported ? `${t.settings.skillImported}: ${imported}` : t.settings.skillImported
      })
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function deleteSkill(skill: AgentSkillOption): Promise<void> {
    if (!skill.removable) return
    if (!window.confirm(`${t.confirm.deleteSkill}\n\n${skill.name}`)) return

    setSkillDeletingPath(skill.path)
    setSkillManageMessage({ type: 'info', text: `${t.settings.skillDeleting}: ${skill.name}` })
    try {
      setSkills(await agentClient.deleteSkill(skill.path))
      setSkillManageMessage({ type: 'success', text: `${t.settings.skillDeleted}: ${skill.name}` })
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSkillDeletingPath(null)
    }
  }

  async function previewSkill(skill: AgentSkillOption): Promise<void> {
    setSkillPreviewLoadingPath(skill.path)
    setSkillManageMessage(null)
    setSkillInstallLogResultId(null)
    setSelectedSkillPreview({ skill, content: '' })
    try {
      const content = await agentClient.getSkillContent(skill.path)
      setSelectedSkillPreview({ skill, content })
    } catch (error) {
      setSelectedSkillPreview(null)
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSkillPreviewLoadingPath(null)
    }
  }

  async function previewCatalogSkill(result: AgentSkillSearchResult): Promise<void> {
    const skill: AgentSkillOption = {
      id: result.id,
      name: result.name,
      description: result.description,
      path: catalogSkillPageUrl(result),
      source: result.source,
      removable: true
    }
    setSkillPreviewLoadingPath(result.id)
    setSkillManageMessage(null)
    setSkillInstallLogResultId(null)
    setSelectedSkillPreview({ skill, content: '', catalogResultId: result.id })
    try {
      const content = await agentClient.getCatalogSkillContent({
        installSource: result.installSource,
        installSkill: result.installSkill,
        name: result.name
      })
      setSelectedSkillPreview((current) =>
        current?.catalogResultId === result.id
          ? { skill, content, catalogResultId: result.id }
          : current
      )
    } catch (error) {
      setSelectedSkillPreview((current) =>
        current?.catalogResultId === result.id
          ? {
              skill,
              content: `${t.settings.skillCatalogPreviewFailed}\n\n${
                error instanceof Error ? error.message : String(error)
              }`,
              catalogResultId: result.id
            }
          : current
      )
    } finally {
      setSkillPreviewLoadingPath((current) => (current === result.id ? null : current))
    }
  }

  function removeSkillRef(skillId: string): void {
    updateTab(sessionChatTab.id, (tab) =>
      applyComposerInput(tab, removeComposerRefToken(tab.agentInput, 'skill', skillId))
    )
  }
  return {
    skillInstallResultIdsRef,
    skillInstallNamesRef,
    skills,
    setSkills,
    localSkillSearchQuery,
    setLocalSkillSearchQuery,
    skillSearchQuery,
    setSkillSearchQuery,
    skillSearchResults,
    setSkillSearchResults,
    skillSearchLoading,
    setSkillSearchLoading,
    skillDeletingPath,
    setSkillDeletingPath,
    copiedSkillCommandId,
    setCopiedSkillCommandId,
    skillManageMessage,
    setSkillManageMessage,
    skillInstallIds,
    setSkillInstallIds,
    skillInstallLogs,
    setSkillInstallLogs,
    skillInstallLogNames,
    setSkillInstallLogNames,
    skillInstallLogStatuses,
    setSkillInstallLogStatuses,
    skillInstallLogCreatedAt,
    setSkillInstallLogCreatedAt,
    skillInstallLogResultId,
    setSkillInstallLogResultId,
    selectedSkillPreview,
    setSelectedSkillPreview,
    skillPreviewLoadingPath,
    setSkillPreviewLoadingPath,
    copiedSkillInstallLogId,
    setCopiedSkillInstallLogId,
    skillInstallCancelingIds,
    setSkillInstallCancelingIds,
    skillOpen,
    setSkillOpen,
    filteredLocalSkills,
    installedSkillNames,
    saveSkillRoot,
    refreshSkills,
    searchSkills,
    installSkill,
    cancelSkillInstall,
    handleSkillInstallEvent,
    deleteSkillInstallLog,
    pruneExpiredSkillInstallLogs,
    copySkillInstallCommand,
    copySelectedSkillInstallLog,
    importSkillFromDisk,
    deleteSkill,
    previewSkill,
    previewCatalogSkill,
    removeSkillRef
  }
}
