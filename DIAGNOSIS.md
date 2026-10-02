# 诊断报告：「计划参数配置轮 Agent 输出丢失」根因

- **症状**（2026-10-02 真机实测）：训练画像调研问卷完成后，用户发送「帮我制定训练计划」，Agent 跑了 3 分 43 秒后 UI 永久停留在「正在解析数据...」占位（`src/components/execution/AICoachOverlay.tsx:847` 的 fallback），正文空、卡片空；LangSmith 思考链里 Agent 明明有完整内容（疼痛部位确认、体重补问、计划骨架）。
- **排查基线**：基于 main `0df1be4` 排查（含 `e6096ab` #107 泄漏重生成、`0df1be4` #109 认证拦截器）。事故发生时后端进程（PID 64433，`/Users/Admin/Documents/codelib/work/star-fit`）实际运行 `c4cd8a7`（#107/#109 均未在场）；两版代码在涉案链路上行为等价，结论不受基线差异影响（见 §4）。
- **性质**：只查不修。根因定位到 **provider 互操作层**，且四层链路（内核→流层→校验回路→前端）全部缺「空答案守卫」，属可修复的设计缺口。

---

## 1. 根因结论（一段话版）

计划参数轮的**最后一次模型调用（第 9 步）返回了无法聚合的响应**：GLM Coding 端点计费了 58 个 completion token（reasoning=0）、`finish_reason="tool_calls"`，但 langchain-openai 聚合产物是一条 **`ChatMessageChunk`（非 `AIMessageChunk`），`content=""` 且不含任何 tool_calls**——工具调用增量在流聚合中丢失。LangGraph 将这条「无工具调用、内容为空」的消息判定为**合法终步**，整轮以空 AI 消息「成功」结束（LangSmith trace status=success，最终输出 `ai: ""`）。`classifyAgentStream`（`backend/src/services/agent/DeepAgentService.ts:650`）对空终步零输出：整轮只发出 thinking 事件 + `done`，**零 token、零 uiHint、零 error**。前端 finalize 时 `msg.text=""` 且无 uiHint、无 error（`src/hooks/useAICoach.ts:884-897`），`AICoachOverlay.tsx:847` 于是永久渲染「正在解析数据...」占位。

**触发条件**：GLM Coding 端点（`open.bigmodel.cn/api/coding/paas/v4`，`glm-5.3-flash`）流式响应的偶发尾包/工具调用增量不可聚合——与代码中已两处记载的互操作问题同族：

- `DeepAgentService.ts:502-507`（assembleAgent 注释）：*"INVALID tool_calls (the args are malformed JSON → langchain drops the call → agent ends the turn)"* —— 本次是它的实锤现场；
- `DeepAgentService.ts:1274-1289`（frameworkTrimMiddleware）：GLM 尾包把聚合结果映射成 `ChatMessageChunk`，现有重水化**只补类型、不救内容**。

**偶发性**：同一 LangSmith session 内其余 3 轮（14:09 / 14:23 / 14:24）均正常出话/出卡；故障专挑了本轮——思考最长（28,383 字符 reasoning）、工具链最密（9 步模型调用 + 12 次工具执行）的计划参数轮。

---

## 2. 证据链

### 2.1 LangSmith trace（项目 star-fit，session `20eb1ada`）

Trace：`01a0fd01-5048-71b9-8599-0136aa4d8ef0`
（UI 路径：smith.langchain.com → 项目 star-fit → 2026-10-02 14:25:16 的 `starfit-agent` root run；
API 回放：`GET api.smith.langchain.com/runs/01a0fd01-5048-71b9-8599-0136aa4d8ef0`）

| 字段 | 值 |
| --- | --- |
| 输入 | `[System context] Current time: 2026-10-02T14:25:16.861Z … 帮我制定训练计划` |
| thread | `85f6e40a-ca77-4c85-ba8d-23ec86760c80:thread_1790951110755_16zq67uhl`（真机用户） |
| 起止 | 14:25:16.873 → 14:28:59.405（3m43s），status **success** |
| token | prompt 215,748 / completion 7,826（其中 reasoning 7,091） |
| **最终输出** | **`ai: ""`（空字符串）** |

9 步模型调用全量扫描（`run_type=llm` 的 outputs 逐条解析）：

