# 共享类型

**状态**: 与源码对齐（2026-09 重写）

---

前后端共享类型的唯一来源是 **`shared/contracts/`**（Zod Schema 定义，类型经
`z.infer` 推导，带运行时校验）。前端与后端都从这里 import，不在各自代码里重复定义。

> 历史路径 `backend/src/types/shared.ts` 与 `shared/v2/types/protocol.ts` 已废弃，
> 被 `shared/contracts` 取代。

## 文件结构

```
shared/contracts/
├── index.ts        # 扁平导出入口；LoadAnchor/用户画像/协议状态等核心 Schema
├── validation.ts   # parseJSONSafe / validateOrThrow / validateBatch 等校验工具
├── suggestions.ts  # 动作建议契约
├── database/       # 数据库行契约
├── logging/        # 日志事件契约
└── mapping/        # 字段映射
```

## 使用约定

1. **类型导入**：与后端交互的类型一律 `import { ... } from '@starfit/shared/contracts'`（或仓库内相对路径），禁止本地重定义
2. **安全解析**：JSON 解析必须走 `parseJSONSafe()`，失败抛 `JSONParseError`
3. **验证失败必须处理**：Zod 校验失败要么抛错、要么记录日志，禁止静默吞掉
4. **命名**：数据库层与应用层统一 snake_case

## 核心 Schema 一览（节选）

| Schema | 用途 |
| --- | --- |
| `LoadAnchorSchema` / `LoadAnchorsSchema` | 负荷锚点（心率/阻力/自重/辅助/等长/有氧六类子锚点） |
| `HeartRateAnchorSchema` | 心率区间阈值与基线 |
| `BasicInfoSchema` / `PreferencesSchema` / `PhysiologicalSchema` / `PsychologicalSchema` / `PsychoOSSchema` | 用户画像三态模型 |
| `HRBaselineSchema` / `ProtocolStatusSchema` | 心率基线 / 协议状态 |
| `suggestions.ts` 导出 | 动作建议（off / hybrid）进出契约 |

完整清单直接读 `shared/contracts/index.ts`（扁平导出）。数据协议概览见
[数据协议](/concepts/data-protocol)。
