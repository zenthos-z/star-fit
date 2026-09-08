# Star-fit 数据流验证报告

**日期**：2026-09-06（凌晨自动执行）
**范围**：前端运动数据 → 预处理 → Agent 的完整链路
**结论**：✅ 三条任务全部完成，端到端已用真实 HTTP + 真实 DB 验证通过

---

## 一、发现的断点（全部已修复）

改造前的链路是断的——训练数据**从未成功持久化过**，Agent 只能靠幻觉分析：

| # | 断点 | 位置 | 修复 |
|---|------|------|------|
| 1 | 前端 POST 的 `sets` 是数组，后端 Zod 要求 `sets: number` → 必 400 | `App.tsx` ↔ `sessionController.ts` | 新建预处理层，把 sets 数组压缩成格式化条目（`sets` 变组数计数） |
| 2 | 持久化请求缺 `X-User-Id` 头 → 后端抛 `MissingUserIdError` | `useAICoach.ts` Phase 1 | 改用 `getHeaders()`（自动带编码后的 X-User-Id） |
| 3 | `startTime/endTime` 根本没放进持久化 payload | `useAICoach.ts` | 预处理器强制要求并校验时间戳 |
| 4 | 双重持久化：App.tsx 和 useAICoach 各 POST 一次 | `App.tsx handleEndSession` | 删除 App.tsx 侧调用，持久化只归 useAICoach 所有 |
| 5 | `weight: z.number().min(0)` 拒绝助力负重量（assisted 卡片录的就是 -10kg） | `sessionController.ts` | 去掉 min(0)，允许负重量 |
| 6 | 有氧的运动时间/心率/距离完全没统计（`heartRate` 字段连类型都没有） | 前端全局 | 预处理器按动作类型统计，`ExerciseSet` 补 `heartRate` 字段 |

## 二、新增 / 修改的文件

**新增**
- `src/v2/utils/workoutSummary.ts` — **预处理层**：原始 Exercise[] → 格式化训练记录（每动作一行汇总 + 会话级 stats）
- `src/v2/utils/workoutSummary.test.ts` — 12 个逐类别单元测试
- `backend/tests/unit/services/sessionSchema.test.ts` — 8 个契约测试
- `backend/scripts/e2e-session-dataflow.mjs` — 端到端验证脚本（可重复跑）

**修改**
- `types.ts` — `ExerciseSet` 增加 `heartRate?: number`
- `App.tsx` — localSummaryData 携带原始 exercises + 起止时间；移除重复持久化
- `src/v2/hooks/useAICoach.ts` — Phase 1 用 `buildSessionPayload` 预处理 + `getHeaders()`
- `backend/src/controllers/sessionController.ts` — schema 对齐格式化数据（`completed_sets`/`avg_hr`/有氧 stats 字段/负重量）
- `backend/src/services/agent/DeepAgentService.ts` — **系统提示词**新增 `SCENARIO_DATA_GUIDES.workout_complete`（教 Agent 按动作类型解读格式化数据）；agent 缓存按 scenario 分键
- `shared/contracts/index.ts` — 注释更新（scenario 现在驱动数据解读指引）

## 三、系统提示词如何应用数据

后端是单 Agent 架构（system prompt 不内联用户数据，数据靠 Agent 调 `load_history` 工具从 DB 读）。因此方案是：

1. **预处理格式化**（前端）：数据在入库前就按类型整理好，Agent 读到的直接是结构化摘要，不再是几百组原始 sets
2. **场景指引**（system prompt）：`workout_complete` 场景时，system prompt 注入数据解读规范：
   - resistance 行 → 看 `weight/reps/sets/completed_sets`，容量总数以 `stats.totalVolume` 为准（不要重算）
   - cardio/outdoor 行 → 看 `duration(秒)/distance(米)/avg_hr`
   - 缺失字段 = 未记录 ≠ 零表现，禁止编造数字
3. **预防幻觉**：workout-complete-handler 技能要求 Agent 只依据 `load_history` 返回的真实数据分析

