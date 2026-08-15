# UIHint 卡片激活场景

本文档描述了系统中所有 UIHint 卡片类型的激活场景和数据结构。

---

## 卡片类型概览

| 卡片类型 | 前端组件 | 主要用途 |
|---------|-----------|---------|
| plan_card | PlanCard | 展示训练计划 |
| survey_card | SurveyCard | 收集用户信息（画像、体感） |
| summary_card | SummaryCard | 训练总结复盘 |
| deviation_card | DeviationCard | 训练偏差确认 |
| survey_success | SurveySuccessCard | 问卷提交成功确认 |

---

## plan_card

### 激活场景

1. **用户请求生成训练计划**
   - 触发条件：用户发送"制定训练计划"、"生成计划"等请求
   - 前置条件：用户已填写画像（`basicInfo` 或 `preferences` 非空）
   - 处理节点：Planner Node (`handlePlanScenario`)

2. **AI 生成训练计划**
   - 触发条件：Planner 根据用户画像和历史数据生成计划
   - 数据来源：LLM (Gemini) 基于 `PLANNER_SYSTEM_PROMPTS.PLAN`

### 数据结构

```typescript
{
  type: 'plan_card',
  data: Array<{
    exerciseId: string;    // 动作ID
    name: string;         // 动作名称
    sets: number;         // 组数
    reps: number;         // 次数
    weight: number;       // 重量（kg）
  }>,
  diff?: {
    added: string[];     // 新增的动作ID
    modified: string[];  // 修改的动作ID
    removed: string[];    // 删除的动作ID
  }
}
```

### 重量推算规则

| 动作类型 | 新用户推算 | 有历史数据 |
|---------|------------|----------|
| 复合动作（深蹲/卧推/硬拉） | 体重 × 0.4~0.6（初学者）/ 0.6~0.8（中级） | 使用历史负荷锚点 |
| 上肢孤立动作 | 体重 × 0.1~0.2 | 使用历史负荷锚点 |
| 下肢孤立动作 | 体重 × 0.2~0.3 | 使用历史负荷锚点 |
| 自重动作 | weight = 0 | 使用历史负荷锚点 |
| 器械动作 | 比自由重量轻 20-30% | 使用历史负荷锚点 |

---

## survey_card

### 激活场景

1. **新用户画像收集**
   - 触发条件：首次使用计划模式，`!hasBasicInfo && !hasSurveyUpload`
   - 处理节点：Planner Node (`handlePlanScenario`)
   - 字段检查：`basicInfo`、`preferences`、`tags`、`summary`

2. **训练后收集体感数据**
   - 触发条件：训练完成，需要收集用户反馈
   - 处理节点：Planner Node (`handleWorkoutCompleteScenario`)
   - 数据来源：LLM 分析训练数据生成个性化问题

### 数据结构

```typescript
{
  type: 'survey_card',
  data: {
    title?: string;       // 标题（可选）
    message: string;      // 描述信息
    questions: Array<{
      id: string;         // 问题ID
      question: string;    // 问题文本
      required: boolean;   // 是否必填
      inputType?: 'text' | 'number' | 'select' | 'multiselect';
      options?: string[];  // 选项（select/multiselect 类型）
      placeholder?: string;  // 占位符
    }>
  }
}
```

### 画像收集问题模板

| 问题ID | 问题文本 | 字段类型 | 必填 |
|--------|---------|---------|------|
| age | 您的年龄是？ | number | 是 |
| height | 您的身高是？ | number | 是 |
| weight | 您的体重是？ | number | 是 |
| training_age | 您的健身经验（年）？ | number | 是 |
| fitness_level | 您的当前健身水平？ | select | 否 |
| method | 您的训练目标？ | select | 是 |
| equipment | 您的可用器械？ | multiselect | 是 |
| intensity_preference | 您的训练强度偏好？ | select | 否 |

### 体感收集问题模板

根据训练数据分析生成 2-4 个个性化问题：

- **历史变化**："卧推重量从 60kg 降到 55kg（降幅8%），是因为疲劳还是尝试新重量？"
- **首次记录**："首次进行侧平举训练，是否感受到目标肌肉发力？"
- **异常跟进**："训练中是否有不适感？请描述具体位置"
- **疲劳度**："今天感觉有多累？（1-10分）"
- **恢复状态**："昨晚睡眠质量如何？"

---

## summary_card

### 激活场景

1. **训练分析报告**
   - 触发条件：训练完成 + 用户提交了体感问卷
   - 处理节点：Planner Node (`handleWorkoutCompleteScenario`)
   - 数据来源：LLM 统一分析训练数据和问卷回复

### 数据结构

```typescript
{
  type: 'summary_card',
  data: {
    title: string;      // 标题
    content: string;    // Markdown 格式的完整分析报告
    encouragement?: string;  // 简洁的鼓励话语
  }
}
```

### 分析内容

AI 分析包含：
- 负荷锚点更新（计算估算 1RM）
- 体能状态推断（疲劳度、恢复状态）
- 偏好设置推断（器械、强度偏好）
- 基础信息更新（仅当问卷有数据时）
- AI 审计总结（Markdown 格式）

---

## deviation_card

### 激活场景

1. **训练偏差确认**
   - 触发条件：检测到用户偏离计划需要确认
   - 处理节点：LLM 基于用户对话内容生成

### 数据结构

```typescript
{
  type: 'deviation_card',
  data: {
    reason: string;         // 偏差原因
    suggestion?: string;     // 调整建议（可选）
  }
}
```

### 使用场景

- 用户实际训练与计划不符
- 需要调整训练计划
- 用户主动询问修改建议

---

## survey_success

### 激活场景

1. **用户画像保存成功**
   - 触发条件：用户提交画像问卷，数据成功保存到数据库
   - 处理节点：Planner Node (`handlePlanScenario`)
   - 后续：等待用户确认后再次生成计划

### 数据结构

```typescript
{
  type: 'survey_success',
  data: {
    title?: string;              // 标题（默认"信息已保存"）
    message: string;             // 描述信息
    actionLabel: string;          // 按钮文本
    requiresConfirmation: boolean;  // 是否需要确认
  }
}
```

### 交互流程

1. 用户填写画像问卷 → 提交
2. Planner 保存到 `user_insights` 表
3. WebSocket 通知前端同步 L2 (IndexedDB)
4. 显示 SURVEY_SUCCESS 卡片
5. 用户点击"生成训练计划"按钮
6. 第二次请求使用最新 DB 数据生成 plan_card

---

## 判断逻辑总结

### hasBasicInfo 判断

```typescript
const hasBasicInfo = userProfile && (
  userProfile.basicInfo && 
  Object.keys(userProfile.basicInfo).length > 0 ||
  userProfile.preferences &&
  Object.keys(userProfile.preferences).length > 0 ||
  userProfile.tags?.length > 0 ||
  userProfile.summary
);
```

### hasSurveyUpload 判断

```typescript
const hasSurveyUpload = state.intentContext?.type === 'survey_upload';
```

---

## 代码位置参考

| 功能 | 文件位置 |
|------|---------|
| Planner 逻辑 | `backend/src/services/mas/agents/plannerNode.ts` |
| Responder 逻辑 | `backend/src/services/mas/agents/responderNode.ts` |
| Schema 定义 | `backend/src/services/mas/schemas/uiHintSchemas.ts` |
| 前端组件 | `src/v2/components/execution/cards/` |
| 前端渲染器 | `src/v2/components/execution/ExerciseRenderer.tsx` |
| 类型桥接 | `src/v2/utils/typeBridge.ts` |
