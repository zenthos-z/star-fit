# 视觉展示 (UI Gallery)

本页面通过直观的示例展示 Starfit 项目的 UI 规范。所有示例均使用项目中定义的 Tailwind 类名和设计变量。

---

## 1. 颜色系统 (Color System)

### 品牌与核心色
<div style="display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0;">
  <div style="flex: 1; min-width: 120px; text-align: center;">
    <div style="background-color: #3B82F6; height: 80px; border-radius: 1rem; margin-bottom: 0.5rem; border: 1px solid #e4e4e7;"></div>
    <span style="font-size: 0.875rem; font-weight: 600;">star-accent</span><br/>
    <span style="font-size: 0.75rem; color: #6b7280;">#3B82F6</span>
  </div>
  <div style="flex: 1; min-width: 120px; text-align: center;">
    <div style="background-color: #2563EB; height: 80px; border-radius: 1rem; margin-bottom: 0.5rem; border: 1px solid #e4e4e7;"></div>
    <span style="font-size: 0.875rem; font-weight: 600;">blue-600</span><br/>
    <span style="font-size: 0.75rem; color: #6b7280;">#2563EB</span>
  </div>
  <div style="flex: 1; min-width: 120px; text-align: center;">
    <div style="background-color: #EFF6FF; height: 80px; border-radius: 1rem; margin-bottom: 0.5rem; border: 1px solid #e4e4e7;"></div>
    <span style="font-size: 0.875rem; font-weight: 600;">blue-50</span><br/>
    <span style="font-size: 0.75rem; color: #6b7280;">#EFF6FF</span>
  </div>
</div>

### 状态反馈色
<div style="display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0;">
  <div style="flex: 1; min-width: 100px; text-align: center;">
    <div style="background-color: #F43F5E; height: 60px; border-radius: 0.75rem; margin-bottom: 0.5rem;"></div>
    <span style="font-size: 0.75rem; font-weight: 600;">Active (Rose)</span>
  </div>
  <div style="flex: 1; min-width: 100px; text-align: center;">
    <div style="background-color: #F97316; height: 60px; border-radius: 0.75rem; margin-bottom: 0.5rem;"></div>
    <span style="font-size: 0.75rem; font-weight: 600;">Active (Orange)</span>
  </div>
  <div style="flex: 1; min-width: 100px; text-align: center;">
    <div style="background-color: #22C55E; height: 60px; border-radius: 0.75rem; margin-bottom: 0.5rem;"></div>
    <span style="font-size: 0.75rem; font-weight: 600;">Success (Green)</span>
  </div>
  <div style="flex: 1; min-width: 100px; text-align: center;">
    <div style="background-color: #818CF8; height: 60px; border-radius: 0.75rem; margin-bottom: 0.5rem;"></div>
    <span style="font-size: 0.75rem; font-weight: 600;">Pending (Indigo)</span>
  </div>
</div>

---

## 2. 字体排印 (Typography)

### 字号阶梯示例
<div style="border: 1px solid #e4e4e7; border-radius: 1rem; padding: 1.5rem; background-color: white; color: #18181B;">
  <div style="font-size: 2.25rem; font-weight: 900; line-height: 1.2; margin-bottom: 1rem;">Hero: 45 BPM</div>
  <div style="font-size: 1.875rem; font-weight: 900; margin-bottom: 0.75rem;">Headline: SET 01</div>
  <div style="font-size: 1.25rem; font-weight: 900; margin-bottom: 0.5rem;">Title: Barbell Squat</div>
  <div style="font-size: 1rem; margin-bottom: 0.5rem;">Base: This is a standard body text.</div>
  <div style="font-size: 0.75rem; color: #6b7280; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase;">Micro Label: GPS ACTIVE</div>
</div>

---

## 3. 空间与组件布局 (Spacing & Components)

