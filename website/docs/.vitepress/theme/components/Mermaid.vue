<script setup lang="ts">
import { ref } from 'vue'
import PluginMermaid from 'vitepress-plugin-mermaid/Mermaid.vue'
import DiagramFrame from './DiagramFrame.vue'

const props = defineProps<{
  graph: string
  id: string
  class?: string
}>()

const hostRef = ref<HTMLElement | null>(null)

function captureHtml(): string {
  const svg = hostRef.value?.querySelector('svg')
  return svg?.outerHTML ?? ''
}
</script>

<template>
  <DiagramFrame title="mermaid" :capture-html="captureHtml">
    <div ref="hostRef" class="crescent-diagram-frame__mermaid-host">
      <PluginMermaid :id="id" :graph="graph" :class="props.class || 'mermaid'" />
    </div>
  </DiagramFrame>
</template>
