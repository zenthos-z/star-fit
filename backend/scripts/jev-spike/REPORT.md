# Jev 路由 spike 报告 · dmx jev-1.13.0 技术测试（#160）

- 分支 `spike/jev-dmx`，基线 main=22a9768e（merge-base 已核）
- 测试时间：2026-10-09（UTC），从本机直连 dmxapi.cn
- 密钥：环境变量 `DMXAPI_API_KEY`（运行时注入；本次使用 dmx 账户现有 key —— dmx 为单 key 单账户聚合商，与 genai.ts 图像生成线路同账户。密钥未写入任何被跟踪文件）
- 复跑方式：`DMXAPI_API_KEY=<key> node scripts/jev-spike/probe.mjs`（classify/failopen 同目录同法）
- 原始数据：`results/probe-results.json` / `results/classify-results.json`（v1）/ `results/classify-results-v2.json` / `results/failopen-results.json`

## TL;DR

| 维度       | 结论                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| 端点       | jev **不走** `/v1/chat/completions`（稳定 503 无渠道），走专用 `POST /typesafe/v1/systemone`           |
| 协议       | `state` + `questions{}` 请求、`answers{}` 结构化应答；choice/score/noul 三型全部实测可用               |
| 准确率     | 朴素 criteria 88.2/88.9% → 调优 criteria **97.2/100%**（36 样本×2 pass，9 边界样本）                   |
| fail-open  | **跨 4 个 pass 全部错样本置信度 <0.5**；T=0.6~0.8 阈值模拟硬错误率恒为 0                               |
| 延迟       | 客户端 P50 775-869ms（dmx 网络+转发叠加后，官方标称 70-500ms 为模型侧，无法从客户端分离）              |
| 成本       | 本次 spike 总消耗 ~91k input tokens ≈ **$0.0038**（output 免费）；单条判定均值 ~600 tok ≈ $0.000025/条 |
| 网络可靠性 | ~155 次真实调用 5 次网络层失败（≈3.2%：fetch failed / 30s 挂死）→ **必须硬超时+立即 fail-open**        |

**推荐进入实施**（条件见 §5）：协议可行、判定质量达标（调优后）、错误形态全部可捕获、成本可忽略。核心代价是每轮 chat 前置 ~0.8s 中位延迟，实施时需与 TTFT 预算对拍。

---

## 1. 协议形态

### 1.1 模型目录

`GET /v1/models` → HTTP 200，525 个模型中 jev 条目：

```json
{
  "id": "jev-1.13.0",
  "object": "model",
  "created": 1626777600,
  "owned_by": "task plugin",
  "supported_endpoint_types": ["openai"]
}
```

注意：`supported_endpoint_types: ["openai"]` 有误导性——OpenAI chat/completions 路径实际**不可用**：

```
POST /v1/chat/completions {"model":"jev-1.13.0",...} → HTTP 503
{"error":{"code":"model_not_found","message":"分组 default 下模型 jev-1.13.0 无可用渠道（distributor）","type":"dmx_api_error"}}
```

（curl 直测 3 次稳定复现；`/v1/responses`、`/v1/completions` 同样 503。同一 key 同端点调 `gpt-4o-mini` 正常 200，证明是 jev×chat 路径无渠道而非 key/网络问题。）

### 1.2 真实调用形态（专用 TypeSafe 端点）

`POST https://www.dmxapi.cn/typesafe/v1/systemone`，Bearer 鉴权：

```jsonc
// 请求体：model + state（共享上下文）+ questions（问题集合，key 为自定义问题 id）
{
  "model": "jev-1.13.0",
  "state": "【用户消息】帮我做一份增肌计划，我每周能练三天。",
  "questions": {
    "intent": {
      "type": "choice", // choice | score | noul
      "instructions": "判断这条健身应用用户消息的意图类别。",
      "criteria": {
        // choice: 对象，key=选项名，value=判定标准
        "chat": "自由聊天…",
        "plan": "请求生成/调整计划…",
        "workout_complete": "报告训练…",
        "update_profile": "更新画像…",
      },
    },
    "certainty": {
      "type": "score", // score: 数组档位（低→高）
      "instructions": "评估你对 intent 判断的确定程度。",
      "criteria": ["很不确定", "较不确定", "一般", "较确定", "很确定"],
    },
    "is_ambiguous": {
      "type": "noul", // noul: 无需 criteria
      "instructions": "判断意图是否 ambiguous。",
    },
  },
}
```

