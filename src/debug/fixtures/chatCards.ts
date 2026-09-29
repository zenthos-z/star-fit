/**
 * T1 对话卡片 fixtures（issue #53）——每个 uiHint 卡片类型的真实形态样例。
 *
 * 形态真源（按 CLAUDE.md 裁决序：代码 > 文档）：
 *  - backend/src/services/agent/schemas/uiHintSchemas.ts（UIHintSchema 判别联合
 *    ——后端校验回路 uiHintValidationLoop 实际执行的那份 Zod）
 *  - backend/src/services/agent/uiHintFormat.ts（HC-1 技能教 Agent 产出的形态）
 *  - src/components/execution/ExerciseRenderer.tsx PluginRegistry（前端分发键）
 *
 * 每个带 backendValidated 的 wireCard 由 fixtures.schema.test.ts 逐一对
 * backend UIHintSchema 校验——改契约或改 fixture 都会被测试拦下。
 *
 * 周计划周日期取固定周 2026-10-05（周一）～ 2026-10-11（周日），保证测试确定性。
 */
import type { DebugScenario } from './types';

/** weekly_plan 用的 NanoID 形态动作 id（12-24 字符，对齐 exercises.id / plan_entries.exercise_id） */
const EX = {
  bench: 'V1StGXR8_Z5jdHi6', // 平板杠铃卧推
  shoulderPress: 'a1b2c3d4e5f6g7h8', // 坐姿肩推
  row: 'b2c3d4e5f6a1b2c3', // 杠铃划船
  pullUp: 'c3d4e5f6a1b2c3d4', // 引体向上
  squat: 'd4e5f6a1b2c3d4e5', // 杠铃深蹲
  legPress: 'e5f6a1b2c3d4e5f6', // 腿举
} as const;

/** 推拉腿 · 3 练整周展示数据（days 覆盖周一～周日） */
const PPL_DAYS = [
  {
    entry_date: '2026-10-05',
    split_label: '推',
    focus: '胸肩三头 · 4 动作',
    rest: false,
    exercises: [
      {
        exercise_id: EX.bench,
        name: '平板杠铃卧推',
        sets: [
          { set: 1, weight: 60, reps: 8, set_type: 'warmup' as const },
          { set: 2, weight: 70, reps: 8 },
          { set: 3, weight: 72.5, reps: 6 },
        ],
      },
      {
        exercise_id: EX.shoulderPress,
        name: '坐姿肩推',
        sets: [
          { set: 1, weight: 20, reps: 10 },
          { set: 2, weight: 22.5, reps: 8 },
        ],
      },
    ],
  },
  { entry_date: '2026-10-06', rest: true, exercises: [] },
  {
    entry_date: '2026-10-07',
    split_label: '拉',
    focus: '背二头 · 4 动作',
    rest: false,
    exercises: [
      {
        exercise_id: EX.row,
        name: '杠铃划船',
        sets: [{ set: 1, weight: 55, reps: 8 }, { set: 2, weight: 60, reps: 8 }],
      },
      {
        exercise_id: EX.pullUp,
        name: '引体向上（自重）',
        sets: [{ set: 1, reps: 8 }, { set: 2, reps: 6 }],
      },
    ],
  },
  { entry_date: '2026-10-08', rest: true, exercises: [] },
  {
    entry_date: '2026-10-09',
    split_label: '腿',
    focus: '股四臀腘 · 4 动作',
    rest: false,
    exercises: [
      {
        exercise_id: EX.squat,
        name: '杠铃深蹲',
        sets: [{ set: 1, weight: 80, reps: 8 }, { set: 2, weight: 90, reps: 6 }],
      },
      {
        exercise_id: EX.legPress,
        name: '腿举',
        sets: [{ set: 1, weight: 120, reps: 12 }],
      },
    ],
  },
  { entry_date: '2026-10-10', rest: true, exercises: [] },
  { entry_date: '2026-10-11', rest: true, exercises: [] },
];

