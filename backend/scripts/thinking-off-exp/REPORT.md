# 关思考实验 A2b 实验报告（#155 #160）

- 分支 `zenthos-z/thinking-off-exp`，基线 main=15629548（已核）
- 日期：2026-10-09 深夜窗（23:39 起 CST）｜模型 GLM-5.3-flash @ CodingPlan 通道（OpenAI 协议）
- 对照组：`../jev-nodes-research/results/`（2026-10-09 同日基线，矩阵命中×1 + 半命中×2，spec §3）
- 实验组：本目录 `results/`（hit×2 + half×2，同剧本同参数，仅 env `THINKING_DISABLED_CHAT=true`）
- 自检：`self-check.ts` 7/7 过（§1）

## 0. TL;DR

| 场景 | 墙钟 | 首卡 TTFT | reasoning 分量 | 出卡质量 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 矩阵命中（新手×居家×3练→t1） | 167.8s → 100.3-105.9s（**1.6×**） | 154.5s → 92.1-99.0s（**1.6×**） | 12,487 → 418-565 字符（**-96%**） | 指纹双命中；1/2 run 首调 submit 参数不全被工具层兜住自纠 | **可用** |
| 半命中（中级×居家×4练→t3 空壳） | 468.7-590.1s → 63.2-115.9s（**4.0-9.3×**） | 461.9-560.2s → 56.6-107.4s（**5.2-8.2×**） | 43,256-64,222 → 843-1,208 字符（**-98%**） | **内容塌方**：提交的是 t3 空壳（6 主项含 2 隔离动作、日标签描述被删动作、剂量 run1 编造/run2 缺失） | **不可用** |

**总判断**：关思考的提速真实且巨大（命中 1.6×、半命中 4-9×），但两条路径的质量命运
完全分岔——**命中路径质量存活（工具层兜底 1 次），半命中路径产出坏计划且现有闸门
（uiHint schema 校验 + submit L2 闸门）全部放行**。半命中场景的推理是承重墙（检测
空壳实例化不可用并自由手搓替代），关掉即塌。推荐维持 spec §6.4 顺序：先节点拆解
（B3 矩阵扩容消灭半命中 + B2 剂量表 + B4 引用提交），再在 B5 瘦身轮上叠关思考；
全域直接开启不推荐。命中路径已具备「B 链落地后即可关思考」的实证基础。

## 1. 配置链路事实（实验前置发现）

### 1.1 正确的开关键（self-check 7/7 实证，`self-check.ts`）

任务书草案键 `THINKING_DISABLED_PLAN=1` **不生效**，两处独立陷阱：

| 陷阱 | 事实 | 出处 |
| --- | --- | --- |
| 键名不匹配 | 回放剧本 scenario 恒为 `chat`（#160 实锤 isPlanMode 死路），`resolveThinkingConfig` 按 scenario 大写拼键 → 只读 `THINKING_DISABLED_CHAT` | modelConfigService.ts:344-353 |
| 值格式 | `parseDisabledFlag` 只认 `true`/`false`（trim+大小写不敏感），`"1"` 返回 null 落穿到默认层（思考仍开） | modelConfigService.ts:325-330 |

**本实验用键：`THINKING_DISABLED_CHAT=true`**。链路全通验证：
env → `resolveThinkingConfig("chat")={thinking:false,source:"env"}`（S3）→
`loadModel` glm 分支构造体 `modelKwargs.thinking.type="disabled"`（S6，model=glm-5.3-flash）→
@langchain/openai completions.js `...this.modelKwargs` 并入请求体（dist 实证）。
DB 层无 `THINKING_DISABLED*` 行（S1），env 即生效层；默认链构造体不带 thinking kwarg（S7，不回归）。

### 1.2 粒度警示

开关按 **scenario**（chat）生效，**问卷轮与计划轮一起被关**——问卷轮数据是附带
观测（墙钟 25.9-28.9s → 13.2-15.9s，~1.9×，参考值），不在对照范围（任务书明示
问卷轮剂量小不做实验对象）。

### 1.3 「关思考」的实测语义：reasoning 残丝，不是归零