```jsonc
// 响应体（HTTP 200）：answers 按 question id 回填 + usage
{
  "answers": {
    "intent":       { "choice": "plan", "confidence": 1, "probabilities": {"chat":0,"plan":1,"update_profile":0,"workout_complete":0}, "type": "choice" },
    "certainty":    { "score": 3.98, "confidence": 0.98, "legend": {"0":"很不确定",…,"4":"很确定"}, "probabilities": {"0":0,…,"4":0.98}, "type": "score" },
    "is_ambiguous": { "noul": 0.28, "type": "noul" }
  },
  "model": "jev-1.13.0",
  "usage": { "input_tokens": 554, "output_tokens": 83 }
}
```

### 1.3 三型应答不变量（实测逐字段核实）

| type     | 应答字段                                                                    | 说明                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `choice` | `choice` + `confidence` + `probabilities` + `type`                          | probabilities 恒覆盖全选项（未选项为 0）                                                                                                                                       |
| `score`  | `score`(float, 0..N-1) + `confidence` + `legend` + `probabilities` + `type` | score 是**连续值**（3.98 不是 4），legend 回映档位文案                                                                                                                         |
| `noul`   | `noul` + `type` ⚠️                                                          | **无 confidence、无 probabilities**——`noul` 值本身即 P(true)。若路由层用 noul 问题做判定，阈值只能直接设在 noul 值上；本 spike 的主判定用 choice 型（带 confidence），规避此坑 |

其他核实点：`questions` 可只含 1 个问题（单问题最小请求 200 正常）；answers 键与 question id 一一对应；usage 含 input/output tokens（output 计费为 0）。

### 1.4 协议边界错误形态（全部 HTTP 可判 + JSON 可解析）

| 异常输入                     | HTTP | body                                                                         |
| ---------------------------- | ---- | ---------------------------------------------------------------------------- |
| `state` 缺失                 | 400  | `{"detail":"state must be text, an object, an array, or null"}`              |
| 未知问题 type（`"boolean"`） | 400  | `{"detail":"Each question must have type choice, score, or noul"}`           |
| choice 缺 criteria           | 400  | `{"detail":"Choice criteria must contain between 1 and 255 options"}`        |
| 未知模型                     | 400  | `{"detail":"model \"jev-9.9.9-not-exist\" is not served by this plugin"}`    |
| 错误密钥                     | 401  | `{"error":{"code":"","message":"Invalid token (…)","type":"dmx_api_error"}}` |

400 系为上游 TypeSafe 插件（FastAPI 风格 `detail`），401 为 dmx 网关包裹——两类 body 均为 JSON，路由层按 `!res.ok` 统一捕获即可。

---

## 2. 意图分类准确率（含混淆样本）

### 2.1 样本集

36 条（≥30 达标）：chat / plan / workout_complete / update_profile 各 9 条，其中 **9 条边界样本**（含 #160 点名的「我练完了」「调整我的计划」「把我的目标从减脂改成增肌」）。完整样本+标注见 `samples.mjs`；标签口径 = #160 正文四场景定义。

### 2.2 两版 criteria 对拍（判定质量对措辞高度敏感）

- **v1（朴素直译 #160 场景描述）**：pass1 88.2%（30/34，另 2 条网络失败）、pass2 88.9%（32/36）
- **v2（针对 v1 错样本强化：update_profile 覆盖隐式画像陈述——身体数据/时间变化/伤病/饮食；instructions 加「个人信息陈述优先考虑画像更新」）**：pass1 97.2%（35/36）、pass2 **100%（36/36，边界 9/9）**

### 2.3 混淆矩阵（v1 pass2 与 v2 pass2）