| 步 | 时段 (UTC) | ctok | content | reasoning | finish_reason | 消息类型 |
| -- | ---------- | ---- | ------- | --------- | ------------- | -------- |
| 1 | 14:25:16→26 | 270 | 0 ch | 1,032 ch | tool_calls | AIMessageChunk |
| 2 | 14:25:26→47 | 1,077 | 0 ch | 4,483 ch | tool_calls | AIMessageChunk |
| 3 | 14:25:47→14:26:29 | 1,550 | 0 ch | 6,252 ch | tool_calls | AIMessageChunk |
| 4 | 14:26:29→32 | 60 | 0 ch | 146 ch | tool_calls | AIMessageChunk |
| 5 | 14:26:32→14:28:16 | 3,803 | 57 ch | 13,344 ch | tool_calls | AIMessageChunk |
| 6 | 14:28:16→37 | 728 | 57 ch | 2,339 ch | tool_calls | AIMessageChunk |
| 7 | 14:28:37→42 | 61 | 0 ch | 148 ch | tool_calls | AIMessageChunk |
| 8 | 14:28:42→54 | 277 | 0 ch | 639 ch | tool_calls | AIMessageChunk |
| **9** | **14:28:54→59** | **0**（计费 58） | **0 ch** | **0 ch** | **tool_calls** | **ChatMessageChunk** |

整轮 content 合计 **114 字符**（两段 57 字中间叙述）、reasoning 合计 **28,383 字符**、**全部 9 步零围栏（```json）卡**。

**第 9 步原始输出（决定性证据，节选）**：

```json
{"generations": [[{"generationInfo": {"completion": 0, "finish_reason": "tool_calls", "model_name": "glm-5.3-flash", "prompt": 0},
  "message": {"id": ["langchain_core", "messages", "ChatMessageChunk"],
    "kwargs": {"additional_kwargs": {}, "content": "",
      "response_metadata": {"model_provider": "openai",
        "usage": {"completion_tokens": 58, "completion_tokens_details": {"reasoning_tokens": 0},
                   "prompt_tokens": 73798, ...}}},
    "text": ""}}]]}
