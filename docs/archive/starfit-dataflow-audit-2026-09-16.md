# Starfit 运动数据传输排查报告 + 平板支撑计时 Bug 分析

日期：2026-09-16 · 排查人：麦子 · 方法：全量代码审读 + 9 类动作传输探针实测（vitest 临时用例，11 例全跑通后已删）

---

## 一、平板支撑「点结束→直接显示达成目标」根因（实锤）

### Bug 1【用户报告的直接根因·UI 显示层】完成后永远显示目标时长，不显示实际时长

`src/v2/components/execution/plugins/IsometricCard.tsx:159`

```ts
const displayDuration = isActive ? (elapsedMap[...] || 0)
                                 : (set.targetDuration || metadata.targetDuration || 30);
```

三元只区分「活跃/非活跃」——**非活跃组（包括已完成的组）一律显示 targetDuration**，
实际记录在 `set.duration` 里的值从不展示。行为还原：

1. 开始计时，撑到 15s 点停止；
2. `toggleStatus` 分支 2 **确实把实际 15s 写进了 `set.duration`**（数据层是对的）；
3. 但 UI 立即切换为显示目标值 30s + 进度条 100% + 整行 `opacity-30` 变灰
   → 用户看到的就是「时间跳回目标、显示达成」，实际支撑时长被界面藏掉了。

**修法**：非活跃且已完成的组显示 `set.duration ?? targetDuration`，进度条按实际/目标比例。

### Bug 2【数据层·目标时长在 V2 桥接层丢失】

`src/v2/components/execution/ExerciseCardV2.tsx:56-66` 的 sets 映射**没有透传 `targetDuration`**，
metadata 映射只带 `targetDurationSec`、不带 `targetDuration`（而计划导入写的是
`metadata.targetDuration`，见 `App.tsx:521`）。

后果链：计划里给平板支撑设目标 45s → 卡片里 `IsometricCard.tsx:42` 三级回退全部落空 →
**目标恒等于兜底 30s**，自动停止/进度条全按 30s 算。
（锁定屏 LockScreen 不受影响：它直接吃 legacy `Exercise[]`，`set.targetDuration` 还在。）

**修法**：桥接层 sets 补 `targetDuration: s.targetDuration`，metadata 补 `targetDuration: exercise.metadata?.targetDuration`。

### Bug 3【口径缺口】isometric 完成后走 App 层 60s restEndTime，但卡片不显示休息倒计时

`App.tsx handleUpdateSet` 对任何 `completed:false→true` 都写 60s 休息（含 isometric），
锁定屏能倒计时，但 `IsometricCard` 卡内没有休息 UI（只有 ResistanceCard 有）。
数据有、界面无——静力组间休息在主训练页「隐形」。

---

## 二、9 类动作传输数据探针结果（POST /api/sessions 口径 = workoutSummary.ts）

实测输出（每动作一行聚合 + 会话级 stats）：

| 类型 | 构造输入 | 实测传输 | 判定 |
|---|---|---|---|
| resistance | 60kg×10, 60kg×8 | weight:60, reps:9, sets:2, completed:2 | ✅ 符合直觉 |
| bodyweight | 自重 0kg×8/×6, referenceBodyweight=70 | reps:7；**stats.totalVolume=0** | ⚠️ Bug 4 |
| assisted | -20kg(助力)×10 | weight:-20 保留正确；**stats.totalVolume=-200 → 后端 Zod `min(0)` 必 400** | ❌ Bug 5 |
| isometric | 实撑 15s（目标 30） | duration:15 正确传输；容量兜底硬编码 75kg | ⚠️ Bug 6 |
| isometric 自动达成 | 45s/45s | duration:45 | ✅ |
| cardio | 20min/3.5km/HR150 | duration:1200, distance:3500, avg_hr:150 | ✅ |
| outdoor | 30min/2km | duration:1800, distance:2000 | ✅ |
| unilateral | 10kg×10 | 容量 100（History UI 算 200，×2 口径分裂） | ⚠️ Bug 7 |
| weight_only / reps_only | 40kg / 12次 | 各自正确 | ✅ |
| 未完成组 | completed=false 但有 reps | 正确排除，completed_sets=1 | ✅ |
| **休息时间** | restEndTime=+60s | **payload 中完全不存在** | ❌ Bug 8 |

### Bug 4【容量口径三分裂】bodyweight 自重训练容量=0

- `workoutSummary.ts`（→ /api/sessions + Agent）与 `settlementSummary.ts`（结算页）：`(weight||0)×reps` = 0
- `History.tsx:46`：`(referenceBodyweight + weight) × reps` = 非零

同一个训练，历史页容量 ≠ 结算页容量 ≠ 落库容量。Agent 拿到的 totalVolume 不含自重贡献。

### Bug 5【assisted 负容量 → 后端 400，持久化静默失败】

