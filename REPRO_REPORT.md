# REPRO_REPORT — ChatMessageChunk 丢 tool_calls 复现矩阵 + 依赖升级验证（refs #110）

- 日期：2026-10-03
- 分支：`zenthos-z/repro-chunk-loss`（复现脚本 + 本报告）；`upgrade-agent-deps`（T3 依赖升级，本地验证分支）
- 环境：Node v22.23.1 / npm 10.9.8 / macOS（darwin 27.0.0）
- 被测运行时（仓库实际解析）：`@langchain/openai` **1.5.13** + `@langchain/core` 1.2.13 + `deepagents` 1.10.7 + `langchain` 1.5.3

## TL;DR

| 问题 | 结论 |
| --- | --- |
| 我方中间层（frameworkTrimMiddleware）是否丢的内容 | **无辜**——丢失发生在 `@langchain/openai` 的逐 delta 转换层，早于中间件可见的任何数据 |
| `@langchain/openai` 1.5.13 → 1.6.2 是否修复 | **未修**——疑似函数逐字节一致，changelog 无相关条目，复现矩阵 1.6.2 仍 BUG |
| `deepagents` 1.10.7 → 1.14.1 是否修复 | **未修**（也不会修——聚合不在此层）；18 个 release 无流聚合相关改动 |
| 无 role 异常流能否确定性复现 | **能**——本地 SSE mock 双版本 × 双路径全部命中，签名与 #110 线上捕获一致 |
| 升级 1.6.2 + 1.14.1 是否安全 | **安全**——tsc/jest/agent 套件/contract 全绿（需 `npm dedupe` 消一次装分裂），但不修 bug |

## T1 版本排查

### T1.1 我方中间层无辜：证据链

`frameworkTrimMiddleware`（`backend/src/services/agent/DeepAgentService.ts:1246-1291`）的 `wrapModelCall` 先 `res = await handler(req2)`（:1273），再对 `constructor.name === "ChatMessageChunk"` 的返回值做 `new AIMessageChunk({ ...res })` 类型重水化（:1281-1288）。丢失发生在它收到 `res` **之前**，完整链路（均为 node_modules 实读行号）：

1. `DeepAgentService.ts:587` — `agent.stream(...)`：LangGraph 流式驱动，向回调链安装流式回调处理器；
2. `langchain/dist/agents/nodes/AgentNode.js:139` — `baseHandler` 调 `modelWithTools.invoke(...)`（非 `.stream()`）；
3. `@langchain/core/dist/language_models/chat_models.js:273-286` — `generate()` 检测到 `lc_prefer_streaming` 回调（定义见 `callbacks/base.js:18-20`）后，**桥接**到 `_streamResponseChunks` 并逐 chunk `concat` 聚合（:286）；
4. `@langchain/openai/dist/converters/completions.js:255-317` — 逐 delta 转换：`role = delta.role ?? defaultRole`（:256）；`role !== assistant/user/system/developer/function/tool` 时走 else 分支 `new ChatMessageChunk({ content, role, response_metadata })`（:313-317）——**不传 `additional_kwargs`**，而 `delta.tool_calls` 恰恰只存在于局部变量 `additional_kwargs`（:258-261）→ 增量在此被静默丢弃；
5. `@langchain/openai/dist/chat_models/completions.js:187/197-198` — `let defaultRole`（= undefined）先转换后更新：`defaultRole = delta.role ?? defaultRole` 只被「带 role 的 chunk」锚定。GLM 异常流**全程无 role** → defaultRole 永远 undefined → 每个 delta 都落入第 4 步 else 分支。

**重水化为何救不回来**：else 分支构造的 `ChatMessageChunk` 的 `additional_kwargs` 是默认空对象，`tool_calls` 增量从未进入实例属性；`new AIMessageChunk({ ...res })` 的展开复制不出从未存在过的字段。该中间件只能修「类型被 AgentNode 校验拒绝」这一层症状（2026-09-28 E2E 已证），对内容丢失无能为力——两者是同族 provider 互操作问题的两层。

### T1.2 `@langchain/openai` 1.5.13 → 1.6.2：未修

