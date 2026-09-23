<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    locale?: 'zh' | 'en'
  }>(),
  { locale: 'zh' }
)

const RELEASES_URL = 'https://github.com/aide-family/Crescent/releases'
const API_URL = 'https://api.github.com/repos/aide-family/Crescent/releases/latest'

type AssetKind = 'macArm' | 'macIntel' | 'windows' | 'appImage' | 'deb' | 'sums'

type Asset = {
  name: string
  browser_download_url: string
  size: number
}

type Release = {
  tag_name: string
  html_url: string
  assets: Asset[]
}

type Row = {
  platform: string
  name: string
  url: string
  size: string
}

const copy = {
  zh: {
    latest: '最新正式版',
    platform: '平台',
    asset: '安装包',
    size: '大小',
    fallbackLead: '暂时读不到最新正式版。请从',
    fallbackTrail: '下载对应平台的安装包。',
    releases: 'GitHub Releases',
    checksumNote: '同一 Release 里的 SHA256SUMS.txt 可以用来校验下载文件。',
    platforms: {
      macArm: 'macOS Apple Silicon',
      macIntel: 'macOS Intel',
      windows: 'Windows',
      appImage: 'Linux AppImage',
      deb: 'Linux deb',
      sums: '校验文件'
    },
    patterns: [
      ['macOS Apple Silicon', 'crescent-*-arm64.dmg'],
      ['macOS Intel', 'crescent-*-x64.dmg'],
      ['Windows', 'crescent-*-x64-setup.exe'],
      ['Linux', '.AppImage 或 .deb']
    ]
  },
  en: {
    latest: 'Latest release',
    platform: 'Platform',
    asset: 'Package',
    size: 'Size',
    fallbackLead: 'The latest release could not be loaded. Download a build from',
    fallbackTrail: '.',
    releases: 'GitHub Releases',
    checksumNote: 'Use SHA256SUMS.txt from the same release to verify the download when you can.',
    platforms: {
      macArm: 'macOS Apple Silicon',
      macIntel: 'macOS Intel',
      windows: 'Windows',
      appImage: 'Linux AppImage',
      deb: 'Linux deb',
      sums: 'Checksums'
    },
    patterns: [
      ['macOS Apple Silicon', 'crescent-*-arm64.dmg'],
      ['macOS Intel', 'crescent-*-x64.dmg'],
      ['Windows', 'crescent-*-x64-setup.exe'],
      ['Linux', '.AppImage or .deb']
    ]
  }
} as const

const labels = computed(() => copy[props.locale])
const status = ref<'pending' | 'ready' | 'fallback'>('pending')
const version = ref('')
const releaseUrl = ref(RELEASES_URL)
const rows = ref<Row[]>([])

const KIND_ORDER: AssetKind[] = ['macArm', 'macIntel', 'windows', 'appImage', 'deb', 'sums']

function classify(name: string): AssetKind | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.blockmap') || lower.endsWith('.yml') || lower.endsWith('.yaml')) return null
  if (lower.endsWith('.zip')) return null
  if (lower === 'sha256sums.txt') return 'sums'
  if (lower.endsWith('.dmg') && lower.includes('arm64')) return 'macArm'
  if (lower.endsWith('.dmg') && lower.includes('x64')) return 'macIntel'
  if (lower.endsWith('-setup.exe')) return 'windows'
  if (lower.endsWith('.appimage')) return 'appImage'
  if (lower.endsWith('.deb')) return 'deb'
  return null
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(async () => {
  try {
    const response = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) {
      status.value = 'fallback'
      return
    }
    const release = (await response.json()) as Release
    const assets = Array.isArray(release.assets) ? release.assets : []
    const matched: Row[] = []
    for (const kind of KIND_ORDER) {
      for (const asset of assets) {
        if (classify(asset.name) !== kind || !asset.browser_download_url) continue
        matched.push({
          platform: labels.value.platforms[kind],
          name: asset.name,
          url: asset.browser_download_url,
          size: formatSize(asset.size)
        })
      }
    }
    if (!release.tag_name || matched.length === 0) {
      status.value = 'fallback'
      return
    }
    version.value = release.tag_name
    releaseUrl.value = release.html_url || RELEASES_URL
    rows.value = matched
    status.value = 'ready'
  } catch {
    status.value = 'fallback'
  }
})
</script>

<template>
  <div v-if="status === 'ready'">
    <p>
      <a :href="releaseUrl">{{ labels.latest }} {{ version }}</a>
    </p>
    <table>
      <thead>
        <tr>
          <th>{{ labels.platform }}</th>
          <th>{{ labels.asset }}</th>
          <th>{{ labels.size }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.url">
          <td>{{ row.platform }}</td>
          <td>
            <a :href="row.url">{{ row.name }}</a>
          </td>
          <td>{{ row.size }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-else>
    <p v-if="status === 'fallback'">
      {{ labels.fallbackLead }}
      <a :href="RELEASES_URL">{{ labels.releases }}</a>
      {{ labels.fallbackTrail }}
    </p>
    <table>
      <thead>
        <tr>
          <th>{{ labels.platform }}</th>
          <th>{{ labels.asset }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="pattern in labels.patterns" :key="pattern[1]">
          <td>{{ pattern[0] }}</td>
          <td>
            <code>{{ pattern[1] }}</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>{{ labels.checksumNote }}</p>
  </div>
</template>
