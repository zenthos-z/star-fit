# 间距布局规范

---

## 间距系统

基于 **4px 网格** 的间距系统：

| 令牌 | 值 | Tailwind | 用途 |
|------|-----|---------|------|
| `0` | 0 | `p-0` | 无间距 |
| `1` | 4px | `p-1` | 极小间距 |
| `2` | 8px | `p-2` | 紧凑间距 |
| `3` | 12px | `p-3` | 小间距 |
| `4` | 16px | `p-4` | 标准间距 |
| `5` | 20px | `p-5` | 中等间距 |
| `6` | 24px | `p-6` | 大间距 |
| `8` | 32px | `p-8` | 较大间距 |
| `12` | 48px | `p-12` | 很大间距 |
| `16` | 64px | `p-16` | 超大间距 |

---

## 圆角 (Border Radius)

| 令牌 | 值 | Tailwind | 用途 |
|------|-----|---------|------|
| `sm` | 8px | `rounded-sm` | 小圆角 |
| `md` | 12px | `rounded-md` | 中圆角 |
| `lg` | 16px | `rounded-lg` | 标准圆角 |
| `xl` | 24px | `rounded-xl` | 大圆角 |
| `2xl` | 32px | `rounded-2xl` | 超大圆角 |
| `3xl` | 40px | `rounded-3xl` | 特大圆角 |
| `full` | 9999px | `rounded-full` | 完全圆角 |

---

## 组件间距规范

### 按钮内边距

```tsx
// 标准按钮
<button className="px-6 py-3 h-12">  // 水平24px, 垂直12px
  按钮
</button>

// 触控按钮 (移动端)
<button className="px-6 h-16">  // 最小高度64px
  按钮
</button>
```

### 卡片内边距

```tsx
// 小卡片
<div className="p-4 rounded-lg">  // 16px
  内容
</div>

// 标准卡片
<div className="p-6 rounded-2xl">  // 24px
  内容
</div>

// 大卡片
<div className="p-8 rounded-3xl">  // 32px
  内容
</div>
```

### 列表项

```tsx
<div className="py-3 px-4">  // 垂直12px, 水平16px
  列表项内容
</div>
```

---

## 布局间距

### Section 间距

```tsx
<section className="py-6">  // 上下24px
  区域内容
</section>
```

### 元素间距

```tsx
<div className="space-y-4">  // 垂直间距16px
  <div>元素1</div>
  <div>元素2</div>
</div>
```

---

## 特殊布局

### 按钮控制栏 (1:2.5 布局)

```tsx
// 右侧核心手柄 (开始/暂停)，左侧状态终结 (结束/完成)
<div className="grid grid-cols-[1fr_2.5fr] gap-4 h-16">
  <button>结束/完成</button>  {/* 左侧 1 份 */}
  <button>开始/暂停</button>  {/* 右侧 2.5 份 */}
</div>
```

---

## 使用建议

1. **遵循 4px 网格**: 所有间距为 4 的倍数
2. **保持一致性**: 相同层级组件使用相同间距
3. **考虑触控**: 移动端按钮最小高度 48px (推荐 64px)
4. **适度留白**: 避免过度拥挤或过度留白

---

**完整规范**: 见 `docs-site\ui-guides\spacing-layout-system.md`