- **diff 实测**（两版本 tarball 解包对比）：
  - `convertCompletionsDeltaToBaseMessageChunk` 函数体**逐字节一致**（64 行 sed 截取 diff 为空）；
  - `chat_models/completions.js` 差异仅 4 处且全不相干：file MIME 过滤、tool 消息含图 400 报错加提示（`addToolImageHint`）、`prompt_cache_key/retention/options` 读取顺序、`profile` getter。`defaultRole` 逻辑（:187/197-198）原样未动；
- **changelog 实读**（包内 CHANGELOG.md）：1.5.14（gpt-6 reasoning 识别 / Responses API 图像 tool 结果 / GPT-5.6 路由）、1.6.0（prompt cache options + content-block breakpoints）、1.6.1（ModelProfile.fileMimeTypes）、1.6.2（Responses API `additional_tools` / `non_standard` 块）——**无一条触及 role 缺省 delta 的 tool_calls 保留**。
- 1.6.2 即当前最新版（npm registry 确认），上游无修复可蹭。

### T1.3 `deepagents` 1.10.7 → 1.14.1：无相关修复

GitHub `langchain-ai/deepagentsjs` 全部 18 个 release（1.11.0 → 1.14.1）过目归类：filesystem 工具（grep/glob/read/delete/路径边界/符号链接）、subagents forking、skills 中间件、极简化 prompting、sandbox 后端、call-limit 计数隔离、tracing 输入省略。**无任何流 chunk 聚合 / tool_calls 保留 / wrapModelCall 返回值处理改动**——符合预期：聚合与转换都发生在 `@langchain/openai` + `@langchain/core` 层，deepagents 只是消费者。

## T2 确定性复现（核心）

**方法**：不起真模型（线上偶发不可复现），本地 `node:http` 起 OpenAI 兼容 SSE mock，把两种形态的流喂给 `ChatOpenAI`，走两条消费路径，断言聚合体类型与 tool_calls 存留。脚本 `backend/scripts/repro-chunk-loss.mjs`，矩阵 runner `backend/scripts/repro-chunk-loss.matrix.sh`（scratch 幂等引导，零仓库依赖污染）。

**形态**（唯一变量：首个 delta 是否带 `role`）：

- `glm-no-role`：6 个 delta 全部无 `role`，`tool_calls` 增量切 4 段（`{"plan_` / `id":"p-001",` / `"weeks":4}`），终包空 delta + `finish_reason:"tool_calls"` —— PR #110 捕获的 GLM 异常形态；
- `openai-normal`：同一流，仅首 delta 增加 `"role":"assistant"` —— OpenAI 标准形态对照组。

**路径**：

- `stream()` + 逐 chunk `concat`：等价 `_generate` 流式分支（chat_models/completions.js:72-82）与 core stream 聚合；
- `invoke()` + `lc_prefer_streaming` 回调：**AgentNode 生产路径**（见 T1.1 第 2-3 步桥接）。

**矩阵结果**（2026-10-03 实测）：

| @langchain/openai | @langchain/core | glm-no-role / stream | glm-no-role / invoke | normal / stream | normal / invoke |
| --- | --- | --- | --- | --- | --- |
| 1.5.13（仓库运行时） | 1.2.13 | **BUG** | **BUG** | PASS | PASS |
| 1.6.2（隔离 scratch） | 1.2.14 | **BUG** | **BUG** | PASS | PASS |
| 1.6.2（in-place 升级后） | 1.2.14 | **BUG** | **BUG** | PASS | PASS |

BUG 腿签名与 #110 线上捕获完全一致：聚合体 `ChatMessageChunk`、`content=''`、无 `tool_calls`（`msg.tool_calls` 与 `additional_kwargs.tool_calls` 双双缺失）。对照组聚合体 `AIMessageChunk`，`tool_calls` 完整还原为 `plan_generate({"plan_id":"p-001","weeks":4})`。

**结论**：

1. 复现确定性成立（同一脚本连跑即现，无偶发性）；
2. **1.6.2 未修 → langchain 官方 bug 实锤**，最小复现脚本即可作上游 issue 附件（草稿见 `docs/upstream-issue-langchainjs-roleless-tool-calls.md`，未提交）；
3. `defaultRole` 锚定边界验证：对照组证明 bug 专属「全程无 role」形态——首 chunk 带 role 时后续无 role delta 均被锚定为 assistant，行为正常。

## T3 升级验证（安全网，`upgrade-agent-deps` 分支）

