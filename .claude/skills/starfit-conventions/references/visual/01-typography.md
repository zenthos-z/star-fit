# 字体排印规范

---

## 字体族 (Font Family)

### 无衬线字体 (Sans)

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
```

### 等宽字体 (Mono)

```css
font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono",
             Consolas, "Courier New", monospace;
```

---

## 字号阶梯 (Font Size)

| 令牌 | 值 | Tailwind | 用途 |
|------|-----|---------|------|
| `xs` | 12px | `text-xs` | 极小标签 |
| `sm` | 14px | `text-sm` | 次要文字 |
| `base` | 16px | `text-base` | 正文 |
| `lg` | 18px | `text-lg` | 强调正文 |
| `xl` | 20px | `text-xl` | 小标题 |
| `2xl` | 24px | `text-2xl` | 标题 |
| `3xl` | 30px | `text-3xl` | 大标题 |
| `4xl` | 36px | `text-4xl` | 特大标题 |

---

## 字重 (Font Weight)

| 令牌 | 值 | Tailwind | 用途 |
|------|-----|---------|------|
| `normal` | 400 | `font-normal` | 正文 |
| `medium` | 500 | `font-medium` | 次级强调 |
| `semibold` | 600 | `font-semibold` | 强调 |
| `bold` | 700 | `font-bold` | 标题 |

---

## 行高 (Line Height)

| 令牌 | 值 | 用途 |
|------|-----|------|
| `tight` | 1.25 | 大标题 |
| `normal` | 1.5 | 正文 |
| `relaxed` | 1.75 | 宽松排版 |

---

## 特殊排版逻辑

### 全大写

```tsx
<span className="uppercase tracking-wider">
  START
</span>
```

### 等宽数字

```tsx
<span className="tabular-nums">
  12:34:56
</span>
```

### 字符翻转动画

用于状态轮播（如 START → READY → GO）:

- **翻转轴**: `rotateX`
- **单字符时长**: 0.15s
- **字符间延迟**: 0.03s
- **切换间隔**: 2s

```tsx
<motion.span
  initial={{ rotateX: -90, opacity: 0 }}
  animate={{ rotateX: 0, opacity: 1 }}
  exit={{ rotateX: 90, opacity: 0 }}
  transition={{ duration: 0.15, delay: i * 0.03 }}
  style={{ perspective: 1000 }}
>
  {char}
</motion.span>
```

---

## 组件示例

### 按钮

```tsx
<button className="text-base font-medium h-16 px-6">
  点击按钮
</button>
```

### 卡片标题

```tsx
<h3 className="text-xl font-semibold leading-tight">
  卡片标题
</h3>
```

### 数字显示

```tsx
<span className="text-3xl font-bold tabular-nums">
  12,345
</span>
```

---

## 使用建议

1. **优先使用 Tailwind 类**: 保持一致性
2. **行高与字号匹配**: 标题用 tight，正文用 normal
3. **数字使用等宽**: `tabular-nums` 防止抖动
4. **避免过多字号**: 同一屏不超过 3 种字号

---

**完整规范**: 见 `docs-site\ui-guides\typography-system.md`
