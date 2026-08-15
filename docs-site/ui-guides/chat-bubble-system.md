# 聊天气泡设计规范 (Chat Bubble System)

聊天气泡是 AI 教练对话界面的核心组件。它不仅承载文本信息，还是多模态交互和智能推理过程的载体。

## 1. 基础样式 (Base Bubbles)

### 用户气泡 (User Message)
- **背景**: `Gray-900 (#18181B)` 或项目主色 `star-dark`。
- **文字**: `White (#FFFFFF)`。
- **圆角**: `1.25rem (20px)`，右上角为直角或小圆角 (`4px`) 以指示发送者方向。
- **布局**: 右对齐。
- **最大宽度**: `92%`。

### AI 气泡 (Assistant Message)
- **背景**: 无背景（直接在页面底色上）或极浅灰色 (`Gray-50`)。
- **文字**: `Gray-900 (#18181B)`。
- **圆角**: `1.25rem (20px)`，左上角为直角或小圆角 (`4px`)。
- **布局**: 左对齐。
- **最大宽度**: `92%`。
- **内容支持**: 默认支持 Markdown 渲染（表格、加粗、列表）。

## 2. 推理链展示 (Reasoning Trace)

当 AI 正在思考或展示其逻辑推导过程时：
- **容器**: 位于气泡上方或气泡内部顶端。
- **背景**: `Gray-100/50` 半透明。
- **文字**: `Gray-400`, `font-mono`, `text-xs`。
- **状态**: 包含一个微小的脉冲动画 (Pulse) 表示正在处理。

## 3. 嵌套卡片 (uiHint Cards)

AI 气泡可以包含 `uiHint` 驱动的功能卡片：
- **衔接**: 卡片通常紧跟在文本之后，或者完全替代文本。
- **内边距**: 卡片在气泡内不应有额外的 Padding，应撑满气泡宽度。
- **交互**: 卡片内的按钮应符合项目的主按钮规范。

## 4. 状态指示

- **发送中**: 气泡透明度降至 `0.5`。
- **发送失败**: 气泡右侧显示红色感叹号图标。

---

### 视觉示例 (Preview)

<div style="background-color: #FAFAFA; padding: 2rem; border-radius: 1.5rem; border: 1px solid #e4e4e7; margin: 1.5rem 0; display: flex; flex-direction: column; gap: 1.5rem;">
  <!-- User Bubble -->
  <div style="display: flex; flex-direction: column; align-items: flex-end;">
    <div style="background-color: #18181B; color: white; padding: 0.875rem 1.25rem; border-radius: 1.25rem 0.25rem 1.25rem 1.25rem; font-size: 0.875rem; max-width: 80%; line-height: 1.5; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
      我想调整一下今天的胸部训练计划，感觉力量恢复得不错。
    </div>
  </div>
  <!-- AI Bubble with Reasoning -->
  <div style="display: flex; flex-direction: column; align-items: flex-start;">
    <div style="margin-bottom: 0.5rem; padding: 0.5rem 0.75rem; background-color: #F4F4F5; border-radius: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
      <div style="width: 8px; height: 8px; background-color: #3B82F6; border-radius: 9999px; animation: pulse-custom 2s infinite;"></div>
      <span style="font-family: monospace; font-size: 0.75rem; color: #71717A; font-weight: 700;">ANALYST: PROCESSING RECOVERY DATA</span>
    </div>
    <div style="background-color: white; color: #18181B; padding: 1rem 1.25rem; border-radius: 0.25rem 1.25rem 1.25rem 1.25rem; font-size: 0.875rem; max-width: 90%; line-height: 1.6; border: 1px solid #F4F4F5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
      太棒了！根据你的恢复数据和最近的睡眠质量，我建议增加 **10%** 的训练容量。
      <br/><br/>
      这是我为你调整后的核心动作建议：
      <div style="margin-top: 0.75rem; padding: 0.75rem; background-color: #EFF6FF; border-radius: 0.75rem; border: 1px solid #DBEAFE;">
        <div style="font-weight: 900; color: #1D4ED8; font-size: 0.75rem; margin-bottom: 0.25rem; text-transform: uppercase;">New Target</div>
        <div style="font-weight: 900; color: #1E293B;">杠铃卧推: 65kg x 8 reps (4 Sets)</div>
      </div>
    </div>
  </div>
</div>

<style>
@keyframes pulse-custom {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.9); }
}
</style>