探针实锤 totalVolume=-200（助力 -20kg×10）。后端 `sessionController.ts StatsSchema:
totalVolume: z.number().min(0)` → POST /api/sessions 返回 400。
`useAICoach.ts` 的 catch 只打日志继续跑 Agent → **该次训练的格式化持久化静默丢失**，
只剩 sync/push 原始路径兜底。单 assisted 动作课（双杠臂屈伸之类）必触发。

**修法**：容量口径统一时给 assisted 用 `max(0, 体重-助力)×reps`（与 History/设置页一致），顺带天然非负。

### Bug 6【isometric 容量兜底仍是硬编码 75kg】

`workoutSummary.ts:121`：无配重按 75kg 兜底；而 App.tsx:1061 注释明确拍板「isometric 无配重走
referenceBodyweight 兜底，取代旧硬编码 75kg」——拍板只在 settlementSummary 落地，
**workoutSummary 没同步**。referenceBodyweight=70 的用户落库容量虚高。

### Bug 7【unilateral ×2 口径分裂】

History.tsx 与 ExerciseSettingsModal 按 `weight×reps×2`（左右各一遍），
workoutSummary/settlementSummary 按 `weight×reps`。落库值恒为界面一半。

### Bug 8【休息时长全链路无记录——本次排查最重要的数据缺口】

现状三层全部缺失：

1. `ExerciseSet` 只有 `restEndTime`（**结束时刻**时间戳），没有休息开始/时长字段；组完成也没写
   `completedAt`，所以事后连「倒推实际休息了多久」都做不到（restEndTime 可能被 +20s、暂停平移多次改写）。
2. `workoutSummary.formatExerciseEntry` 直接丢弃 restEndTime → /api/sessions 聚合 payload 零休息信息。
3. `markdownExportService.ts:291` 读 `set.restTime || set.rest_time` ——**全仓库没有任何代码写过这个字段**，恒为 '-'。

**建议设计（最小改动）**：
- `ExerciseSet` 增加 `completedAt?: number`（组完成时刻，完成时一次性写入）；
- 休息时长 = `min(restEndTime, 下一组 completedAt) − 上一组 completedAt`，负值/缺失丢弃；
- `formatExerciseEntry` 聚合出每动作 `rest_sec`（及组级明细进 metadata），Agent/历史页即有真休息数据；
- sync/push 原始路径因为保留全量 raw_json，加了 completedAt 后自动受益。

---

## 三、顺带发现的其他问题

| # | 问题 | 位置 | 严重度 |
|---|---|---|---|
| 9 | **HIIT/计时卡（CardioCard）自由计时默认目标 60s**：`targetDuration = set.targetDuration \|\| metadata.targetDuration \|\| 60`，停止时 `finalDuration = min(elapsed, target)`，且计时器 60s 即自动完成 → 无目标时长的 HIIT 组超过 60s 被**截断成 60s** | `plugins/CardioCard.tsx:68,71,156-160` | 高 |
| 10 | **暂停中任何组更新都自动恢复会话**（AUTO-RESUME）：暂停状态下改重量/点组 → `handleResumeSession()`，用户感知「明明暂停了却继续计时」，pausedDuration 统计随之失真 | `App.tsx handleUpdateSet` | 中（需产品确认是否有意） |
| 11 | `/api/sessions` payload 不含 `pausedDuration`：走该路径时 Agent 无法区分净训练时长与挂钟时长（sessions 表 duration=end−start，含暂停） | `workoutSummary.ts buildSessionPayload` | 中 |
| 12 | RunningCard FREE_RUN 模式「目标」位显示 `00:00` 倒计时（cosmetic） | `plugins/RunningCard.tsx:189` | 低 |
| 13 | ResistanceCard 休息暂停冻结逻辑正确（pauseStartTime 冻结+恢复平移 restEndTime），实测口径一致——**这一块没问题**，作为对照确认 | `App.tsx handleResumeSession` / `ResistanceCard.tsx:97-111` | ✅ |

## 四、结论与建议优先级

P0（用户可直接感知的数据错误）：
1. Bug 1（isometric 显示实际时长）+ Bug 2（桥接层透传 targetDuration）——一起修
2. Bug 8（休息时长记录：ExerciseSet.completedAt + workoutSummary 聚合 rest_sec）
3. Bug 5（assisted 容量 400，与 Bug 4/6/7 一并做「容量口径统一到 settlementSummary 语义」）

P1：Bug 9（CardioCard 60s 截断）；Bug 10 需用户拍板 AUTO-RESUME 是否保留。

验证路径建议：修完后跑 `e2e-session-dataflow.mjs`（7 类动作断言）+ 把本次探针用例固化为
`workoutSummary` 回归测试（含 assisted 负值、bodyweight 容量、rest_sec 聚合三例），
最后模拟器逐类型点一遍核对落库 raw_json。
