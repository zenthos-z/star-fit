# 微交互与手势规范

---

## 点击反馈

所有可点击元素必须提供即时反馈：

| 元素类型 | 反馈方式 | 时长 |
|----------|----------|------|
| 按钮 | `scale: 0.92` | 150ms |
| 卡片 | `scale: 0.96` | 150ms |
| 列表项 | `scale: 0.98` + 背景色 | 150ms |
| 图标 | `scale: 0.9` | 100ms |

```tsx
// ✅ 使用预设
<motion.button {...buttonPress}>按钮</motion.button>

// ✅ 自定义
<motion.button
  whileTap={{ scale: 0.92 }}
  transition={{ duration: 0.15 }}
>
  按钮
</motion.button>
```

---

## 悬停状态

**仅在桌面端使用**（通过 `@media (hover: hover)` 检测）：

```tsx
<motion.div
  whileHover={{ scale: 1.08 }}
  className="hidden md:block"
>
  悬停区域
</motion.div>
```

---

## 手势逻辑

### 滑动手势

- 避免与系统手势（如边缘侧滑返回）冲突
- 左滑通常用于"删除"或"撤销"
- 使用 Framer Motion 的 `drag` 约束

```tsx
<motion.div
  drag="x"
  dragConstraints={{ left: 0, right: 0 }}
  onDragEnd={(e, info) => {
    if (info.offset.x < -100) {
      // 触发删除
    }
  }}
/>
```

### 长按操作

谨慎使用，通常用于高级编辑或排序。

---

## 交互按钮设计原则

### 简约优先

- 核心操作栏严禁超过 3 个按钮
- 优先使用双按钮布局：[暂停/继续] + [完成]
- 低频操作通过侧滑菜单、长按隐藏

### 右手习惯优化

```tsx
// 1:2.5 布局 - 右侧核心手柄占更大面积
<div className="grid grid-cols-[1fr_2.5fr] gap-4 h-16">
  <button className="bg-white border-2 text-sm">结束/完成</button>
  <button className="bg-gray-900 text-white text-lg">开始/暂停</button>
</div>
```

### 盲操友好

- 按钮高度不低于 `h-16` (64px)
- 关键按钮使用高对比度颜色
- 在有氧运动场景显示目标心率区间

---

## 加载状态

| 类型 | 动画 | 用途 |
|------|------|------|
| 骨架屏 | `pulse` | 内容加载中 |
| 按钮加载 | `spin` + 文字淡出 | 提交中 |
| 进度条 | 宽度过渡 | 上传/下载 |
| 智能推荐 | `shimmer` | AI 计算中 |

```tsx
// 骨架屏
<div className="animate-pulse">
  <div className="h-4 bg-gray-200 rounded" />
</div>

// 智能推荐扫光
<motion.div
  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
  animate={{ x: ['-100%', '100%'] }}
  transition={{ duration: 1.5, repeat: Infinity }}
/>
```

---

## 防抖与限流

- 高频点击的"加减"按钮必须实现防抖
- 敏感操作（删除整个计划）必须有二次确认

```tsx
// 防抖示例
const debouncedIncrement = useMemo(
  () => debounce(() => setCount(c => c + 1), 200),
  []
);
```

---

## 滚动反馈

### 原生回弹

```css
/* 全局启用 */
overscroll-behavior-y: auto;

/* iOS 平滑滚动 */
-webkit-overflow-scrolling: touch;
```

### 弹性拉伸

```tsx
import { useSpring, useTransform } from 'framer-motion';

function ElasticPull({ scrollY }) {
  const y = useTransform(scrollY, [0, 100], [0, 20]);
  const scaleY = useTransform(scrollY, [0, 100], [1, 1.08]);
  const springY = useSpring(y, { stiffness: 200, damping: 25 });

  return <motion.div style={{ y: springY, scaleY }} />;
}
```

---

**完整规范**: 见 `docs-site\ui-guides\animation-interaction-system.md`
