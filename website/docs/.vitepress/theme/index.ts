import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import LatestDownloads from './components/LatestDownloads.vue'
import ArchitectureDiagram from './components/ArchitectureDiagram.vue'
import Mermaid from './components/Mermaid.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('LatestDownloads', LatestDownloads)
    app.component('ArchitectureDiagram', ArchitectureDiagram)
    // Override vitepress-plugin-mermaid's Mermaid with enlarge-capable wrapper.
    app.component('Mermaid', Mermaid)
  }
} satisfies Theme
