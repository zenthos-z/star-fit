---
name: bridge
description: |
  star-fit 数据桥（starfit-bridge CLI）操作技能——供外部 Agent 读写 star-fit 用户运动数据与画像。
  触发词：bridge、starfit-bridge、查训练记录、导出会话、用户画像、动作库查询、app 配置、
  starfit 数据、star-fit data、训练计划查询。
  前置：bridge config set server+token 一次性配置后即可全量消费数据（--json 机器通道）。
---

# bridge — star-fit 数据桥技能

starfit-bridge 是 star-fit 的**数据全量开放对接 CLI**：外部 Agent（你）通过它读写
用户的运动数据与画像。通道 = 现有 REST API（`X-Access-Token` = 服务器
`STARFIT_ACCESS_TOKEN` 同一令牌体系），输出 = 人读表格（默认）或 `--json`
机器信封（**主用**）。

## 前置（一次性，缺一不可）

```bash
# 1. 安装（仓库内包，未发布前从 monorepo 本地装）
cd packages/starfit-bridge && npm install && npm run build
# 可选全局链接：npm link（之后直接用 bridge 命令；未链接时用 node packages/starfit-bridge/dist/index.js）

# 2. 指向服务器（CLI 配置文件 ~/.config/starfit-bridge/config.json）
bridge config set server http://<host>:43111
bridge config set token <STARFIT_ACCESS_TOKEN>    # 服务器未开鉴权可跳过

# 3. 连接自检
bridge ping        # 期望 ok:true, app:starfit
```

env 双通道：`STARFIT_BRIDGE_SERVER` / `STARFIT_BRIDGE_TOKEN`（或复用
`STARFIT_ACCESS_TOKEN`）可覆盖配置文件；单次调用也可 `--server` / `--token` 临时覆盖。

## 常用动词速查

```bash
bridge ping                                   # 连接自检（GET /health）

bridge profile get <user> --json              # 用户画像全量（原始分段透传）
bridge profile update <user> --field basic_info.weight=80 --field basic_info.age=35
                                              # 字段更新（读-改-写，保住同段其余字段）

bridge app-config get [key] --json            # 远端 app_configs 读
bridge app-config set <key> '<json>'          # 写（value 按 JSON 解析，失败按字符串）

bridge data sessions <user> --limit 10 --json # 训练会话（raw_json 全量动作明细）
bridge data plans <user> --json               # 本周计划（默认当前周；--date D 或 --from D --to D）
bridge data exercises --json                  # 动作库全量；--id <id> 单个
bridge data hr <user>                         # 心率时序（占位，第二批实现，exit 3）
```

`<user>` 接受 display_name（人类可读）或 UUID（内部 ID）；同名歧义时改用 UUID。
本地配置查看/管理：`bridge config get` / `config path`。

## --json 输出契约（机器通道）

```json
{
  "schema_version": "1.0.0",        // 信封契约版本（semver；MAJOR=结构破坏性变更）
  "bridge_version": "0.1.0",        // CLI 版本
  "endpoint": "GET /api/...",        // 数据来源端点
  "generated_at": "2026-...Z",
  "ok": true,
  "data": { }                        // ← 服务器响应原样透传（唯一数据字段）
}
```

失败时输出 `{ok:false, error:{kind, message}}` 到 stdout（kind:
usage | user_resolution | api | internal），退出码 0/1/2/3
（成功/运行错误/用法错误/未实现）。

## 数据形状说明（真源指向）

**CLI 层零裁剪零映射——字段含义以契约仓库为真源**：
`shared/contracts/`（monorepo 内，数据契约唯一定义源）。常用：

| 动词 | 端点 | 形状真源 |
| --- | --- | --- |
| profile get | GET /api/profiles/:userId | shared/contracts `UserProfile` 系（basic_info / preferences / physiological / psychological / load_anchors / active_limitations / recovery_state 分段 JSONB） |
| data sessions | GET /api/admin/users/:id/sessions | sessions 表行（raw_json = 全量动作明细：组数/重量/RPE；ai_audit_text = AI 审计） |
| data plans | GET /api/schedule/today?date= | shared/contracts `TodayScheduleResponseSchema`（date / week_id / status / split / entries） |
| data exercises | GET /api/exercises[/:id] | shared/contracts exercise-library（exercise_type / instructions_zh / video_urls 等；per-type 扩展块设计见下） |
| app-config | GET/POST /api/admin/configs | app_configs 表（user_id="admin" 命名空间，value JSONB） |

画像段字段白名单（服务端 Zod 校验，未知键静默丢弃）：
basic_info(age/weight/height/body_fat/training_age/gender)、
preferences(method/avoided/time_constraint/equipment/goal/weekly_frequency_days)、
physiological(sleep_hours/stress_level/cycle_focus)、
psychological(neurotype/accountability/risk_preference)。
动态段：load_anchors / active_limitations / recovery_state。

## 契约演进四原则（消费端必读，issue #90 项目主人定调）

1. **schema 版本协商**：载荷信封带 `schema_version`，按版本解读；演进不破坏老消费者。
2. **原始透传**：CLI 不裁剪/映射字段——`data` 字段就是服务器原样响应。**消费端也不要
   假设字段集合固定**：新增字段是常态（MINOR），直接忽略未知键，不要报错。
3. **动作类型差异化**：exercises / raw_json 内允许 per-exercise-type 扩展数据块
   （resistance / cardio / isometric / 心率各有细节参数，未来只增不改）。
   解析时按 `exercise_type` 分派，未知类型按通用块兜底。
4. **心率时序独立通道**：heart_rate_samples 类时序数据走 `bridge data hr` 独立导出
   （量级与结构化画像不同；P0 占位，第二批交付）。不要从 sessions 通道猜心率结构。

## 写操作注意

- `profile update` 是**读-改-写**：单字段更新不会抹掉同段其余字段（CLI 已保证）。
- `app-config set` 的 value 会整体替换该 key 的旧值（无合并）。
- 写操作幂等性不保证，Agent 重复执行前先 get 核对当前值。
