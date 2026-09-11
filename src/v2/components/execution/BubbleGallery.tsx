import React from 'react';
import type { ChatMessage } from '../../hooks/useAICoach';

/**
 * BubbleGallery（调试模式）— 一屏看全 AI 教练对话框的所有气泡/卡片形式。
 *
 * 入口：URL 带 `?bubbleGallery`（或 `#bubbleGallery`）打开 AI 教练时，
 * Welcome 屏位置改为渲染本画廊。不影响正常聊天链路，发布亦可保留。
 */

const SectionTitle: React.FC<{ label: string }> = ({ label }) => (
  <div className="pt-4 pb-1 px-1 text-[11px] font-semibold text-gray-400 tracking-wide">{label}</div>
);

const MOCK_PLAN = [
  { name: 'Bench Press 杠铃卧推', exercise_type: 'resistance', sets: 4, reps: 10, weight: 60 },
  { name: 'Running 户外跑', exercise_type: 'cardio', sets: 1, reps: 1 },
];

const wrapUiHint = (type: string, data: any, extra?: any) => ({
  role: 'ai' as const,
  text: '教练为您生成了以下交互卡片：',
  uiHint: { type, data, ...extra },
});

const GALLERY_MESSAGES: Partial<ChatMessage>[] = [
  { role: 'user', text: '用户消息气泡长这样，最多占 78% 宽度。' },
  { role: 'ai', text: 'AI 回复气泡长这样，全宽灰底。支持 **Markdown** 与公式 $E=mc^2$。' },
  wrapUiHint('plan_card', MOCK_PLAN, { diff: { added: ['Running 户外跑'], modified: [] } }),
  wrapUiHint('plan_card', MOCK_PLAN.map(e => ({ ...e })), { context: 'post_finish' }),
  wrapUiHint('survey_card', {
    title: '练后调研（多题）',
    subtitle: '约需 1 分钟',
    questions: [
      { id: 'q1', question: '今天训练整体感觉如何？', required: true, options: [
        { label: '轻松', value: 'easy' }, { label: '刚好', value: 'good' }, { label: '很累', value: 'hard' },
      ]},
      { id: 'q2', question: '今日体重（kg）', inputType: 'number', placeholder: '如 72.5' },
    ],
  }),
  wrapUiHint('survey_card', { question: '旧版单题：昨晚睡眠时长？', options: [
    { label: '7 小时以上', value: 'ok' }, { label: '不足 7 小时', value: 'bad' },
  ]}),
  wrapUiHint('survey_success', { message: '你的补充信息已保存，教练可以据此生成训练计划了。' }),
  wrapUiHint('audit_complete', {
    message: '今天训练完成，以下是本次审计自动更新的画像内容。',
    updates: [
      { field: 'load_anchors', label: '负荷锚点', count: 2, details: ['卧推 60kg×10 更新为基准组', '下肢容量 +8%'] },
      { field: 'recovery_state', label: '恢复状态', count: 1 },
    ],
    auditContent: '## 审计报告示例\n\n- **卧推** 60kg×10 完成质量高\n- 建议｜下次下肢日恢复',
  }),
  wrapUiHint('strategy_confirm', { title: '训练策略更新', message: 'AI 已根据你近两周的训练数据生成新的训练策略。' }),
  wrapUiHint('profile_update_confirm', {
    message: '教练希望更新你的训练画像，请确认以下改动。',
    trigger: 'day_end',
    proposals: [
      { field: 'load_anchors', label: '负荷锚点', change: '卧推基准组 57.5kg → 60kg', value: { bench: 60 } },
      { field: 'recovery_state', label: '恢复状态', change: '睡眠不足，恢复评分下调' },
    ],
  }),
  wrapUiHint('hitl_confirm', { sub_type: 'weight_confirm', data: { reason: '深蹲重量 105kg 超过基准 15%，需要你确认。' } }),
  wrapUiHint('summary_card', {
    stats: { totalVolume: 6240, setsCount: 18, durationMinutes: 52 },
    exercises: [
      { name: 'Bench Press 杠铃卧推', type: '抗阻', sets: [
        { weight: 55, reps: 10, completed: true }, { weight: 60, reps: 8, completed: true },
      ]},
      { name: 'Squat 深蹲', type: '抗阻', sets: [{ weight: 90, reps: 8, completed: true }] },
    ],
  }),
];

export const BubbleGallery: React.FC = () => {
  return (
    <div className="space-y-2.5 pt-[calc(var(--safe-top)+64px)] pb-[calc(var(--safe-bottom)+80px)] px-1">
      <SectionTitle label="基础气泡 / Basic bubbles" />
      {GALLERY_MESSAGES.slice(0, 2).map((msg, i) => (
        <GalleryRow key={`basic-${i}`} msg={msg} />
      ))}
      <SectionTitle label="AI 交互卡片 / Interactive cards" />
      {GALLERY_MESSAGES.slice(2).map((msg, i) => (
        <GalleryRow key={`card-${i}`} msg={msg} />
      ))}
      <div className="pt-6 text-center text-[11px] text-gray-300">
        BubbleGallery 调试模式 · ?bubbleGallery
      </div>
    </div>
  );
};

/**
 * 单条画廊消息：直接复用聊天流的渲染分支（ExerciseRenderer 的 onConfirm 在画廊中静默）。
 * 为避免复制大段 JSX，这里以 render props 形式由 AICoachOverlay 注入渲染函数。
 */
export const GalleryRow: React.FC<{ msg: Partial<ChatMessage>; children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

export { GALLERY_MESSAGES };
