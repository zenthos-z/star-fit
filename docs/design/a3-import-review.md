# A3 动作库导入人工审核清单（issue #11）

> 生成时间：2026-09-26T06:09:45.338Z
> 源：库3 free-exercise-db-with-videos 317 条（基线，内部重名丢弃 3）｜库1 free-exercise-db 876 条（补充池）
> 导入口径：库3 314 条 + 库1 补缺 40 条 = **354 条**（精收 300-500）
> 判重口径：主名 token（去括号/标点）Jaccard ≥ 0.75 且器材相同且主肌群有交集；精确重名一律库3 胜出

## 1. 库3 内部重名丢弃（3）

| 动作名 | 保留源 id | 丢弃源 id | 说明 |
| --- | --- | --- | --- |
| 45-Degree Bicycle Twisting Crunch | drv-45-degree-bycicle-twisting-crunch | drv-45-degree-bycicle-twisting-crunch-1 | 同重名但 target 不同（保留 obliques，丢弃 abdominals） |
| Bridge Pose (Setu Bandhasana) | drv-stretching-bridge-pose-setu-bandhasana | drv-stretching-bridge-pose-setu-bandhasana-1 | 完全重复行，保留首条 |
| Sit-Up | drv-sit-ups | drv-sit-up | 完全重复行，保留首条 |

## 2. 库1∩库3 精确重名（33，库3 胜出、库1 跳过）

### 2.1 冲突——重名但器材/主肌群不一致（10，需人工裁决）

| 动作名 | 库3 器材 | 库1 器材 | 库3 主肌群 | 库1 主肌群 |
| --- | --- | --- | --- | --- |
| Band Assisted Pull-Up | band | other | lats | lats |
| Barbell Lunge | barbell | barbell | glutes | quadriceps |
| Battling Ropes | cable | other | shoulders | shoulders |
| Dumbbell Squat | dumbbell | dumbbell | glutes | quadriceps |
| Elliptical Trainer | machine | machine | — | quadriceps |
| Inverted Row with Straps | bodyweight | other | middle_back | middle_back |
| Otis-Up | weighted | other | abdominals | abdominals |
| Peroneals Stretch | bodyweight | other | calves | calves |
| Runner's Stretch | bodyweight | bodyweight | quadriceps | hamstrings |
| Weighted Sissy Squat | weighted | barbell | quadriceps | quadriceps |

### 2.2 单纯重复——三元组一致（23，跳过无争议）

- Barbell Curl
- Barbell Shrug
- Bench Dips
- Cable Lying Triceps Extension
- Cable Rope Overhead Triceps Extension
- Chin To Chest Stretch
- Decline Dumbbell Bench Press
- Dumbbell Incline Row
- Dumbbell One-Arm Triceps Extension
- Dumbbell Prone Incline Curl
- Dumbbell Shrug
- Dumbbell Side Bend
- Dynamic Chest Stretch
- Incline Push-Up
- Middle Back Stretch
- Reverse Crunch
- Seated Calf Stretch
- Sit-Up
- Smith Machine Calf Raise
- Smith Machine Leg Press
- Spell Caster
- Standing Lateral Stretch
- Wrist Circles

## 3. 低置信度入选（0）

入选库1 补缺行与库3某行近似（Jaccard 0.6-0.75 且同器材）——大概率是合理变体，建议抽查：

| 入选（库1） | 相似库3 行 | Jaccard |
| --- | --- | --- |

## 4. 源值未映射（11 项 → 按契约规则落 null，已计数上报）

| 字段 | 原值 | 出现次数 |
| --- | --- | --- |
| lib3.secondaryMuscles | achilles tendon | 1 |
| lib3.secondaryMuscles | ankle stabilizers | 2 |
| lib3.secondaryMuscles | ankles | 2 |
| lib3.secondaryMuscles | core | 7 |
| lib3.secondaryMuscles | core stabilizers | 1 |
| lib3.secondaryMuscles | intercostals | 1 |
| lib3.secondaryMuscles | varies by machine | 1 |
| lib3.secondaryMuscles | varies by machine (legs, glutes, arms) | 1 |
| lib3.secondaryMuscles | varies by movement | 1 |
| lib3.target | cardiovascular system | 10 |
| lib3.target | full body | 1 |

## 5. 覆盖矩阵残余缺口（40 格，补缺后仍为 0）

| 模式 | 器材 | 原因 |
| --- | --- | --- |
| push | bench | 库1 无候选 |
| push | rack | 库1 无候选 |
| push | pull_up_bar | 库1 无候选 |
| push | foam_roller | 库1 无候选 |
| push | weighted | 库1 无候选 |
| pull | bench | 库1 无候选 |
| pull | rack | 库1 无候选 |
| pull | pull_up_bar | 库1 无候选 |
| pull | foam_roller | 库1 无候选 |
| squat | cable | 库1 无候选 |
| squat | bench | 库1 无候选 |
| squat | rack | 库1 无候选 |
| squat | pull_up_bar | 库1 无候选 |
| squat | stability_ball | 库1 无候选 |
| squat | medicine_ball | 库1 无候选 |
| squat | foam_roller | 库1 无候选 |
| hip_hinge | bench | 库1 无候选 |
| hip_hinge | rack | 库1 无候选 |
| hip_hinge | pull_up_bar | 库1 无候选 |
| hip_hinge | medicine_ball | 库1 无候选 |
| hip_hinge | foam_roller | 库1 无候选 |
| hip_hinge | weighted | 库1 无候选 |
| loaded_carry | bodyweight | 库1 无候选 |
| loaded_carry | barbell | 库1 无候选 |
| loaded_carry | dumbbell | 库1 无候选 |
| loaded_carry | kettlebell | 库1 无候选 |
| loaded_carry | cable | 库1 无候选 |
| loaded_carry | machine | 库1 无候选 |
| loaded_carry | band | 库1 无候选 |
| loaded_carry | bench | 库1 无候选 |
| loaded_carry | rack | 库1 无候选 |
| loaded_carry | pull_up_bar | 库1 无候选 |
| loaded_carry | stability_ball | 库1 无候选 |
| loaded_carry | medicine_ball | 库1 无候选 |
| loaded_carry | foam_roller | 库1 无候选 |
| loaded_carry | weighted | 库1 无候选 |
| core | bench | 库1 无候选 |
| core | rack | 库1 无候选 |
| core | pull_up_bar | 库1 无候选 |
| core | foam_roller | 库1 无候选 |

## 附：导入后覆盖矩阵（六大模式 × 15 器材）

| 模式 | bodyweight | barbell | dumbbell | kettlebell | cable | machine | band | bench | rack | pull_up_bar | stability_ball | medicine_ball | foam_roller | weighted | other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| push | 16 | 11 | 30 | 5 | 13 | 8 | 8 | 0 | 0 | 0 | 2 | 3 | 0 | 0 | 6 |
| pull | 17 | 9 | 22 | 3 | 15 | 6 | 4 | 0 | 0 | 0 | 3 | 4 | 0 | 1 | 9 |
| squat | 3 | 3 | 5 | 3 | 0 | 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 3 |
| hip_hinge | 1 | 2 | 3 | 1 | 3 | 4 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 3 |
| loaded_carry | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| core | 39 | 1 | 2 | 3 | 4 | 1 | 4 | 0 | 0 | 0 | 10 | 3 | 0 | 4 | 3 |
