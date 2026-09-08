# Starfit iOS 设计规范（iOS 26 Liquid Glass / HIG 对齐）

> 2026-09-08 制定。新页面、新组件一律遵循本规范；改造旧界面时顺手迁移。

## 1. 页面骨架

| 元素 | 规范 |
|------|------|
| 顶层页面标题 | iOS Large Title 形态：内容区 34px/font-black，滚动 >30px 后折叠，导航栏 17px/font-semibold 居中小标题淡入（参照 `components/History.tsx`） |
| tab 页 | 无「×」关闭按钮（关闭语义专属模态）；页级功能收进右上角「···」菜单 |
| sheet 头部 | 三段式：左取消 / 中标题 / 右圆✓（见 `references/ios-sheet-modal-styling.md`） |
| 安全区 | 顶部 `var(--safe-top)`，底部为 tab bar 预留 `pb-20` 起步；sheet 底部 `calc(16px + var(--safe-bottom, 0px))` |

## 2. Sheet / 弹层

- **顶部圆角统一 `rounded-t-[40px]`**（≈62pt squircle 的 CSS 近似，用户拍板 2026-09-08）。禁止 2xl/2rem/2.5rem/14px 混用。
- sheet 打开即**盖住 tab bar**（`setTabBarHidden(true)`，关闭恢复），不做变暗共存。
- 确认对话框 = iOS Alert 窄卡纵向蓝字（DeviationWarningModal 为样板）。

## 3. 页面切换动效（全局统一）

| 场景 | 动效 | 实现 |
|------|------|------|
| tab 页签切换 | 无转场直切 + 内容 150ms 淡入 | `transition={{ duration: 0.15, ease: 'easeOut' }}`，仅 opacity |
| push 级页面（历史详情/设置） | 右滑入 300ms easeOut（原生 push 感） | `initial={{ x: '100%' }} → animate={{ x: 0 }}`，tween 0.3 easeOut |
| sheet 弹出 | 底部上滑 + 背景暗化 | `slide-in-from-bottom` 或 framer-motion y: '100%' → 0，spring |
| 菜单/popover | 18ms 缩放淡入，锚点在按钮 | `initial={{ opacity: 0, y: -8, scale: 0.96 }}`，0.18 easeOut |
| AI 对话 | 全屏 sheet 上滑；**禁止半透明中间态** | 打开/关闭都是完整状态切换 |

新页面按上表对号入座；不属于以上四类的转场先在此表登记再实现。

## 4. 触感反馈（iOS 原生，`src/lib/nativeHaptics.ts`）

| 场景 | 样式 |
|------|------|
| 菜单/次级按钮/卡片点按 | `haptic('light')` |
| 主操作（开始训练、发送消息、导入确认） | `haptic('medium')` |
| 拖拽落位/重型操作 | `haptic('heavy')` |
| 任务结果（导入成功/校验失败） | `haptic('success' | 'warning' | 'error')` |
| tab 切换 | 系统自带，勿重复添加 |

Web/Android 静默降级；勿用 `navigator.vibrate`（新代码禁止）。

## 5. 排版与颜色

- 字体栈：`-apple-system` 系统 SF Pro（index.html 已配），勿引入外部字体。
- 单位排版：数值 font-mono 粗体，单位用小号同色系文字（`text-[10px] text-gray-400`），非下标/斜体。
- 页面底色 `#F3F3F3` 统一淡灰（原生玻璃三明治兼容），卡片纯白 rounded-2xl。
- 中文界面禁用开发黑话占位符（如「iMessage 风格输入」→「给教练发消息」）。

## 6. 可访问性底线

- 所有可点元素必须有 `aria-label`；图标按钮必带。
- 列表项 `role="button"`，菜单 `role="menu"` / `menuitem`，状态提示 `role="status"`。
- 装饰性 SVG `aria-hidden="true"`。
