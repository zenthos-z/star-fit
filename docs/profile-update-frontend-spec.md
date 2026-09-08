# 用户画像自动更新 — 前端配套实现规范

> 状态：后端已全部落地（契约 + Agent 技能 + SSE 通路）。本文档是前端实现唯一规范，
> 供前端窗口直接照做。后端改动清单见文末「附：后端已完成的改动」。

## 1. 功能概览

Agent 在两类时机主动提议更新用户画像：

- **一天训练结束**（trigger: `day_end`）
- **受伤 / 关键参数变化**（trigger: `injury_report` / `key_parameter_change`）

交互闭环：Agent 发**确认气泡**（特殊卡片）→ 用户点「确认更新」或「暂不更新」→
确认则进入 `scenario=update_profile` 的执行轮 → Agent 写库并回**反馈气泡**
（`audit_complete` 卡片）。

红线：Agent 提案轮绝不写库；写库只发生在用户确认之后。

## 2. SSE 契约（已就绪，前端只管渲染）

SSE `data:` 帧仍是标准 `AgentEvent`（`token | uiHint | done | error | thinking`）。
新卡片经 `sseAgentClient.ts` 的 `synthesizeUiHint` 后，`RenderableUiHint.type`
为字符串 **`'profile_update_confirm'`**（前端无需改 sseAgentClient，映射已加）。

## 3. 确认气泡卡：`profile_update_confirm`

### 3.1 data 结构（Zod 已在后端校验，前端按此渲染）

```ts
interface ProfileUpdateConfirmData {
  title?: string;           // 卡片标题，如 "用户画像更新建议"
  message: string;          // 主文案（Agent 已按 1000 字限制写短句）
  trigger: 'day_end' | 'injury_report' | 'key_parameter_change' | 'user_request';
  proposals: Array<{
    field: 'load_anchors' | 'active_limitations' | 'recovery_state' | 'memories';
    label: string;          // 中文标签，如 "活动限制"
    change: string;         // 一句话改动描述（必渲染）
    value?: unknown;        // 可选的新值预览（JSON，建议折叠展示）
  }>;
  confirmLabel: string;     // 默认 "确认更新"
  cancelLabel: string;      // 默认 "暂不更新"
}
```

### 3.2 渲染要求

- 识别入口：聊天流里 `uiHint.type === 'profile_update_confirm'`（经
  `synthesizeUiHint` 映射后即该字符串）。
- **特殊气泡**：区别于普通卡片——带 icon（建议 🧬/shield 样式）、圆角气泡内
  列出 proposals（`label + change` 逐条，`value` 可展开/折叠）、底部两个按钮
  `[confirmLabel] [cancelLabel]`，主按钮高亮（项目主色），次按钮灰。
- 按钮点击后：**气泡冻结为已选状态**（选中按钮高亮、另一按钮禁用），防止重复
  提交。

### 3.3 确认/取消如何回传给 Agent

点任一按钮 = 发起一轮新的 `/api/chat`（走现有 `useAICoach` / sseAgentClient
通路，不要新开通道）：

- **确认**：`scenario: 'update_profile'`，`message` 建议：
  `"已确认画像更新，请按以下提案执行：<逐条 field + change + value JSON>"`
  （把 proposals 原文带上，Agent 执行轮要据此写入；threadId 沿用当前会话）。
- **取消**：`scenario: 'chat'`（或 'update_profile' 均可），`message`：
  `"用户选择暂不更新画像（放弃提案：<field 列表>）。请简短确认，不做任何修改。"`

Agent 的下一轮回复里，确认路径会带 `audit_complete` 卡片（见 §4），取消路径
是纯文本一句话。

## 4. 反馈气泡卡：`audit_complete`（已有类型，扩展渲染）

Agent 写库成功后回 `audit_complete`，`data`：

```ts
{
  title?: string;                 // "画像已更新"
  message: string;
  actionLabel?: string;           // 默认 "查看详情"
  requiresConfirmation?: boolean; // 本场景下应为 false
  updates: Array<{
    field: 'load_anchors' | 'active_limitations' | 'recovery_state' | 'memories'
         | 'loadAnchors' | 'physiological' | 'preferences' | 'basicInfo'; // 兼容旧值
    label: string;
    count: number;
    details?: string[];           // 逐条改动明细，建议列表渲染
  }>;
}
```

前端渲染：绿色 ✓ 风格的特殊气泡，逐条列 `label ×count`，有 `details` 就展开
列出。`actionLabel` 点击行为前端自定（本闭环中可只做展开/收起，无需跳转）。
若已有 audit_complete 渲染逻辑则无需重写，只需确认 `field` 下划线新枚举值
不会掉进兜底分支。

## 5. 触发时机（前端需要做的配合）

前端**不需要**主动判断触发条件（Agent 在对话里自己识别）。前端只需保证：

1. `workout_complete` 场景的收尾轮照常发出（现有链路）——Agent 会在总结末尾
   视情况追加确认卡片。
2. 用户在自由聊天里提到受伤时（普通 `scenario: 'chat'`），Agent 同样会发确认
   卡片——前端只要渲染它即可。
3. （可选增强）设置页加「画像更新通知」开关，关闭时不冻结气泡但默认仍显示。

## 6. 验收清单

- [ ] `profile_update_confirm` 气泡正确渲染 proposals + 双按钮，点击后冻结
- [ ] 确认 → 发 `scenario=update_profile` + 携带 proposals 原文 → 收到
      `audit_complete` 气泡
- [ ] 取消 → 不产生任何写入 → Agent 回一句纯文本
- [ ] 普通文本 token 流不损失（卡片之外的 prose 照常渲染）
- [ ] `thinking` 事件照常进折叠块（M5c 重试时可能出现）
- [ ] `npm run typecheck` 通过（`UiHintCard['type']` 新增枚举值的 Record 映射
      已在 sseAgentClient.ts:247 补齐，前端卡片渲染如有
      `Record<type, ...>` 穷举表也要补 `'profile_update_confirm'` 键）

## 附：后端已完成的改动（前端窗口勿重复改）

| 文件 | 改动 |
|------|------|
| `shared/contracts/index.ts` | `UiHintCardSchema.type` 增加 `'profile_update_confirm'` |
| `backend/src/services/agent/schemas/uiHintSchemas.ts` | 新增 `ProfileUpdateProposalSchema` / `ProfileUpdateConfirmDataSchema`、union 分支、fallback；`ProfileUpdateItem.field` 枚举扩展 |
| `backend/src/services/agent/uiHintFormat.ts` | 卡片格式技能文本增加第七类型说明 + 允许写入约束 |
| `backend/src/services/agent/DeepAgentService.ts` | ①系统提示词加「输出 ≤1000 字」硬约束；②新增 `update_profile` 场景数据指引（先问后写流程） |
| `backend/src/services/mas/skills/profile-update-reviewer/` | 新技能：触发识别→确认卡片→确认执行→audit_complete 反馈 全流程指南 + examples.md |
| `src/v2/services/agent/sseAgentClient.ts` | `CARD_TYPE_TO_LEGACY` 补 `profile_update_confirm` 映射（透传） |
| 测试 | uiHintValidator +7 用例、uiHintFormat +1 用例，60/96 全绿（1 失败为历史遗留：workout-complete-handler 缺 knowledge 文件，stash 验证过与本次无关） |
