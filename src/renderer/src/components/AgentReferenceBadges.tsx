import { BookOpenIcon, FileIcon, FolderOpenIcon, PlugIcon, XIcon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { AgentMessageReferences } from '@renderer/lib/agent-message-refs'
import { hasMessageReferences } from '@renderer/lib/agent-message-refs'
import { clampAgentText } from '@renderer/lib/agent-text-limits'
import {
  parseComposerSegments,
  type ComposerRefKind
} from '@renderer/lib/composer-ref-tokens'
import type { AgentToolReference } from '@renderer/lib/terminal-tabs'
import type {
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference
} from '../../../shared/agent-types'
import { cn } from '@renderer/lib/utils'

const TAG_CLASS = {
  skill: 'border-teal-500/30 bg-teal-500/12 text-teal-700 dark:text-teal-200',
  wiki: 'border-amber-500/30 bg-amber-500/12 text-amber-800 dark:text-amber-200',
  mcp: 'border-violet-500/30 bg-violet-500/12 text-violet-800 dark:text-violet-200',
  tool: 'border-violet-500/30 bg-violet-500/12 text-violet-800 dark:text-violet-200',
  path: 'border-slate-400/35 bg-slate-500/10 text-slate-700 dark:text-slate-200'
} as const

export function ComposerRefChip({
  kind,
  label,
  removable,
  t,
  pathKind,
  isMcp,
  onRemove,
  onKeyDown
}: {
  kind: ComposerRefKind
  label: string
  removable?: boolean
  t: Dictionary
  pathKind?: 'file' | 'directory'
  isMcp?: boolean
  onRemove?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLSpanElement>) => void
}): React.JSX.Element {
  const tone =
    kind === 'wiki' ? TAG_CLASS.wiki : kind === 'skill' ? TAG_CLASS.skill : kind === 'path' ? TAG_CLASS.path : isMcp ? TAG_CLASS.mcp : TAG_CLASS.tool
  const prefix =
    kind === 'wiki'
      ? t.input.tagSop
      : kind === 'skill'
        ? t.input.tagSkill
        : kind === 'path'
          ? pathKind === 'directory'
            ? t.input.tagDirectory
            : t.input.tagFile
          : isMcp
            ? t.input.tagMcp
            : t.input.tagTool
  const removeLabel =
    kind === 'wiki'
      ? t.input.removeWikiRef
      : kind === 'skill'
        ? t.input.removeSkillRef
        : kind === 'path'
          ? t.input.removePathRef
          : t.input.removeToolRef

  return (
    <Badge
      variant="outline"
      translate="no"
      tabIndex={removable ? 0 : undefined}
      className={cn('app-ref-chip', tone, removable && 'pr-1', 'py-0 leading-none')}
      title={label}
      onKeyDown={onKeyDown}
    >
      {kind === 'wiki' ? <BookOpenIcon className="size-3 shrink-0" aria-hidden="true" /> : null}
      {kind === 'path' && pathKind === 'directory' ? (
        <FolderOpenIcon className="size-3 shrink-0" aria-hidden="true" />
      ) : null}
      {kind === 'path' && pathKind !== 'directory' ? (
        <FileIcon className="size-3 shrink-0" aria-hidden="true" />
      ) : null}
      {kind === 'tool' && isMcp ? <PlugIcon className="size-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">
        {prefix}: {label}
      </span>
      {removable && onRemove ? (
        <RemoveReferenceButton label={`${removeLabel}: ${label}`} onClick={onRemove} />
      ) : null}
    </Badge>
  )
}

export function MessageInlineContent({
  text,
  references,
  t
}: {
  text: string
  references?: AgentMessageReferences
  t: Dictionary
}): React.JSX.Element {
  const segments = parseComposerSegments(text)
  const hasInline = segments.some((segment) => segment.type === 'ref')
  if (!hasInline) {
    return (
      <div className="app-ref-flow min-w-0">
        <AgentReferenceBadges references={references} variant="message" t={t} />
        <pre className="app-ref-flow-text select-text min-w-0 overflow-x-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {clampAgentText(text)}
        </pre>
      </div>
    )
  }

  const wikiById = new Map((references?.wiki ?? []).map((item) => [item.id, item.title]))
  const skillById = new Map((references?.skills ?? []).map((item) => [item.id, item.name]))
  const toolById = new Map((references?.tools ?? []).map((item) => [item.id, item]))
  const pathById = new Map((references?.paths ?? []).map((item) => [item.id, item]))

  return (
    <div className="app-ref-flow min-w-0">
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          if (!segment.value) return null
          return (
            <pre
              key={`text-${index}`}
              className="app-ref-inline-text select-text min-w-0 overflow-x-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
            >
              {clampAgentText(segment.value)}
            </pre>
          )
        }
        const label =
          segment.kind === 'wiki'
            ? (wikiById.get(segment.id) ?? segment.id)
            : segment.kind === 'skill'
              ? (skillById.get(segment.id) ?? segment.id)
              : segment.kind === 'tool'
                ? (toolById.get(segment.id)?.name ?? segment.id)
                : (pathById.get(segment.id)?.name ?? segment.id)
        const tool = toolById.get(segment.id)
        const path = pathById.get(segment.id)
        return (
          <ComposerRefChip
            key={`ref-${segment.kind}-${segment.id}-${index}`}
            kind={segment.kind}
            label={label}
            t={t}
            isMcp={tool?.source === 'mcp'}
            pathKind={path?.kind}
          />
        )
      })}
    </div>
  )
}