GLM-5.3-flash 收到 `thinking:{type:'disabled'}` 后 **reasoning_content 压到
0.4-1.2K 字符水位（-96~-98%）但不归零**——模型仍以逐词 delta 吐出极简推理残丝
（问卷轮样本：`Need plan: load_history first (parallel with skill files).`）。
「thinking 字符数 ≈0」的验收预期应修正为「reasoning 分量 ≈0.5-1.2K 水位」。

## 2. 计量口径：thinking 事件二分（本报告关键口径）

DeepAgentService 的 thinking 事件有两个异质来源，**总字符数不能直接对照**：

| 分量 | 来源 | 与开关关系 | 判别（离线） |
| --- | --- | --- | --- |
| **reasoning** | `reasoning_content` 逐词 delta（extractReasoningContent 直通，DeepAgentService L854-857） | 开关消除对象（→残丝） | len<300 的流式 delta |
| **echo** | 模型正文里复述工具返回（SKILL 全文/模板目录/实例化 JSON/错误消息），被 stripToolEcho* 剥离转 thinking | **与开关无关**（工具结果复述行为，基线同在） | len≥300 的快照整块 |

二分与总量逐字对账（基线 run 级）：hit 34,546=14,522+20,024 ✓ half-r1 133,492=66,174+67,318 ✓ half-r2 123,023=44,958+78,065 ✓。

**结构性事实**：命中路径的 echo 分量在基线与实验组**逐字节相同**（15,584 字符 =
pick_template 目录 1,552 + instantiate 全卡 JSON 14,032）——工具返回一样、复述一样。
开关消除的是 reasoning 分量；墙钟收益也主要来自 reasoning 的解码时间。

## 3. 对照表

### 3.1 场景1 矩阵命中（新手×居家×3练 → t1-novice-fullbody-home）

| 指标 | 基线（n=1） | 关思考（n=2） | 变化 |
| --- | --- | --- | --- |
| 计划轮墙钟 | 167.8s | 105.9s / 100.3s | **提速 1.58-1.67×** |
| 首卡 TTFT-card | 154.5s | 99.0s / 92.1s | **提速 1.56-1.68×** |
| 首帧（思考面板残丝） | 3.9s | 4.1s / 1.2s | 持平 |
| thinking 总字符 | 28,071 | 17,733 / 16,002 | -37~-43%（echo 结构性留存） |
| ├ reasoning 分量 | 12,487 | **565 / 418** | **-95.5~-96.7%** |
| ├ echo 分量 | 15,584 | 15,584（run1 另有错误复述 1,584） | 持平（结构性） |
| 模型轮次 | 4 | 5 / 4 | run1 +1（submit 首调打回重试，§4.1） |
| 工具序列 | pick→instantiate→submit | pick→instantiate→submit(→submit) | 模板路径存活 |
| 模板指纹 | 「新手 · 居家全身」命中 | **双 run 命中** | **存活** |
| uiHint 校验回路打回 | 0 | **0 / 0** | 存活 |
| 吞卡/真实泄漏 | 0/0 | 0/0（疑似项均为 instantiate 结果复述误报） | 存活 |
| submit 参数规模 | 13,682 字符 | ~16K 量级（全参数，指纹命中） | 存活 |
| 问卷轮墙钟（附带观测） | 25.9-28.9s | 14.2s / 13.6s | ~1.9×（参考） |

### 3.2 场景2 半命中（中级×居家×4练 → t3 空壳 → 本应自由手搓）

