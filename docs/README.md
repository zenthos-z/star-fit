# Starfit 文档地图 (Documentation Map)

本目录存放**领域知识与分析资料**。开发者文档（架构、API、UI 规范）在
`docs-site/`（VitePress 文档站，`npm run docs:dev` 启动）。

---

## 目录导航

### 领域分析

- [用户画像数据流分析.md](用户画像数据流分析.md) — 用户画像的数据流转
- [analysis/RPE评估场景与用户画像关联分析.md](analysis/RPE评估场景与用户画像关联分析.md) — RPE 评估与用户画像的关联
- [analysis/LLM数据结构损坏风险与防护方案.md](analysis/LLM数据结构损坏风险与防护方案.md) — LLM 输出结构损坏的防护方案

### 向量检索 / 数据层

- [vector-ai-analysis.md](vector-ai-analysis.md) — 向量 AI 分析
- [vector-search-investigation-report-2026-02-12.md](vector-search-investigation-report-2026-02-12.md) — 向量检索调研报告

### 参考规范

- [references/scoring_logic.md](references/scoring_logic.md) — 力训设计表 MEV/MRV 评分逻辑
- [scripts/calculate_training_volume.py](scripts/calculate_training_volume.py) — 训练量计算脚本

### 截图

- [screenshots/](screenshots/) — 前端与管理台截图（README 配图来源）

### 变更记录

- [changelog/](changelog/) — 变更日志

### 小工具

- [小工具/](小工具/) — 独立 HTML 小工具（动作库修复器、端口管理器 GUI、海报提示词生成器）

---

## 文档站点

技术文档（架构设计、数据库、UI 指南、API 参考）位于 `docs-site/`：

```bash
npm run docs:dev   # 启动 VitePress 文档站
```