### 运动项卡片示例
<div style="background-color: #FAFAFA; padding: 2rem; border-radius: 1.5rem; border: 1px solid #e4e4e7; margin: 1.5rem 0;">
  <div style="background-color: white; border-radius: 1.5rem; padding: 1.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #f4f4f5; max-width: 400px; margin: 0 auto;">
    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
      <div style="width: 6px; height: 24px; background-color: #3B82F6; border-radius: 9999px;"></div>
      <h3 style="font-size: 1.25rem; font-weight: 900; margin: 0; color: #111827;">Running</h3>
    </div>
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background-color: #EFF6FF; border-radius: 1rem; border: 1px solid #DBEAFE;">
        <span style="font-size: 0.75rem; font-weight: 900; color: #3B82F6; text-transform: uppercase;">Warm Up</span>
        <span style="font-size: 1.5rem; font-weight: 900; color: #1D4ED8;">05:00</span>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background-color: #F4F4F5; border-radius: 1rem; opacity: 0.6;">
        <span style="font-size: 0.75rem; font-weight: 900; color: #9CA3AF; text-transform: uppercase;">Sprint</span>
        <span style="font-size: 1.5rem; font-weight: 900; color: #374151;">02:00</span>
      </div>
    </div>
  </div>
</div>

---

## 4. 动效预览 (Animation - CSS Simulation)

### 状态指示器
<div style="display: flex; gap: 2rem; align-items: center; margin: 1.5rem 0;">
  <div style="display: flex; align-items: center; gap: 0.5rem;">
    <div class="pulse-box" style="width: 12px; height: 12px; background-color: #22C55E; border-radius: 9999px;"></div>
    <span style="font-size: 0.875rem;">Active (Pulse)</span>
  </div>
  <div class="bounce-box" style="padding: 0.5rem 1rem; background-color: #F43F5E; color: white; border-radius: 0.75rem; font-size: 0.75rem; font-weight: 900;">
    HEART RATE RISING
  </div>
</div>

---

## 5. 运动卡片规范 (Exercise Cards)

展示不同类型运动卡片（由 `ExerciseRenderer` 分发）的真实结构与交互。

### 力量训练 (Resistance Card)
<div style="background-color: #FAFAFA; padding: 2rem; border-radius: 1.5rem; border: 1px solid #e4e4e7; margin: 1.5rem 0;">
  <div style="background-color: white; border-radius: 1.5rem; padding: 1.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #f4f4f5; max-width: 400px; margin: 0 auto;">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 6px; height: 24px; background-color: #3B82F6; border-radius: 9999px; box-shadow: 0 0 8px rgba(59,130,246,0.5);"></div>
        <h3 style="font-size: 1.25rem; font-weight: 900; margin: 0; color: #111827;">杠铃卧推</h3>
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 10px; background-color: #EFF6FF; color: #3B82F6; padding: 2px 6px; border-radius: 4px; font-weight: 900;">力量</span>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 48px 1fr 1fr 64px; align-items: center; gap: 1rem;">
      <div style="display: flex; flex-direction: column;">
        <span style="font-size: 10px; color: #D1D5DB; font-weight: 900; text-transform: uppercase;">组</span>
        <span style="font-size: 18px; color: #9CA3AF; font-weight: 900;">01</span>
      </div>
      <div style="text-align: center;">
        <div style="font-size: 24px; font-weight: 900; color: #1F2937;">60</div>
        <div style="font-size: 10px; color: #9CA3AF; font-weight: 900; text-transform: uppercase;">kg</div>
      </div>
      <div style="text-align: center;">
        <div style="font-size: 24px; font-weight: 900; color: #1F2937;">10</div>
        <div style="font-size: 10px; color: #9CA3AF; font-weight: 900; text-transform: uppercase;">次数</div>
      </div>
      <div style="display: flex; justify-content: center;">
        <div style="width: 48px; height: 32px; background-color: #10B981; border-radius: 0.75rem; display: flex; align-items: center; justify-content: center; color: white;">
          <svg style="width: 20px; height: 20px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
      </div>
    </div>
  </div>
</div>

