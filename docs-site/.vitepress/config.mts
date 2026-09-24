import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
  title: "Starfit Docs",
  description: "AI-Powered Fitness Companion Documentation",

  // Base URL for GitHub Pages deployment (project site)
  base: '/star-fit/',

  // Dead links are build errors; fix them rather than ignore
  ignoreDeadLinks: false,

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '设计哲学', link: '/getting-started/design-philosophy' }
        ],
        sidebar: {
          '/': [
            {
              text: '文档',
              items: [
                { text: '设计哲学', link: '/getting-started/design-philosophy' }
              ]
            }
          ]
        },
        docFooter: {
          prev: '上一页',
          next: '下一页'
        },
        outline: {
          label: '页面导航'
        }
      }
    }
  },
  mermaid: {
    securityLevel: 'loose',
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#e3f2fd',
      primaryTextColor: '#333',
      lineColor: '#333',
    }
  },
  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zenthos-z/star-fit' }
    ],

    footer: {
      message: 'Released under MIT License.',
      copyright: 'Copyright © 2025-2026 Starfit'
    }
  }
  })
)
