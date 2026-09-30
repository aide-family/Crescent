<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

const props = defineProps<{
  title: string
  /** Inline + lightbox markup when no default slot is used */
  html?: string
  /** Capture rendered markup when opening lightbox (e.g. Mermaid SVG) */
  captureHtml?: () => string
}>()

const { lang } = useData()

const isEnglish = computed(() => String(lang.value ?? '').toLowerCase().startsWith('en'))
const labels = computed(() =>
  isEnglish.value
    ? { enlarge: 'Enlarge', close: 'Close', zoomIn: 'Zoom in', zoomOut: 'Zoom out' }
    : { enlarge: '放大', close: '关闭', zoomIn: '放大', zoomOut: '缩小' }
)

const expanded = ref(false)
const zoom = ref(1)
const bodyOverflow = ref('')
const stageRef = ref<HTMLElement | null>(null)
const lightboxHtml = ref('')

const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`)

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

function resolveLightboxHtml(): string {
  if (props.captureHtml) {
    const captured = props.captureHtml()
    if (captured) return captured
  }
  return props.html ?? ''
}

function openExpanded(): void {
  lightboxHtml.value = resolveLightboxHtml()
  if (!lightboxHtml.value) return
  expanded.value = true
  zoom.value = 1
}

function closeExpanded(): void {
  expanded.value = false
  zoom.value = 1
}

function nudgeZoom(delta: number): void {
  zoom.value = clampZoom(zoom.value + delta)
}

function onStageWheel(event: WheelEvent): void {
  event.preventDefault()
  const direction = event.deltaY > 0 ? -1 : 1
  nudgeZoom(direction * ZOOM_STEP)
}

function onKeydown(event: KeyboardEvent): void {
  if (!expanded.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeExpanded()
  }
}

watch(expanded, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    bodyOverflow.value = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = bodyOverflow.value
  }
})

watch(stageRef, (el, prev) => {
  prev?.removeEventListener('wheel', onStageWheel)
  el?.addEventListener('wheel', onStageWheel, { passive: false })
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  stageRef.value?.removeEventListener('wheel', onStageWheel)
  if (typeof document !== 'undefined' && expanded.value) {
    document.body.style.overflow = bodyOverflow.value
  }
})

defineExpose({ openExpanded })
</script>

<template>
  <div class="crescent-diagram-frame">
    <div class="crescent-diagram-frame__toolbar">
      <span class="crescent-diagram-frame__title">{{ title }}</span>
      <button
        type="button"
        class="crescent-diagram-frame__icon-btn"
        :aria-label="labels.enlarge"
        :title="labels.enlarge"
        @click="openExpanded"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>
    <div class="crescent-diagram-frame__canvas" role="img" :aria-label="title" @dblclick="openExpanded">
      <slot>
        <div v-if="html" v-html="html" />
      </slot>
    </div>

    <Teleport to="body">
      <div
        v-if="expanded"
        class="crescent-diagram-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <div class="crescent-diagram-lightbox__header">
          <span class="crescent-diagram-lightbox__title">{{ title }} · {{ zoomPercent }}</span>
          <div class="crescent-diagram-lightbox__actions">
            <button
              type="button"
              class="crescent-diagram-frame__icon-btn"
              :aria-label="labels.zoomOut"
              :title="labels.zoomOut"
              @click="nudgeZoom(-ZOOM_STEP)"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button
              type="button"
              class="crescent-diagram-frame__icon-btn"
              :aria-label="labels.zoomIn"
              :title="labels.zoomIn"
              @click="nudgeZoom(ZOOM_STEP)"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button
              type="button"
              class="crescent-diagram-frame__icon-btn"
              :aria-label="labels.close"
              :title="labels.close"
              @click="closeExpanded"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div ref="stageRef" class="crescent-diagram-lightbox__stage">
          <div
            class="crescent-diagram-lightbox__scaled"
            :style="{ transform: `scale(${zoom})` }"
            v-html="lightboxHtml"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>