/** 确认落库载荷（B5b 提案-确认）：scope=week 需带 split，entries 覆盖 3 个训练日 */
const PPL_APPLY = {
  scope: 'week' as const,
  split: 'push_pull_legs' as const,
  dates: [],
  entries: [
    { entry_date: '2026-10-05', exercise_id: EX.bench, target_sets: 3, target_load: { type: 'rpe' as const, min: 7, max: 8 }, sort_order: 0 },
    { entry_date: '2026-10-05', exercise_id: EX.shoulderPress, target_sets: 2, target_load: { type: 'rpe' as const, min: 7, max: 8 }, sort_order: 1 },
    { entry_date: '2026-10-07', exercise_id: EX.row, target_sets: 2, target_load: { type: 'rpe' as const, min: 7, max: 8 }, sort_order: 0 },
    { entry_date: '2026-10-07', exercise_id: EX.pullUp, target_sets: 2, target_load: { type: 'rpe' as const, min: 6, max: 8 }, sort_order: 1 },
    { entry_date: '2026-10-09', exercise_id: EX.squat, target_sets: 2, target_load: { type: 'percent_1rm' as const, min: 70, max: 80 }, sort_order: 0 },
    { entry_date: '2026-10-09', exercise_id: EX.legPress, target_sets: 1, target_load: { type: 'rpe' as const, min: 7, max: 8 }, sort_order: 1 },
  ],
};

