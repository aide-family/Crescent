import { CopyIcon, RefreshCwIcon, Settings2Icon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import whaleSprite from '@renderer/assets/whale-sprite.png'
import { WhalePetPortrait } from '@renderer/components/WhalePetPortrait'
import type { WhaleMonitorConfigInput, WhaleMonitorSnapshot } from '../../../shared/whale-monitor'

interface WhaleMotionAsset {
  id: string
  category: string
  src: string
}

interface ActiveWhaleMotion extends WhaleMotionAsset {
  loop: boolean
  token: number
}

const WHALE_WIDGET_HEIGHT = 136
const PET_DOUBLE_CLICK_DELAY_MS = 350
const whaleMotionModules = import.meta.glob<string>('../assets/whale-motions/**/*.webm', {
  eager: true,
  import: 'default',
  query: '?url'
})
const whaleMotionAssets: WhaleMotionAsset[] = Object.entries(whaleMotionModules).map(
  ([path, src]) => {
    const parts = path.split('/')
    const category = parts.at(-2) ?? 'other'
    const name = (parts.at(-1) ?? path).replace(/\.webm$/, '')
    return { id: `${category}/${name}`, category, src }
  }
)
const idleMotion = whaleMotionAssets.find((motion) => motion.id === 'idle/breathing') ?? {
  id: 'idle/static',
  category: 'idle',
  src: ''
}
const staticIdleMotion = { id: 'idle/static', category: 'idle', src: '' }
const workMotions = whaleMotionAssets.filter((motion) => motion.category === 'work')
const clickMotions = whaleMotionAssets.filter((motion) => motion.category === 'clicks')
const dragMotions = whaleMotionAssets.filter((motion) => motion.category === 'drag')
const ambientMotions = whaleMotionAssets.filter(
  (motion) => !['idle', 'work', 'clicks', 'drag'].includes(motion.category)
)

function chooseMotion(
  pool: WhaleMotionAsset[],
  previousId?: string,
  failedIds?: Set<string>
): WhaleMotionAsset {
  const available = pool.filter((motion) => !failedIds?.has(motion.id))
  if (available.length === 0) return staticIdleMotion
  const choices = available.filter((motion) => motion.id !== previousId)
  return choices[Math.floor(Math.random() * choices.length)] ?? available[0]
}

interface WhaleMonitorProps {
  locale: 'zh-CN' | 'en'
  agentBusy?: boolean
  onSelectModel?: (modelId: string) => Promise<void> | void
  selectedModel?: string
  onEnabledChange?: (enabled: boolean) => void
}

type DateRange = { startDate: string; endDate: string }

const DEFAULT_RANGE = (): DateRange => {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now)
  const [year, month] = date.split('-')
  const lastDay = new Date(Number(year), Number(month), 0).getDate()
  return { startDate: `${year}-${month}-01`, endDate: `${year}-${month}-${lastDay}` }
}

function WhaleAvatar({
  motion,
  agentBusy,
  onMotionEnded,
  onMotionError
}: {
  motion: ActiveWhaleMotion
  agentBusy: boolean
  onMotionEnded: (token: number) => void
  onMotionError: (token: number) => void
}): React.JSX.Element {
  const [videoState, setVideoState] = useState({ token: -1, ready: false, failed: false })
  const videoReady = videoState.token === motion.token && videoState.ready
  const videoFailed = videoState.token === motion.token && videoState.failed

  return (
    <span className="relative flex h-[132px] w-[100px] items-end justify-center">
      <span aria-hidden="true" className="whale-pet-ground" />
      <span className={`whale-pet-motion ${agentBusy ? 'whale-pet-busy' : ''}`}>
        <img
          aria-hidden="true"
          draggable={false}
          src={whaleSprite}
          className={`whale-pet-sprite absolute inset-0 h-full w-full object-contain drop-shadow-xl ${videoReady && !videoFailed ? 'opacity-0' : ''}`}
        />
        {motion.src && !videoFailed && (
          <video
            key={`${motion.id}-${motion.token}`}
            aria-hidden="true"
            autoPlay
            loop={motion.loop}
            muted
            playsInline
            preload="auto"
            src={motion.src}
            className="whale-pet-sprite absolute inset-0 h-full w-full object-contain drop-shadow-xl"
            onCanPlay={() => setVideoState({ token: motion.token, ready: true, failed: false })}
            onEnded={() => onMotionEnded(motion.token)}
            onError={() => {
              setVideoState({ token: motion.token, ready: false, failed: true })
              onMotionError(motion.token)
            }}
          />
        )}
      </span>
    </span>
  )
}

