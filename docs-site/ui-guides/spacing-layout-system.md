# UI 空间与布局规范

本指南定义了 Starfit 项目中的空间间距、容器布局和圆角规范，确保界面在各种屏幕尺寸下都能保持呼吸感和结构化。

## 1. 间距系统 (Spacing Scale)
我们基于 4px (0.25rem) 基准系统，所有的间距、内边距、外边距都应是 4 的倍数。

| 级别 | Tailwind 类名 | 像素值 | 用途示例 |
| :--- | :--- | :--- | :--- |
| **XS** | `1` / `1.5` | `4px / 6px` | 极小的图标间距、微调 |
| **SM** | `2` / `3` | `8px / 12px` | 标签内边距、小元素间距 |
| **MD** | `4` / `5` | `16px / 20px` | 默认内边距、普通间距 |
| **LG** | `6` / `8` | `24px / 32px` | 卡片内边距、主要模块间距 |
| **XL** | `10` / `12` | `40px / 48px` | 页面大区隔 |

### 间距比例预览
<div style="display: flex; align-items: flex-end; gap: 1rem; margin-top: 1rem;">
  <div style="width: 16px; height: 16px; background: #3B82F6; border-radius: 2px;" title="16px"></div>
  <div style="width: 24px; height: 24px; background: #3B82F6; border-radius: 2px;" title="24px"></div>
  <div style="width: 32px; height: 32px; background: #3B82F6; border-radius: 2px;" title="32px"></div>
  <div style="width: 48px; height: 48px; background: #3B82F6; border-radius: 2px;" title="48px"></div>
</div>

## 2. 容器布局 (Containers & Grid)
- **页面边距**: 移动端标准页面边距为 `p-4` 或 `p-6`。
- **卡片布局**: 动作卡片统一使用 `bg-white` + `rounded-3xl` + `p-6`。
- **Flex 布局**: 优先使用 `flex` + `gap-{n}` 替代 `margin`，使组件更具可重用性。
- **Grid 布局**: 对于复杂的列表对齐（如力量训练的组数列表），使用 `grid` 配合固定的列宽，如 `grid-cols-[48px_1fr_1fr_80px_48px]`。

## 3. 圆角规范 (Border Radius)
圆角是 Starfit 视觉语言中表达“动感”与“友好”的关键。

- **Large (`rounded-3xl`)**: 用于主要的动作卡片容器。
- **Medium (`rounded-2xl`)**: 用于内部组件（如训练组容器、操作按钮）。
- **Small (`rounded-xl` / `rounded-lg`)**: 用于输入框、次要标签。
- **Full (`rounded-full`)**: 用于进度条末端、圆形按钮、头像。

## 4. 刘海屏与动态岛适配 (Safe Area)

现代移动设备存在刘海屏（Notch）和动态岛（Dynamic Island），必须在全屏组件顶部留出安全区域，避免内容被遮挡。

### 4.1 安全区域规范

| 场景 | 处理方式 | 代码示例 |
| :--- | :--- | :--- |
| **全屏覆盖面板** | 顶部添加 safe-area-inset-top 占位 | `<div style="padding-top: env(safe-area-inset-top)" />` |
| **固定顶部导航** | padding-top 叠加 safe-area | `pt-[env(safe-area-inset-top)]` 或使用 spacer 元素 |
| **底部操作区** | 底部留出安全区域 | `pb-[env(safe-area-inset-bottom)]` |

### 4.2 实现示例

**全屏面板（如历史记录面板）：**
```tsx
<motion.div className="fixed inset-0 z-[70] bg-white flex flex-col">
  {/* Safe Area Spacer for Notch/Dynamic Island */}
  <div className="flex-shrink-0 w-full" style={{ paddingTop: 'env(safe-area-inset-top)' }} />

  {/* Header 内容 */}
  <div className="flex-shrink-0 h-16 px-4 flex items-center justify-between">
    {/* ... */}
  </div>

  {/* 内容区域 */}
  <div className="flex-1 overflow-y-auto">
    {/* ... */}
  </div>
</motion.div>
```

### 4.3 设计原则

1. **必须留出空间**: 所有全屏覆盖组件（侧边栏、底部弹出面板）都必须在顶部添加安全区域 spacer
2. **使用 flex-shrink-0**: 确保 spacer 不会被压缩
3. **视觉连续**: 安全区域背景色应与面板背景色一致，保持视觉连续性
4. **避免固定高度**: 不要为顶部区域设置固定高度，让 `env(safe-area-inset-top)` 自动适配不同设备

## 5. 响应式与对齐
- **安全区域**: 考虑到移动端的刘海屏和底部手势条，必须在容器上使用 `viewport-fit=cover`。
- **居中逻辑**: 大数字和单位的对齐应基于 `baseline` 而不是 `center`，以符合视觉审美。
- **最大宽度**: 在桌面端或管理后台，内容区通常限制在 `max-w-7xl` 或固定宽度。

## 布局示例
```tsx
<div className="p-6 bg-white rounded-3xl shadow-sm border border-gray-50">
  <div className="flex items-center gap-3 mb-6">
    <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
    <h3 className="text-xl font-black">跑步</h3>
  </div>
  
  <div className="space-y-4">
    {/* 列表项 */}
    <div className="flex items-center justify-between p-4 rounded-2xl bg-gray-50">
      {/* 内容 */}
    </div>
  </div>
</div>
```
