<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useData } from 'vitepress'

const REPO_URL = 'https://github.com/aide-family/Crescent'
const API_URL = 'https://api.github.com/repos/aide-family/Crescent'

let cachedCount: number | undefined
let pending: Promise<number | undefined> | undefined

function loadStarCount(): Promise<number | undefined> {
  if (cachedCount !== undefined) return Promise.resolve(cachedCount)
  if (pending) return pending
  pending = fetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json' }
  })
    .then(async (response) => {
      if (!response.ok) return undefined
      const body = (await response.json()) as { stargazers_count?: unknown }
      const value = body.stargazers_count
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
      cachedCount = value
      return value
    })
    .catch(() => undefined)
    .finally(() => {
      if (cachedCount === undefined) pending = undefined
    })
  return pending
}

const { lang } = useData()
const count = ref<number | undefined>(cachedCount)

const formattedCount = computed(() => {
  if (count.value === undefined) return ''
  return new Intl.NumberFormat(lang.value || 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(count.value)
})

const ariaLabel = computed(() => {
  const zh = lang.value.toLowerCase().startsWith('zh')
  if (!formattedCount.value) {
    return zh ? '在 GitHub 上 Star Crescent' : 'Star Crescent on GitHub'
  }
  return zh
    ? `在 GitHub 上 Star Crescent，当前 ${formattedCount.value} 个 star`
    : `Star Crescent on GitHub, ${formattedCount.value} stars`
})

onMounted(() => {
  void loadStarCount().then((value) => {
    if (value !== undefined) count.value = value
  })
})
</script>

<template>
  <a class="repo-star" :href="REPO_URL" target="_blank" rel="noreferrer" :aria-label="ariaLabel">
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"
      />
    </svg>
    <span>Star</span>
    <span v-if="formattedCount" class="count">{{ formattedCount }}</span>
  </a>
</template>

<style scoped>
.repo-star {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  margin-inline: 8px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}

.repo-star:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.repo-star:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.count {
  font-variant-numeric: tabular-nums;
}
</style>
