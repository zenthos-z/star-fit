# 组件视觉规范

---

## 按钮 (Buttons)

### 标准按钮

```tsx
<button className="
  h-12 px-6
  bg-gray-900 text-white
  rounded-lg
  font-medium text-base
  active:scale-95 transition-transform
">
  主要按钮
</button>
```

### 触控按钮 (移动端)

```tsx
<button className="
  h-16 px-6 min-w-[120px]
  bg-gray-900 text-white
  rounded-2xl
  font-semibold text-lg
  active:scale-95
">
  开始
</button>
```

### 次要按钮

```tsx
<button className="
  h-12 px-6
  bg-white border-2 border-gray-200 text-gray-900
  rounded-lg
  font-medium text-base
">
  次要按钮
</button>
```

---

## 卡片 (Cards)

### 标准卡片

```tsx
<div className="
  bg-white rounded-2xl
  p-6
  shadow-md
  hover:shadow-lg hover:-translate-y-1
  transition-all duration-200
">
  <h3 className="text-xl font-semibold">标题</h3>
  <p className="text-gray-500 mt-2">内容</p>
</div>
```

### 激活卡片

```tsx
<div className="
  bg-white rounded-2xl
  p-6
  shadow-lg
  border-2 border-blue-500
">
  <div className="flex items-center gap-2">
    <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
    <span>进行中</span>
  </div>
</div>
```

---

## 输入框 (Inputs)

```tsx
<input
  className="
    h-12 px-4
    bg-white border border-gray-300
    rounded-lg
    text-base
    focus:outline-none focus:ring-2 focus:ring-blue-500
  "
  placeholder="请输入..."
/>
```

---

## 标签 (Tags)

```tsx
<span className="
  inline-flex items-center
  px-3 py-1
  bg-blue-50 text-blue-600
  rounded-full
  text-sm font-medium
">
  标签
</span>
```

### 状态标签

```tsx
// 进行中
<span className="px-3 py-1 bg-rose-100 text-rose-600 rounded-full text-sm">
  进行中
</span>

// 已完成
<span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-sm">
  已完成
</span>

// 待开始
<span className="px-3 py-1 bg-indigo-100 text-indigo-600 rounded-full text-sm">
  待开始
</span>
```

---

## 模态框 (Modals)

```tsx
<div className="fixed inset-0 flex items-center justify-center z-[1400]">
  {/* 背景遮罩 */}
  <div className="absolute inset-0 bg-black/50" />

  {/* 内容 */}
  <div className="
    relative bg-white rounded-[2.5rem]
    p-6 max-w-md w-full
    shadow-2xl
  ">
    <h2 className="text-2xl font-bold mb-4">标题</h2>
    <div className="text-gray-600">内容</div>
  </div>
</div>
```

---

## 列表 (Lists)

### 标准列表项

```tsx
<div className="
  flex items-center gap-4
  p-4
  bg-white rounded-xl
  border border-gray-100
  active:scale-[0.98] active:bg-gray-50
  transition-all
">
  <div className="w-12 h-12 rounded-lg bg-gray-200" />
  <div className="flex-1">
    <h4 className="font-medium">标题</h4>
    <p className="text-sm text-gray-500">描述</p>
  </div>
</div>
```

---

## AI 推荐按钮

```tsx
<button className="
  relative overflow-hidden
  bg-blue-600 text-white
  px-6 py-4 h-14
  rounded-2xl
  font-semibold text-base
  shadow-lg shadow-blue-200
  group
">
  {/* 扫光效果 */}
  <motion.div
    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
    animate={{ x: ['-100%', '100%'] }}
    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
  />

  <span className="relative flex items-center gap-2">
    AI 推荐
    <ArrowRight className="group-hover:translate-x-1 transition-transform" />
  </span>
</button>
```

---

## 加载状态

### 骨架屏

```tsx
<div className="animate-pulse">
  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
  <div className="h-4 bg-gray-200 rounded w-1/2" />
</div>
```

### 脉冲指示器

```tsx
<div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
```

---

## 无障碍建议

1. **最小触控目标**: 44px x 44px (推荐 48px)
2. **焦点环**: `focus:ring-2 focus:ring-blue-500`
3. **ARIA 标签**: 按钮添加 `aria-label`
4. **键盘导航**: 支持Tab键导航

---

**完整规范**: 见 `docs-site\ui-guides\`
