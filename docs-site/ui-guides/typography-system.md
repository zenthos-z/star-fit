# UI 字体排印规范

本指南定义了 Starfit 项目中的字体使用、字号阶梯和排版逻辑，旨在提供清晰的信息层级和极致的阅读体验。

## 1. 字体族 (Font Families)
- **系统默认 (Sans-serif)**: 优先使用系统原生字体以获得最佳性能。
  - iOS/macOS: `San Francisco (-apple-system)`
  - Windows: `Segoe UI`
  - Android: `Roboto`
- **等宽字体 (Monospace)**: 用于组数显示、倒计时、数值等需要对齐的场景。
  - `font-mono`: 用于 `SET 01`, `12:30` 等。

## 2. 字号阶梯 (Font Size Scale)
我们遵循一个严谨的字号阶梯，确保在不同设备上的一致性。

| 级别 | 类名 | 像素值 (rem/px) | 用途 |
| :--- | :--- | :--- | :--- |
| **Hero** | `text-4xl` | `2.25rem (36px)` | 运动数据大数字 (如心率、秒数) |
| **Headline** | `text-3xl` | `1.875rem (30px)` | 组数大字、主要数值 |
| **Title 1** | `text-xl` | `1.25rem (20px)` | 动作名称、模块标题 |
| **Base** | `text-base` | `1rem (16px)` | 标准正文 |
| **Small** | `text-sm` | `0.875rem (14px)` | 次要信息、按钮文字 |
| **Tiny** | `text-xs` | `0.75rem (12px)` | 辅助说明、单位 |
| **Micro** | `text-[10px]`| `0.625rem (10px)` | 标签、极小补充 |

### 字阶视觉预览
<div style="background: white; padding: 1.5rem; border-radius: 0.75rem; border: 1px solid #e4e4e7; color: #18181B; margin-top: 1rem;">
  <div style="font-size: 2.25rem; font-weight: 900;">45 BPM</div>
  <div style="font-size: 1.875rem; font-weight: 900;">SET 01</div>
  <div style="font-size: 1.25rem; font-weight: 900;">Barbell Squat</div>
  <div style="font-size: 1rem;">Standard Body Text</div>
  <div style="font-size: 0.75rem; font-weight: 900; text-transform: uppercase; color: #6b7280;">Micro Label</div>
</div>

## 3. 字重规范 (Font Weights)
- **Black (`font-black`)**: 用于最重要的标题和数据，增强视觉冲击力。
- **Bold (`font-bold`)**: 用于动作名称、按钮、强调文字。
- **Normal (`font-normal`)**: 用于大段正文描述。

## 4. 行高与间距 (Leading & Tracking)
- **Tight (`tracking-tight`)**: 用于大字号标题，使排版更紧凑。
- **Widest (`tracking-widest`)**: 用于全大写的小字号标签（如 `SET`），增强高级感。
- **None (`leading-none`)**: 用于数据展示，消除多余的垂直间距，便于对齐。

## 5. 特殊排版逻辑
- **全大写 (Uppercase)**: 所有的辅助标签（如 `SET`, `BPM`, `GPS`）必须使用全大写。
- **等宽数字 (Tabular Nums)**: 在计时器和频繁变动的数值中，必须使用 `tabular-nums` 类，防止文字跳动。
- **中文字体优化**: 确保在中文环境下，字体粗细适中，避免使用过细的字重。

## 示例代码
```tsx
// 动作标题
<h3 className="text-xl font-black text-gray-900 tracking-tight">深蹲</h3>

// 数据展示
<span className="text-4xl font-black tabular-nums text-orange-600">
  45<span className="text-sm font-bold text-gray-400">s</span>
</span>

// 辅助标签
<span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
  SET 01
</span>
```
