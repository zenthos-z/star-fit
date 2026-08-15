# UI 颜色系统规范

本指南定义了 Starfit 项目中使用的颜色系统，确保应用端和管理后台的视觉一致性与专业感。

## 核心设计理念
- **专业与动感**: 使用深邃的蓝色作为主色调，象征科技与专业。
- **状态清晰**: 通过鲜明的颜色区分运动状态（进行中、已完成、待开始）。
- **层次分明**: 利用中性色阶构建清晰的界面层次。

## 1. 品牌色 (Brand Colors)
品牌色主要用于主要的 UI 元素、操作按钮和品牌标识。

| 颜色名 | 变量/类名 | 16进制值 | 用途描述 |
| :--- | :--- | :--- | :--- |
| **Star Accent** | `star-accent` | `#3B82F6` | 全局主操作色 (Blue-500) |
| **Primary Blue** | `blue-500` | `#3B82F6` | 主要按钮、进度条、高亮 |
| **Dark Accent** | `blue-600` | `#2563EB` | 悬停状态、深色背景按钮 |
| **Light Accent** | `blue-50` | `#EFF6FF` | 浅色背景、标签背景 |

### 核心色视觉预览
<div style="display: flex; gap: 1rem; margin: 1.5rem 0;">
  <div style="flex: 1; height: 60px; background-color: #3B82F6; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.75rem;">Accent</div>
  <div style="flex: 1; height: 60px; background-color: #F43F5E; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.75rem;">Active</div>
  <div style="flex: 1; height: 60px; background-color: #22C55E; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.75rem;">Success</div>
</div>

## 2. 状态色 (Status Colors)
用于反馈运动执行状态和系统反馈。

| 状态 | 变量/类名 | 16进制值 | 用途描述 |
| :--- | :--- | :--- | :--- |
| **进行中 (Active)** | `rose-500` / `orange-500` | `#F43F5E` / `#F97316` | 当前正在进行的动作/组 |
| **已完成 (Success)** | `green-500` | `#22C55E` | 已完成的组、打勾图标 |
| **警示 (Warning)** | `orange-400` | `#FB923C` | 休息倒计时、接近目标 |
| **错误 (Error)** | `red-500` | `#EF4444` | 删除操作、失败反馈 |
| **待开始 (Pending)** | `indigo-400` | `#818CF8` | 预设动作、未开始状态 |

## 3. 中性色 (Neutral Colors)
用于背景、文字、边框和阴影，构建界面的骨架。

| 颜色名 | 类名 | 16进制值 | 用途描述 |
| :--- | :--- | :--- | :--- |
| **Text Primary** | `gray-900` | `#111827` | 主要标题、重要正文 |
| **Text Secondary**| `gray-500` | `#6B7280` | 次要描述、占位符 |
| **Text Muted** | `gray-400` | `#9CA3AF` | 极细微说明、单位标识 |
| **Border Light** | `gray-100` | `#F3F4F6` | 分隔线、浅色边框 |
| **Surface** | `white` | `#FFFFFF` | 卡片背景、页面底色 |
| **Background** | `star-white` | `#FAFAFA` | 应用全局背景 |

## 4. 管理后台专属色 (Admin Console)
管理后台采用深色系或特定的专业配色。

- **Background**: `#0f172a` (`admin-bg`)
- **Card**: `#1e293b` (`admin-card`)
- **Border**: `#334155` (`admin-border`)
- **Text**: `#f1f5f9` (`admin-text`)

## 5. 阴影规范 (Shadows)
- **Small (`shadow-sm`)**: 用于普通卡片。
- **Large (`shadow-lg`)**: 用于浮动按钮、当前激活卡片。
- **White Model (`white-model`)**: 微弱阴影，用于极致扁平化风格。
- **Color Shadow**: 如 `shadow-blue-200`，用于彩色按钮的深度感。

## 使用建议
- 避免在同一页面使用超过 3 种强调色。
- 文字与背景的对比度应符合 Web 可访问性标准 (WCAG)。
- 优先使用 Tailwind 的类名，以保持配置的统一性。
