# 特殊效果规范

---

## 3D 翻转文字

用于主界面核心按钮（如 START）的状态轮播：

### 规范

- **翻转轴**: `rotateX`
- **单字符时长**: 0.15s
- **字符间延迟**: 0.03s
- **切换间隔**: 2s
- **透视**: 1000px

### 代码示例

```tsx
<motion.span
  initial={{ rotateX: -90, opacity: 0 }}
  animate={{ rotateX: 0, opacity: 1 }}
  exit={{ rotateX: 90, opacity: 0 }}
  transition={{ duration: 0.15, delay: i * 0.03 }}
  style={{ display: 'inline-block', perspective: 1000 }}
>
  {char}
</motion.span>
```

---

## 弹性拉伸 (Elastic Stretch)

用于下拉刷新、过度滚动：

### 弹力参数

- `stiffness`: 200 (扎实的拉力感)
- `damping`: 25 (无多余震荡)

### 变换逻辑

- **位移**: 实际拖拽的 20% (`deltaY * 0.2`)
- **缩放**: 垂直方向 1.0 → 1.08
- **动态原点**: 顶部下拉 `top`，底部上拉 `bottom`

### 代码示例

```tsx
import { useSpring, useTransform } from 'framer-motion';

function ElasticPull({ scrollY }) {
  const y = useTransform(scrollY, [0, 100], [0, 20]);
  const scaleY = useTransform(scrollY, [0, 100], [1, 1.08]);
  const springY = useSpring(y, { stiffness: 200, damping: 25 });

  return (
    <motion.div
      style={{ y: springY, scaleY, transformOrigin: 'top' }}
    />
  );
}
```

---

## 弧形拖拽排序

专为单手操作设计的沉浸式列表重排序方案：

### 核心参数

```tsx
const ARC_RADIUS = 260;      // 极大半径
const ITEM_ANGLE = 15;        // 单项夹角
const GAP_ANGLE_OFFSET = 12;  // 插入缺口
const CONTAINER_OFFSET_RIGHT = -160;  // 圆心右移
```

### 性能优化

使用 `CustomEvent` 绕过 React 渲染周期：

```tsx
// 监听原生 DOM 事件
useEffect(() => {
  const handler = (e) => {
    const { deltaY } = e.detail;
    y.set(deltaY * 0.2);
  };
  window.addEventListener('reorder-drag-move', handler);
  return () => window.removeEventListener('reorder-drag-move', handler);
}, []);
```

---

## 运动特有动效

### 呼吸灯效果

正在进行的运动卡片边框或进度条应有轻微呼吸感：

```tsx
<motion.div
  animate={{ opacity: [0.3, 1, 0.3] }}
  transition={{ duration: 2, repeat: Infinity }}
  className="border-2 border-rose-500"
/>
```

### 完成反馈

当一个大项完成时，使用缩放动画提供成就感：

```tsx
<motion.div
  initial={{ scale: 0.8, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  transition={{
    type: 'spring',
    stiffness: 400,
    damping: 15
  }}
>
  ✓ 完成
</motion.div>
```

---

## 扫光效果 (Shimmer)

AI 推荐按钮的微弱光效划过：

```tsx
<motion.button className="relative overflow-hidden">
  <motion.div
    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
    animate={{ x: ['-100%', '100%'] }}
    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
  />
  <span>AI 推荐</span>
</motion.button>
```

---

## 无障碍支持

所有特殊效果必须支持 `prefers-reduced-motion`：

```tsx
const shouldReduceMotion = useReducedMotion();

const variants = shouldReduceMotion
  ? { animate: { opacity: 1 }, transition: { duration: 0 } }
  : { animate: { opacity: 1, scale: 1.1 }, transition: { duration: 0.2 } };
```

---

**完整规范**: 见 `docs-site\ui-guides\animation-interaction-system.md`