export function WhaleMonitor({
  locale,
  agentBusy = false,
  onSelectModel,
  selectedModel,
  onEnabledChange
}: WhaleMonitorProps): React.JSX.Element | null {
  const en = locale === 'en'
  const [snapshot, setSnapshot] = useState<WhaleMonitorSnapshot | null>(null)
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [activeMotion, setActiveMotion] = useState<ActiveWhaleMotion>(() => ({
    ...idleMotion,
    loop: true,
    token: 0
  }))
  const [error, setError] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [bounds, setBounds] = useState({ x: 0, y: 0 })
  const [positionReady, setPositionReady] = useState(false)
  const [budgetText, setBudgetText] = useState('200')
  const [refreshIntervalText, setRefreshIntervalText] = useState('120')
  const [endpointSpend, setEndpointSpend] = useState('')
  const [endpointModels, setEndpointModels] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    pointerX: number
    pointerY: number
    x: number
    y: number
    lastX: number
    lastY: number
    moved: boolean
    frameId?: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const petClickTimerRef = useRef<number | null>(null)
  const activeMotionRef = useRef(activeMotion)
  const motionTokenRef = useRef(0)
  const failedMotionsRef = useRef(new Set<string>())

  useEffect(
    () => () => {
      if (petClickTimerRef.current !== null) {
        window.clearTimeout(petClickTimerRef.current)
      }
    },
    []
  )

  const playMotion = useCallback((motion: WhaleMotionAsset, loop: boolean): void => {
    const nextMotion = { ...motion, loop, token: motionTokenRef.current + 1 }
    motionTokenRef.current = nextMotion.token
    activeMotionRef.current = nextMotion
    setActiveMotion(nextMotion)
  }, [])

  const playRandomMotion = useCallback(
    (pool: WhaleMotionAsset[], loop = false): void => {
      playMotion(chooseMotion(pool, activeMotionRef.current.id, failedMotionsRef.current), loop)
    },
    [playMotion]
  )

  const handleMotionEnded = useCallback(
    (token: number): void => {
      if (activeMotionRef.current.token !== token) return
      if (dragging) {
        playRandomMotion(dragMotions)
      } else if (agentBusy) {
        playRandomMotion(workMotions)
      } else {
        playMotion(
          failedMotionsRef.current.has(idleMotion.id) ? staticIdleMotion : idleMotion,
          true
        )
      }
    },
    [agentBusy, dragging, playMotion, playRandomMotion]
  )

  const handleMotionError = useCallback(
    (token: number): void => {
      if (activeMotionRef.current.token !== token) return
      failedMotionsRef.current.add(activeMotionRef.current.id)
      handleMotionEnded(token)
    },
    [handleMotionEnded]
  )

  useEffect(() => {
    if (dragging) {
      playRandomMotion(dragMotions)
    } else if (agentBusy) {
      playRandomMotion(workMotions)
    } else if (['drag', 'work'].includes(activeMotionRef.current.category)) {
      playMotion(idleMotion, true)
    }
  }, [agentBusy, dragging, playMotion, playRandomMotion])

  useEffect(() => {
    if (agentBusy || dragging || activeMotion.category !== 'idle') return
    const timer = window.setTimeout(
      () => playRandomMotion(ambientMotions),
      18_000 + Math.random() * 24_000
    )
    return () => window.clearTimeout(timer)
  }, [activeMotion, agentBusy, dragging, playRandomMotion])

  const applySnapshot = useCallback(
    (next: WhaleMonitorSnapshot) => {
      setSnapshot(next)
      onEnabledChange?.(next.settings.enabled)
      setBudgetText(String(next.settings.totalBudget))
      setRefreshIntervalText(String(next.settings.refreshIntervalSeconds))
      setEndpointSpend(next.settings.spendBaseUrl)
      setEndpointModels(next.settings.modelsBaseUrl)
      if (
        next.settings.defaultDateRange === 'custom' &&
        next.settings.startDate &&
        next.settings.endDate
      ) {
        setRange({ startDate: next.settings.startDate, endDate: next.settings.endDate })
      }
      setBounds((current) => {
        if (next.settings.position) return next.settings.position
        if (current.x || current.y) return current
        return {
          x: Math.max(16, window.innerWidth - 316),
          y: Math.max(70, window.innerHeight - 190)
        }
      })
      setPositionReady(true)
    },
    [onEnabledChange]
  )

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.whaleMonitor.onSnapshot((next) => {
      if (active) applySnapshot(next)
    })
    void window.api.whaleMonitor
      .getSnapshot()
      .then((next) => {
        if (active) applySnapshot(next)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      active = false
      unsubscribe()
    }
  }, [applySnapshot])

  useEffect(() => {
    if (!positionReady) return
    const node = rootRef.current
    if (!node) return
    const maxX = Math.max(12, window.innerWidth - node.offsetWidth - 12)
    const maxY = Math.max(55, window.innerHeight - node.offsetHeight - 12)
    setBounds((current) => ({
      x: Math.min(maxX, Math.max(12, current.x)),
      y: Math.min(maxY, Math.max(55, current.y))
    }))
  }, [positionReady, snapshot])

  useEffect(() => {
    if (!positionReady) return
    const clampToViewport = (): void => {
      const node = rootRef.current
      if (!node) return
      const maxX = Math.max(12, window.innerWidth - node.offsetWidth - 12)
      const maxY = Math.max(55, window.innerHeight - node.offsetHeight - 12)
      setBounds((current) => ({
        x: Math.min(maxX, Math.max(12, current.x)),
        y: Math.min(maxY, Math.max(55, current.y))
      }))
    }
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [positionReady])

  const usage = snapshot?.usage
  const remaining =
    usage?.spend === undefined ? undefined : (snapshot?.settings.totalBudget ?? 200) - usage.spend
  const balanceLabel =
    remaining !== undefined
      ? `${en ? 'Left' : '剩余'} ${formatAmount(remaining)} / ${formatAmount(snapshot?.settings.totalBudget ?? 200)}`
      : en
        ? 'Set up Whale monitor'
        : '鲸鱼监控'
  const columns = useMemo(() => {
    const models = snapshot?.models.models ?? []
    return [0, 1, 2].map((column) => models.filter((_, index) => index % 3 === column))
  }, [snapshot?.models.models])
  const spaceAboveWidget = Math.max(0, bounds.y - 12)
  const spaceBelowWidget = Math.max(0, window.innerHeight - bounds.y - WHALE_WIDGET_HEIGHT - 12)
  const panelOpensAbove = spaceAboveWidget >= spaceBelowWidget
  const panelAvailableHeight = panelOpensAbove ? spaceAboveWidget : spaceBelowWidget
  const panelMaxHeight = Math.max(120, Math.min(560, panelAvailableHeight - 8))
  const panelAlignsRight = bounds.x + 112 > window.innerWidth / 2

  const refreshUsage = async (): Promise<void> => {
    if (!range.startDate || !range.endDate || range.startDate > range.endDate) {
      setError(en ? 'Choose a valid date range.' : '请选择有效的日期区间。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const settings = snapshot?.settings
      if (settings) {
        await window.api.whaleMonitor.saveSettings({
          ...settings,
          defaultDateRange: 'custom',
          startDate: range.startDate,
          endDate: range.endDate
        })
      }
      const result = await window.api.whaleMonitor.refreshUsage(range)
      if (result.error) setError(result.error)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const refreshModels = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.whaleMonitor.refreshModels()
      if (result.error) setError(result.error)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = async (): Promise<void> => {
    const amount = Number(budgetText)
    if (!Number.isFinite(amount) || amount < 0) {
      setError(en ? 'Budget must be zero or greater.' : '额度必须是大于或等于 0 的数字。')
      return
    }
    const refreshIntervalSeconds = Number(refreshIntervalText)
    if (
      !Number.isInteger(refreshIntervalSeconds) ||
      refreshIntervalSeconds < 30 ||
      refreshIntervalSeconds > 3600
    ) {
      setError(
        en
          ? 'Refresh interval must be between 30 and 3600 seconds.'
          : '刷新间隔必须在 30 到 3600 秒之间。'
      )
      return
    }
    const settings = snapshot?.settings
    if (!settings) return
    setBusy(true)
    setError('')
    try {
      const input: WhaleMonitorConfigInput = {
        enabled: settings.enabled,
        spendBaseUrl: endpointSpend,
        modelsBaseUrl: endpointModels,
        totalBudget: amount,
        refreshIntervalSeconds,
        defaultDateRange: snapshot?.settings.defaultDateRange ?? 'current-month',
        ...(snapshot?.settings.defaultDateRange === 'custom'
          ? { startDate: range.startDate, endDate: range.endDate }
          : {}),
        position: bounds,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {})
      }
      const saved = await window.api.whaleMonitor.saveSettings(input)
      setSnapshot((current) => (current ? { ...current, settings: saved } : current))
      setApiKey('')
      setClearApiKey(false)
      setSettingsOpen(false)
      if (!settings.apiKeyConfigured && saved.apiKeyConfigured) {
        await Promise.all([
          window.api.whaleMonitor.refreshUsage(range),
          window.api.whaleMonitor.refreshModels()
        ])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dragHandle = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-whale-drag-handle]'
    )
    if (!dragHandle) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: bounds.x,
      y: bounds.y,
      lastX: bounds.x,
      lastY: bounds.y,
      moved: false
    }
    dragHandle.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.pointerX
    const dy = event.clientY - drag.pointerY
    if (!drag.moved && Math.hypot(dx, dy) <= 8) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(true)
      if (detailsOpen) {
        setDetailsOpen(false)
        setSettingsOpen(false)
      }
    }
    const node = rootRef.current
    const maxX = Math.max(12, window.innerWidth - (node?.offsetWidth ?? 280) - 12)
    const maxY = Math.max(55, window.innerHeight - (node?.offsetHeight ?? 90) - 12)
    drag.lastX = Math.min(maxX, Math.max(12, drag.x + dx))
    drag.lastY = Math.min(maxY, Math.max(55, drag.y + dy))
    if (drag.frameId !== undefined) return
    drag.frameId = window.requestAnimationFrame(() => {
      if (rootRef.current) {
        rootRef.current.style.transform = `translate3d(${drag.lastX}px, ${drag.lastY}px, 0)`
      }
      drag.frameId = undefined
    })
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.frameId !== undefined) window.cancelAnimationFrame(drag.frameId)
    if (drag.moved) {
      const next = { x: drag.lastX, y: drag.lastY }
      if (rootRef.current) {
        rootRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`
      }
      setBounds(next)
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      void window.api.whaleMonitor.setPosition(next)
    }
    dragRef.current = null
    setDragging(false)
  }

  const handlePetClick = (): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    if (petClickTimerRef.current !== null) {
      window.clearTimeout(petClickTimerRef.current)
      petClickTimerRef.current = null
      setDetailsOpen(true)
      setSettingsOpen(false)
      return
    }

    petClickTimerRef.current = window.setTimeout(() => {
      petClickTimerRef.current = null
      playRandomMotion(clickMotions)
    }, PET_DOUBLE_CLICK_DELAY_MS)
  }

  const copyModel = async (model: string): Promise<void> => {
    const result = await window.api.app.writeClipboardText(model)
    if (!result.ok)
      setError(result.error || (en ? 'Could not copy model ID.' : '复制模型 ID 失败。'))
  }

  if (!snapshot || !snapshot.settings.enabled) return null

  return (
    <div
      ref={rootRef}
      className={`whale-widget fixed left-0 top-0 z-40 select-none will-change-transform ${dragging ? 'whale-widget-dragging cursor-grabbing' : 'cursor-grab'}`}
      style={{
        transform: `translate3d(${bounds.x}px, ${bounds.y}px, 0)`,
        visibility: positionReady ? 'visible' : 'hidden'
      }}
    >
      {detailsOpen ? (
        <section
          className={`whale-widget-panel ${panelOpensAbove ? 'whale-widget-panel-above' : 'whale-widget-panel-below'} ${panelAlignsRight ? 'right-0' : 'left-0'} w-[min(370px,calc(100vw-24px))] overflow-x-hidden rounded-xl border border-border bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl`}
          style={{ maxHeight: panelMaxHeight, overflowY: 'auto' }}
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <WhalePetPortrait className="size-5" />
                <span>{en ? 'Whale monitor' : '额度监控'}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">LiteLLM · Asia/Shanghai</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                aria-label={en ? 'Settings' : '设置'}
                onClick={() => setSettingsOpen((value) => !value)}
              >
                <Settings2Icon size={15} />
              </button>
              <button
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                aria-label={en ? 'Close details' : '关闭详情'}
                onClick={() => setDetailsOpen(false)}
              >
                <XIcon size={15} />
              </button>
            </div>
          </header>
          {settingsOpen ? (
            <div className="max-h-[min(70vh,560px)] space-y-3 overflow-auto p-3">
              <label className="block space-y-1 text-xs">
                <span>{en ? 'Total budget' : '总额度'}</span>
                <input
                  className="h-8 w-full rounded border border-input bg-background px-2 text-sm"
                  inputMode="decimal"
                  value={budgetText}
                  onChange={(event) => setBudgetText(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span>{en ? 'Refresh interval (seconds)' : '刷新间隔（秒）'}</span>
                <input
                  type="number"
                  min={30}
                  max={3600}
                  step={1}
                  className="h-8 w-full rounded border border-input bg-background px-2 text-sm"
                  value={refreshIntervalText}
                  onChange={(event) => setRefreshIntervalText(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span>{en ? 'Spend endpoint' : '用量端点'}</span>
                <input
                  className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                  value={endpointSpend}
                  onChange={(event) => setEndpointSpend(event.target.value)}
                />
              </label>
              {snapshot?.settings.apiKeyConfigured && (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(event) => setClearApiKey(event.target.checked)}
                  />
                  {en ? 'Remove saved API key' : '移除已保存的 API Key'}
                </label>
              )}
              <label className="block space-y-1 text-xs">
                <span>{en ? 'Models endpoint' : '模型端点'}</span>
                <input
                  className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                  value={endpointModels}
                  onChange={(event) => setEndpointModels(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span>
                  {en ? 'Bearer API key' : 'Bearer API Key'}
                  {snapshot?.settings.apiKeyConfigured
                    ? ` · ${en ? 'already saved' : '已保存'}`
                    : ''}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                  placeholder={en ? 'Leave blank to keep current key' : '留空则保留已保存密钥'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {en
                  ? 'The key stays in the main process and is encrypted with Electron safeStorage.'
                  : '密钥由主进程读取，并通过 Electron safeStorage 加密保存。'}
              </p>
              <button
                className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void saveSettings()}
              >
                {en ? 'Save settings' : '保存设置'}
              </button>
            </div>
          ) : (
            <div className="max-h-[min(70vh,560px)] space-y-3 overflow-auto p-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {en ? 'Remaining' : '剩余额度'}
                  </div>
                  <div
                    className={`text-2xl font-semibold tabular-nums ${remaining !== undefined && remaining < 0 ? 'text-destructive' : 'text-primary'}`}
                  >
                    {remaining === undefined ? '—' : formatAmount(remaining)}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      / {formatAmount(snapshot?.settings.totalBudget ?? 200)}
                    </span>
                  </div>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  {usage?.stale
                    ? en
                      ? 'May be outdated'
                      : '数据可能已过期'
                    : usage?.updatedAt
                      ? new Date(usage.updatedAt).toLocaleTimeString()
                      : en
                        ? 'Not queried yet'
                        : '尚未查询'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-background/45 p-2.5 text-xs">
                <Metric
                  label={en ? 'Spent' : '已使用'}
                  value={usage?.spend === undefined ? '—' : formatAmount(usage.spend)}
                />
                <Metric
                  label={en ? 'Requests' : '请求数'}
                  value={usage?.requestCount === undefined ? '—' : formatAmount(usage.requestCount)}
                />
                <Metric
                  label={en ? 'Tokens' : 'Token 用量'}
                  value={usage?.totalTokens === undefined ? '—' : formatAmount(usage.totalTokens)}
                />
                <Metric
                  label={en ? 'Input / output' : '输入 / 输出'}
                  value={
                    usage?.promptTokens === undefined || usage.completionTokens === undefined
                      ? '—'
                      : `${formatAmount(usage.promptTokens)} / ${formatAmount(usage.completionTokens)}`
                  }
                />
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
                  <label className="space-y-1 text-[10px] text-muted-foreground">
                    <span>{en ? 'From' : '开始日期'}</span>
                    <input
                      type="date"
                      className="h-8 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground"
                      value={range.startDate}
                      onChange={(event) =>
                        setRange((current) => ({ ...current, startDate: event.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-1 text-[10px] text-muted-foreground">
                    <span>{en ? 'To' : '截止日期'}</span>
                    <input
                      type="date"
                      className="h-8 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground"
                      value={range.endDate}
                      onChange={(event) =>
                        setRange((current) => ({ ...current, endDate: event.target.value }))
                      }
                    />
                  </label>
                  <button
                    className="h-8 rounded border border-border px-2 text-xs hover:bg-muted disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void refreshUsage()}
                  >
                    {en ? 'Query' : '查询'}
                  </button>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {usage
                    ? `${usage.startDate} — ${usage.endDate}`
                    : `${range.startDate} — ${range.endDate}`}
                </div>
              </div>
              <div className="border-t border-border pt-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-xs font-medium">
                    {en ? 'Available models' : '可用模型'}{' '}
                    <span className="text-muted-foreground">
                      · {snapshot?.models.models.length ?? 0}
                    </span>
                  </div>
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    title={en ? 'Refresh models' : '刷新模型'}
                    onClick={() => void refreshModels()}
                    disabled={busy}
                  >
                    <RefreshCwIcon size={13} />
                  </button>
                </div>
                {snapshot?.models.stale && (
                  <div className="mb-1 text-[10px] text-amber-500">
                    {en ? 'Model list may be outdated' : '模型列表可能已过期'}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-x-1.5 text-[10px]">
                  {columns.map((items, index) => (
                    <div key={index} className="min-w-0 space-y-1">
                      {items.map((model) => (
                        <div
                          key={model}
                          className={`group flex min-w-0 items-start gap-0.5 rounded px-1 py-1 ${selectedModel === model ? 'bg-primary/15 text-primary' : 'hover:bg-muted'}`}
                        >
                          <button
                            className="min-w-0 flex-1 break-all text-left leading-snug"
                            title={model}
                            onClick={() => void onSelectModel?.(model)}
                          >
                            {model}
                          </button>
                          <button
                            aria-label={`${en ? 'Copy' : '复制'} ${model}`}
                            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 hover:bg-background hover:opacity-100"
                            onClick={() => void copyModel(model)}
                          >
                            <CopyIcon size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {snapshot?.models.updatedAt && (
                  <div className="mt-1 text-right text-[10px] text-muted-foreground">
                    {en ? 'Updated ' : '更新于 '}
                    {new Date(snapshot.models.updatedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
              {error && (
                <div
                  role="status"
                  className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </section>
      ) : null}
      <div
        className="flex cursor-grab touch-none items-center justify-end gap-2 active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {detailsOpen ? (
          <span
            aria-hidden="true"
            className="invisible rounded-full border border-teal-300/50 bg-card/90 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-lg backdrop-blur"
          >
            {balanceLabel}
          </span>
        ) : (
          <button
            data-whale-drag-handle
            className="rounded-full border border-teal-300/50 bg-card/90 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-lg backdrop-blur hover:bg-card"
            onClick={handlePetClick}
          >
            {balanceLabel}
          </button>
        )}
        <button
          data-whale-drag-handle
          aria-label={en ? 'Open whale monitor' : '打开鲸鱼额度面板'}
          className="rounded-full p-0.5 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onClick={handlePetClick}
        >
          <WhaleAvatar
            motion={activeMotion}
            agentBusy={agentBusy}
            onMotionEnded={handleMotionEnded}
            onMotionError={handleMotionError}
          />
        </button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate font-medium tabular-nums" title={value}>
        {value}
      </div>
    </div>
  )
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}
