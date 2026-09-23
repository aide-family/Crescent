import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repo = 'https://github.com/aide-family/Crescent'
const base = '/Crescent/'

const zhSearch = {
  translations: {
    button: {
      buttonText: '搜索文档',
      buttonAriaLabel: '搜索文档'
    },
    modal: {
      noResultsText: '没有找到结果',
      resetButtonTitle: '清除查询',
      footer: {
        selectText: '选择',
        navigateText: '切换',
        closeText: '关闭'
      }
    }
  }
}

export default withMermaid(
  defineConfig({
    title: 'Crescent',
    description: '把 AI 放进真实终端的开源运维工作台',
    base,
    head: [['link', { rel: 'icon', type: 'image/x-icon', href: `${base}favicon.ico` }]],
    lastUpdated: true,
    cleanUrls: true,
    ignoreDeadLinks: false,
    mermaid: {},
    locales: {
      root: {
        label: '简体中文',
        lang: 'zh-CN',
        description: '把 AI 放进真实终端的开源运维工作台',
        themeConfig: {
          nav: [
            { text: '指南', link: '/guide/why' },
            { text: '架构', link: '/architecture/' },
            { text: '开发', link: '/develop/' }
          ],
          sidebar: [
            {
              text: '指南',
              items: [
                { text: '为什么需要 Crescent', link: '/guide/why' },
                { text: '安装', link: '/guide/install' },
                { text: '快速开始', link: '/guide/quick-start' },
                { text: '工作台', link: '/guide/workbench' },
                { text: '终端与 Agent', link: '/guide/terminal' },
                { text: '子终端与子代理', link: '/guide/subagents' },
                { text: '命令审核', link: '/guide/command-review' },
                { text: 'SSH 连接', link: '/guide/ssh' },
                { text: 'Skills 与知识库', link: '/guide/skills' },
                { text: 'Agent 工具', link: '/guide/tools' },
                { text: '会话历史', link: '/guide/history' }
              ]
            },
            {
              text: '架构',
              items: [{ text: '运行时与适用人群', link: '/architecture/' }]
            },
            {
              text: '开发',
              items: [{ text: '从源码运行与贡献', link: '/develop/' }]
            }
          ],
          outline: { label: '本页目录', level: [2, 3] },
          docFooter: { prev: '上一页', next: '下一页' },
          lastUpdated: { text: '最后更新' },
          darkModeSwitchLabel: '外观',
          lightModeSwitchTitle: '切换到浅色模式',
          darkModeSwitchTitle: '切换到深色模式',
          sidebarMenuLabel: '菜单',
          returnToTopLabel: '返回顶部',
          langMenuLabel: '语言',
          footer: {
            message: '开源运维工作台',
            copyright: 'Copyright © Crescent'
          }
        }
      },
      en: {
        label: 'English',
        lang: 'en-US',
        link: '/en/',
        description: 'An open-source operations workbench that brings AI into the real terminal.',
        themeConfig: {
          nav: [
            { text: 'Guide', link: '/en/guide/why' },
            { text: 'Architecture', link: '/en/architecture/' },
            { text: 'Develop', link: '/en/develop/' }
          ],
          sidebar: [
            {
              text: 'Guide',
              items: [
                { text: 'Why Crescent', link: '/en/guide/why' },
                { text: 'Install', link: '/en/guide/install' },
                { text: 'Quick start', link: '/en/guide/quick-start' },
                { text: 'Workbench', link: '/en/guide/workbench' },
                { text: 'Terminal and Agent', link: '/en/guide/terminal' },
                { text: 'Subterminals and subagents', link: '/en/guide/subagents' },
                { text: 'Command review', link: '/en/guide/command-review' },
                { text: 'SSH connections', link: '/en/guide/ssh' },
                { text: 'Skills and knowledge', link: '/en/guide/skills' },
                { text: 'Agent tools', link: '/en/guide/tools' },
                { text: 'Session history', link: '/en/guide/history' }
              ]
            },
            {
              text: 'Architecture',
              items: [{ text: 'Runtime and audience', link: '/en/architecture/' }]
            },
            {
              text: 'Develop',
              items: [{ text: 'Run from source and contribute', link: '/en/develop/' }]
            }
          ],
          outline: { label: 'On this page', level: [2, 3] },
          footer: {
            message: 'Open-source operations workbench',
            copyright: 'Copyright © Crescent'
          }
        }
      }
    },
    themeConfig: {
      socialLinks: [{ icon: 'github', link: repo }],
      search: {
        provider: 'local',
        options: {
          locales: {
            root: zhSearch
          }
        }
      }
    }
  })
)
