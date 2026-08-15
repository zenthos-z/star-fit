# Starfit 动效视觉规范 v2.0

> 单一事实源：定义 Starfit 项目的所有动画设计决策

---

## 1. 设计原则

### 1.1 动效哲学

Starfit 的动效设计遵循「**灵动、即时、克制**」三大原则：

| 原则 | 描述 | 实现方式 |
|------|------|----------|
| **灵动** | 动画应赋予界面生命力，而非机械运动 | 使用弹簧物理，避免线性动画 |
| **即时** | 反馈必须在 100ms 内触达用户 | 微交互使用 150ms 以内时长 |
| **克制** | 动画是辅助，不是主角 | 同一屏幕不超过 3 个并行动画 |

### 1.2 无障碍优先

所有动画必须支持 `prefers-reduced-motion`：

```tsx
import { useReducedMotion } from 'framer-motion';

function AccessibleComponent() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={shouldReduceMotion ? {} : { scale: 1.1 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
    />
  );
}
```

---

## 2. 设计令牌

### 2.1 动画时长

| 令牌 | 值 | 用途 |
|------|-----|------|
| `instant` | 0ms | 禁用动画、减少运动模式 |
| `fast` | 150ms | 微交互、点击反馈 |
| `normal` | 200ms | 状态切换、悬停效果 |
| `slow` | 300ms | 模态框、页面过渡 |
| `slower` | 500ms | 复杂动画、强调效果 |

### 2.2 缓动函数

| 令牌 | 值 | 用途 |
|------|-----|------|
| `easeOut` | `[0, 0, 0.58, 1]` | 元素入场（自然减速） |
| `easeInOut` | `[0.4, 0, 0.2, 1]` | 状态切换（对称平滑） |
| `spring` | `stiffness: 300, damping: 25` | 通用弹簧效果 |
| `springGentle` | `stiffness: 200, damping: 20` | 柔和弹性（列表、卡片） |
| `springBouncy` | `stiffness: 400, damping: 15` | Q弹效果（按钮、强调） |
| `springStiff` | `stiffness: 400, damping: 38` | 全局覆盖层专用 |

### 2.3 缩放值

| 令牌 | 值 | 用途 |
|------|-----|------|
| `tap` | 0.92 | 点击反馈（8% 压缩） |
| `hover` | 1.08 | 悬停放大（8% 提升） |
| `press` | 0.96 | 轻按反馈（卡片） |

### 2.4 错开延迟

| 令牌 | 值 | 用途 |
|------|-----|------|
| `fast` | 30ms | 快速列表 |
| `normal` | 50ms | 标准列表 |
| `slow` | 80ms | 强调依次入场 |

---

## 3. 组件动画模式

### 3.1 按钮

#### 标准按钮

```tsx
import { motion } from 'framer-motion';
import { buttonPress } from '@/v2/lib/animations';

<motion.button
  {...buttonPress}
  className="h-16 px-6 bg-gray-900 text-white rounded-2xl"
>
  点击我
</motion.button>
```

**规范**：
- 悬停：`scale: 1.08`, `duration: 0.15s`
- 点击：`scale: 0.92`
- 最小高度：移动端 64px，桌面端 48px

#### AI 推荐按钮（带扫光）

```tsx
<motion.button className="relative overflow-hidden bg-star-dark">
  <motion.div
    variants={shimmer}
    initial="initial"
    animate="animate"
    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
  />
  <span>AI 推荐</span>
</motion.button>
```

### 3.2 卡片

```tsx
import { cardHover } from '@/v2/lib/animations';

<motion.div
  {...cardHover}
  className="rounded-3xl bg-white shadow-md"
>
  {/* 卡片内容 */}
</motion.div>
```

**规范**：
- 悬停上浮：`y: -6px`
- 阴影增强：`shadow-md` → `shadow-lg`
- 点击压缩：`scale: 0.96`

### 3.3 模态框

#### 标准模态框