export const CHAT_CARD_SCENARIOS: DebugScenario[] = [
  // ── plan_card：当场训练计划（含 diff 高亮）───────────────────────────────
  {
    id: 'plan-card-session',
    group: 'chat-card',
    label: '计划卡 · 当场训练',
    description: 'plan_card 数组形态 + diff 高亮（新增/调整）；确认后进当前会话',
    bubbleText: '结合你近两次的训练表现，今天建议练推日，重点保卧推容量：',
    backendValidated: true,
    wireCard: {
      type: 'plan_card',
      data: [
        { exerciseId: 'bench_press', name: '杠铃卧推', exercise_type: 'resistance', sets: 4, reps: 8, weight: 60 },
        { exerciseId: 'inclined_dumbell_press', name: '哑铃上斜卧推', exercise_type: 'unilateral', sets: 3, reps: 12, weight: 20 },
        { exerciseId: 'plank', name: '平板支撑', exercise_type: 'isometric', sets: 3, reps: 1, duration: 60 },
        { exerciseId: 'treadmill_warmup', name: '跑步机热身', exercise_type: 'cardio', sets: 1, reps: 1, duration: 600 },
      ],
      diff: { added: ['plank'], modified: ['bench_press'], removed: [] },
    },
  },
  // ── plan_card target=next_day：明日计划卡（双按钮形态）──────────────────
  {
    id: 'plan-card-next-day',
    group: 'chat-card',
    label: '计划卡 · 明日（target=next_day）',
    description: 'Agent 对「制定明天计划」意图打标的独立明日卡，按日历日期保存',
    bubbleText: '明天的训练我帮你排好了，腿部为主，配重沿用本周深蹲锚点：',
    backendValidated: true,
    wireCard: {
      type: 'plan_card',
      target: 'next_day',
      data: [
        { exerciseId: 'squat', name: '杠铃深蹲', exercise_type: 'resistance', sets: 5, reps: 5, weight: 85 },
        { exerciseId: 'leg_press', name: '腿举', exercise_type: 'resistance', sets: 3, reps: 12, weight: 120 },
        { exerciseId: 'calf_raise', name: '站姿提踵', exercise_type: 'rep_training', sets: 4, reps: 15 },
      ],
    },
  },
  // ── weekly_plan：周计划卡（提案-确认形态，带 apply 载荷）────────────────
  {
    id: 'weekly-plan-card',
    group: 'chat-card',
    label: '周计划卡 · 推拉腿整周',
    description: 'weekly_plan 卡（B5b 提案-确认）：7 天纵列 + apply 确认落库载荷',
    bubbleText: '按你「每周 3 练、主项渐进」的偏好，下一周的推拉腿安排如下：',
    backendValidated: true,
    wireCard: {
      type: 'weekly_plan',
      data: {
        week_label: '第 2 周',
        phase_label: '力量块',
        split_summary: '推拉腿 · 每周 3 练 · 主项渐进 +1 档',
        days: PPL_DAYS,
        apply: PPL_APPLY,
      },
    },
  },
  // ── survey_card：首用画像问卷（预声明选项 + 多选）──────────────────────
  {
    id: 'survey-card-first-use',
    group: 'chat-card',
    label: '问卷卡 · 首用画像调研',
    description: 'survey_card 多题形态：预声明选项（experience/goal/equipment 多选）',
    bubbleText: '为了给你排合适的计划，先花 1 分钟告诉我你的基本情况：',
    backendValidated: true,
    wireCard: {
      type: 'survey_card',
      data: {
        title: '训练画像调研',
        subtitle: '约需 1 分钟',
        questions: [
          {
            id: 'experience',
            question: '你的训练经验？',
            required: true,
            options: [
              { label: '完全新手', value: 'beginner' },
              { label: '有一定经验', value: 'intermediate' },
              { label: '资深练家', value: 'advanced' },
            ],
          },
          {
            id: 'goal',
            question: '当前主要目标？',
            required: true,
            options: [
              { label: '增肌', value: 'muscle_gain' },
              { label: '减脂', value: 'fat_loss' },
              { label: '力量', value: 'strength' },
              { label: '健康', value: 'health' },
            ],
          },
          {
            id: 'equipment',
            question: '可用的器械条件？（可多选）',
            required: true,
            inputType: 'checkbox',
            options: [
              { label: '健身房', value: 'gym' },
              { label: '哑铃杠铃', value: 'free_weights' },
              { label: '自重', value: 'bodyweight' },
              { label: '弹力带', value: 'bands' },
            ],
          },
        ],
      },
    },
  },
  // ── survey_card：练后问卷（智能 2 题 + 数字输入）───────────────────────
  {
    id: 'survey-card-post-workout',
    group: 'chat-card',
    label: '问卷卡 · 练后快速调研',
    description: 'workout_complete 场景问卷：疲劳度单选 + 体重数字输入',
    bubbleText: '这次训练的数据已记录，再补两个信息帮你校准恢复状态：',
    backendValidated: true,
    wireCard: {
      type: 'survey_card',
      data: {
        title: '练后快速调研',
        subtitle: '2 题 · 约需 30 秒',
        questions: [
          {
            id: 'fatigue_level',
            question: '今天训练整体感觉如何？',
            required: true,
            options: [
              { label: '轻松 (RPE < 6)', value: 'easy' },
              { label: '适中 (RPE 7-8)', value: 'moderate' },
              { label: '非常有挑战 (RPE 9)', value: 'hard' },
              { label: '力竭 (RPE 10)', value: 'failure' },
            ],
          },
          {
            id: 'body_weight',
            question: '今日晨起体重（kg）？',
            inputType: 'number',
            placeholder: '如 72.5',
          },
        ],
      },
    },
  },
  // ── profile_update_confirm：画像确认（day_end 收尾，无待续意图）─────────
  {
    id: 'profile-confirm-day-end',
    group: 'chat-card',
    label: '画像确认卡 · 日结更新',
    description: 'profile_update_confirm（trigger=day_end）：负荷锚点 + 恢复状态提案',
    bubbleText: '今天的训练收尾了，有两项画像更新建议，确认后才会写入：',
    backendValidated: true,
    wireCard: {
      type: 'profile_update_confirm',
      data: {
        message: '教练希望更新你的训练画像，请确认以下改动。',
        trigger: 'day_end',
        proposals: [
          {
            field: 'load_anchors',
            label: '负荷锚点',
            change: '卧推基准组 57.5kg → 60kg',
            value: { bench_press: { type: 'resistance', best_weight: 60, best_reps: 8, est_1rm: 75 } },
          },
          {
            field: 'recovery_state',
            label: '恢复状态',
            change: '睡眠不足，恢复评分 82 → 55',
            value: { total_score: 55 },
          },
        ],
        confirmLabel: '确认更新',
        cancelLabel: '暂不更新',
      },
    },
  },
  // ── profile_update_confirm：带待续意图（打断主任务后续跑）───────────────
  {
    id: 'profile-confirm-pending-intent',
    group: 'chat-card',
    label: '画像确认卡 · 伤病上报（带待续意图）',
    description: 'trigger=key_parameter_change + pending_intent：确认写入后自动续跑周计划调整',
    bubbleText: '收到你的肩部不适反馈。先把这个限制登记进画像，再据此调整计划：',
    backendValidated: true,
    wireCard: {
      type: 'profile_update_confirm',
      data: {
        message: '教练希望把右肩限制写入画像（7 天后自动过期），确认后继续调整周计划。',
        trigger: 'key_parameter_change',
        proposals: [
          {
            field: 'active_limitations',
            label: '活动限制',
            change: '新增右肩限制，严重度 4/10，7 天后自动过期',
            value: [{ part: 'right_shoulder', severity: 4 }],
          },
        ],
        pending_intent: {
          user_message: '根据我的信息调整一下本周训练计划',
          summary: '结合新的肩部限制，把本周推类动作换成不激惹肩的替代项',
          scenario: 'plan',
        },
      },
    },
  },
  // ── audit_complete：审计完成卡 ────────────────────────────────────────
  {
    id: 'audit-complete-card',
    group: 'chat-card',
    label: '审计完成卡',
    description: 'audit_complete：画像更新清单（updates[]）+ 审计报告正文',
    bubbleText: '你的补充信息已处理完，本次画像自动更新如下：',
    backendValidated: true,
    wireCard: {
      type: 'audit_complete',
      data: {
        message: '今天训练完成，以下是本次审计自动更新的画像内容。',
        actionLabel: '查看详情',
        requiresConfirmation: true,
        updates: [
          { field: 'load_anchors', label: '负荷锚点', count: 2, details: ['卧推 60kg×8 更新为基准组', '下肢容量 +8%'] },
          { field: 'recovery_state', label: '恢复状态', count: 1 },
          { field: 'memories', label: '训练记忆', count: 1, details: ['偏好傍晚训练，晨训状态差'] },
        ],
        auditContent: '## 审计报告\n\n- **卧推** 60kg×8 完成质量高，锚点上调\n- **恢复** 连续两日睡眠 < 6h，恢复评分下调\n- 建议｜下次下肢日降低容量 10%',
      },
    },
  },
  // ── summary_card：后端契约形态（summary/highlights/metrics）────────────
  {
    id: 'summary-card-contract',
    group: 'chat-card',
    label: '总结卡 · 后端契约形态',
    description: 'summary_card 契约形态（summary/highlights/metrics）——后端校验回路认可的真源形态',
    bubbleText: '本次训练表现总结：',
    backendValidated: true,
    wireCard: {
      type: 'summary_card',
      data: {
        title: '训练小结',
        summary: '推日完成度 100%，卧推容量创近 4 周新高，最后一组 RPE 9 接近力竭——下次可保持配重、减少 1 组辅助容量。',
        highlights: ['总容量 6,240kg · 近 4 周最高', '卧推 72.5kg×6 新锚点', '训练时长 52 分钟，组间休息控制良好'],
        metrics: { totalVolume: 6240, setsCount: 18, durationMinutes: 52, avgRpe: 7.5 },
      },
    },
  },
  // ── summary_card：前端旧展示形态（stats/exercises）────────────────────
  {
    id: 'summary-card-legacy-stats',
    group: 'chat-card',
    label: '总结卡 · 前端旧形态（stats/exercises）',
    description: 'SummaryCard 组件实际消费的 stats/exercises 形态（与后端契约存在漂移，本场景用于对照）',
    bubbleText: '（前端旧渲染形态对照——非后端契约形态）',
    backendValidated: false,
    wireCard: {
      type: 'summary_card',
      data: {
        stats: { totalVolume: 6240, setsCount: 18, durationMinutes: 52, avgHr: 138 },
        exercises: [
          {
            name: '杠铃卧推', type: 'resistance',
            sets: [
              { weight: 60, reps: 8, completed: true },
              { weight: 70, reps: 8, completed: true },
              { weight: 72.5, reps: 6, completed: true },
            ],
          },
          { name: '跑步机热身', type: 'cardio', sets: [{ duration: 600, completed: true }] },
        ],
      },
    },
  },
  // ── deviation_card：偏差调整卡 ───────────────────────────────────────
  {
    id: 'deviation-card',
    group: 'chat-card',
    label: '偏差卡 · 计划偏离确认',
    description: 'deviation_card：reason + suggestion（注：PluginRegistry 无此键，走 StandardCard 兜底——真实行为）',
    bubbleText: '检测到这组完成情况与计划有偏差：',
    backendValidated: true,
    wireCard: {
      type: 'deviation_card',
      data: {
        reason: '左膝不适，深蹲第 3 组后动作幅度明显变浅',
        suggestion: '本次以 RPE 7 控制剩余组数，下周视恢复情况再回升配重',
      },
    },
  },
  // ── 前端专属卡型（后端不产出 / 已拉黑）────────────────────────────────
  {
    id: 'survey-success-card',
    group: 'chat-card-frontend-only',
    label: '问卷成功卡（前端卡型）',
    description: 'survey_success：问卷提交成功反馈，仅前端存在该渲染组件',
    bubbleText: '信息已保存，教练可以据此排计划了。',
    backendValidated: false,
    wireCard: {
      type: 'survey_success',
      data: { title: '信息已保存', message: '你的补充信息已保存，教练可以据此生成训练计划了。', actionLabel: '继续' },
    },
  },
  {
    id: 'hitl-confirm-card',
    group: 'chat-card-frontend-only',
    label: 'HITL 确认卡（后端已拉黑）',
    description: 'hitl_confirm：HC-4 黑名单卡型，后端永不产出——仅留存前端渲染形态供对照',
    bubbleText: '（历史形态对照——Agent 已被禁止产出此卡）',
    backendValidated: false,
    wireCard: {
      type: 'hitl_confirm',
      data: { sub_type: 'weight_confirm', data: { reason: '深蹲重量 105kg 超过基准 15%，需要你确认。' } },
    },
  },
];