| 指标 | 基线（n=2） | 关思考（n=2） | 变化 |
| --- | --- | --- | --- |
| 计划轮墙钟 | 590.1s / 468.7s | 115.9s / 63.2s | **提速 4.0-9.3×** |
| 首卡 TTFT-card | 560.2s / 461.9s（事件流复算） | 107.4s / 56.6s | **提速 5.2-8.2×** |
| thinking 总字符 | 127,090 / 116,909 | 33,565 / 33,157 | -72~-74% |
| ├ reasoning 分量 | 64,222 / 43,256 | **1,208 / 843** | **-98.1%** |
| ├ echo 分量 | 62,868 / 73,653（find_exercises×N+read_file×N 复述） | 32,357 / 32,314（2×instantiate 复述为主） | -50~-56%（路径结构变了） |
| 模型轮次 | 8 / 7 | 5 / 5 | -2~-3 |
| 工具序列 | pick→instantiate(空壳)→find_exercises×3/6→read_file×2/3→submit | pick→instantiate→instantiate(week_offset:1)→submit | **零 find_exercises、零 read_file** |
| 模板指纹 | 无（自由手搓，指纹不命中） | **t3「初-中级 · 上下分化」命中** | **语义反转 = 空壳提交**（§4.2） |
| uiHint 校验回路打回 | 0 | 0 / 0 | （见 §4.2：闸门放行了坏内容） |
| 吞卡/真实泄漏 | 0/0 | 0/0（疑似项均为 instantiate 结果复述误报） | 存活 |
| submit 参数规模 | 5,503 / 12,828 字符 | 16,402 / 6,520 字符 | — |
| 计划内容充分性 | 自由手搓完整 4 练计划 | **空壳 6 主项**（见 §4.2） | **塌方** |
| 问卷轮墙钟（附带观测） | 26.7-28.9s | 15.9s / 13.2s | ~1.9×（参考） |

## 4. 质量门明细

### 4.1 hit run1：submit 首调参数不全 → 工具层打回 → 自纠（新增劣化形态）

工具序列实测 `pick_template → instantiate_weekly_plan → submit_weekly_plan → submit_weekly_plan`：

- 首次 submit 的 kwargs 只有 `{"split_summary":…,"week_label":…}` 两字段——**完整
  卡数据（t1 实例化的 ~14K JSON）没带**，被工具输入校验拒绝（thread dump [14]：
  `Error invoking tool 'submit_weekly_plan' … with error: Error: Received tool i…`，
  1,584 字符；kwargs 是合法闭合 JSON，非流中截断——是漏带主体只写摘要字段）。
- 模型下一轮带全参数重提成功（`{"ok":true,"cardId":…}`），终卡指纹命中、正文
  干净。代价 = 1 个额外模型轮 + ~7s。
- 判读：关思考后「把 instantiate 返回原样转述进 submit 参数」这一 13.7K 字符长
  参数组装的首次尝试退化；工具入参 zod 校验兜住了它。**这不是 uiHint 校验回路
  的打回**（validationRetries=0），是工具入参校验的打回——同属校验兜底但通道
  不同，报告分开计。
- 对照：基线 hit 单次 submit 直接成功；实验组 run2 也是单次成功 → 该劣化非必然
  （1/2 出现），但暴露长参数组装在无思考下的不稳态。

### 4.2 half 双 run：提交 t3 空壳计划（内容质量塌方，闸门全放行）

KEEP=1 保留的 thread 取证（`dump-run-forensics.ts`，两 run 形态一致）：

1. **工具序列**：`pick_template → instantiate(t3, W41) → instantiate(t3, week_offset:1 → W42) → submit`——
   基线里模型识别空壳不可用、转 find_exercises×3-6 自由手搓；关思考后模型把
   空壳实例化**当作可用计划直接改周提交**（week_offset 的重实例化 = 用工具调用
   替代了「本周只剩末两天」的周对齐推理，+1 工具轮换 ~50s 提速，这个替代是成功的）。
2. **主体动作 6/6 逐 id 相同**：submit 的 6 个 main exercise_id 与 instantiate 返回
   的 6 个 main **完全一致**（集合重叠 6/6）——提交内容就是空壳本体。t3 器械过滤
   删了 9 个核心槽位（平板杠铃卧推/俯身划船/军事推举/后深蹲/站姿提踵/坐姿反向
   飞鸟/绳索三头下压/山羊挺身/坐姿提踵），存活主体仅 6 项且含 2 个隔离动作
   （Dumbbell Biceps Curl / Dumbbell Lying Leg Curl）。
3. **日标签与内容不符**：day_focus 写「卧推 + 划船 + 推举」「深蹲 + 直腿硬拉 +
   提踵」——描述的恰是被删动作；实际该日唯一 main 是哑铃弯举（上肢日）。
   卡面「看起来」是 4 练分化计划，实际主体容量只有标签宣称的 ~1/3。