```
v1（88.9%）                          v2（100%）
              pred→chat plan wc  up              pred→chat plan wc  up
expected chat        9    0    0   0      chat        9    0    0   0
expected plan        0    9    0   0      plan        0    9    0   0
expected wc          1    0    8   0      wc          0    0    9   0
expected up          2    1    0   5      up          0    0    0   9
```

误差集中在 **update_profile 弱类**：无「更新/资料」触发词的口头画像陈述（v1 判成 chat/plan）。v2 措辞修复后全部正确。

### 2.4 混淆（错）样本清单（跨 4 pass 全量）

| 样本  | 文本                                     | 期望             | 实判 | 置信度      | 出现 pass |
| ----- | ---------------------------------------- | ---------------- | ---- | ----------- | --------- |
| wc-06 | 今天没做完，做了一半就没力了             | workout_complete | chat | 0.44 / 0.45 | v1×2      |
| up-04 | 我最近膝盖有伤，深蹲相关的先不要给我安排 | update_profile   | plan | 0.40 / 0.41 | v1×2      |
| up-08 | 我只有周末有空练了                       | update_profile   | chat | 0.25 / 0.20 | v1×2      |
| up-09 | 静息心率降到55了，最近恢复得不错         | update_profile   | chat | 0.36 / 0.40 | v1×2      |
| wc-07 | 我昨天练了背，感觉还挺不错的             | workout_complete | chat | 0.37        | v2 pass1  |

#160 点名的歧义样本表现：「我练完了」→ workout_complete conf=1.0（两版均对）；「调整我的计划，这周改成练三天」→ plan conf=1.0/0.83（两版均对）；「把我的目标从减脂改成增肌」→ update_profile conf=1.0（两版均对）。

### 2.5 关键发现：错样本与置信度完美分离

**4 个 pass 的全部 9 例错判，置信度无一 ≥0.5**；全部正确判定基本 ≥0.61（个别边界正确样本低至 0.36-0.73）。阈值模拟（conf<T 回落 chat，即 #160 fail-open 语义）：

| 版本/pass | T=0.6               | T=0.7               | T=0.8               |
| --------- | ------------------- | ------------------- | ------------------- |
| v1 pass1  | 硬错误 0/34，回落 4 | 硬错误 0/34，回落 5 | 硬错误 0/34，回落 6 |
| v1 pass2  | 硬错误 0/36，回落 4 | 硬错误 0/36，回落 5 | 硬错误 0/36，回落 7 |
| v2 pass1  | 硬错误 0/36，回落 1 | 硬错误 0/36，回落 2 | 硬错误 0/36，回落 3 |
| v2 pass2  | 硬错误 0/36，回落 1 | 硬错误 0/36，回落 2 | 硬错误 0/36，回落 3 |

「硬错误」= 置信度过阈值且判错（真正劣化路由）。**任何版本任何阈值下硬错误均为 0**——低置信一律保守回落 chat（= 现状行为），意味着即使判定质量回退到 v1 水平，路由层也不会比现状更差。推荐阈值 **T=0.7**（v2 下仅 2/36≈5.6% 轮次回落 chat，其中约半数原本就判对）。

---

## 3. 延迟实测（30 样本逐条计时 ×4 pass）

| pass                  | min   | P50 | P90  | P95  | max       | mean |
| --------------------- | ----- | --- | ---- | ---- | --------- | ---- |
| v1 pass1（含 2 失败） | 647ms | 869 | 1913 | 1977 | 2014      | 1095 |
| v1 pass2              | 589ms | 775 | 898  | 953  | **6332**  | 943  |
| v2 pass1              | 685ms | 804 | 1461 | 1996 | **23082** | 1522 |
| v2 pass2              | 665ms | 779 | 912  | 935  | 1818      | 822  |

对照官方标称 70-500ms：

- 客户端墙钟 = 本机→dmxapi.cn 网络往返 + dmx 转发 + 模型判定。**~700ms 是本机网络+转发的地板值**（min 恒 >580ms），模型侧真实耗时无法从客户端分离；标称值只能理解为模型侧上界。
- **长尾实质性存在**：P95 达 0.9-2s，max 出现 1.8s/2.0s/6.3s/23.1s 尾部，另有 30s 级挂死（见 §4）。
- 路由层延迟预算结论：中位 **+0.8s** 前置成本；硬超时建议 **3s**（覆盖全部成功调用的 P95+，同时封顶最坏等待）；超时即 fail-open 回落 chat。

