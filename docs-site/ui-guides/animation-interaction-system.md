# UI 动效与交互规范

本指南定义了 Starfit 项目中的动画节奏、交互反馈和手势逻辑，旨在创造一个灵动、流畅且具有即时反馈的运动体验。

## 0. 动画预设库（Framer Motion）

### 导入方式

```typescript
import { buttonPress, cardHover, modalContent, tapScale } from '@/v2/lib/animations';
import { motion } from 'framer-motion';
```

### 可用预设

| 预设名 | 用途 | 效果 |
|--------|------|------|
| `buttonPress` | 按钮交互 | hover: scale(1.05), tap: scale(0.95) |
| `cardHover` | 卡片悬停 | hover: y(-4px) + shadow, tap: scale(0.97) |
| `tapScale` | 点击反馈 | tap: scale(0.95) |
| `modalContent` | 模态框内容 | scale(0.95→1) + y(10→0) + spring |
| `modalBackdrop` | 模态框背景 | opacity(0→1) |
| `fadeIn` | 淡入淡出 | opacity(0→1) |
| `fadeScale` | 缩放淡入 | opacity + scale 组合 |
| `slideUp` | 上滑入场 | y(20→0) + opacity |
| `slideDown` | 下滑入场 | y(-20→0) + opacity |
| `staggerContainer` | 依次入场容器 | 配合 staggerItem 使用 |
| `staggerItem` | 依次入场项 | 配合 staggerContainer 使用 |

### 使用示例

#### 按钮交互
```tsx
import { motion } from 'framer-motion';
import { buttonPress } from '@/v2/lib/animations';

<motion.button {...buttonPress}>
  点击我
</motion.button>
```

#### 模态框动画
```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { modalBackdrop, modalContent } from '@/v2/lib/animations';

<AnimatePresence>
  {isOpen && (
    <>
      <motion.div {...modalBackdrop} className="fixed inset-0 bg-black/50" />
      <motion.div {...modalContent} className="fixed inset-0 flex items-center justify-center">
        {/* 模态框内容 */}
      </motion.div>
    </>
  )}
</AnimatePresence>
```

#### 依次入场效果
```tsx
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/v2/lib/animations';

<motion.div
  variants={staggerContainer.variants}
  initial="initial"
  animate="animate"
>
  <motion.div variants={staggerItem}>第一项</motion.div>
  <motion.div variants={staggerItem}>第二项</motion.div>
  <motion.div variants={staggerItem}>第三项</motion.div>
</motion.div>
```

### 迁移指南

从 Tailwind CSS 动画迁移到 Motion 预设：

| 原 Tailwind 类 | Motion 预设 |
|----------------|-------------|
| `hover:scale-105 active:scale-95` | `buttonPress` |
| `active:scale-95` | `tapScale` |
| `animate-in fade-in` | `fadeIn` |
| `animate-in slide-in-from-bottom` | `slideUp` |
| `animate-in zoom-in-95` | `fadeScale` |

### 动画参数配置

| 参数 | 值 | 说明 |
|------|-----|------|
| **点击缩放** | 0.95 (5%) | 快速反馈，不明显 |
| **悬停缩放** | 1.05 (5%) | 微妙的提升感 |
| **过渡时长** | 150-300ms | fast/normal/slow 三档 |
| **缓动函数** | easeOut | 自然减速 |
| **弹簧参数** | stiffness: 200, damping: 20 | 柔和弹性 |

## 1. 动画节奏 (Timing & Easing)
- **Duration**:
  - `duration-150`: 快速反馈（如按钮点击缩放）。
  - `duration-300`: 普通状态切换（如列表项展开）。
  - `duration-1000`: 进度条缓慢增长。
- **Easing**: 默认使用 `ease-in-out`，对于进入页面的元素建议使用 `cubic-bezier(0.4, 0, 0.2, 1)`。

### 动效示例预览
<div style="display: flex; gap: 2rem; margin: 1.5rem 0;">
  <div class="pulse-demo" style="width: 40px; height: 40px; background: #F43F5E; border-radius: 0.75rem;"></div>
  <div class="bounce-demo" style="width: 40px; height: 40px; background: #3B82F6; border-radius: 9999px;"></div>
</div>