## 四、逐类别验证结果

### 单元测试（12/12 通过）+ 契约测试（8/8 通过）

### 端到端（真实 HTTP → 真实 PostgreSQL，8/8 断言通过）

模拟一次包含 7 类动作的训练会话，POST → 落库 → 读回比对：

| 类别 | 动作 | 验证点 | 结果 |
|------|------|--------|------|
| resistance | 杠铃卧推 | weight=60, reps=10, sets=3 | ✅ |
| **cardio** | **跑步机** | **时长 1800s + 距离 4000m + 心率 145bpm** | ✅ |
| outdoor | 户外跑 | distance=8000m, avg_hr=138 | ✅ |
| isometric | 平板支撑 | duration=105s | ✅ |
| bodyweight | 俯卧撑 | reps=18（平均） | ✅ |
| assisted | 助力引体 | weight=-10（助力负重保留） | ✅ |
| unilateral | 箭步蹲 | weight=20, reps=12 | ✅ |
| stats | 会话级 | totalCardioDurationSec=5400, totalDistanceM=12000, avgHr=142 | ✅ |

DB 直查确认：`history_summary.sessions[-1]` 中所有字段完整落库，`load_history`（Agent 数据入口，同一条 SQL）可读到。

## 五、遗留卡点（需要你拍板）

> **2026-09-06 上午更新：卡点 1、2 已完成，见第六节。**

1. ~~**心率目前只能来自穿戴设备/手动录入**~~ → ✅ 已完成：有氧/户外卡片已加实际心率录入控件，全链路打通。
2. ~~**Agent 分析输出未验证**~~ → ✅ 已完成：新增 workoutQualityGate 数据一致性检测，编造数字的卡片会被拒绝并触发重试。LLM 端到端质量仍建议真机训练一次后人工确认。
3. **容器是重建后的新镜像**：本次为验证重建了 `backend-backend-1`（旧镜像里是断点代码）。如后续拉取旧镜像部署会复现已修断点。**注意：本次新增的心率 UI 与质量检测尚未打进容器镜像，下次部署需重新 build。**
4. **一处历史遗留测试已顺手修正**：`sseAgentClient.test.ts` 的错误消息断言与实现脱节（实现有意加了 `@url` 诊断后缀），已同步（31/31 通过）。

## 六、第二轮增量（2026-09-06 上午）

### 6.1 心率 UI（有氧/户外卡片）

四层打通：

| 层 | 文件 | 改动 |
|----|------|------|
| 协议 | `src/v2/types/protocol.ts` | set schema 增加 `heartRate`（min 0） |
| 桥接 | `src/v2/components/execution/ExerciseCardV2.tsx` | v2Exercise 映射带出 `heartRate`/`distance`；写回比较与透传增加心率 |
| UI | `plugins/RunningCard.tsx`（有氧）、`plugins/OutdoorExerciseCardV2.tsx`（户外） | 「目标 Zone」徽章旁新增实际心率输入框（40-220 bpm，数字键盘），输入即时同步父层，完成后锁定 |
| 类型 | `types.ts` | （上一轮已完成）`ExerciseSet.heartRate` |

数据闭环：卡片录入 → `handleUpdateSet`（`{...s, ...updates}` 自动透传）→ 训练结束 `workoutSummary` 聚合 `avg_hr` → POST /api/sessions → DB → Agent `load_history` 读到。

### 6.2 Agent 生成质量检测（workoutQualityGate）

**新文件**：
- `backend/src/services/agent/workoutQualityGate.ts` — 纯函数检测器
- `backend/src/services/agent/qualityFactsResolver.ts` — 从 DB（同 load_history 路径）读最新 session 真值，失败静默降级
- `__tests__/workoutQualityGate.test.ts` — 19 个单测

**机制**：`workout_complete` 场景下，卡片通过 schema 校验后追加**数据一致性检测**——从卡片文本提取「指标关键词 + 数字」（支持中文量词后置「12 组」、千分位、km/m 换算），与真实 stats 比对（容差：绝对差 ≤1 或相对 ≤2%）。编造数字 → `data_mismatch` 结构化错误 → 走既有 M5c 反馈重试回路让 Agent 自纠，超限则 `VALIDATION_ERROR`。