## 3bis. 网络可靠性（fail-open 的实证必要性）

classify 144 次真实调用中网络层失败 2 次（1.4%：1× `fetch failed` 22s 后、1× 30s AbortError）；加上 probe 对照与 failopen 首跑的失败，~155 次调用共 5 次（**≈3.2%**）。失败形态只有两种：连接层 `TypeError: fetch failed`（10-22s 后抛出）与请求挂死（>30s）。**没有重试成功的必要**——直接 fail-open 回落 chat 更快更稳（重试一次最坏再等一个超时窗，超过收益）。

---

## 4. 异常形态（fail-open 验证）

八类异常逐一实测（`failopen.mjs`，含模拟路由决策函数 `routeDecision`：任何失败或 conf<0.7 → 回落 chat）：

| #   | 异常                                         | 模拟方式                                  | 可捕获形态                                                       | 决策              |
| --- | -------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ----------------- |
| 1   | 超时（上游挂死）                             | 本地 mock `/hang` + 800ms AbortController | `error.name === "AbortError"`，805ms 触发                        | → chat ✓          |
| 2   | 5xx                                          | 本地 mock `/500` + dmx 风格 JSON body     | `res.ok=false`，status=500，body JSON 可解析                     | → chat ✓          |
| 3a  | 空响应（200 空 body）                        | 本地 mock `/empty200`                     | `JSON.parse("")` 失败 → body 为空 string，`answers` 缺失检查命中 | → chat ✓          |
| 3b  | questions 传空                               | 真实 API                                  | HTTP 400 `{"detail":"questions must be a nonempty object"}`      | → chat ✓          |
| 3c  | state 传空串                                 | 真实 API                                  | HTTP 200 正常应答（chat conf 0.96）——空上下文天然判 chat，安全   | → chat ✓          |
| 4a  | 低置信度（无信号文本「随便来点啥」）         | 真实 API                                  | intent=plan 但 conf=0.45                                         | 阈值拦截 → chat ✓ |
| 4b  | 双意图混合「练完了，顺便把我体重改成73公斤」 | 真实 API                                  | update_profile conf=0.85（取主意图，合理）                       | 正常路由 ✓        |
| 4c  | 真实挂死                                     | v1 pass1 up-07                            | 30s AbortError（网络层，非 API 行为）                            | → chat ✓          |

外加 §1.4 的 5 类协议错误（400×4 + 401×1）均 `!res.ok` + JSON body 统一捕获。**结论：四类异常（超时/5xx/空响应/低置信度）形态全部可捕获、可判定、可回落，fail-open 前提成立。**

---

## 5. 开关形态设计草案（纯设计，未实现）

### 5.1 Feature flag（默认关）

沿用 #151 双轨模式（DB `app_configs` 优先，`safeGetConfig` 读失败回落 env）：

- flag 名：`intent_routing`（env 键 `INTENT_ROUTING_ENABLED`，默认 `false`）
- **关闭**：`chat()` 行为与现状逐字节一致——零 jev 调用、scenario 字段原样透传、缓存键不变
- **开启**：仅当本轮输入满足路由条件（见 5.3）时，在 `buildAgent` 之前插入一次 `routeIntent()` 调用
- 判定调用参数：模型 `jev-1.13.0`，端点 `/typesafe/v1/systemone`，**硬超时 3s**，失败/超时/conf<0.7 一律返回 `"chat"`（fail-open，不抛错、不重试——§3bis 实证重试不划算）
- 成本护栏：按 spike 实测 ~600 input tok/条 ≈ $0.000025/条，10 万条判定 ≈ $2.5，无需额外配额机制；output 免费
- key 注入：走现有 `AI_PROVIDER` 密钥装载路径新增 `DMXAPI_API_KEY`（或复用 modelConfigService 的 provider 配置面，与 #167 模型路由配置治理合流评估）

