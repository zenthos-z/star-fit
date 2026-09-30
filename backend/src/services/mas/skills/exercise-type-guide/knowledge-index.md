# 动作类型知识索引

> 本文件由 scripts/gen-exercise-type-index.mjs 从 shared/contracts/card-types.ts
> 生成（#88 分册1 类型单一真源），禁手改——改类型定义请改 card-types.ts
> 后重新生成。

## 快速参考表

| 细类 | 大类 | 名称 | cardType | 必需字段 | 典型场景 | 详细知识 |
|------|------|------|----------|----------|----------|----------|
| resistance | resistance | 抗阻力训练 | resistance_standard | weight > 0 | 增肌、力量 | read_file("/exercise-type-guide/knowledge/resistance.md") |
| unilateral | resistance | 单侧训练 | resistance_standard | weight > 0 | 单侧强化 | read_file("/exercise-type-guide/knowledge/unilateral.md") |
| bodyweight | resistance | 自重训练 | resistance_standard | 无（weight 默认 0） | 徒手训练 | read_file("/exercise-type-guide/knowledge/bodyweight.md") |
| assisted | resistance | 辅助训练 | resistance_standard | weight <= 0（负值助力，如 -20 = 辅助 20kg） | 助力完成 | read_file("/exercise-type-guide/knowledge/assisted.md") |
| isometric | isometric | 等长收缩 | isometric_static | duration > 0（reps 应为 1） | 核心稳定 | read_file("/exercise-type-guide/knowledge/isometric.md") |
| cardio | cardio | 有氧训练 | cardio_running | duration > 0 | 心肺功能 | read_file("/exercise-type-guide/knowledge/cardio.md") |
| flexibility | stretch | 柔韧性训练 | stretch_standard | 无（可选 duration） | 拉伸放松 | read_file("/exercise-type-guide/knowledge/flexibility.md") |
| heavy_weight | resistance | 大重量训练 | resistance_standard | weight > 0 | 1RM 突破 | read_file("/exercise-type-guide/knowledge/heavy_weight.md") |
| rep_training | resistance | 次数训练 | resistance_standard | 无（weight 默认 0） | 次数挑战 | read_file("/exercise-type-guide/knowledge/rep_training.md") |
| outdoor | cardio | 户外运动 | cardio_outdoor | distance > 0 | 户外跑步 | read_file("/exercise-type-guide/knowledge/outdoor.md") |

## 使用指南

### 何时查询详细知识？

**建议查询**：
- 生成的计划中包含该类型动作
- 不确定该类型的参数设置
- 用户明确指定了训练目标

**无需查询**：
- 只是浏览动作列表
- 用户需求很明确且常见

### 按需读取示例（原生 read_file）

```javascript
// 单个类型详细知识（~1000-2000 tokens）
read_file("/exercise-type-guide/knowledge/cardio.md")

// 轻量级索引（本文件，所有类型概要，~500 tokens）
read_file("/exercise-type-guide/knowledge-index.md")
```

## 按大类分类（5 大类两级体系）

cardType = `{major}_{variant}`（如 resistance_standard、cardio_running），
为卡片分发键；细类为动作库/计划维度检索轴。

### 抗阻训练（resistance）
- **resistance** - 抗阻力训练：weight > 0
- **unilateral** - 单侧训练：weight > 0
- **bodyweight** - 自重训练：无（weight 默认 0）
- **assisted** - 辅助训练：weight <= 0（负值助力，如 -20 = 辅助 20kg）
- **heavy_weight** - 大重量训练：weight > 0
- **rep_training** - 次数训练：无（weight 默认 0）

### 有氧训练（cardio）
- **cardio** - 有氧训练：duration > 0
- **outdoor** - 户外运动：distance > 0

### 高强度间歇（hiit）
- 无细类（仅动作/cardType 层有效，cardType = hiit_timer）

### 等长训练（isometric）
- **isometric** - 等长收缩：duration > 0（reps 应为 1）

### 柔韧拉伸（stretch）
- **flexibility** - 柔韧性训练：无（可选 duration）