```tsx
import { AnimatePresence } from 'framer-motion';
import { modalBackdrop, modalContent } from '@/v2/lib/animations';

<AnimatePresence>
  {isOpen && (
    <>
      <motion.div
        {...modalBackdrop}
        className="fixed inset-0 bg-black/50"
      />
      <motion.div
        {...modalContent}
        className="fixed inset-0 flex items-center justify-center"
      >
        <div className="bg-white rounded-[2.5rem] p-6">
          {/* 内容 */}
        </div>
      </motion.div>
    </>
  )}
</AnimatePresence>
```

#### 全局覆盖层（Q弹效果）

```tsx
import { modalContentBouncy } from '@/v2/lib/animations';

<motion.div
  {...modalContentBouncy}
  style={{ transformOrigin: 'bottom center' }}
  className="fixed inset-0 bg-star-dark"
>
  {/* 全屏内容 */}
</motion.div>
```

**规范**：
- 背景：`opacity 0→1`, `duration: 0.25s`
- 内容：`scale: 0.92→1` + `y: 20→0` + spring
- 退出：比进入快 50%

### 3.4 列表

#### 依次入场

```tsx
import { staggerContainer, staggerItem } from '@/v2/lib/animations';

<motion.div
  variants={staggerContainer}
  initial="initial"
  animate="animate"
>
  {items.map((item) => (
    <motion.div key={item.id} variants={staggerItem}>
      {item.content}
    </motion.div>
  ))}
</motion.div>
```

**规范**：
- 容器延迟：`delayChildren: 0.15s`
- 子项错开：`staggerChildren: 0.08s`
- 子项动画：`opacity + y + scale` + spring

### 3.5 页面过渡

#### 前进导航（从右滑入）

```tsx
import { pageSlideInRight } from '@/v2/lib/animations';

<motion.div
  variants={pageSlideInRight}
  initial="initial"
  animate="animate"
  exit="exit"
>
  {/* 页面内容 */}
</motion.div>
```

#### 返回导航（从左滑入）

```tsx
import { pageSlideInLeft } from '@/v2/lib/animations';
```

---

## 4. 微交互规范

### 4.1 点击反馈

所有可点击元素必须提供即时反馈：

| 元素类型 | 反馈方式 | 时长 |
|----------|----------|------|
| 按钮 | `scale: 0.92` | 150ms |
| 卡片 | `scale: 0.96` | 150ms |
| 列表项 | `scale: 0.98` + 背景色 | 150ms |
| 图标 | `scale: 0.9` | 100ms |

### 4.2 悬停状态

**仅在桌面端使用**（通过 `@media (hover: hover)` 检测）：

```css
@media (hover: hover) {
  .interactive:hover {
    transform: scale(1.08);
  }
}
```

### 4.3 加载状态

| 类型 | 动画 | 用途 |
|------|------|------|
| 骨架屏 | `pulse` | 内容加载中 |
| 按钮加载 | `spin` + 文字淡出 | 提交中 |
| 进度条 | 宽度过渡 | 上传/下载 |
| 智能推荐 | `shimmer` | AI 计算中 |

---

## 5. 性能优化

### 5.1 GPU 加速

仅动画以下属性（GPU 友好）：

```typescript
// ✅ 安全
const safeProperties = ['transform', 'opacity', 'filter'];

// ❌ 避免（触发重排）
const avoidProperties = ['width', 'height', 'top', 'left', 'margin', 'padding'];
```

### 5.2 will-change 使用

```tsx
// 动画前添加
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  style={{ willChange: 'opacity' }}
/>

// 动画后移除（通过 onAnimationComplete）
<motion.div
  animate={{ x: 100 }}
  onAnimationComplete={(definition) => {
    // 清理 will-change
  }}
/>
```

**规范**：
- 仅在即将动画的元素上使用
- 动画完成后立即移除
- 最多同时 3 个元素使用 will-change

### 5.3 减少重渲染

对于高频动画（如拖拽），绕过 React 渲染周期：

```tsx
import { useMotionValue, useTransform } from 'framer-motion';

function DraggableItem() {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-100, 100], [-10, 10]);

  return (
    <motion.div style={{ x, rotate }} drag="x">
      {/* 内容 */}
    </motion.div>
  );
}
```

---

## 6. 无障碍规范

### 6.1 减少动画偏好