**防误伤**：百分比、RPE、组序号（第3组）、休息秒数等不相关数字不校验；stats 缺失/为 0 的指标跳过；非 workout_complete 场景完全不启用。

**接入点**：`uiHintValidationLoop.ts`（chatWithValidationLoop 每轮加载一次 facts，consume 时对每张卡检查）。

### 6.3 顺手修复的历史遗留测试（基线即挂，stash 验证）

- `uiHintValidator.test.ts`（4 处）：plan_card fixture 补 `exercise_type`/`weight`（schema 后加的必填项）；survey_card 从黑名单断言改为放行断言（v3 修订已解除黑名单）
- `uiHintValidationLoop.test.ts`（2 处）：VALID_PLAN fixture 同步 schema

### 6.4 测试汇总（本轮全绿）

| 套件 | 结果 |
|------|------|
| workoutQualityGate（新） | 19/19 |
| uiHintValidator（修复后） | 22/22 |
| uiHintValidationLoop（修复后） | 5/5 |
| uiHintFormat / uiHintExtractor | 11/11 + 14/14 |
| sessionSchema 契约 | 8/8 |
| 前端 workoutSummary + sseAgentClient | 31/31 |
| typecheck（前端 + 后端） | ✅ |

## 七、完整端到端验证（2026-09-06，真实 LLM）

复跑方式：`cd backend && node scripts/e2e-full-dataflow.mjs`（前置：docker backend 已 build 最新代码并运行）

链路：格式化 payload → `POST /api/sessions` → DB → `POST /api/chat (workout_complete, SSE)` → Agent 调 `load_history` → 真实 LLM 分析 → 数据一致性校验 + 质量门反向验证。

### 结果（14/14 PASS，SSE 耗时 9-33s）

| 阶段 | 验证点 | 结果 |
|------|--------|------|
| A 持久化 | 含心率 7 类动作 payload → 201 | ✅ |
| B 读回 | avg_hr 145/138、距离 12000m、全局心率 142 落库 | ✅ |
| C Agent | SSE 流式 200 → done、无 error、真实 LLM 文本非空 | ✅ |
| D 质量 | Agent 引用数字（2280kg/13组/5400秒/12000m/142bpm）与库内真值逐一吻合 | ✅ |
| E 质量门 | 编造卡片（9999kg/190bpm/42km）被拒 ≥2 个 mismatch；诚实卡片放行 | ✅ |

### 两个重要的行为验证

1. **反幻觉红线生效**：清空 sessions 后再调 workout_complete，Agent 明确回复「数据库里没有真实数据可读，工作流红线禁止编造训练数字，任何分析都会是虚构的」——拒绝输出，而不是编一份总结。
2. **Agent 智能超出预期**：连续跑 E2E 写入 4 条相同测试数据后，Agent 主动识别出「同一场训练被重复持久化」，指出污染源并建议核查前端 `POST /api/sessions` 调用——这是数据解读指引 + 真数据 grounding 的直接证明。

### E2E 脚本文件

- `backend/scripts/e2e-full-dataflow.mjs` — 主脚本（A-E 五阶段 14 断言）
- `backend/scripts/quality-gate.mjs` — 质量门判定逻辑的 E2E 桥接副本
- `backend/scripts/e2e-session-dataflow.mjs` — 上一轮的数据层子集（无 LLM）

## 八、复跑方式

```bash
# 单元 + 契约
cd main && npx vitest run src/v2/utils/workoutSummary.test.ts
cd backend && npx tsx --test tests/unit/services/sessionSchema.test.ts

# 数据层端到端（需 docker backend 运行中，无 LLM）
cd backend && node scripts/e2e-session-dataflow.mjs

# 完整端到端（含真实 LLM 分析，消耗 DeepSeek 配额）
cd backend && node scripts/e2e-full-dataflow.mjs
```
