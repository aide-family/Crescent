import { BookOpenIcon, FileIcon, FolderOpenIcon, PlugIcon, XIcon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import type { AgentToolReference } from '@renderer/lib/terminal-tabs'
import type {
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference
} from '../../../shared/agent-types'

export function AgentReferenceBadges({
  skillRefs,
  pathRefs,
  toolRefs,
  wikiRefs,
  t,
  onRemoveSkill,
  onRemovePath,
  onRemoveTool,
  onRemoveWiki
}: {
  skillRefs: AgentSkillOption[]
  pathRefs: AgentPathReference[]
  toolRefs: AgentToolReference[]
  wikiRefs: AgentWikiReference[]
  t: Dictionary
  onRemoveSkill: (id: string) => void
  onRemovePath: (id: string) => void
  onRemoveTool: (id: string) => void
  onRemoveWiki: (id: string) => void
}): React.JSX.Element | null {
  if (
    skillRefs.length === 0 &&
    pathRefs.length === 0 &&
    toolRefs.length === 0 &&
    wikiRefs.length === 0
  ) {
    return null
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2 px-1">
      {wikiRefs.map((wiki) => (
        <Badge
          key={wiki.id}
          variant="secondary"
          className="max-w-full gap-1 rounded-md pr-1"
          title={wiki.path}
        >
          <BookOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {t.input.referencedWiki}: {wiki.title}
          </span>
          <RemoveReferenceButton
            label={`${t.input.removeWikiRef}: ${wiki.title}`}
            onClick={() => onRemoveWiki(wiki.id)}
          />
        </Badge>
      ))}
      {toolRefs.map((tool) => (
        <Badge
          key={tool.id}
          variant="secondary"
          className="max-w-full gap-1 rounded-md pr-1"
          title={tool.description}
        >
          {tool.source === 'mcp' && <PlugIcon className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">
            {t.input.referencedTool}: {tool.name}
          </span>
          <RemoveReferenceButton
            label={`${t.input.removeToolRef}: ${tool.name}`}
            onClick={() => onRemoveTool(tool.id)}
          />
        </Badge>
      ))}
      {skillRefs.map((skill) => (
        <Badge
          key={skill.id}
          variant="secondary"
          className="max-w-full gap-1 rounded-md pr-1"
          title={[skill.name, skill.description, skill.path].filter(Boolean).join('\n')}
        >
          <span className="truncate">
            {t.input.referencedSkill}: {skill.name}
          </span>
          <RemoveReferenceButton
            label={`${t.input.removeSkillRef}: ${skill.name}`}
            onClick={() => onRemoveSkill(skill.id)}
          />
        </Badge>
      ))}
      {pathRefs.map((reference) => (
        <Badge
          key={reference.id}
          variant="secondary"
          className="max-w-full gap-1 rounded-md pr-1"
          title={reference.path}
        >
          {reference.kind === 'directory' ? (
            <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            {reference.kind === 'directory' ? t.input.referencedDirectory : t.input.referencedFile}:{' '}
            {reference.name}
          </span>
          <RemoveReferenceButton
            label={`${t.input.removePathRef}: ${reference.name}`}
            onClick={() => onRemovePath(reference.id)}
          />
        </Badge>
      ))}
    </div>
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