4. **剂量不稳定**：run1 给了 weight_kg（8.5/13/21/22.5kg，3-4 组，RPE 7-8.5 爬坡，
   数值合理——但 instantiate 返回本身无重量锚，属模型无思考直出）；run2 的 sets
   **完全无 weight_kg 无 RPE**（只有组数×次数）。同一剧本两 run 剂量形态漂移。
5. **闸门全放行**：submit 工具 L2 闸门两次都返回 `{"ok":true}`；uiHint schema
   校验 0 打回。现有闸门校验 schema 合法性，不校验「计划充分性」（主体动作数/
   日标签一致性/剂量完整性）——本实验实证了该覆盖缺口（见 §8 D4）。
6. 模板指纹在此场景的语义反转：基线半命中指纹不命中（自由手搓）= 质量正常；
   实验组指纹命中 = 空壳提交 = 劣化。跨场景解读指纹必须带场景语境。

### 4.3 其余质量门（全 4 run）

- 打回（uiHint 校验回路）：全 0（基线同 0）。
- 泄漏：leakSuspects 计数命中的均为工具结果复述块里合法含 `"type"` 字段的 JSON
  （instantiate/pick 返回），token 通道零 JSON、终稿正文干净——**零真实泄漏**。
- 吞卡：无（8 turn 全部按预期出卡：survey_card ×4 + weekly_plan ×4）。

## 5. 归因警示（spec §6.4，任务书红线）

本实验的关思考作用于**全量推理**，而非节点拆解（B 链）后的残余推理：

1. 节点拆解先行（B2 表接管剂量算术 / B3 矩阵接管选型与覆盖 / B4 引用提交接管
   转述）之后，留给 LLM 的推理面收缩到话术级——**届时**关思考的质量风险与本
   实验不同层。本实验是在「模型仍需自由完成选型辩论+剂量算术+13.7K 转述+空壳
   可用性判断」的全量负载下硬关思考。
2. 因此本实验是**独立数据点**，不是 B5 瘦身轮关思考的替代，也不能外推「B 链+
   关思考」的复合收益。它能给出的只有：全量推理下关思考的**收益上限**（命中
   1.6×、半命中 4-9×）与**质量代价**（半命中内容塌方 + 命中路径长参数组装 1/2
   不稳态）。
3. 半命中路径的实证恰恰支持 B 链先行的顺序：那 43-64K 字符的 reasoning 里至少
   包含「空壳实例化不可用 → 弃用 → 自由手搓」的**承重判断**——关掉它，模型就
   把空壳当好计划提交了。B3 矩阵扩容把半命中场景消灭后，这个承重判断的需求
   才随之消失，关思考才安全。
4. 命中路径的墙钟地板：100.3-105.9s 里 echo 复述解码（~15.6K 字符）+ 13.7K 卡
   JSON 转述生成是结构项——B4 引用式提交（转述归零）+ echo 复述治理（复述
   剥离已做但模型仍会生成）才是继续压缩的地板钥匙，关思考已把这层能拿的拿完。

## 6. 是否推荐与节点拆解叠加

**推荐叠加，但必须按依赖顺序（维持 spec §6.4 判断，本实验提供实证支撑）**：

1. **立即全域开启 THINKING_DISABLED_CHAT：不推荐**。半命中用户（中级×居家×N 练
   等矩阵空洞组合）会拿到「闸门放行的空壳坏计划」——这是对用户的静默伤害，
   比 9.8 分钟的等待更糟。
2. **矩阵覆盖面先修**：B3 矩阵扩容（中级×居家、新手×4 练等空洞）+ instantiate
   对核心槽位删除超阈值返回结构化 INFEASIBLE（spec §3.5 建议）——把「半命中
   陷阱」场景消灭后，计划轮全部落入「命中路径」质量形态。
3. **然后在 B5 瘦身轮上叠关思考**：命中路径已实证关思考质量存活（指纹双命中、
   唯一劣化被工具层兜住）——B 链把推理面进一步收缩后，风险面只会更小。叠加
   后预期：命中路径墙钟从本实验的 ~100s 进一步向 ~30-50s 走（转述归零 + 选型
   矩阵化）。
