import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { BotIcon, CheckIcon, Loader2Icon, SettingsIcon, TerminalIcon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@renderer/components/ui/sheet'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import type { AgentConfig, AgentEvent, AgentModelOption } from '../../main/agent/types'

const PROMPT = '\x1b[38;5;45mterminal-agent\x1b[0m $ '

const emptyConfig: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: '',
  openApiDocument: ''
}

function App(): React.JSX.Element {
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const inputBufferRef = useRef('')
  const busyRef = useRef(false)
  const [config, setConfig] = useState<AgentConfig>(emptyConfig)
  const [models, setModels] = useState<AgentModelOption[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('dark')

    window.api.agent.getConfig().then(setConfig).catch((error) => {
      writeLine(`\x1b[31mFailed to load config: ${String(error)}\x1b[0m`)
    })
    window.api.agent.getModels().then(setModels).catch((error) => {
      writeLine(`\x1b[31mFailed to load models: ${String(error)}\x1b[0m`)
    })
  }, [])

  useEffect(() => {
    const host = terminalHostRef.current
    if (!host || terminalRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#111111',
        foreground: '#f5f5f5',
        cursor: '#ffffff',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#38bdf8',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f4f4f5'
      }
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()

    terminal.writeln('\x1b[1mTerminalAgent\x1b[0m')
    terminal.writeln('Type a natural-language command. Use /config, /clear, /remember, or /help.')
    terminal.write(`\r\n${PROMPT}`)

    terminal.onData((data) => {
      void handleTerminalData(data)
    })

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(host)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    return window.api.agent.onEvent((event) => {
      writeAgentEvent(event)
    })
  }, [])

  async function handleTerminalData(data: string): Promise<void> {
    for (const char of data) {
      if (char === '\r') {
        const command = inputBufferRef.current.trim()
        inputBufferRef.current = ''
        terminalRef.current?.write('\r\n')
        await runCommand(command)
        continue
      }

      if (char === '\u007f') {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1)
          terminalRef.current?.write('\b \b')
        }
        continue
      }

      if (char >= ' ') {
        inputBufferRef.current += char
        terminalRef.current?.write(char)
      }
    }
  }

  async function runCommand(command: string): Promise<void> {
    if (!command) {
      writePrompt()
      return
    }

    if (command === '/config') {
      setSheetOpen(true)
      writeLine('Opening configuration panel.')
      writePrompt()
      return
    }

    if (command === '/clear') {
      terminalRef.current?.clear()
      writePrompt()
      return
    }

    if (command === '/help') {
      writeLine('Commands: /config, /clear, /help, /remember <note>')
      writeLine('Modes: ReAct for direct reasoning/action, Plan-and-Execute for multi-step workflows.')
      writeLine('Enter a natural-language request to let the model select and call OpenAPI tools.')
      writePrompt()
      return
    }

    if (busyRef.current) {
      writeLine('\x1b[33mAgent is still running. Wait for the current command to finish.\x1b[0m')
      writePrompt()
      return
    }

    busyRef.current = true
    setBusy(true)

    const result = await window.api.agent.run({ input: command })

    if (!result.ok && result.error) {
      writeLine(`\x1b[31m${result.error}\x1b[0m`)
    }

    busyRef.current = false
    setBusy(false)
    writePrompt()
  }

  async function saveConfig(): Promise<void> {
    const nextConfig = await window.api.agent.saveConfig(config)
    setConfig(nextConfig)
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  function updateConfig<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  function writeAgentEvent(event: AgentEvent): void {
    if (event.type === 'status') writeLine(`\x1b[90m${event.message}\x1b[0m`)
    if (event.type === 'thought') writeLine(`\x1b[35mthought\x1b[0m ${event.message}`)
    if (event.type === 'plan') {
      writeLine('\x1b[33mplan\x1b[0m')
      event.steps.forEach((step, index) => writeLine(`  ${index + 1}. ${step}`))
    }
    if (event.type === 'tool') writeLine(`\x1b[36mtool\x1b[0m ${event.name}: ${event.message}`)
    if (event.type === 'token') writeLine(event.text)
    if (event.type === 'error') writeLine(`\x1b[31m${event.message}\x1b[0m`)
    if (event.type === 'done') writeLine(`\x1b[32m${event.message}\x1b[0m`)
  }

  function writeLine(text: string): void {
    terminalRef.current?.writeln(text.replace(/\n/g, '\r\n'))
  }

  function writePrompt(): void {
    terminalRef.current?.write(`\r\n${PROMPT}`)
  }

  const configured = Boolean(
    config.openAiApiKey.trim() && config.model.trim() && config.openApiBaseUrl.trim() && config.openApiDocument.trim()
  )

  return (
    <main className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TerminalIcon aria-hidden="true" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">TerminalAgent</span>
            <span className="text-xs text-muted-foreground">OpenAPI function-calling terminal</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={configured ? 'secondary' : 'outline'}>
            {configured ? 'Configured' : 'Needs config'}
          </Badge>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <SettingsIcon data-icon="inline-start" />
                Settings
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-xl">
              <SheetHeader>
                <SheetTitle>Agent settings</SheetTitle>
                <SheetDescription>
                  Configure the model provider and the OpenAPI document used to generate tools.
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-auto px-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="open-ai-api-key">OpenAI API key</FieldLabel>
                    <Input
                      id="open-ai-api-key"
                      type="password"
                      value={config.openAiApiKey}
                      onChange={(event) => updateConfig('openAiApiKey', event.target.value)}
                      placeholder="sk-..."
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="open-ai-base-url">OpenAI-compatible base URL</FieldLabel>
                    <Input
                      id="open-ai-base-url"
                      value={config.openAiBaseUrl}
                      onChange={(event) => updateConfig('openAiBaseUrl', event.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                    <FieldDescription>Leave blank for the official OpenAI endpoint.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="model">Model</FieldLabel>
                    <Select value={config.model} onValueChange={(value) => updateConfig('model', value)}>
                      <SelectTrigger id="model" className="w-full">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>OpenClaw-compatible defaults</SelectLabel>
                          {models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.name} · {model.providerId}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Defaults mirror the OpenClaw provider layout; API keys stay local.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Agent mode</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={config.agentMode}
                      onValueChange={(value) => {
                        if (value === 'react' || value === 'plan-execute') {
                          updateConfig('agentMode', value)
                        }
                      }}
                      className="justify-start"
                    >
                      <ToggleGroupItem value="react">ReAct</ToggleGroupItem>
                      <ToggleGroupItem value="plan-execute">Plan-and-Execute</ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription>Use Plan-and-Execute for longer workflows that may need replanning.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="max-active-tools">Dynamic tool limit</FieldLabel>
                    <Input
                      id="max-active-tools"
                      type="number"
                      min={1}
                      max={12}
                      value={config.maxActiveTools}
                      onChange={(event) => updateConfig('maxActiveTools', Number(event.target.value))}
                    />
                    <FieldDescription>Only the most relevant OpenAPI tools are sent to the model.</FieldDescription>
                  </Field>
                  <Separator />
                  <Field>
                    <FieldLabel htmlFor="open-api-base-url">REST API base URL</FieldLabel>
                    <Input
                      id="open-api-base-url"
                      value={config.openApiBaseUrl}
                      onChange={(event) => updateConfig('openApiBaseUrl', event.target.value)}
                      placeholder="https://api.example.com"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="open-api-document">OpenAPI URL or JSON</FieldLabel>
                    <Textarea
                      id="open-api-document"
                      className="min-h-48 resize-none font-mono text-xs"
                      value={config.openApiDocument}
                      onChange={(event) => updateConfig('openApiDocument', event.target.value)}
                      placeholder="https://api.example.com/openapi.json"
                    />
                  </Field>
                </FieldGroup>
              </div>
              <SheetFooter>
                <Button onClick={saveConfig} disabled={busy}>
                  {saved ? <CheckIcon data-icon="inline-start" /> : <BotIcon data-icon="inline-start" />}
                  {saved ? 'Saved' : 'Save settings'}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <section className="grid min-h-0 flex-1 grid-cols-1">
        <div className="min-h-0 border bg-[#111111]">
          <div ref={terminalHostRef} className="h-full min-h-0" />
        </div>
      </section>
      <footer className="flex h-9 shrink-0 items-center justify-between border-t px-4 text-xs text-muted-foreground">
        <span>Use /config for settings. Current mode: {config.agentMode}.</span>
        <span className="inline-flex items-center gap-2">
          {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {busy ? 'Running' : 'Ready'}
        </span>
      </footer>
    </main>
  )
}

export default App
