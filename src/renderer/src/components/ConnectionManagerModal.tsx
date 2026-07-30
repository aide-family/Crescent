import { CopyIcon, CopyPlusIcon, Layers2Icon, PencilIcon, ServerIcon, Trash2Icon, XIcon } from 'lucide-react'

import { ConnectionList } from '@renderer/components/ConnectionList'
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
  if (!open) return null

  return (
    <div
      className="app-modal-overlay fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="app-modal-panel flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-background shadow-2xl shadow-black/30">
        <div className="app-modal-header flex shrink-0 items-center justify-between gap-3 border-b bg-card/80 px-4 py-3">
          <div>
            <h2 id="connection-modal-title" className="text-sm font-semibold">
              {t.connections.sshConnections}
            </h2>
            <p className="text-xs text-muted-foreground">
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
        <div className="app-connection-grid grid min-h-0 flex-1 grid-cols-[minmax(300px,0.92fr)_minmax(420px,1.08fr)] overflow-hidden">
          <ConnectionList
            className="min-h-0 border-r bg-muted/15 p-4"
            connections={connections}
            filteredConnections={filteredConnections}
            query={query}
            selectedConnectionId={selectedConnectionId}
            t={t}
            showCustomMetadata
            formatConnectionTarget={formatConnectionTarget}
            onQueryChange={onQueryChange}
            onSelectConnection={(connection) => {
              if (connection.source === 'custom') onSelectConnection(connection)
            }}
            renderConnectionActions={(connection) => (
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
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
                    </>
                  )}
                </div>
                {connection.source === 'custom' && (
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
                )}
              </div>
            )}
          />
          <div className="min-h-0 overflow-auto p-4">
            <FieldGroup>
              <Field>
                <FieldLabel>{t.connections.copiedConnection}</FieldLabel>
                <Textarea
                  className="min-h-20 resize-y font-mono text-xs"
                  value={connectionImportText}
                  onChange={(event) => onImportTextChange(event.target.value)}
                  placeholder={t.connections.copiedConnectionPlaceholder}
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
                <FieldLabel>{t.connections.customConnectionName}</FieldLabel>
                <Input
                  value={connectionForm.name}
                  onChange={(event) => onFormChange('name', event.target.value)}
                  placeholder={t.connections.namePlaceholder}
                  disabled={!connectionEditing}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <FieldLabel>{t.connections.host}</FieldLabel>
                  <Input
                    value={connectionForm.host}
                    onChange={(event) => onFormChange('host', event.target.value)}
                    placeholder="10.0.0.8"
                    disabled={!connectionEditing}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t.connections.port}</FieldLabel>
                  <Input
                    type="number"
                    value={connectionForm.port ?? 22}
                    onChange={(event) => onFormChange('port', Number(event.target.value))}
                    placeholder="22"
                    disabled={!connectionEditing}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel>{t.connections.user}</FieldLabel>
                <Input
                  value={connectionForm.user ?? ''}
                  onChange={(event) => onFormChange('user', event.target.value)}
                  placeholder="root"
                  disabled={!connectionEditing}
                />
              </Field>
              <Field>
                <FieldLabel>{t.connections.password}</FieldLabel>
                <Input
                  type="password"
                  value={connectionForm.password ?? ''}
                  onChange={(event) => onFormChange('password', event.target.value)}
                  placeholder={t.connections.passwordPlaceholder}
                  disabled={!connectionEditing}
                />
              </Field>
              <Field>
                <FieldLabel>{t.connections.passwordEnvVar}</FieldLabel>
                <Input
                  value={connectionForm.passwordEnvVar ?? ''}
                  onChange={(event) => onFormChange('passwordEnvVar', event.target.value)}
                  placeholder={t.connections.passwordEnvVarPlaceholder}
                  disabled={!connectionEditing}
                />
                <FieldDescription>{t.connections.passwordEnvVarDescription}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{t.connections.identityFile}</FieldLabel>
                <Input
                  value={connectionForm.identityFile ?? ''}
                  onChange={(event) => onFormChange('identityFile', event.target.value)}
                  placeholder="~/.ssh/id_rsa"
                  disabled={!connectionEditing}
                />
              </Field>
              <Field>
                <FieldLabel>{t.connections.sshOptions}</FieldLabel>
                <Textarea
                  className="min-h-28 resize-y font-mono text-xs"
                  value={connectionSshOptionsText}
                  onChange={(event) => onSshOptionsTextChange(event.target.value)}
                  disabled={!connectionEditing}
                  placeholder={
                    '-o HostKeyAlgorithms=+ssh-rsa\n-o PubkeyAcceptedAlgorithms=+ssh-rsa\n-t\n-o PreferredAuthentications=keyboard-interactive,password\n-o PubkeyAuthentication=no'
                  }
                />
                <FieldDescription>{t.connections.sshOptionsDescription}</FieldDescription>
                {connectionCommandPreview && (
                  <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
                    {connectionCommandPreview}
                  </pre>
                )}
              </Field>
              <Field>
                <FieldLabel>{t.connections.loginActions}</FieldLabel>
                <Textarea
                  className="min-h-32 resize-y font-mono text-xs"
                  value={connectionActionsText}
                  onChange={(event) => onActionsTextChange(event.target.value)}
                  disabled={!connectionEditing}
                  placeholder={'your_password\ncd /srv/app\nkubectl get pods'}
                />
                <FieldDescription>{t.connections.loginActionsDescription}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{t.connections.description}</FieldLabel>
                <Input
                  value={connectionForm.description ?? ''}
                  onChange={(event) => onFormChange('description', event.target.value)}
                  placeholder={t.connections.descriptionPlaceholder}
                  disabled={!connectionEditing}
                />
                <FieldDescription>
                  {connectionEditing ? t.connections.storedIn : t.connections.readOnlyHint}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>
        </div>
        <div className="shrink-0 border-t px-4 py-3">
          <SkillManageStatus message={connectionSaveMessage} />
          <div className="mt-3 flex items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={onResetForm}>
              {t.common.new}
            </Button>
            <div className="flex items-center gap-2">
              {!connectionEditing && connectionForm.id && (
                <Button type="button" variant="outline" onClick={onStartEditing}>
                  {t.common.edit}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => onSave(false)}
                disabled={!connectionEditing || !connectionFormReady}
              >
                {t.common.save}
              </Button>
              <Button
                type="button"
                onClick={() => onSave(true)}
                disabled={!connectionEditing || !connectionFormReady}
              >
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
