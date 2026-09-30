<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import type { ArchitectureSpec } from '@shared/architecture-spec'
import { buildArchitectureExportSvg } from '@shared/architecture-svg'
import { architectureDiagramPresets } from '../architecture-specs'
import DiagramFrame from './DiagramFrame.vue'

export type ArchitectureDiagramName = keyof typeof architectureDiagramPresets

const props = defineProps<{
  /** Named diagram from architecture-specs, or omit when passing :spec */
  name?: ArchitectureDiagramName | (string & {})
  spec?: ArchitectureSpec
}>()

const { lang } = useData()

const resolved = computed(() => {
  if (props.spec) return props.spec
  if (props.name && architectureDiagramPresets[props.name]) {
    return architectureDiagramPresets[props.name]
  }
  return null
})

const svg = computed(() => {
  if (!resolved.value) return ''
  return buildArchitectureExportSvg(resolved.value).svg
})

const title = computed(() => resolved.value?.title ?? 'architecture')

const isEnglish = computed(() => {
  if (props.name?.endsWith('-en')) return true
  return String(lang.value ?? '').toLowerCase().startsWith('en')
})

const unavailable = computed(() =>
  isEnglish.value ? 'Architecture diagram is unavailable.' : '架构图不可用。'
)
</script>

<template>
  <p v-if="!svg" class="crescent-diagram-frame__error">{{ unavailable }}</p>
  <DiagramFrame v-else :title="title" :html="svg" />
</template>