### 有氧训练 (Running Card)
<div style="background-color: #FAFAFA; padding: 2rem; border-radius: 1.5rem; border: 1px solid #e4e4e7; margin: 1.5rem 0;">
  <div style="background-color: white; border-radius: 1.5rem; padding: 1.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #f4f4f5; max-width: 400px; margin: 0 auto;">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 6px; height: 24px; background-color: #3B82F6; border-radius: 9999px;"></div>
        <h3 style="font-size: 1.25rem; font-weight: 900; margin: 0; color: #111827;">户外跑步</h3>
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 10px; background-color: #EFF6FF; color: #3B82F6; padding: 2px 6px; border-radius: 4px; font-weight: 900;">计时器</span>
      </div>
    </div>
    <div style="background-color: #F9FAFB; border-radius: 1rem; padding: 1.5rem; display: flex; flex-direction: column; align-items: center; margin-bottom: 1.5rem; position: relative; overflow: hidden; border: 1px solid #F1F5F9;">
      <div style="font-size: 4rem; font-weight: 900; color: #111827; line-height: 1; letter-spacing: -0.05em;">12:45</div>
      <div style="font-size: 10px; color: #9CA3AF; font-weight: 900; margin-top: 0.5rem; text-transform: uppercase; letter-spacing: 0.1em;">剩余时长</div>
      <div style="margin-top: 1rem; display: flex; align-items: center; gap: 0.25rem; background-color: #FFFBEB; color: #D97706; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 900; border: 1px solid #FEF3C7;">
        <svg style="width: 12px; height: 12px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        ZONE 2
      </div>
      <div style="position: absolute; bottom: 0; left: 0; height: 4px; background-color: #3B82F6; width: 60%;"></div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 2.5fr; gap: 1rem; height: 56px;">
      <div style="background-color: #FFF1F2; border: 2px solid #FFE4E6; border-radius: 1rem; display: flex; align-items: center; justify-content: center; color: #E11D48; font-weight: 900; gap: 0.5rem;">
        结束
      </div>
      <div style="background-color: #FFFBEB; border: 2px solid #FEF3C7; border-radius: 1rem; display: flex; align-items: center; justify-content: center; color: #D97706; font-weight: 900; gap: 0.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        暂停
      </div>
    </div>
  </div>
</div>

---

## 6. 聊天气泡规范 (Chat Bubbles)

### 对话场景示例
<div style="background-color: #FAFAFA; padding: 2rem; border-radius: 1.5rem; border: 1px solid #e4e4e7; margin: 1.5rem 0; display: flex; flex-direction: column; gap: 1.5rem;">
  <div style="display: flex; flex-direction: column; align-items: flex-end;">
    <div style="background-color: #18181B; color: white; padding: 0.875rem 1.25rem; border-radius: 1.25rem 0.25rem 1.25rem 1.25rem; font-size: 0.875rem; max-width: 80%; line-height: 1.5; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
      帮我分析一下刚才那组深蹲的表现。
    </div>
  </div>
  <div style="display: flex; flex-direction: column; align-items: flex-start;">
    <div style="margin-bottom: 0.5rem; padding: 0.5rem 0.75rem; background-color: #F4F4F5; border-radius: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
      <div class="pulse-box" style="width: 8px; height: 8px; background-color: #3B82F6; border-radius: 9999px;"></div>
      <span style="font-family: monospace; font-size: 0.75rem; color: #71717A; font-weight: 700;">COACH: ANALYZING SENSOR DATA</span>
    </div>
    <div style="background-color: white; color: #18181B; padding: 1rem 1.25rem; border-radius: 0.25rem 1.25rem 1.25rem 1.25rem; font-size: 0.875rem; max-width: 90%; line-height: 1.6; border: 1px solid #F4F4F5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
      你在最后两次动作中重心略微前移，建议在下一组开始前，先做两次空杆练习来找回后跟受力的感觉。
    </div>
  </div>
</div>

<style>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.pulse-box {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
.bounce-box {
  animation: bounce 1s infinite;
}
</style>

---

> **提示**: 以上示例展示了如何在 Markdown 中结合 HTML/CSS 快速实现符合规范的 UI 预览。在实际开发中，应优先使用项目中配置的 Tailwind 类名。