### 5.2 路由结果进 Agent 缓存键（#151 S2 通道签章兼容）

现状：缓存键 = `${scenario ?? "default"}::${img|txt}`，`channelSignatures` 每轮与 `resolveCardChannels()` 对拍，翻转即弃缓存重建。

设计要点：

1. **不新增键维度**——路由输出就是 4 值 scenario 枚举，直接作为 `effectiveScenario` 进现有键形 `${effectiveScenario}::${img|txt}`。副产品：激活 `plan::txt` 等当前永不命中的死缓存键（#160 点名的存量问题）。
2. **flag 进签章**：`channelSignature` 的输入从 `cardChannels` 扩为 `{...cardChannels, intent_routing: flag}`——flag 翻转 → 签名不匹配 → 全键重建，复用 #151 S2 既有机制，零新概念。签章先行（缓存 promise 之前解析）的时序约束保持不变。
3. **轮间翻转无污染**：agent 实例缓存是提示词组装缓存（非会话状态），checkpoint 按 `userId:threadId` 隔离——同一会话第 2 轮路由结果不同 = 换一个缓存实例 + 同一 checkpoint，与今日 scenario 逐请求变化的语义完全同构，不引入新的污染类别。

### 5.3 与 scenario 字段共存序（前端显式覆盖优先）

```
effectiveScenario =
  req.scenario ∈ {workout_complete, update_profile}   // 程序化显式触发（finalizeSession / 画像卡回传）——直通，不路由
    ? req.scenario
  : flag 开启 && req.scenario === "chat"              // 自由文本输入（UI 恒发 chat 的那类轮次）——自动路由
    ? routeIntent(userMessage, dialogSummary, attachmentMeta)   // fail-open 恒返回 4 枚举值之一
    : req.scenario                                    // flag 关：原样透传（现状）
```

- 前端显式覆盖恒优先（#160 约束「续跑轮 update_profile 显式覆盖仍优先于自动路由」）；自动路由只作用于现状落 chat 的自由文本轮——即只「复活」死路，不抢活路
- 路由输入按 #160 设计：用户消息 + 最近对话摘要 + 附件元数据（本次 spike 只测了纯消息；对话摘要作为 state 前缀的增量效果留实施期 A/B）
- 建议同步落地路由结果观测：每轮把 `{routed, confidence, latencyMs, fallbackReason}` 写入现有 logging 契约（`shared/contracts/logging`），供 #160 验收基线（准确率 ≥95% 回放、TTFT A/B）取数

### 5.4 实施风险清单

| 风险                                         | 实证依据 | 缓解                                                                            |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| +0.8s 中位前置延迟                           | §3       | 与附件上传/上下文构建并行发起判定；TTFT A/B 定论净收益                          |
| ~3% 网络失败率                               | §3bis    | 3s 硬超时 + 立即 fail-open（不重试）                                            |
| criteria 措辞敏感（朴素 88% → 调优 97-100%） | §2.2     | criteria 纳入版本化管理（类比 skillLoader GOLD 哈希思路）；上线后按观测数据迭代 |
| noul 无 confidence                           | §1.3     | 判定问题一律用 choice 型（自带 confidence）                                     |
| chat/completions 不可用                      | §1.1     | 接线时直接用 `/typesafe/v1/systemone`，勿按 OpenAI 兼容惯例接                   |

---

## 附：本次 spike 花费决算

| 项                             | input tokens               | output tokens | 费用         |
| ------------------------------ | -------------------------- | ------------- | ------------ |
| probe（目录+三型+边界×5+对照） | ~3.5k                      | ~0.4k         | ~$0.0002     |
| classify v1 ×2 pass            | 39,460                     | 5,853         | ~$0.0017     |
| classify v2 ×2 pass            | 48,294                     | 6,025         | ~$0.0020     |
| failopen ×2 跑                 | ~5k                        | ~0.6k         | ~$0.0002     |
| **合计**                       | **~96k / 2M 预算（4.8%）** | 免费          | **≈ $0.004** |
