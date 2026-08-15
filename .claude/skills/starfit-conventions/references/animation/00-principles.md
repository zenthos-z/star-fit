# 动画设计原则与令牌

---

## 设计原则

| 原则 | 描述 | 实现方式 |
|------|------|----------|
| **灵动** | 赋予界面生命力 | 使用弹簧物理，避免线性动画 |
| **即时** | 100ms 内反馈 | 微交互使用 150ms 以内 |
| **克制** | 动画是辅助不是主角 | 同屏不超过 3 个并行动画 |

---

## 动画时长 (Duration)

| 令牌 | 值 | 用途 |
|------|-----|------|
| `instant` | 0ms | 禁用动画、减少运动模式 |
| `fast` | 150ms | 微交互、点击反馈 |
| `normal` | 200ms | 状态切换、悬停效果 |
| `slow` | 300ms | 模态框、页面过渡 |
| `slower` | 500ms | 复杂动画、强调效果 |

---

## 缓动函数 (Easing)

| 令牌 | 值 | 用途 |
|------|-----|------|
| `easeOut` | `[0, 0, 0.58, 1]` | 元素入场（自然减速） |
| `easeInOut` | `[0.4, 0, 0.2, 1]` | 状态切换（对称平滑） |
| `spring` | `stiffness: 300, damping: 25` | 通用弹簧效果 |
| `springGentle` | `stiffness: 200, damping: 20` | 柔和弹性（列表、卡片） |
| `springBouncy` | `stiffness: 400, damping: 15` | Q弹效果（按钮、强调） |
| `springStiff` | `stiffness: 400, damping: 38` | 全局覆盖层专用 |

---

## 缩放值 (Scale)

| 令牌 | 值 | 用途 |
|------|-----|------|
| `tap` | 0.92 | 点击反馈（8% 压缩） |
| `hover` | 1.08 | 悬停放大（8% 提升） |
| `press` | 0.96 | 轻按反馈（卡片） |
| `subtle` | 0.98 | 微小压缩 |

---

## 错开延迟 (Stagger)

| 令牌 | 值 | 用途 |
|------|-----|------|
| `fast` | 30ms | 快速列表 |
| `normal` | 50ms | 标准列表 |
| `slow` | 80ms | 强调依次入场 |

---

## 无障碍支持

### 减少动画偏好

```tsx
import { useReducedMotion } from 'framer-motion';

function Component() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={shouldReduceMotion ? {} : { scale: 1.1 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
    />
  );
}
```

### 焦点管理

模态框打开时：
1. 将焦点移至模态框内第一个可交互元素
2. 限制焦点在模态框内循环
3. 关闭时恢复焦点到触发元素

---

## 性能优化

### GPU 加速属性

仅动画以下属性（GPU 友好）：

```typescript
// ✅ 安全
const safeProperties = ['transform', 'opacity', 'filter'];

// ❌ 避免（触发重排）
const avoidProperties = ['width', 'height', 'top', 'left'];
```

### will-change 使用

```tsx
// 动画前添加
<motion.div
  style={{ willChange: 'opacity' }}
  animate={{ opacity: 1 }}
/>

// 动画后移除
<motion.div
  animate={{ opacity: 1 }}
  onAnimationComplete={() => {
    // 清理 will-change
  }}
/>
```

**规范**：
- 仅在即将动画的元素上使用
- 动画完成后立即移除
- 最多同时 3 个元素使用

---

## 全局覆盖层动画

所有全屏覆盖层必须遵循一致的进出场动画：

### 核心参数

```tsx
const overlayVariants = {
  initial: { opacity: 0, scale: 0, borderRadius: '40px' },
  animate: { opacity: 1, scale: 1, borderRadius: '0px' },
  exit: { opacity: 0, scale: 0, borderRadius: '40px' }
};

const transition = {
  type: 'spring',
  stiffness: 400,
  damping: 38
};
```

### 动态原点

动画的 `transformOrigin` 应指向触发按钮的中心点：

```tsx
style={{ transformOrigin: 'bottom center' }}
```

---

**完整规范**: 见 `docs-site\ui-guides\motion-design-system.md`