```

要点：provider 计费 58 个非 reasoning completion token（= 模型确实输出了东西，`finish_reason` 表明是工具调用增量），但聚合产物 content 空、无 tool_calls、消息类型是 `ChatMessageChunk` —— 增量在 langchain-openai 聚合层丢失。

**Agent 当时的意图（第 8 步 reasoning 原文节选）**——问卷卡已设计完毕、就差下一步发出：

> "I'll ask 2 questions: 1. weight (number, required) — explain it's for 起始重量推算 2. days (select…) … **OK — emit the survey card now.** Keep prose to one sentence."

第 8 步实际动作：调用 `write_memory`（记录「阻塞项=体重与每周固定训练天数；等用户答 survey_card 后按 §3.2.0 新手分支出 weekly_plan 卡」）。第 9 步本应输出 survey_card，结果响应被 provider 聚合故障吞掉，整轮终结于空消息。**用户在 LangSmith 思考链看到的「确认疼痛部位、补体重、计划内容」= 第 5/6/8 步 reasoning 里的 survey_card 草稿与计划骨架**（草稿含 `body_weight`、`discomfort`（肩/腰/膝）、3天全身/4天上下分化骨架），它们从未进入 content 通道。

### 2.2 后端与前端代码（main 0df1be4 行号）

1. **流层分类器** `backend/src/services/agent/DeepAgentService.ts:650` `classifyAgentStream`：
   - `messages` 增量只进缓冲/直通（`extractText`/`extractReasoningContent`，:955/:995）；本轮终步无任何文本增量；
   - `updates.model_request` 快照：终步 AI 消息无 tool_calls → 终步分支（:801-858）：`stepRaw` 为空 → **不 yield 任何 token**；
   - 流尾 `yield { type: "done" }`（:893）。整轮事件序列 = thinking×N + done。
2. **Stage 1 提取器** `uiHintExtractor.ts`：只处理 token 事件中的围栏/内联卡。本轮零 token、零围栏 → 提取器全程未参与。（任务书排查方向 2 的 `jsonSuspectHoldback`/降级路径**证伪**：不存在「被降级成 thinking 的卡」——所有模型 content 里根本没有卡。）
3. **Stage 2 校验回路** `uiHintValidationLoop.ts`（#107 后版本）：无 uiHint 事件 → 不触发 VALIDATION_ERROR / 重试 / error 事件，done 直通（:177-181）。**空答案不在其谓词内**（详见 §4.1）。
4. **SSE 传输** `backend/src/sse/agentSse.ts`：事件逐帧透传，P007 错误隔离与本案无关（本轮无异常抛出）。
5. **前端主路径** `src/hooks/useAICoach.ts`：
   - 流消费 :854-874：thinking→折叠区、token→正文、error→暂存；本轮只收到 thinking；
   - finalize :884-897：无 error 时 `text: recovered.text`（= 空串）、`uiHint: synthesizeUiHint(undefined)` = undefined、`isThinking: false`；
   - `src/components/execution/AICoachOverlay.tsx:821` 气泡渲染条件 `(!msg.isThinking || msg.text)` 成立 → :847 `msg.text || (msg.uiHint ? … : "正在解析数据...")` → **永久占位**。#56 的 `recoverLeakedCard` 只复原正文里的卡型 JSON，对空正文无兜底。
   - （任务书排查方向 4 的「thinking 溢出截断」**证伪**：前端无任何截空逻辑，正文为空是因为从未收到 token。）

### 2.3 服务端日志

- `/tmp/starfit-backend.log` 最后写入 **2026-10-01 12:28**（事故发生时后端已不写该文件，任务书所述「最近的 /api/chat 在 48176 行」实为 10-01 的轮次）；该文件中 89 个 401 全部是 10-01 的 GET 探测类请求（`/api/schedule/today`、`/api/exercises`、`token=` 空参 `/api/ws/sync`），与本案无关。
- `backend/access.log`（无状态码字段）：事故窗口 2026-10-02 内真机（192.168.31.236）POST `/api/chat` 三次——13:47:43、13:53:19（未入 LangSmith，早于 session 14:06 建立）与 **14:25:16（= 事故轮 trace 起点毫秒级吻合）**。
- LangSmith root run `end_time=14:28:59.405` 且 events 完整（start/end）→ **SSE 服务端全程消费完毕、连接未断**，排除「流被 401/登出打断」。

### 2.4 #109 认证拦截器关系（任务书方向 5，证伪）

- `src/services/authInterceptor.ts` 于 `0df1be4`（#109）合入，**晚于事故**；事故后端运行 `c4cd8a7` 无此代码。
- 即使在场：拦截器只在 fetch 响应状态 401 且命中登录服务器时触发登出（:84-102），`/api/chat` SSE 本轮响应 200 且无 401 记录；LangSmith trace 完整收尾证明流未被前端中断（否则生成器 return() 会使 root run 提前截断）。

---

## 3. 故障传播链（哪一环、哪个函数、什么条件）

```
GLM Coding 端点（glm-5.3-flash）
  └─ 第 9 步流式响应：计费 58 tok、finish_reason=tool_calls
     └─ langchain-openai 聚合 ⇒ ChatMessageChunk{content:"", 无 tool_calls}   ← 丢失点（provider 互操作）
        └─ frameworkTrimMiddleware 重水化（DeepAgentService.ts:1274-1289）只补类型，内容仍空
           └─ LangGraph model_request：无 tool_calls ⇒ 路由 END，终态 AI 消息 content=""
              └─ classifyAgentStream（DeepAgentService.ts:801-858,893）：空 stepRaw ⇒ 零 token
                 └─ extractUiHintEvents：零 token ⇒ 无卡可提
                    └─ chatWithValidationLoop：无 uiHint ⇒ 无重试/无 error，done 直通（:177-181）
                       └─ streamAgentSSE：帧序列 = thinking×N + done
                          └─ 前端 finalize（useAICoach.ts:884-897）：text=""、uiHint=undefined、无 error
                             └─ AICoachOverlay.tsx:847 ⇒ 永久「正在解析数据...」        ← 用户所见
