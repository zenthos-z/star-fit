import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
  title: "Starfit Docs",
  description: "AI-Powered Fitness Companion Documentation",

  // Base URL for GitHub Pages deployment (project site)
  base: '/star-fit/',

  // Temporarily ignore dead links while fixing link references
  ignoreDeadLinks: true,

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '快速入门', link: '/getting-started/introduction' },
          { text: '核心概念', link: '/concepts/data-protocol' },
          { text: '数据库', link: '/database/postgresql-schema' },
          { text: '架构设计', link: '/architecture/data-flow' },
          { text: '开发指南', link: '/development/contributing' },
          { text: 'UI 指南', link: '/ui-guides/color-system' },
          { text: 'API 参考', link: '/api/shared-types' }
        ],
        sidebar: {
          '/getting-started/': [
            {
              text: '快速入门',
              items: [
                { text: '项目简介', link: '/getting-started/introduction' },
                { text: '快速开始', link: '/getting-started/quick-start' },
                { text: '设计理念', link: '/getting-started/design-philosophy' }
              ]
            }
          ],
          '/concepts/': [
            {
              text: '核心概念',
              items: [
                { text: '数据协议', link: '/concepts/data-protocol' },
                { text: '同步系统', link: '/concepts/sync-system' },
                { text: '视频管理', link: '/concepts/video-management' },
                { text: 'AI 教练', link: '/concepts/ai-coach' }
              ]
            }
          ],
          '/specifications/': [
            {
              text: '技术规范',
              items: [
                { text: '视频协议', link: '/specifications/video-protocol' }
              ]
            }
          ],
          '/architecture/': [
            {
              text: '架构设计',
              items: [
                { text: '数据流', link: '/architecture/data-flow' },
                { text: '三态数据流', link: '/architecture/three-state-data-flow' }
              ]
            }
          ],
          '/development/': [
            {
              text: '开发指南',
              items: [
                { text: '贡献指南', link: '/development/contributing' },
                { text: '目录规范', link: '/development/directory-conventions' },
                { text: '部署', link: '/development/deployment' },
                { text: '代码质量', link: '/development/code-quality' },
                { text: '视频排错', link: '/development/video-troubleshooting' }
              ]
            }
          ],
          '/ui-guides/': [
            {
              text: 'UI 指南',
              items: [
                { text: '颜色系统', link: '/ui-guides/color-system' },
                { text: '字体排印', link: '/ui-guides/typography-system' },
                { text: '空间布局', link: '/ui-guides/spacing-layout-system' },
                { text: '运动卡片', link: '/ui-guides/exercise-card-system' },
                { text: '聊天气泡', link: '/ui-guides/chat-bubble-system' },
                { text: '动效交互', link: '/ui-guides/animation-interaction-system' },
                { text: '组件展示', link: '/ui-guides/gallery' }
              ]
            }
          ],
          '/api/': [
            {
              text: 'API 参考',
              items: [
                { text: '共享类型', link: '/api/shared-types' },
                { text: '动作库 IO', link: '/api/exercise-library-io' },
                { text: '向量检索', link: '/api/vector-search-guide' }
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
