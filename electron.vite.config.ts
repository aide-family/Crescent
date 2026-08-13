import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  '@mariozechner/clipboard'
]

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
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [tailwindcss(), react()]
  }
})
