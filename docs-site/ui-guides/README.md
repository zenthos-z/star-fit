# Starfit UI 规范文档

本目录包含 Starfit 项目的所有 UI 相关规范文档。

## 文档索引

| 文档 | 说明 | 适用角色 |
|------|------|----------|
| [motion-design-system.md](./motion-design-system.md) | **动效视觉规范 v2.0** - 动画令牌、组件动画模式、性能优化、无障碍规范 | 前端开发、UI 设计 |
| [animation-interaction-system.md](./animation-interaction-system.md) | 交互系统详细规范 - 弧形拖拽、全局覆盖层、文字翻转等特殊交互 | 前端开发 |

## 快速开始

### 设计令牌

```typescript
import { primitives, semantic, animation, component } from '@/v2/lib/design-tokens';

// 使用颜色
const primaryColor = primitives.color.primary[500];

// 使用动画时长
const fastDuration = animation.duration.fast;
```

### 动画预设

```typescript
import { fadeIn, buttonPress, modalContent, staggerContainer } from '@/v2/lib/animations';
import { motion } from 'framer-motion';

// 淡入动画
<motion.div {...fadeIn}>内容</motion.div>

// 按钮交互
<motion.button {...buttonPress}>点击我</motion.button>

// 依次入场
<motion.div variants={staggerContainer} initial="initial" animate="animate">
  {items.map(item => (
    <motion.div key={item.id} variants={staggerItem}>
      {item.content}
    </motion.div>
  ))}
</motion.div>
```

## 规范层级

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Component (组件令牌)                           │
│  - 按钮、卡片、模态框的具体样式                           │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Animation (动画令牌)                           │
│  - 时长、缓动、缩放、错开延迟                             │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Semantic (语义化令牌)                          │
│  - 背景、文字、边框的语义化命名                           │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Primitive (原始令牌)                           │
│  - 颜色、间距、圆角、阴影的基础值                         │
└─────────────────────────────────────────────────────────┘
```

## 更新日志

### 2026-01-31
- 创建 `motion-design-system.md` - 完整的动效视觉规范 v2.0
- 创建 `design-tokens.ts` - 系统化设计令牌
- 重构 `animations/index.ts` - 完整的动画预设库
- 扩展 `animations/types.ts` - 完整的类型定义
