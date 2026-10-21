import { agentClient } from '@renderer/clients'
import type { Dictionary } from '@renderer/i18n'
import { type SkillManageMessage } from '@renderer/components/StatusIndicators'
import {
  WIKI_REFRESH_MIN_LOADING_MS,
  getDefaultWikiPreviewWidth,
  wait
} from '@renderer/lib/app-runtime'
import { filterWikiDocuments, upsertWikiSummary } from '@renderer/lib/wiki'
import { useCallback, useMemo, useState } from 'react'
import {
  type WikiDirectoryInfo,
  type WikiDocument,
  type WikiDocumentSummary
} from '../../../shared/agent-types'

interface Parameters {
  t: Dictionary
}

export function useWikiController({ t }: Parameters) {
  const [wikiOpen, setWikiOpen] = useState(false)

  const [wikiLoading, setWikiLoading] = useState(false)

  const [wikiDocumentLoadingId, setWikiDocumentLoadingId] = useState<string | null>(null)

  const [wikiDocuments, setWikiDocuments] = useState<WikiDocumentSummary[]>([])

  const [wikiDirectory, setWikiDirectory] = useState<WikiDirectoryInfo | null>(null)

  const [wikiDirectoryChanging, setWikiDirectoryChanging] = useState(false)

  const [selectedWikiDocument, setSelectedWikiDocument] = useState<WikiDocument | null>(null)

  const [wikiSearchQuery, setWikiSearchQuery] = useState('')

  const [wikiEditing, setWikiEditing] = useState(false)

  const [wikiEditContent, setWikiEditContent] = useState('')

  const [wikiSaving, setWikiSaving] = useState(false)

  const [wikiDeletingId, setWikiDeletingId] = useState<string | null>(null)

  const [wikiMessage, setWikiMessage] = useState<SkillManageMessage | null>(null)

  const [wikiPreviewWidth, setWikiPreviewWidth] = useState(620)

  const filteredWikiDocuments = useMemo(
    () => filterWikiDocuments(wikiDocuments, wikiSearchQuery),
    [wikiDocuments, wikiSearchQuery]
  )

  const refreshWikiDocuments = useCallback(async (): Promise<boolean> => {
    const startedAt = Date.now()
    setWikiLoading(true)
    let succeeded = false
    try {
      const [documents, directory] = await Promise.all([
        agentClient.listWikiDocuments(),
        agentClient.getWikiDirectory()
      ])
      setWikiDocuments(documents)
      setWikiDirectory(directory)
      succeeded = true
      setSelectedWikiDocument((current) =>
        current && documents.some((document) => document.id === current.id) ? current : null
      )
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < WIKI_REFRESH_MIN_LOADING_MS) {
        await wait(WIKI_REFRESH_MIN_LOADING_MS - elapsed)
      }
      setWikiLoading(false)
    }
    return succeeded
  }, [])

  async function chooseWikiDirectory(): Promise<void> {
    setWikiDirectoryChanging(true)
    try {
      const result = await agentClient.chooseWikiDirectory()
      if (!result.ok) return
      setWikiDirectory(result.directory)
      setSelectedWikiDocument(null)
      setWikiEditing(false)
      if (!(await refreshWikiDocuments())) return
      setWikiMessage({
        type: 'success',
        text: `${t.wiki.directoryChanged}: ${result.directory.path}`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setWikiMessage({ type: 'error', text: `${t.wiki.directoryChangeFailed}: ${message}` })
    } finally {
      setWikiDirectoryChanging(false)
    }
  }

  async function resetWikiDirectory(): Promise<void> {
    setWikiDirectoryChanging(true)
    try {
      const directory = await agentClient.resetWikiDirectory()
      setWikiDirectory(directory)
      setSelectedWikiDocument(null)
      setWikiEditing(false)
      if (!(await refreshWikiDocuments())) return
      setWikiMessage({ type: 'success', text: `${t.wiki.directoryChanged}: ${directory.path}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setWikiMessage({ type: 'error', text: `${t.wiki.directoryChangeFailed}: ${message}` })
    } finally {
      setWikiDirectoryChanging(false)
    }
  }

  function setWikiSheetOpen(open: boolean): void {
    setWikiOpen(open)
    if (open) {
      setWikiEditing(false)
      setWikiMessage(null)
      void refreshWikiDocuments()
    }
  }

  async function openWikiDocument(document: WikiDocumentSummary): Promise<void> {
    setWikiDocumentLoadingId(document.id)
    setWikiEditing(false)
    setWikiMessage(null)
    try {
      const detail = (await agentClient.getWikiDocument(document.id)) ?? null
      setSelectedWikiDocument(detail)
      setWikiEditContent(detail?.content ?? '')
      if (detail) setWikiPreviewWidth(getDefaultWikiPreviewWidth())
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setWikiDocumentLoadingId(null)
    }
  }

  async function saveWikiEdits(): Promise<void> {
    if (!selectedWikiDocument) return

    setWikiSaving(true)
    setWikiMessage(null)
    try {
      const document = await agentClient.saveWikiDocument({
        id: selectedWikiDocument.id,
        title: selectedWikiDocument.title,
        content: wikiEditContent
      })
      setSelectedWikiDocument(document)
      setWikiEditContent(document.content)
      setWikiDocuments((current) => upsertWikiSummary(current, document))
      setWikiEditing(false)
      setWikiMessage({ type: 'success', text: `${t.wiki.saved}: ${document.title}` })
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: `${t.wiki.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setWikiSaving(false)
    }
  }

  async function deleteWikiDocument(): Promise<void> {
    if (!selectedWikiDocument) return
    if (!window.confirm(`${t.confirm.deleteWikiDocument}\n\n${selectedWikiDocument.title}`)) return

    setWikiDeletingId(selectedWikiDocument.id)
    setWikiMessage(null)
    try {
      const deleted = await agentClient.deleteWikiDocument(selectedWikiDocument.id)
      if (!deleted.ok) throw new Error(t.wiki.deleteFailed)

      const deletedTitle = selectedWikiDocument.title
      setWikiDocuments((current) =>
        current.filter((document) => document.id !== selectedWikiDocument.id)
      )
      setSelectedWikiDocument(null)
      setWikiEditContent('')
      setWikiEditing(false)
      setWikiMessage({ type: 'success', text: `${t.wiki.deleted}: ${deletedTitle}` })
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: `${t.wiki.deleteFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setWikiDeletingId(null)
    }
  }
  return {
    wikiOpen,
    setWikiOpen,
    wikiLoading,
    setWikiLoading,
    wikiDocumentLoadingId,
    setWikiDocumentLoadingId,
    wikiDocuments,
    setWikiDocuments,
    wikiDirectory,
    setWikiDirectory,
    wikiDirectoryChanging,
    setWikiDirectoryChanging,
    selectedWikiDocument,
    setSelectedWikiDocument,
    wikiSearchQuery,
    setWikiSearchQuery,
    wikiEditing,
    setWikiEditing,
    wikiEditContent,
    setWikiEditContent,
    wikiSaving,
    setWikiSaving,
    wikiDeletingId,
    setWikiDeletingId,
    wikiMessage,
    setWikiMessage,
    wikiPreviewWidth,
    setWikiPreviewWidth,
    filteredWikiDocuments,
    refreshWikiDocuments,
    chooseWikiDirectory,
    resetWikiDirectory,
    setWikiSheetOpen,
    openWikiDocument,
    saveWikiEdits,
    deleteWikiDocument
  }
}
