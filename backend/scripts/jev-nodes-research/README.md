# jev-nodes-research — 线G' Jev 决策节点深化研究脚本（#160 二次定调 + #155）

纯调研脚本目录（零产品代码改动；spec 见 `docs/research/jev-nodes-spec.md`）。

## 脚本

### replay-baseline.ts — 现状基线回放（真实 LLM）

量化新用户引导（问卷轮）与计划生成轮的 thinking 压力。进程内回放（复用
#72/#151 replay-stream-card 方法）：新用户两轮剧本，scenario=chat（#160 实锤
isPlanMode 死路，真实用户路径恒 chat）。

```bash
cd backend
GLM_API_KEY=… DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit \
  npx tsx scripts/jev-nodes-research/replay-baseline.ts
# env：RUNS(默认3) | HARD_TURN_CAP(默认8，配额硬顶) | KEEP=1 跳过清理 | EVENTS_DIR
#      TURN1_MSG / TURN2_MSG 剧本覆盖（对照组实验）：
#      模板命中对照示例（新手×居家×3练 → t1）：
#      TURN2_MSG="目标增肌；之前没系统练过；家里有哑铃和训练凳；一周能练3次；体重75公斤；没有伤病。信息齐了，直接给我完整的周计划。"
#      默认 turn2（中级×居家×4练）= 模板矩阵半命中陷阱 → 自由路径（spec §3.z）
```

- 每轮计量：thinking 块/字符、token 块/字符、卡型+模板指纹、墙钟、逐事件
  相对时间戳。
- 产出：`results/replay-baseline.json` + `results/replay-events-run{N}.jsonl`
  （含 thinking 头 240 字符，供离线推理占比分析）。
- 清理：默认删除测试用户（`device_id` 前缀 `jev-nodes-replay-`）与对应
  checkpoints。
- 已知限制：脚本内 `collectToolRounds` 对消息类型识别失败（输出空）——工具
  序列用下面的 extract-tool-rounds.ts 离线取。

### extract-tool-rounds.ts — 工具序列离线提取（零 LLM 成本）

从 agent_runtime checkpointer 读 thread 消息，输出每 turn 模型轮次与工具
调用序列。注意 service 内部 thread_id = `${userId}:${threadId}`（拼接见
DeepAgentService L597），userId 从 users 表查 device_id 前缀获得。

```bash
cd backend
DATABASE_URL=… npx tsx scripts/jev-nodes-research/extract-tool-rounds.ts "<userId>:<threadId>"
```

### jev-node-probe.mjs — 关键判定节点 dmx jev 实测

三组判定节点质量/延迟/成本（与 jev-spike 的意图路由互为补充）：

- **N1 问卷完整性**（6×choice missing|known，12 样本）→ 11/12
- **N2 引导路径**（choice full_intake|gap_fill|direct_plan|clarify，同 12 样本）→ 7/12
  （结构性教训：阈值题是 Jev 坏问题——路径应由代码函数消费 N1 事实）
- **N3 画像档位**（tier choice novice|intermediate + readiness score，10 样本，
  含 5/6/7 月训练龄边界与口语化描述）→ 10/10

```bash
cd backend
DMXAPI_API_KEY=<dmxapi.cn key> node scripts/jev-nodes-research/jev-node-probe.mjs
# env：JEV_ENDPOINT(默认 dmx typesafe/v1/systemone) | JEV_MODEL(jev-1.13.0) | JEV_TIMEOUT_MS(10s)
```

- 产出：`results/jev-node-probe.json`（逐样本判定/置信度/延迟/usage）。
- 成本：22 次调用 ≈ 21k input tok ≈ $0.0009（单价 $0.042/M，output 免费）。

### analyze-thinking.mjs — thinking 主题占比（启发式）

对 events JSONL 的 thinking 头做关键词分桶。口径注意：GLM 思考是中英混合
逐词 delta 流，中文关键词桶只能覆盖中文段；「其他推理」≈英文自由推理流
（spec §3.4 有分桶口径的完整说明）。

```bash
node scripts/jev-nodes-research/analyze-thinking.mjs [results-dir]
```

## 本批实测数据（2026-10-09，复现锚点）

| 文件 | 内容 |
| --- | --- |
| `results/replay-baseline-free.json` | 自由路径组（中级×居家×4练）×2 完整汇总（半命中陷阱两轮复现） |
| `results/replay-events-free-run{1,2}.jsonl.gz` | 自由路径组事件流（127K/117K thinking 字符；`gunzip -c` 后喂 analyze-thinking.mjs） |
| `results/replay-baseline.json` + `results/replay-events-run1.jsonl.gz` | 模板命中组（新手×居家×3练 → t1，RUNS=1 + TURN2_MSG 覆盖；指纹「新手 · 居家全身」逐字命中） |
| `results/jev-node-probe.json` | Jev 判定节点 22 调用原始数据 |

配额账：真实 LLM 回放 6 turn（2 运行×2 + 模板组 1×2）≤ 10 红线；jev 22 次
$0.00088 ≤ $0.02 红线。

## 复现注意

- 密钥只从环境变量注入，绝不写入本目录任何被跟踪文件（公开仓红线）。
- replay 走 GLM CodingPlan 配额（配额纪律：真 LLM 回放 ≤10 轮尝试）；jev
  走 dmx 按量（自我设限 ≤$0.02）。
- GLM-5.3-flash 计划轮单轮 3-10 分钟属正常；脚本必须重定向到文件再查
  （禁 head 管道假死，starfit-test-infra 记录）。
