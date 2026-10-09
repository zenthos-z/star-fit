# thinking-off-exp — 关思考实验 A2b（#155 #160）

任务书：`/Users/Admin/Documents/agent-output/projects/starfit/prompts/thinking-off-exp.md`
（议题 #155 #160；spec 背景 `docs/research/jev-nodes-spec.md` §6.4）

命题：计划生成轮 thinking 关闭（GLM `thinking:{type:'disabled'}`）后，墙钟/TTFT
提速多少？卡片质量是否存活（校验回路打回/模板指纹/吞卡/泄漏）？

## 关键配置事实（self-check.ts 7/7 实证）

- **正确键是 `THINKING_DISABLED_CHAT=true`**，不是任务书草案的
  `THINKING_DISABLED_PLAN=1`——两处陷阱：
  1. 回放剧本 scenario 恒为 `chat`（#160 实锤 isPlanMode 死路），`PLAN` 键不匹配；
  2. `resolveThinkingConfig` 的 `parseDisabledFlag` 只认 `true`/`false`，`1`
     被视为未配置落穿到默认层（思考仍开）。
- 生效链路：env → `resolveThinkingConfig("chat")` → `loadModel` glm 分支
  `modelKwargs:{thinking:{type:'disabled'}}`（并入请求体，@langchain/openai
  completions.js `...this.modelKwargs` 实证）。
- 注意粒度：开关按 scenario（chat）生效，**问卷轮与计划轮一起被关**——问卷轮
  数据是附带观测，不在对照范围（任务书明示问卷轮剂量小不做实验对象）。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `self-check.ts` | 零 LLM 自检：DB 无覆盖行、键/值双陷阱实证、loadModel 构造体带 disabled kwargs、默认链不回归 |
| `replay-thinking-off.ts` | 实验组回放（复用 jev-nodes-research 剧本与计量 + 质量门新增：打回计数/疑似泄漏/token 头落盘/工具轮次进程内修复） |
| `analyze-results.mjs` | 离线对照分析（实验 vs 基线；thinking 事件二分：reasoning 流式 delta vs 工具复述整块） |

## 复现（深夜窗 + 配额纪律）

```bash
cd backend
KEY=<GLM CodingPlan key>
COMMON="DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit GLM_API_KEY=$KEY THINKING_DISABLED_CHAT=true"

# 自检（零 LLM）
env -u NODE_ENV DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit \
  GLM_API_KEY=$KEY npx tsx scripts/thinking-off-exp/self-check.ts

# 实验组场景1：矩阵命中（新手×居家×3练 → t1）×2 run
env -u NODE_ENV $COMMON GROUP=hit RUNS=2 HARD_TURN_CAP=4 \
  TURN2_MSG="目标增肌；之前没系统练过；家里有哑铃和训练凳；一周能练3次；体重75公斤；没有伤病。信息齐了，直接给我完整的周计划。" \
  npx tsx scripts/thinking-off-exp/replay-thinking-off.ts

# 实验组场景2：半命中（中级×居家×4练，默认 TURN2_MSG）×2 run
env -u NODE_ENV $COMMON GROUP=half RUNS=2 HARD_TURN_CAP=4 \
  npx tsx scripts/thinking-off-exp/replay-thinking-off.ts

# 对照分析
node scripts/thinking-off-exp/analyze-results.mjs
```

对照组不重跑：直接用 `../jev-nodes-research/results/`（矩阵命中×1 +
半命中×2，2026-10-09 基线，spec §3）。

## 产物

| 文件 | 内容 |
| --- | --- |
| `results/replay-{hit,half}.json` | 实验组汇总（含质量门新计量） |
| `results/replay-events-{hit,half}-run{N}.jsonl(.gz)` | 逐事件流（thinking 头 240 + token 头 120 字符） |
| `REPORT.md` | 实验报告（对照表+结论+归因警示） |

配额账：实验组 8 turn（2 场景 × 2 run × 2 turn）+ 1 次误判中止的半截计划轮
（详见 REPORT.md 披露）≤ 任务书红线，含余量。

## 卫生

- 测试用户（device_id 前缀 `thinking-off-replay-`）与 checkpoints 用后即删
  （对齐 G' 清理标准；脚本默认执行，KEEP=1 跳过）。
- 密钥只经环境变量注入，不入任何被跟踪文件。
