import { useState, type FormEvent } from 'react'
import { Trash2Icon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import type { Dictionary } from '@renderer/i18n'

export interface CommandWhitelistSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  rules: string[]
  onSave: (rules: string[]) => Promise<void>
}

export function CommandWhitelistSheet({
  open,
  onOpenChange,
  t,
  rules,
  onSave
}: CommandWhitelistSheetProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const addRule = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const rule = draft.trim()
    if (!rule || saving) return
    if (rules.some((item) => item.trim() === rule)) {
      setNotice(t.settings.commandWhitelistDuplicate)
      return
    }
    setSaving(true)
    setNotice('')
    try {
      await onSave([...rules, rule])
      setDraft('')
    } catch {
      // Parent reports the save error.
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (rule: string): Promise<void> => {
    if (saving) return
    setSaving(true)
    setNotice('')
    try {
      await onSave(rules.filter((item) => item !== rule))
    } catch {
      // Parent reports the save error.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t.settings.commandWhitelist}</SheetTitle>
          <SheetDescription>{t.settings.commandWhitelistHint}</SheetDescription>
        </SheetHeader>
        <form className="flex items-center gap-2 px-4" onSubmit={(event) => void addRule(event)}>
          <Input
            value={draft}
            aria-label={t.settings.commandWhitelistAdd}
            placeholder={t.settings.commandWhitelistPlaceholder}
            disabled={saving}
            onChange={(event) => {
              setDraft(event.target.value)
              if (notice) setNotice('')
            }}
          />
          <Button type="submit" size="sm" disabled={saving || !draft.trim()}>
            {t.settings.commandWhitelistAdd}
          </Button>
        </form>
        {notice ? (
          <p className="px-4 text-xs text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 pb-4">
          {rules.length === 0 ? (
            <p className="app-empty-state">{t.settings.commandWhitelistEmpty}</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule, index) => (
                <li key={`${rule}:${index}`} className="app-list-row flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs" title={rule}>
                    {rule}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.settings.commandWhitelistRemove}
                    title={t.settings.commandWhitelistRemove}
                    disabled={saving}
                    onClick={() => void removeRule(rule)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
