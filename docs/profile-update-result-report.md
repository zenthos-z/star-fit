# 用户画像自动更新 — 结果报告（2026-09-08 凌晨）

> 给用户明早检查用。全部任务已完成并经端到端验证，后端容器已运行最新镜像。

## 一、任务完成总览

| # | 任务 | 状态 |
|---|------|------|
| 1 | 输出长度改为**建议式**（非硬约束） | ✅ |
| 2 | 语义化触发 E2E（无关键词聊天激活技能） | ✅ 连续 5 轮 15/15 全过 |
| 3 | 修复历史遗留（workout-complete-handler 测试失败） | ✅ |
| 4 | 全部 deepagent 技能规范性修复 | ✅ |
| 5 | 后端重建重启 + 稳定性验证 | ✅ |

## 二、各项详情

### 1. 长度约束（按你的要求改为软性）

`backend/src/services/agent/DeepAgentService.ts` BASE_SYSTEM_PROMPT：

```
## Output length (soft guidance)
As a general guideline, aim to keep prose replies under about 1000 Chinese
characters (~600 English words). Prioritize what matters: if trimming would
cut important safety or health information, keep it — completeness wins
over brevity. ...
```

要点：guideline 而非 MUST；明确写了「安全/健康信息优先于简洁」，避免截断重要内容。
E2E 实测：阶段 B/C 回复 87~228 字符，远低于上限。

### 2. 语义化触发 E2E（核心验证）

**测试消息（无任何"更新/画像/受伤/记录"关键词）**：
> "感觉最近有点顶不住了。这周已经练了五天了，昨天睡觉翻来覆去到两点才睡着，早上起来肩膀那里有一点点僵，今天练卧推的时候右边使不上劲，重量比上周轻了也不敢加。"

**验证链路**（`backend/scripts/e2e-profile-update.mjs`，真实 HTTP + 真实 deepseek-v4-flash + 真实 PG）：

- ① 基线：DB 画像清零
- ② 阶段 A（scenario=chat）：Agent 语义理解 → 判为 `injury_report` 触发 → 生成
  `profile_update_confirm` 卡片（3 项提案：active_limitations / recovery_state / memories）
  **红线验证：本回合 profile_dynamic 零写入** ✅
- ③ 阶段 B（scenario=update_profile 确认回传）：Agent 调 `update_profile` →
  **DB 真实写入验证**（right_shoulder severity=4、auto_heal、7 天过期、恢复评分、memories）→
  回 `audit_complete` 反馈卡片，updates[] 与写入一致 ✅
- ④ 阶段 C（拒绝路径）："暂时不用更新了" → 无新写入、简短回复、无卡片 ✅
- ⑤ 清理：DB 恢复空画像

**稳定性**：修复两处 prompt 缺陷后**连续 5 轮全部 15/15 通过**（LLM 非确定性下）。

**E2E 过程中发现并修复的两个真问题**：

1. **普通 chat 场景技能激活不稳定**（最初 3/6 轮失败）：Agent 把技能当成
   "workout_complete 专属"，识别到触发却只给训练建议不发卡片。
   修复：①`SCENARIO_DATA_GUIDES.update_profile` 改写为明确的三步流程；
   ②BASE_SYSTEM_PROMPT 新增「Profile auto-update trigger (ANY scenario)」段，
   明确语义触发信号 + 卡片不可跳过 + 提案轮绝不写库。
2. **audit_complete 卡片重试泄漏**：模型把 `details` 写成字符串（schema 要求
   string[]），M5c 打回后模型的修订独白"The updates details field must be…"
   泄漏为正文。修复：uiHintFormat.ts 中明确 `details MUST be an ARRAY of
   strings`，并新增「卡片必须用 ```json 围栏 + 括号自检」规则（围栏是提取
   主路径，无围栏的 JSON 笔误会整段漏成正文——run12 实测复现过）。

### 3. 历史遗留修复

`workout-complete-handler` 缺 knowledge 文件导致 `skillLoader.test.ts` 一直挂
（stash 验证过改动前即挂）。已补 `knowledge/examples.md`（4 个示例 + 红线回顾，
并厘清了与 profile-update-reviewer 的职责边界：survey 驱动的限制登记不走确认门）。
**skillLoader 测试 12/12，114 个 agent 单测全绿，0 历史遗留。**

### 4. 技能规范审计与修复（8 个技能全查）

| 技能 | 问题 | 修复 |
|------|------|------|
| workout-complete-handler | 缺 knowledge 文件 | 补 examples.md |
| exercise-suggestion-advisor | frontmatter name 用下划线 | `exercise_suggestion_advisor` → `exercise-suggestion-advisor`（与目录一致，Agent Skills 规范） |
| exercise-type-guide | 同上 + 引用已删除的 `load_skill` 工具 | name 连字符化；15 处 load_skill 改为原生 `read_file` 路径；工具表与版本历史同步更新 |
| plan-generation | 同上 + 2 处 load_skill | name 连字符化；改为技能引用表述；knowledge.md 中 1 处失效引用改为 `list_exercises`（GOLD 快照 SHA256 已同步更新到测试） |
| strength-training-designer | name 下划线 | 连字符化 |
| fitness-data-tools / program-progression / profile-update-reviewer | 规范 ✅ | 无需改 |

> 注：load_skill 是 R5 重构前旧 MAS 运行时的工具，早已不存在——模型若照旧文档
> 调用必然报错，这类修复是实际行为修复，不只是文档清理。
> 目录结构（knowledge/ vs references/）未统一，因收益小、改动面大，判断不动。

### 5. 测试与构建状态（最终）

- 后端 `tsc --noEmit`：0 错误
- 前端 `npm run typecheck`：0 错误
- 后端 agent 单测：**114/114**（uiHintFormat/Validator/ValidationLoop/Extractor/skillLoader/workoutQualityGate/mcpTools）
- 前端 vitest：42/42（sseAgentClient / workoutSummary / suggestionService）
- Docker：`backend-backend-1` 已用最新镜像重建并运行（healthy）

### 6. 顺手修复

- `components/History.tsx`：`handleScroll` 已定义但未挂载导致的 TS2304（补 `onScroll={handleScroll}`）+ Sync Debug Panel 一个未闭合的 JSX 标签（该文件是工作区已有未提交改动的一部分）

## 三、E2E 复跑方式

```bash
cd backend
node scripts/e2e-profile-update.mjs   # 一键完整闭环（触发→确认→拒绝→清理）
# 或分阶段：
node scripts/e2e-profile-update-trigger.mjs  # 仅阶段 A
node scripts/e2e-profile-update-confirm.mjs  # 仅阶段 B（需先跑 A）
bash scripts/run-e2e-stability.sh            # 稳定性 5 连跑
```

## 四、遗留事项 / 提醒

1. **前端未动**（另一窗口负责）：确认/反馈气泡渲染按 `docs/profile-update-frontend-spec.md` 实现，注意 `UiHintCard['type']` 穷举 Record 需补 `profile_update_confirm` 键（sseAgentClient.ts:247 已示范）。
2. **线程上下文**：E2E 首次失败曾复现"残留 checkpoint 干扰"——默认 threadId=userId 的旧会话很长（182 checkpoints），Agent 会把新消息误判为重复。前端确保新会话用新 threadId（现框架已如此）。
3. **GOLD 快照已更新**：`plan-generation/knowledge.md` 因修复失效工具引用改了 1 行，skillLoader.test.ts 的 SHA256 已同步；今后改 GOLD 文件记得同步快照。
4. 所有改动均未提交（含你之前的未提交改动），`git status` 共 100+ 文件，建议你确认后自行分批提交。