4. **闸门补强先于任何关思考上线**：L2/uiHint 闸门需补「计划充分性」检查（主体
   动作数下限、日标签↔内容一致性、剂量完整性三项，本实验 §4.2 的三个塌方点）
   ——否则关思考的失败形态是静默的。

## 7. 配额账与清理

- 真实 LLM 回放完成 **8 turn**（hit×2run×2turn + half×2run×2turn）= 任务书 ≤8 上限。
- **额外披露：1 次中止的半截计划轮**（hit 首跑 run1 turn2，生成 ~2min 后人工误判
  中止——当时误读「thinking 事件仍在流」为开关失效，实为工具复述块与开关无关；
  该次数据已弃，其用户/checkpoint 当场清理，hit 批整批重跑）。计尝试口径约
  9 turn 当量。
- 清理：测试用户（`thinking-off-replay-` 前缀）删净；agent_runtime 三表
  （checkpoints/checkpoint_writes/checkpoint_blobs）按复合 thread_id 删净
  （half 批 KEEP=1 留证，§4.2 取证完成后删净）；复核 SQL 全 0。
- 事件流 gzip 存档与基线同规格。

## 8. 发现的配置/脚本/闸门缺陷（按红线：只记录不修，列待办）

| # | 缺陷 | 位置 | 待办建议 |
| --- | --- | --- | --- |
| D1 | 任务书候选键 `THINKING_DISABLED_PLAN=1` 双陷阱（§1.1）——非代码 bug，是文档级陷阱；`parseDisabledFlag` 对 `"1"` 静默落穿，后来者可能误以为开关已生效 | modelConfigService.ts:325 | 对非 true/false 值 log 一次 warning（配置手误可见），或文档明示 |
| D2 | `replay-baseline.ts` 清理删错表：`DELETE FROM checkpoints`（public 空壳表）而真 checkpointer 在 `agent_runtime` schema——脚本显示 cleanup 成功实则 0 行（本实验脚本已修正三表连删） | jev-nodes-research/replay-baseline.ts | 基线脚本同修（另一批） |
| D3 | `THINKING_DISABLED_<TASK>` 的 TASK 语义 = scenario 名而非任务域——「只关计划轮不关问卷轮」现链路做不到（scenario=chat 一开全开） | modelConfigService.ts resolveThinkingConfig 设计层 | 若要轮级粒度需 scenario 拆分或接受整场景关闭 |
| D4 | 计划充分性闸门缺口：submit L2 闸门 + uiHint schema 校验对「6 主项空壳/日标签与内容不符/sets 无剂量」全部放行（§4.2 实证） | cardSubmit/weeklyPlan 校验层 | 补三项检查：主体动作数下限（按 days_per_week×分化）、day_focus↔entries 一致性、main sets 剂量完整性 |

## 附录 A · 原始数据

- `results/replay-hit.json` / `results/replay-half.json`：逐 turn 全计量（含质量门新字段 validationRetries/leakSuspects + 工具轮次进程内修复版）
- `results/replay-events-{hit,half}-run{N}.jsonl(.gz)`：逐事件流（thinking 头 240 / token 头 120 字符）
- half 批 KEEP=1 取证产物（thread 全量 dump → submit args/instantiate 结构比对）已固化进本报告 §4.2；checkpoint 本体按卫生标准删除
- `../jev-nodes-research/results/`：对照组原始数据（不重跑）
- 复现命令：见 `README.md`

## 附录 B · 执行时间线（深夜窗纪律）

| 时刻（CST） | 动作 |
| --- | --- |
| 23:39 | 开工核基线（15629548 ✓），读 spec/基线数据/modelConfigService |
| 23:46-23:47 | self-check 7/7（含 S7 判据修正：langchain modelKwargs 默认空对象） |
| 23:51 | hit 批首发 → 误判中止（thinking 事件仍在流）→ 复盘定位二分口径 → 清理重跑 |
| 00:0x | hit 批完成 ×2；发现 submit 双调 + D2 清理 bug |
| 00:1x-00:2x | half 批 KEEP=1 ×2 完成；取证 dump → 空壳提交实锤 |
| 00:2x | 报告 + gzip + 清理复核 |
