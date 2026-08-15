# Framer Motion 预设库

---

## 导入方式

```tsx
import { buttonPress, cardHover, modalContent, fadeIn } from '@/v2/lib/animations';
import { motion, AnimatePresence } from 'framer-motion';
```

---

## 可用预设

| 预设名 | 用途 | 效果 |
|--------|------|------|
| `buttonPress` | 按钮交互 | hover: scale(1.08), tap: scale(0.92) |
| `cardHover` | 卡片悬停 | hover: y(-4px) + shadow, tap: scale(0.96) |
| `tapScale` | 点击反馈 | tap: scale(0.95) |
| `modalContent` | 模态框内容 | scale(0.95→1) + y(10→0) + spring |
| `modalBackdrop` | 模态框背景 | opacity(0→1) |
| `fadeIn` | 淡入淡出 | opacity(0→1) |
| `fadeScale` | 缩放淡入 | opacity + scale 组合 |
| `slideUp` | 上滑入场 | y(20→0) + opacity |
| `slideDown` | 下滑入场 | y(-20→0) + opacity |
| `staggerContainer` | 依次入场容器 | 配合 staggerItem 使用 |
| `staggerItem` | 依次入场项 | 配合 staggerContainer 使用 |

---

## 使用示例

### 按钮交互

```tsx
<motion.button {...buttonPress} className="h-16 px-6 bg-gray-900 rounded-2xl">
  点击我
</motion.button>
```

### 卡片悬停

```tsx
<motion.div
  {...cardHover}
  className="bg-white rounded-2xl p-6 shadow-md"
>
  卡片内容
</motion.div>
```

### 模态框动画

```tsx
<AnimatePresence>
  {isOpen && (
    <>
      <motion.div {...modalBackdrop} className="fixed inset-0 bg-black/50" />
      <motion.div {...modalContent} className="fixed inset-0 flex items-center justify-center">
        <div className="bg-white rounded-[2.5rem] p-6">
          模态框内容
        </div>
      </motion.div>
    </>
  )}
</AnimatePresence>
```

### 依次入场效果

```tsx
<motion.div
  variants={staggerContainer.variants}
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

---

## 动画参数配置

| 参数 | 值 | 说明 |
|------|-----|------|
| **点击缩放** | 0.92 (8%) | 快速反馈，不明显 |
| **悬停缩放** | 1.08 (8%) | 微妙的提升感 |
| **过渡时长** | 150-300ms | fast/normal/slow 三档 |
| **缓动函数** | easeOut | 自然减速 |
| **弹簧参数** | stiffness: 200, damping: 20 | 柔和弹性 |

---

## 迁移指南

从 Tailwind CSS 动画迁移到 Motion 预设：

| 原 Tailwind 类 | Motion 预设 |
|----------------|-------------|
| `hover:scale-105 active:scale-95` | `buttonPress` |
| `active:scale-95` | `tapScale` |
| `animate-in fade-in` | `fadeIn` |
| `animate-in slide-in-from-bottom` | `slideUp` |
| `animate-in zoom-in-95` | `fadeScale` |

---

## 内联 vs 预设

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
  initial={{ opacity: 0, scale: 0.95, y: 20 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
/>
```

---

**完整规范**: 见 `docs-site\ui-guides\animation-interaction-system.md`
