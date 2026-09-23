import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const localTests = process.env.CRESCENT_LOCAL_TESTS === '1'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    exclude: localTests
      ? ['**/node_modules/**', 'dist/**', 'out/**']
      : [
          '**/node_modules/**',
          'dist/**',
          'out/**',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/__tests__/**'
        ]
  }
})