export function AgentReferenceBadges({
  skillRefs,
  pathRefs,
  toolRefs,
  wikiRefs,
  references,
  t,
  variant = 'composer',
  onRemoveSkill,
  onRemovePath,
  onRemoveTool,
  onRemoveWiki
}: {
  skillRefs?: AgentSkillOption[]
  pathRefs?: AgentPathReference[]
  toolRefs?: AgentToolReference[]
  wikiRefs?: AgentWikiReference[]
  references?: AgentMessageReferences
  t: Dictionary
  variant?: 'composer' | 'message'
  onRemoveSkill?: (id: string) => void
  onRemovePath?: (id: string) => void
  onRemoveTool?: (id: string) => void
  onRemoveWiki?: (id: string) => void
}): React.JSX.Element | null {
  const skills = references?.skills ?? skillRefs ?? []
  const wiki = references?.wiki ?? wikiRefs ?? []
  const tools = references?.tools ?? toolRefs ?? []
  const paths = references?.paths ?? pathRefs ?? []
  const removable = variant === 'composer'
  const snapshot = {
    skills: skills.map((item) => ({ id: item.id, name: 'name' in item ? item.name : '' })),
    wiki: wiki.map((item) => ({
      id: item.id,
      title: 'title' in item ? item.title : ''
    })),
    tools: tools.map((item) => ({
      id: item.id,
      name: item.name,
      source: 'source' in item ? item.source : 'built-in'
    })),
    paths: paths.map((item) => ({
      id: item.id,
      name: item.name,
      kind: 'kind' in item ? item.kind : 'file'
    }))
  }

  if (
    !hasMessageReferences(snapshot) &&
    skills.length === 0 &&
    wiki.length === 0 &&
    tools.length === 0 &&
    paths.length === 0
  ) {
    return null
  }

  return (
    <>
      {wiki.map((item) => {
        const title = 'title' in item ? item.title : ''
        return (
          <Badge
            key={item.id}
            variant="outline"
            translate="no"
            className={cn('app-ref-chip', TAG_CLASS.wiki, removable && 'pr-1')}
            title={title}
          >
            <BookOpenIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {t.input.tagSop}: {title}
            </span>
            {removable && onRemoveWiki ? (
              <RemoveReferenceButton
                label={`${t.input.removeWikiRef}: ${title}`}
                onClick={() => onRemoveWiki(item.id)}
              />
            ) : null}
          </Badge>
        )
      })}
      {tools.map((item) => {
        const isMcp = item.source === 'mcp'
        return (
          <Badge
            key={item.id}
            variant="outline"
            translate="no"
            className={cn(
              'app-ref-chip',
              isMcp ? TAG_CLASS.mcp : TAG_CLASS.tool,
              removable && 'pr-1'
            )}
            title={item.name}
          >
            {isMcp ? <PlugIcon className="size-3 shrink-0" aria-hidden="true" /> : null}
            <span className="truncate">
              {isMcp ? t.input.tagMcp : t.input.tagTool}: {item.name}
            </span>
            {removable && onRemoveTool ? (
              <RemoveReferenceButton
                label={`${t.input.removeToolRef}: ${item.name}`}
                onClick={() => onRemoveTool(item.id)}
              />
            ) : null}
          </Badge>
        )
      })}
      {skills.map((item) => {
        const name = 'name' in item ? item.name : ''
        return (
          <Badge
            key={item.id}
            variant="outline"
            translate="no"
            className={cn('app-ref-chip', TAG_CLASS.skill, removable && 'pr-1')}
            title={name}
          >
            <span className="truncate">
              {t.input.tagSkill}: {name}
            </span>
            {removable && onRemoveSkill ? (
              <RemoveReferenceButton
                label={`${t.input.removeSkillRef}: ${name}`}
                onClick={() => onRemoveSkill(item.id)}
              />
            ) : null}
          </Badge>
        )
      })}
      {paths.map((item) => {
        const kind = 'kind' in item ? item.kind : 'file'
        return (
          <Badge
            key={item.id}
            variant="outline"
            translate="no"
            className={cn('app-ref-chip', TAG_CLASS.path, removable && 'pr-1')}
            title={item.name}
          >
            {kind === 'directory' ? (
              <FolderOpenIcon className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <FileIcon className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {kind === 'directory' ? t.input.tagDirectory : t.input.tagFile}: {item.name}
            </span>
            {removable && onRemovePath ? (
              <RemoveReferenceButton
                label={`${t.input.removePathRef}: ${item.name}`}
                onClick={() => onRemovePath(item.id)}
              />
            ) : null}
          </Badge>
        )
      })}
    </>
  )
}

function RemoveReferenceButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-4 hover:bg-background/70"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <XIcon aria-hidden="true" />
    </Button>
  )
}
