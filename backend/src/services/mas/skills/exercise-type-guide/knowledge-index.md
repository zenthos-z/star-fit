# 动作类型知识索引

## 快速参考表

| 类型 | 名称 | 必需字段 | 典型场景 | 查询命令 |
|------|------|----------|----------|----------|
| resistance | 抗阻力训练 | weight > 0 | 增肌、力量 | get_exercise_type_knowledge({type: "resistance"}) |
| bodyweight | 自重训练 | 无 | 徒手训练 | get_exercise_type_knowledge({type: "bodyweight"}) |
| isometric | 等长收缩 | duration > 0 | 核心稳定 | get_exercise_type_knowledge({type: "isometric"}) |
| cardio | 有氧训练 | duration > 0 | 心肺功能 | get_exercise_type_knowledge({type: "cardio"}) |
| outdoor | 户外运动 | distance > 0 | 户外跑步 | get_exercise_type_knowledge({type: "outdoor"}) |
| unilateral | 单侧训练 | weight >= 0 | 单侧强化 | get_exercise_type_knowledge({type: "unilateral"}) |
| assisted | 辅助训练 | weight > 0 | 助力完成 | get_exercise_type_knowledge({type: "assisted"}) |
| flexibility | 柔韧性训练 | 无 | 拉伸放松 | get_exercise_type_knowledge({type: "flexibility"}) |
| heavy_weight | 大重量训练 | weight > 0 | 1RM 突破 | get_exercise_type_knowledge({type: "heavy_weight"}) |
| rep_training | 次数训练 | weight >= 0 | 次数挑战 | get_exercise_type_knowledge({type: "rep_training"}) |

## 使用指南

### 何时查询详细知识？

**建议查询**：
- 生成的计划中包含该类型动作
- 不确定该类型的参数设置
- 用户明确指定了训练目标

**无需查询**：
- 只是浏览动作列表
- 用户需求很明确且常见

### 工具使用示例

```javascript
// 查询单个类型 - 返回该类型的详细知识（~1000-2000 tokens）
get_exercise_type_knowledge({ type: "cardio" })

// 查询多个类型 - 返回多个类型的概要（~300 tokens/类型）
get_exercise_type_knowledge({ types: ["resistance", "bodyweight"] })

// 不传参数 - 返回轻量级索引（所有类型概要，~500 tokens）
get_exercise_type_knowledge()
```

## 按类别分类

### 力量类 (Strength)
- **resistance** - 抗阻力训练：需要 weight > 0
- **unilateral** - 单侧训练：weight >= 0
- **assisted** - 辅助训练：weight > 0（可为负值表示辅助）
- **heavy_weight** - 大重量训练：weight > 0，接近 1RM

### 时长类 (Time)
- **isometric** - 等长收缩：需要 duration > 0
- **cardio** - 有氧训练：需要 duration > 0

### 距离类 (Distance)
- **outdoor** - 户外运动：需要 distance > 0

### 自重类 (Bodyweight)
- **bodyweight** - 自重训练：无必需字段，weight 通常为 0
- **rep_training** - 次数训练：无必需字段，weight 通常为 0

### 其他类
- **flexibility** - 柔韧性训练：无必需字段
