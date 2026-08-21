import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * Pi packages are ESM-only. Keep them external and load via dynamic `import()`
 * (see src/main/agent/pi-sdk.ts). Do not static-import them into the CJS main bundle.
 */
const piPackages = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-tui',
  '@earendil-works/pi-telemetry',
  '@earendil-works/pi-client',
  '@earendil-works/pi-protocol',
  '@silvia-odwyer/photon-node',
  '@mariozechner/clipboard',
  '@modelcontextprotocol/sdk'
]

const RENDERER_ASSET_LIMIT_BYTES = 1024 * 1024

function posixId(id: string): string {
  return id.replaceAll('\\', '/')
}

function nodeModuleName(id: string): string | undefined {
  const normalized = posixId(id)
  const marker = '/node_modules/'
  const index = normalized.lastIndexOf(marker)
  if (index === -1) return undefined
  const rest = normalized.slice(index + marker.length)
  if (rest.startsWith('@')) {
    const [scope, name] = rest.split('/')
    return name ? `${scope}/${name}` : undefined
  }
  return rest.split('/')[0]
}

function rendererManualChunks(id: string): string | undefined {
  const pkg = nodeModuleName(id)
  if (pkg) {
    if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react-vendor'
    if (pkg === '@xterm/xterm' || pkg === '@xterm/addon-fit' || pkg === 'xterm') {
      return 'xterm-vendor'
    }
    if (pkg === 'lucide-react') return 'lucide-vendor'
    if (pkg === 'radix-ui' || pkg.startsWith('@radix-ui/')) return 'radix-vendor'
    if (pkg === 'd3' || pkg.startsWith('d3-')) return 'd3'
    // Keep mermaid/katex/cytoscape lazy splits. Packing them undoes diagram code-splitting.
    return undefined
  }

  const normalized = posixId(id)
  if (normalized.includes('/src/renderer/src/App.tsx')) return 'app-shell'
  if (normalized.includes('/src/renderer/src/i18n/')) return 'i18n'
  if (normalized.includes('/src/renderer/src/components/')) return 'renderer-ui'
  return undefined
}

function assetSize(item: { type: string; code?: string; source?: string | Uint8Array }): number {
  if (item.type === 'chunk' && typeof item.code === 'string') return item.code.length
  if (item.type !== 'asset' || item.source == null) return 0
  return typeof item.source === 'string' ? item.source.length : item.source.byteLength
}

function enforceRendererAssetLimit(): Plugin {
  return {
    name: 'crescent-renderer-asset-limit',
    apply: 'build',
    generateBundle(_options, bundle) {
      const oversized = Object.values(bundle)
        .map((item) => ({ fileName: item.fileName, size: assetSize(item) }))
        .filter((item) => item.size > RENDERER_ASSET_LIMIT_BYTES)
      if (oversized.length === 0) return
      const details = oversized
        .map((item) => `  - ${item.fileName} (${(item.size / 1024).toFixed(1)} kB)`)
        .join('\n')
      throw new Error(`Renderer assets exceed 1MB:\n${details}`)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty', ...piPackages],
        output: {
          // Keep shared helpers out of index.js so dynamically imported agent/ipc
          // does not create a circular require back into the main entry.
          manualChunks(id) {
            if (id.includes('/src/main/safe-ipc-send')) return 'safe-ipc-send'
            if (id.includes('/src/main/crescent-paths')) return 'crescent-paths'
            if (id.includes('/src/main/update/updater')) return 'updater'
            return undefined
          }
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // mermaid-parser.core ships an unminified langium bundle (~1.3MB).
        // The esm.min entry keeps architecture/git/pie parsers and stays under 1MB.
        '@mermaid-js/parser': resolve(
          'node_modules/@mermaid-js/parser/dist/mermaid-parser.esm.min.mjs'
        )
      }
    },
    plugins: [tailwindcss(), react(), enforceRendererAssetLimit()],
    build: {
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: {
          manualChunks: rendererManualChunks
        }
      }
    }
  }
})