```tsx
import { useReducedMotion } from 'framer-motion';

function Component() {
  const shouldReduceMotion = useReducedMotion();

  const variants = shouldReduceMotion
    ? { animate: { opacity: 1 }, transition: { duration: 0 } }
    : { animate: { opacity: 1, scale: 1.1 }, transition: { duration: 0.2 } };

  return <motion.div {...variants} />;
}
```

### 6.2 焦点管理

模态框打开时必须：
1. 将焦点移至模态框内第一个可交互元素
2. 限制焦点在模态框内循环
3. 关闭时恢复焦点到触发元素

```tsx
import { useFocusTrap } from '@/v2/hooks/useFocusTrap';

function Modal({ isOpen, onClose }) {
  const ref = useFocusTrap(isOpen);

  return (
    <motion.div ref={ref} role="dialog" aria-modal="true">
      {/* 内容 */}
    </motion.div>
  );
}
```

### 6.3 屏幕阅读器

动画元素添加适当的 ARIA 属性：

```tsx
<motion.div
  animate={{ height: isExpanded ? 'auto' : 0 }}
  aria-expanded={isExpanded}
  aria-live="polite"
>
  {/* 可展开内容 */}
</motion.div>
```

---

## 7. 特殊效果

### 7.1 3D 翻转文字

```tsx
import { flipText } from '@/v2/lib/animations';

// 单字符翻转
<motion.span
  variants={flipText}
  initial="initial"
  animate="animate"
  exit="exit"
  style={{ display: 'inline-block', perspective: 1000 }}
>
  {char}
</motion.span>
```

**规范**：
- 单字符时长：`0.15s`
- 字符间延迟：`0.03s`
- 切换间隔：`2s`

### 7.2 弹性拉伸

用于下拉刷新、过度滚动：

```tsx
import { useSpring, useTransform } from 'framer-motion';

function ElasticPull({ scrollY }) {
  const y = useTransform(scrollY, [0, 100], [0, 20]);
  const scaleY = useTransform(scrollY, [0, 100], [1, 1.08]);
  const springY = useSpring(y, { stiffness: 200, damping: 25 });

  return <motion.div style={{ y: springY, scaleY }} />;
}
```

### 7.3 弧形拖拽排序

详见 [animation-interaction-system.md](./animation-interaction-system.md) 第 11 节。

---

## 8. 代码规范

### 8.1 导入顺序

```tsx
// 1. React
import { useState } from 'react';

// 2. 第三方库
import { motion, AnimatePresence } from 'framer-motion';

// 3. 动画预设
import { fadeIn, buttonPress } from '@/v2/lib/animations';

// 4. 组件
import { Button } from '@/v2/components/ui/Button';
```

### 8.2 变体命名

```tsx
// ✅ 推荐
const containerVariants = { ... };
const itemVariants = { ... };

// ❌ 避免
const variants = { ... };
const animation = { ... };
```

### 8.3 内联 vs 预设

```tsx
// ✅ 使用预设（可复用、一致）
<motion.div {...fadeIn} />

// ✅ 简单内联（一次性使用）
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
/>

// ❌ 复杂内联（难以维护）
<motion.div
  initial={{ opacity: 0, scale: 0.95, y: 20, rotate: -5 }}
  animate={{
    opacity: 1,
    scale: 1,
    y: 0,
    rotate: 0,
    transition: { type: 'spring', stiffness: 300, damping: 25 }
  }}
/>
```

---

## 9. 检查清单

### 实现前检查

- [ ] 是否使用了正确的动画预设？
- [ ] 时长是否在规范范围内？
- [ ] 是否考虑了 `prefers-reduced-motion`？

### 实现后检查

- [ ] 动画是否 60fps 流畅？
- [ ] 是否在低端设备上测试？
- [ ] 焦点管理是否正确？
- [ ] 屏幕阅读器是否正常工作？

---

## 10. 相关文档

- [animation-interaction-system.md](./animation-interaction-system.md) - 交互系统详细规范
- [design-tokens.ts](../../src/v2/lib/design-tokens.ts) - 设计令牌源码
- [animations/index.ts](../../src/v2/lib/animations/index.ts) - 动画预设源码
