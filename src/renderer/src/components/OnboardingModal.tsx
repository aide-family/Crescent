import { BookOpenIcon, PlugIcon, ServerIcon, SparklesIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'

export function OnboardingModal({
  open,
  t,
  onDismiss,
  onOpenSettings,
  onOpenConnections,
  onOpenSkills,
  onAddExampleOpenApi
}: {
  open: boolean
  t: Dictionary
  onDismiss: () => void
  onOpenSettings: () => void
  onOpenConnections: () => void
  onOpenSkills: () => void
  onAddExampleOpenApi: () => void
}): React.JSX.Element | null {
  if (!open) return null

  return (
    <div
      className="app-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <div className="app-modal-panel w-full max-w-lg overflow-hidden rounded-lg border bg-background shadow-xl">
        <div className="app-modal-header border-b px-4 py-3">
          <h2 id="onboarding-title" className="text-sm font-semibold">
            {t.onboarding.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.onboarding.description}</p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <OnboardingStep
            icon={<PlugIcon className="size-4 text-primary" aria-hidden="true" />}
            title={t.onboarding.stepOpenApiTitle}
            body={t.onboarding.stepOpenApiBody}
            actionLabel={t.onboarding.addExampleOpenApi}
            secondaryLabel={t.onboarding.openSettings}
            onAction={onAddExampleOpenApi}
            onSecondary={onOpenSettings}
          />
          <OnboardingStep
            icon={<ServerIcon className="size-4 text-primary" aria-hidden="true" />}
            title={t.onboarding.stepConnectionTitle}
            body={t.onboarding.stepConnectionBody}
            actionLabel={t.onboarding.openConnections}
            onAction={onOpenConnections}
          />
          <OnboardingStep
            icon={<SparklesIcon className="size-4 text-primary" aria-hidden="true" />}
            title={t.onboarding.stepSkillsTitle}
            body={t.onboarding.stepSkillsBody}
            actionLabel={t.onboarding.openSkills}
            onAction={onOpenSkills}
          />
          <div className="rounded-md border border-dashed bg-muted/10 p-3 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <BookOpenIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{t.onboarding.hint}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={onDismiss}>
            {t.onboarding.skip}
          </Button>
          <Button type="button" onClick={onDismiss}>
            {t.onboarding.done}
          </Button>
        </div>
      </div>
    </div>
  )
}

function OnboardingStep({
  icon,
  title,
  body,
  actionLabel,
  secondaryLabel,
  onAction,
  onSecondary
}: {
  icon: React.ReactNode
  title: string
  body: string
  actionLabel: string
  secondaryLabel?: string
  onAction: () => void
  onSecondary?: () => void
}): React.JSX.Element {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
            {secondaryLabel && onSecondary ? (
              <Button type="button" size="sm" variant="outline" onClick={onSecondary}>
                {secondaryLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
