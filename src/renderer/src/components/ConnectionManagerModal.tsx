import { useEffect } from 'react'
import {
  CopyIcon,
  CopyPlusIcon,
  Layers2Icon,
  PanelBottomIcon,
  PencilIcon,
  ServerIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { ConnectionList } from '@renderer/components/ConnectionList'
import { ConnectionOpsFeedbackPanel } from '@renderer/components/ConnectionOpsFeedbackPanel'
import { SkillManageStatus, type SkillManageMessage } from '@renderer/components/StatusIndicators'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { ConnectionConfig, ConnectionInput } from '../../../shared/agent-types'

type ConnectionFormChange = <K extends keyof ConnectionInput>(
  key: K,
  value: ConnectionInput[K]
) => void

export function ConnectionManagerModal({
  open,
  connections,
  filteredConnections,
  query,
  selectedConnectionId,
  connectionForm,
  connectionEditing,
  connectionImportText,
  connectionSshOptionsText,
  connectionActionsText,
  connectionCommandPreview,
  connectionFormReady,
  connectionSaveMessage,
  t,
  formatConnectionTarget,
  onClose,
  onQueryChange,
  onSelectConnection,
  onConnect,
  onConnectInSession,
  onConnectInSubterminal,
  onCopyConnection,
  onDuplicateConnection,
  onEditConnection,
  onDeleteConnection,
  onImportTextChange,
  onImportConnection,
  onFormChange,
  onSshOptionsTextChange,
  onActionsTextChange,
  onResetForm,
  onStartEditing,
  onSave
}: {
  open: boolean
  connections: ConnectionConfig[]
  filteredConnections: ConnectionConfig[]
  query: string
  selectedConnectionId: string
  connectionForm: ConnectionInput
  connectionEditing: boolean
  connectionImportText: string
  connectionSshOptionsText: string
  connectionActionsText: string
  connectionCommandPreview: string
  connectionFormReady: boolean
  connectionSaveMessage: SkillManageMessage | null
  t: Dictionary
  formatConnectionTarget: (connection: ConnectionConfig) => string
  onClose: () => void
  onQueryChange: (query: string) => void
  onSelectConnection: (connection: ConnectionConfig) => void
  onConnect: (connection: ConnectionConfig) => void
  onConnectInSession: (connection: ConnectionConfig) => void
  onConnectInSubterminal: (connection: ConnectionConfig) => void
  onCopyConnection: (connection: ConnectionConfig) => void
  onDuplicateConnection: (connection: ConnectionConfig) => void
  onEditConnection: (connection: ConnectionConfig) => void
  onDeleteConnection: (id: string) => void
  onImportTextChange: (value: string) => void
  onImportConnection: () => void
  onFormChange: ConnectionFormChange
  onSshOptionsTextChange: (value: string) => void
  onActionsTextChange: (value: string) => void
  onResetForm: () => void
  onStartEditing: () => void
  onSave: (connectAfterSave: boolean) => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const selectedConnection = connections.find(
    (connection) => connection.id === selectedConnectionId
  )
  const canEditConnection = !selectedConnection || selectedConnection.source === 'custom'
  const canSaveConnection = connectionEditing && connectionFormReady && canEditConnection

  return (
    <div
      className="app-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="app-modal-panel flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background">
        <div className="app-modal-header flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 id="connection-modal-title" className="text-sm font-semibold text-pretty">
              {t.connections.sshConnections}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {t.connections.sshConnectionsDescription}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.common.close}
            title={t.common.close}
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="app-connection-grid grid min-h-0 flex-1 grid-cols-[minmax(280px,0.9fr)_minmax(400px,1.1fr)] overflow-hidden">
          <ConnectionList
            className="min-h-0 border-r bg-muted/10 p-2.5"
            connections={connections}
            filteredConnections={filteredConnections}
            query={query}
            selectedConnectionId={selectedConnectionId}
            t={t}
            showCustomMetadata
            formatConnectionTarget={formatConnectionTarget}
            onQueryChange={onQueryChange}
            onSelectConnection={(connection) => {
              onSelectConnection(connection)
            }}
            renderConnectionActions={(connection) => (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {connection.source === 'custom' && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.connections.copyAsJson}
                      title={t.connections.copyAsJson}
                      onClick={(event) => {
                        event.stopPropagation()
                        onCopyConnection(connection)
                      }}
                    >
                      <CopyIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.connections.duplicateAsNew}
                      title={t.connections.duplicateAsNew}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDuplicateConnection(connection)
                      }}
                    >
                      <CopyPlusIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.common.edit}
                      title={t.common.edit}
                      onClick={(event) => {
                        event.stopPropagation()
                        onEditConnection(connection)
                      }}
                    >
                      <PencilIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-xs"
                      aria-label={t.common.delete}
                      title={t.common.delete}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteConnection(connection.id)
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label={t.connections.connectInSession}
                  title={t.connections.connectInSessionDescription}
                  onClick={(event) => {
                    event.stopPropagation()
                    onConnectInSession(connection)
                    onClose()
                  }}
                >
                  <Layers2Icon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label={t.terminal.openSubterminalInSession}
                  title={t.terminal.openSubterminalInSessionDescription}
                  onClick={(event) => {
                    event.stopPropagation()
                    onConnectInSubterminal(connection)
                    onClose()
                  }}
                >
                  <PanelBottomIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="icon-xs"
                  aria-label={t.connections.connect}
                  title={t.connections.connect}
                  onClick={(event) => {
                    event.stopPropagation()
                    onConnect(connection)
                    onClose()
                  }}
                >
                  <ServerIcon aria-hidden="true" />
                </Button>
              </div>
            )}
          />
          <div className="min-h-0 overflow-auto overscroll-contain p-2.5">
            <FieldGroup className="gap-2.5">
              <Field>
                <FieldLabel htmlFor="connection-import">{t.connections.copiedConnection}</FieldLabel>
                <Textarea
                  id="connection-import"
                  name="connection-import"
                  className="min-h-20 resize-y font-mono text-xs"
                  value={connectionImportText}
                  onChange={(event) => onImportTextChange(event.target.value)}
                  placeholder={t.connections.copiedConnectionPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onImportConnection}
                    disabled={!connectionImportText.trim()}
                  >
                    {t.connections.importAsNew}
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-name">
                  {t.connections.customConnectionName}
                </FieldLabel>
                <Input
                  id="connection-name"
                  name="connection-name"
                  className="h-8"
                  value={connectionForm.name}
                  onChange={(event) => onFormChange('name', event.target.value)}
                  placeholder={t.connections.namePlaceholder}
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <FieldLabel htmlFor="connection-host">{t.connections.host}</FieldLabel>
                  <Input
                    id="connection-host"
                    name="host"
                    className="h-8 font-mono"
                    value={connectionForm.host}
                    onChange={(event) => onFormChange('host', event.target.value)}
                    placeholder="10.0.0.8…"
                    disabled={!connectionEditing}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="connection-port">{t.connections.port}</FieldLabel>
                  <Input
                    id="connection-port"
                    name="port"
                    type="number"
                    inputMode="numeric"
                    className="h-8 font-mono tabular-nums"
                    value={connectionForm.port ?? 22}
                    onChange={(event) => onFormChange('port', Number(event.target.value))}
                    placeholder="22"
                    disabled={!connectionEditing}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="connection-user">{t.connections.user}</FieldLabel>
                <Input
                  id="connection-user"
                  name="username"
                  className="h-8 font-mono"
                  value={connectionForm.user ?? ''}
                  onChange={(event) => onFormChange('user', event.target.value)}
                  placeholder="root…"
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-password">{t.connections.password}</FieldLabel>
                <Input
                  id="connection-password"
                  name="connection-password"
                  type="password"
                  className="h-8"
                  value={connectionForm.password ?? ''}
                  onChange={(event) => onFormChange('password', event.target.value)}
                  placeholder={t.connections.passwordPlaceholder}
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-password-env">
                  {t.connections.passwordEnvVar}
                </FieldLabel>
                <Input
                  id="connection-password-env"
                  name="connection-password-env"
                  className="h-8 font-mono"
                  value={connectionForm.passwordEnvVar ?? ''}
                  onChange={(event) => onFormChange('passwordEnvVar', event.target.value)}
                  placeholder={t.connections.passwordEnvVarPlaceholder}
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldDescription>{t.connections.passwordEnvVarDescription}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-identity">{t.connections.identityFile}</FieldLabel>
                <Input
                  id="connection-identity"
                  name="identity-file"
                  className="h-8 font-mono"
                  value={connectionForm.identityFile ?? ''}
                  onChange={(event) => onFormChange('identityFile', event.target.value)}
                  placeholder="~/.ssh/id_rsa…"
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-ssh-options">{t.connections.sshOptions}</FieldLabel>
                <Textarea
                  id="connection-ssh-options"
                  name="ssh-options"
                  className="min-h-28 resize-y font-mono text-xs"
                  value={connectionSshOptionsText}
                  onChange={(event) => onSshOptionsTextChange(event.target.value)}
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    '-o HostKeyAlgorithms=+ssh-rsa\n-o PubkeyAcceptedAlgorithms=+ssh-rsa\n-t\n-o PreferredAuthentications=keyboard-interactive,password\n-o PubkeyAuthentication=no'
                  }
                />
                <FieldDescription>{t.connections.sshOptionsDescription}</FieldDescription>
                {connectionCommandPreview && (
                  <pre className="overflow-auto rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] text-muted-foreground">
                    {connectionCommandPreview}
                  </pre>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-actions">{t.connections.loginActions}</FieldLabel>
                <Textarea
                  id="connection-actions"
                  name="login-actions"
                  className="min-h-32 resize-y font-mono text-xs"
                  value={connectionActionsText}
                  onChange={(event) => onActionsTextChange(event.target.value)}
                  disabled={!connectionEditing}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={'your_password\ncd /srv/app\nkubectl get pods'}
                />
                <FieldDescription>{t.connections.loginActionsDescription}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-description">{t.connections.description}</FieldLabel>
                <Input
                  id="connection-description"
                  name="connection-description"
                  className="h-8"
                  value={connectionForm.description ?? ''}
                  onChange={(event) => onFormChange('description', event.target.value)}
                  placeholder={t.connections.descriptionPlaceholder}
                  disabled={!connectionEditing}
                  autoComplete="off"
                />
                <FieldDescription>
                  {connectionEditing ? t.connections.storedIn : t.connections.readOnlyHint}
                </FieldDescription>
              </Field>
            </FieldGroup>
            {selectedConnectionId ? (
              <ConnectionOpsFeedbackPanel
                key={selectedConnectionId}
                connectionId={selectedConnectionId}
                t={t}
              />
            ) : null}
          </div>
        </div>
        <div className="shrink-0 border-t px-4 py-2">
          <SkillManageStatus message={connectionSaveMessage} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={onResetForm}>
              {t.common.new}
            </Button>
            <div className="flex items-center gap-2">
              {!connectionEditing && connectionForm.id && canEditConnection && (
                <Button type="button" variant="outline" onClick={onStartEditing}>
                  {t.common.edit}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => onSave(false)}
                disabled={!canSaveConnection}
              >
                {t.common.save}
              </Button>
              <Button type="button" onClick={() => onSave(true)} disabled={!canSaveConnection}>
                <ServerIcon data-icon="inline-start" />
                {t.common.saveAndConnect}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
