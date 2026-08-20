import { TriangleAlertIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'

export function QuotaErrorCard({
  t,
  provider,
  resetHint,
  message,
  onOpenModelSettings
}: {
  t: Dictionary
  provider?: string
  resetHint?: string
  message: string
  onOpenModelSettings?: () => void
}): React.JSX.Element {
  const providerLabel = provider?.trim() || t.input.modelQuotaUnknownProvider
  const resetLabel = resetHint?.trim() || t.input.modelQuotaResetHintSoon
  const body =
    message.trim() ||
    t.input.modelQuotaExceeded
      .replace('{provider}', providerLabel)
      .replace('{resetHint}', resetLabel)

  return (
    <div
      data-testid="model-quota-error-card"
      className="min-w-0 rounded-xl border border-border/70 border-l-2 border-l-primary bg-card px-3 py-2.5 text-sm"
    >
      <div className="flex items-start gap-2">
        <TriangleAlertIcon
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-2">
          <div className="font-semibold text-pretty text-foreground">
            {t.input.modelQuotaExceededTitle}
          </div>
          <p className="leading-relaxed text-muted-foreground">{body}</p>
          {onOpenModelSettings ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenModelSettings}>
              {t.input.switchModel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