```

四层都没有错——每一层都按契约处理了「合法的空终步」。缺的是**任何一层对「整轮零可见输出」的守卫**。

---

## 4. 与 #107 / #109 的关系复核（按调度指令基于新 main 重验）

### 4.1 #107（e6096ab，泄漏自动重生成）不覆盖本故障形态

泄漏重试通道（`uiHintValidationLoop.ts:148-175, 331-349`）的触发谓词是 `isDegradedCardFragment(thinking.text)`（`uiHintExtractor.ts:625-653`）：要求 thinking 事件里出现**自报卡型的花括号区间且整体 parse 失败**（即「写歪在正文的卡被整段降级」）。本案：

- 终步零输出 ⇒ 不存在被降级的卡残片；
- 思考链是协议级 `reasoning_content` 逐 delta 事件（每帧几个字符，`DeepAgentService.ts:738-741`），单帧不含完整花括号区间 ⇒ 谓词粒度不命中；
- 第 5/6 步 reasoning 里的 survey_card 草稿是**可完整 parse 的 JSON**（按谓词定义属「工具复述/完整卡」而非残片），且只存在于 delta 流中，从不构成整段 thinking 事件。

结论：在新 main 上重放本轮，#107 同样不会介入，表现与事故一致。#107 解决的是「卡写了但写歪」，本案是「压根没写出来」。

### 4.2 #109（0df1be4）与本案无关

见 §2.4：合并晚于事故、事故窗口零 401、SSE 服务端完整走完、拦截器不触碰 200 响应的流。

---

## 5. 修复方向建议（不实施）

按「最小兜底 → 根治」排序，可组合：

1. **前端空答案兜底（最小、必做）**：`useAICoach.ts:884-897` finalize 时，若 `!recovered.text && !card && !error` ⇒ 置为明确的失败文案 + 重试入口（镜像现有 `CONNECTION_LOST` 的 `retry` 处理，:882-896），替换掉「正在解析数据...」死占位。
2. **校验回路空答案分支（机制已就位，成本低）**：`chatWithValidationLoop` 在 done 到达、本 Attempt **零卡且零 token** 时走既有重试通道（复用 `RETRY_STATUS_TOKEN` + attempt 计数）重滚一轮——线程 checkpoint 里 write_memory/find_exercises 结果俱在，重滚大概率直接出 survey_card。
3. **内核层根治（针对丢失点本身）**：`frameworkTrimMiddleware` 重水化处（`DeepAgentService.ts:1274-1289`）升级判定——`finish_reason === "tool_calls"` 但聚合结果无 tool_calls 且 content 为空时**不得静默放行**：抛错（→ SSE error 事件 → 前端 `[诊断]` 文案）或就地重试一次模型调用。该信号在 `generationInfo`/`response_metadata` 中可得，无需改 provider。
4. **流层守卫（防御纵深）**：`classifyAgentStream` 流尾若整轮未发过任何 token/uiHint 且无 error ⇒ 补发一个兜底事件（token 或 `error{code:"EMPTY_ANSWER"}`），保证「成功轮必有可见输出」的不变量。
5. **可观测性**：后端对「finish_reason=tool_calls 但零 tool_calls 解析」打点告警日志；为 agent 层接文件日志（本案排查期间 `/tmp/starfit-backend.log` 已停写 10 小时、access.log 无状态码，服务端侧几乎无日志可用）。

**回归验收建议**（provider 偶发故障无法确定性复现，走注入式）：fake agent 注入「终步空消息」流，断言修复后前端不再出现死占位、SSE 有兜底事件——四层任取一层实现即可覆盖该注入用例。

## 6. 若需真机复现的最小操作序列

本故障为 provider 偶发（同 session 其余轮次正常），以下序列仅提高撞中概率，不保证复现：

1. 新设备/新用户登录 → 完成画像调研问卷（触发 survey→plan 链路）；
2. 直接发送「帮我制定训练计划」；
3. 保持 LangSmith 追踪开启，等满 3-4 分钟（长思考+密集工具链的轮次最易命中）；
4. 判定：UI 出现「正在解析数据...」死占位 且 对应 trace root run `outputs_preview` 为 `ai: ""` 且末步 llm 子 run ctok=0 ⇒ 复现成功。

---

### 附：证据文件

- LangSmith API 回放产物（本机 `/tmp/`）：`ls-root-run.json`（root run 全量）、`ls-children.jsonl`（72 个子 run 全量，含 9 步 LLM 原始 outputs）；
- 关键 trace 链接：smith.langchain.com/o/8f9f569e-c5b7-4273-9a6a-dc5d04f3ab7d/projects/p/20eb1ada-4f30-485f-9705-27fcd0aefdaf/r/01a0fd01-5048-71b9-8599-0136aa4d8ef0
