import type { RefObject } from 'react'

import type { Dictionary } from '@renderer/i18n'
import type { SlashCommandOption } from '@renderer/lib/slash-commands'

export function SlashCommandMenu({
  visible,
  listRef,
  options,
  selectedIndex,
  t,
  onSelect
}: {
  visible: boolean
  listRef: RefObject<HTMLDivElement | null>
  options: SlashCommandOption[]
  selectedIndex: number
  t: Dictionary
  onSelect: (command: SlashCommandOption) => void
}): React.JSX.Element | null {
  if (!visible) return null

  return (
    <div className="absolute right-2 bottom-full left-2 z-30 mb-2 overflow-hidden rounded-md border bg-popover text-xs text-popover-foreground shadow-lg">
      <div className="border-b px-3 py-2 text-muted-foreground">{t.input.slashCommandHint}</div>
      <div ref={listRef} className="max-h-56 overflow-auto p-1">
        {options.map((command, index) => (
          <button
            key={command.id}
            type="button"
            data-slash-command-index={index}
            className={`block w-full rounded px-2 py-2 text-left transition-colors ${
              index === selectedIndex
                ? 'bg-secondary text-secondary-foreground'
                : 'hover:bg-muted/50'
            }`}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(command)
            }}
          >
            <span className="block font-medium">
              {command.connection ||
              command.agentMode ||
              command.pathReferenceKind ||
              command.toolRef ||
              command.wikiDocument ||
              command.wikiRef
                ? command.title
                : `/${command.id}`}
            </span>
            <span className="block text-muted-foreground">{command.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
