# starfit-bridge

**star-fit 数据桥** —— 用户运动数据与画像的全量开放对接 CLI。外部 Agent
（Claude Code / 任意 Hermes / 自定义脚本）零门槛接入消费 star-fit 数据。

- 通道：现有 REST API（不新增后端入口）
- 鉴权：`STARFIT_ACCESS_TOKEN` 体系（`X-Access-Token` 头；env 或配置文件双通道）
- 输出：人读表格（默认）/ `--json` 机器信封（`schema_version` 版本协商，数据原样透传）
- 依赖：零运行时依赖（Node ≥ 18，自研轻参数解析）

## 安装

```bash
cd packages/starfit-bridge
npm install
npm run build          # → dist/index.js
npm link               # 可选：全局 bridge 命令
```

未 link 时以 `node packages/starfit-bridge/dist/index.js <动词>` 调用。

## 快速开始

```bash
bridge config set server http://<host>:43111
bridge config set token <STARFIT_ACCESS_TOKEN>   # 服务器未开鉴权可跳过
bridge ping                                       # 连接自检

bridge profile get <user> --json                  # 画像（原始分段透传）
bridge data sessions <user> --limit 10 --json     # 训练会话
bridge data plans <user> --json                   # 本周计划
bridge data exercises --json                      # 动作库
bridge data hr <user>                             # 心率时序（占位，第二批）
bridge --help
```

`<user>` = display_name 或 UUID。完整动词表与数据形状说明见
`.claude/skills/bridge/SKILL.md`（配套技能，教外部 Agent 使用）。

## 开发

```bash
npm test            # build + 单测（config/参数解析/输出双模/端点映射 mock fetch）
npm run typecheck
```

## 契约演进原则（issue #90 定调）

1. 导出载荷带 `schema_version`，消费端按版本解读
2. 原始 JSON 透传——CLI 层禁字段裁剪/映射，形状真源在 `shared/contracts/`
3. 允许 per-exercise-type 扩展数据块（只增不改）
4. 心率时序独立导出通道（与结构化画像分轨）
