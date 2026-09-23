import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import LatestDownloads from './components/LatestDownloads.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LatestDownloads', LatestDownloads)
  }
} satisfies Theme