**动作**：`npm install -w backend @langchain/openai@1.6.2 deepagents@1.14.1`。backend/package.json 显式变更仅此两项（`^1.2.3→^1.6.2`、`^1.10.7→^1.14.1`），连带 peer 自动提升：`@langchain/core` 1.2.13→1.2.14、`langchain` 1.5.3→1.5.15、`@langchain/langgraph` 1.4.7→1.4.18（lock 记录）。

**过程中发现的唯一破坏点——安装态分裂（非 API 破坏）**：首装后 `tsc --noEmit` 报 3 处 TS2322：

| 位置 | 报错类型 | 根因 |
| --- | --- | --- |
| `DeepAgentService.ts:497` | `PostgresSaver` 不可赋给 `BaseCheckpointSaver` | `@langchain/langgraph-checkpoint-postgres`（hoist 在 root，编译于 root core 1.2.13）vs backend core 1.2.14 双实例 |
| `llm.ts:237` | `ChatDeepSeek` 不可赋给 `BaseChatModel` | 同上（root/shared 各自声明 `@langchain/deepseek ^1.1.13`，锚住 root 旧 core） |
| `llm.ts:270` | `ChatGoogleGenerativeAI` 不可赋给 `BaseChatModel` | 同上 |

均为「同名类跨两个 `@langchain/core` 副本」的 protected 成员名义类型不兼容，**不是** 1.6.2/1.14.1 的 API 变更。执行 `npm dedupe` 统一为单一 core 1.2.14 后 **0 错**，全程未改任何 `src/` 代码。

**全量回归**（`docker start starfit-test-pg pg-passthrough` 后实测）：

| 套件 | 结果 |
| --- | --- |
| `npx tsc --noEmit`（backend） | 0 错误（dedupe 后） |
| `npm test`（jest，unit+integration） | 381 pass / 0 fail（33 skip，2 套件按设计 skip） |
| `node --import tsx --test src/services/agent/__tests__/*.test.ts` | 270 pass / 0 fail |
| `npm run test:contract` | 60 pass / 0 fail |

（曾记录的 main 既有失败 skillLoader GOLD 哈希漂移在当前基线已不复现，无需区分既有/新增。）

**结论**：升级本身安全（安全网成立），升级后 in-place 复现矩阵仍 BUG——**升级 ≠ 修复**。若合入升级，需另行保留/加强我方 `frameworkTrimMiddleware` 一类的防御（见后续建议）。

## 复现脚本使用

```bash
# 单腿（仓库运行时）
node backend/scripts/repro-chunk-loss.mjs --label repo-runtime

# 完整矩阵（自动引导 1.6.2 scratch 到 $TMPDIR/repro-chunk-loss-matrix）
bash backend/scripts/repro-chunk-loss.matrix.sh
```

退出码：仅对照组（openai-normal）失败时非零（脚手架坏）；BUG 判定不算失败。末行 `##RESULT## <json>` 供机器采集。

## 后续建议（不在本任务范围）

1. **上游**：提交 `docs/upstream-issue-langchainjs-roleless-tool-calls.md` 草稿至 langchain-ai/langchainjs（最小复现 + 版本矩阵 + 三种修法建议：`defaultRole` 初始为 `"assistant"` / 转换层 `role ?? "assistant"` 兜底 / `ChatMessageChunk` 构造透传 `additional_kwargs`）；
2. **我方防御**（若上游短期不修）：`frameworkTrimMiddleware` 的重水化救不回已丢的 `tool_calls`（见 T1.1）；可考虑在更外层对「`finish_reason=tool_calls` 但聚合体无 tool_calls」的轮做检测告警或触发一次非流式重试——需另立任务设计；
3. **GLM 侧**：向智谱反馈其 OpenAI 兼容端点偶发整轮流缺 `role` 字段（对照 OpenAI 规范首 chunk 必带 role）。

## 产物清单

| 产物 | 位置 |
| --- | --- |
| 复现脚本 | `backend/scripts/repro-chunk-loss.mjs` |
| 矩阵 runner | `backend/scripts/repro-chunk-loss.matrix.sh` |
| 上游 issue 草稿（英文，未提交） | `docs/upstream-issue-langchainjs-roleless-tool-calls.md` |
| 依赖升级提交 | 分支 `upgrade-agent-deps`（backend/package.json + 根 package-lock.json） |