<style>
@keyframes pulse-custom { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.pulse-demo { animation: pulse-custom 2s infinite; }
@keyframes bounce-custom { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.bounce-demo { animation: bounce-custom 1s infinite; }
</style>

## 2. 交互状态反馈
- **点击缩放 (`active:scale-95`)**: 所有的可点击按钮在按下时都应有微小的缩小反馈。
- **悬停状态 (`hover:`)**: 仅在非触摸设备（管理后台）使用。
- **加载状态**: 
  - `animate-pulse`: 用于骨架屏或当前激活的运动项。
  - `animate-bounce`: 用于心率等实时变动的数据提示。

## 3. 核心交互模式
- **影子计算同步**: 所有的交互（如点击完成组）应立即反映在 UI 上（Optimistic UI），然后再通过 Web Worker 或同步服务持久化。
- **滑动手势**: 避免与系统手势（如边缘侧滑返回）冲突。左滑通常用于“删除”或“撤销”。
- **长按操作**: 谨慎使用，通常用于高级编辑或排序。

## 4. 运动特有动效
- **呼吸灯效果**: 正在进行的运动卡片边框 or 进度条应有轻微的呼吸感（`animate-pulse`），提示用户当前正在计时。
- **完成反馈**: 当一个大项完成时，建议使用缩放动画或粒子效果（未来扩展）来提供成就感。

## 5. 交互防抖与限流
- **对于高频点击的“加减”按钮**，必须在代码逻辑中实现防抖，防止数据同步冲突。
- **所有的敏感操作（如删除整个计划）**必须有二次确认弹窗。

## 6. 交互按钮设计原则 (Button Design)

为了确保用户在运动过程中（可能伴随流汗、喘气或大幅度动作）能准确、快速地进行操作，交互按钮遵循以下原则：

- **简约优先 (Minimalism)**:
  - 核心操作栏（如有氧运动控制条）严禁超过 3 个按钮。
  - 优先使用双按钮布局（[暂停/继续] + [完成]），覆盖 90% 以上的使用场景。
  - 低频操作（如重置、高级设置）应通过侧滑菜单、长按或二级菜单隐藏，保持主界面的视觉纯净。
- **右手习惯优化 (Right-hand Friendliness)**:
  - 最频繁或最具“运行控制”性质的按钮（如“开始/暂停/继续”）必须放置在屏幕右侧，且占据更大的点击面积（建议比例 2:1），方便右手大拇指在运动中盲操。
  - “完成”或“结束”等终结性按钮放置在左侧，并采用较小的面积，以防运动中的误触导致数据意外保存。
- **盲操友好 (Blind Operation)**:
  - 按钮高度建议不低于 `h-16` (64px)，增加点击热区。
  - 关键按钮使用高对比度颜色（如背景色 `bg-gray-900` 或深色描边），在运动状态下即便视线模糊也能通过颜色识别。
- **视觉去冗余**:
  - 避免在主操作路径上添加额外的状态标签（如 RPE 提示），除非该数据是即时决策所必须的。
  - 在有氧运动等高强度场景下，应在醒目位置显示“目标心率区间”，帮助用户维持运动强度。

### 控制栏设计示例
```tsx
// 推荐的 1:2.5 状态驱动布局
// 右侧为核心手柄（开始/暂停/继续），左侧为状态终结（结束/完成）
<div className="grid grid-cols-[1fr_2.5fr] gap-4 h-16">
  {/* 左侧：仅在运动开始后显示，根据运行状态切换 [结束] 或 [完成] */}
  <button className="bg-white border-2 border-emerald-100 text-emerald-600 rounded-2xl">
    {isRunning ? '结束' : '完成'}
  </button>
  
  {/* 右侧：主控制手柄，占据 2.5 倍面积 */}
  <button className="bg-gray-900 text-white rounded-2xl shadow-lg">
    {isRunning ? '暂停' : (hasStarted ? '继续' : '开始')}
  </button>
</div>
```

## 7. AI 建议应用按钮 (AI Suggestion CTA)

AI 推荐按钮作为“智能辅助”的核心触点，设计上需要兼顾“辅助感”与“确定感”：

- **视觉吸引**: 
  - 使用深色背景 (`bg-star-dark` 或 `bg-blue-600`) 配合白色文字，使其在浅色卡片中脱颖而出。
  - 引入 **Shimmer (扫光)** 动效：当鼠标悬停或按钮显示时，微弱的光效划过按钮，暗示其“智能/活跃”的状态。
- **微交互**:
  - **图标动效**: 悬停时右侧/下方的箭头图标应有微小的位移 (`group-hover:translate-y-0.5`)，强化点击后的数据流向感（应用到下方列表中）。
  - **点击反馈**: 使用较明显的缩放反馈 (`active:scale-90`)，提供扎实的物理点击手感。
- **状态同步**: 当 AI 正在计算时，按钮应进入 `disabled` 状态并配合文字 `animate-pulse` 效果，防止重复触发且明确告知用户系统正在运行。

## 8. 全局覆盖层动画 (Global Overlay Transitions)

为了保持应用界面的统一感，所有的全屏覆盖层（如历史记录、AI 教练、添加动作页面）必须遵循一致的进出场动画：

- **动画容器**: 必须使用 `AnimatePresence` 进行包裹，确保退出动画能正常执行。
- **核心参数**:
  - `initial/exit`: `{ opacity: 0, scale: 0, borderRadius: '40px' }`
  - `animate`: `{ opacity: 1, scale: 1, borderRadius: '0px' }`
- **弹簧配置 (Spring)**: 严禁使用线性动画，必须采用以下物理参数以获得“Q弹”手感：
  - `stiffness`: 400
  - `damping`: 38
  - `mass`: 1
- **动态原点**: 动画的 `transformOrigin` 应指向触发该页面的按钮中心点（如屏幕底部中心），实现“由点及面”的扩张感。

## 9. 交互文字翻转动效 (Text Flip Animation)

在主界面核心按钮（如 START）的状态轮播中，为了消除传统滑动的拖沓感，采用字符级翻转动效：

- **翻转轴**: `rotateX` 轴翻转。
- **性能指标**:
  - `duration`: 0.15s (单字符翻转耗时)。
  - `stagger`: 0.03s (字符间进入延迟)。
  - `interval`: 2s (状态切换停顿时间)。
- **视觉增强**: 必须设置 `perspective: 1000px` 以确保 3D 翻转的透视效果真实。

### 代码参考 (Framer Motion)
```tsx
<motion.span
  initial={{ rotateX: -90, opacity: 0 }}
  animate={{ rotateX: 0, opacity: 1 }}
  exit={{ rotateX: 90, opacity: 0 }}
  transition={{ duration: 0.15, delay: i * 0.03 }}
  className="origin-center"
>
  {char}
</motion.span>
```

## 10. 滚动反馈与弹性拉伸 (Scroll Bounce & Elastic Stretch)

为了提升应用的物理质感，主界面滚动区域采用了模拟真实物理特性的反馈机制：

- **原生回弹 (Native Bounce)**: 
  - 全局启用 `overscroll-behavior-y: auto`。
  - 在 iOS 上确保 `-webkit-overflow-scrolling: touch` 以获得流畅的原生橡皮筋效果。
  - **规避规则**：主滚动容器严禁设置 `overflow-hidden`，否则会截断弹性溢出区域。
- **弹性拉伸 (Elastic Band Effect)**:
  - **实现方案**：使用 Framer Motion 的 `useSpring` 和 `useTransform` 监听垂直过度滚动。
  - **弹力参数**:
    - `stiffness`: 200 (提供扎实的拉力感)。
    - `damping`: 25 (确保回弹过程无多余震荡)。
  - **变换逻辑**:
    - **位移 (Translate)**: 实际拖拽位移的 20% (`deltaY * 0.2`)。
    - **缩放 (Scale)**: 垂直方向产生微小拉伸 (`scaleY` 1.0 -> 1.08)。
    - **动态原点**: 根据拉动方向动态切换 `transformOrigin`（顶部下拉为 `top`，底部上拉为 `bottom`）。

## 11. 弧形拖拽排序交互 (Arc Reorder Menu)

专为单手操作设计的沉浸式列表重排序方案，解决了传统垂直列表在移动端拖拽距离过长、遮挡视线的问题。

### 核心设计理念
- **单手拇指热区 (Thumb Zone Friendly)**: 
  - 交互区域固定在屏幕右侧中部（拇指自然触达区）。
  - 通过“相对位移”而非“绝对跟随”来驱动排序，拇指无需大幅度移动即可遍历长列表。
- **太阳光束隐喻 (Sun Rays)**:
  - 列表项呈扇形展开，文字方向从右侧圆心向外发散（`rotate: -angle`），模拟光束射出效果，确保文字始终垂直于视线切线，提升阅读舒适度。
- **隐形大圆逻辑 (Off-screen Large Circle)**:
  - **问题**: 小半径圆弧会导致项之间夹角过大，且手指遮挡严重。
  - **解法**: 采用极大的圆弧半径 (R=260px)，并将圆心移至屏幕右侧外 (-160px)。这创造了一个平缓的“伪直线”弧度，既保留了旋转的物理感，又避免了剧烈的视觉畸变。

### 性能与实现细节
- **全局事件总线 (Global Event Bus)**:
  - **痛点**: 传统的 React State 驱动拖拽会导致 `App` 根组件高频重渲染，造成卡顿。
  - **优化**: 使用 `CustomEvent` (`reorder-drag-move`) 直接通信。`ReorderMode` 组件内部监听原生 DOM 事件更新 `useMotionValue`，完全绕过 React Render Cycle，实现 60fps 流畅跟手。
- **相对拖拽映射 (Relative Drag Mapping)**:
  - **逻辑**: 不再将手指的 Y 轴绝对坐标映射到列表 Index。
  - **算法**: 记录拖拽起始点 `startY`，计算 `deltaY`。每移动 `40px` (SENSITIVITY) 触发一次 Index 变更。这使得用户只需在 200px 范围内滑动手指，即可控制整个长列表的排序，极大幅度降低操作疲劳。
- **幽灵插槽 (Phantom Slot)**:
  - 拖拽中的原始卡片在圆盘上自动隐藏（过滤），避免视觉上的双重显示，保持界面清爽。
- **视觉引导**:
  - 背景添加 SVG 虚线圆弧引导线，暗示运动轨迹。
  - 插入点上下增加 `GAP_ANGLE_OFFSET` (12deg)，明确提示当前释放的位置。

### 代码参考 (配置参数)
```tsx
// 专为单手操作优化的大圆弧参数
const ARC_RADIUS = 260; // 极大半径，创造平缓弧度
const ITEM_ANGLE = 15;  // 较小的单项夹角，容纳更多可见项
const GAP_ANGLE_OFFSET = 12; // 插入缺口的角度补偿
const CONTAINER_OFFSET_RIGHT = -160; // 圆心移出屏幕，形成右侧切弧
```
