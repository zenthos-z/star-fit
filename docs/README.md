# Starfit 文档地图 (Documentation Map)

本目录存放**领域知识与分析资料**。开发者文档（架构、API、UI 规范）的真源是
`backend/` 代码与 `shared/contracts/`（数据契约唯一定义源）；本目录仅保留
不可再生的决策/设计记录与有效依据。

---

## 目录导航

### 有效设计依据

- [design-spec-ios.md](design-spec-ios.md) — iOS 设计规范（iOS 26 Liquid Glass / HIG 对齐，新页面新组件遵循）
- [profile-update-frontend-spec.md](profile-update-frontend-spec.md) — 用户画像自动更新前端实现规范
- [references/scoring_logic.md](references/scoring_logic.md) — 力训设计表 MEV/MRV 评分逻辑
- [scripts/calculate_training_volume.py](scripts/calculate_training_volume.py) — 训练量计算脚本

### 小工具

- [小工具/](小工具/) — 独立 HTML 小工具（端口管理器 GUI）

### 档案与记录

- [adr/](adr/) — 架构决策记录
- [changelog/](changelog/) — 变更日志
- [screenshots/](screenshots/) — 前端与管理台截图
- [archive/](archive/) — 历史归档（过时/一次性分析文档，仅供参考）

### 项目上下文

- [CONTEXT.md](../CONTEXT.md) — 项目上下文
