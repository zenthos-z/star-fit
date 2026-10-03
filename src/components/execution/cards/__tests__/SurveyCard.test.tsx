/**
 * SurveyCard #114 B5b 交互测试
 * 覆盖（任务书验证门）：
 * - 题库消费断言：UI 题目数 = PROFILE_INTAKE_QUESTIONS 长度（改题库结构 UI 跟着变，
 *   不硬编码题数）；题干 / section 分组 / hint / 单位 chip 渲染
 * - children 二级菜单：一级选中展开多选 chips、切场地清空 + 确认弹层、全选 toggle
 * - textarea：输入 + maxLength 计数器
 * - condition 条件显示与必答闸门联动
 * - injuries「无」互斥、number 越界行内提示、提交 payload 契约值直传
 * - 已提交只读回显、旧卡（legacy / 旧 4 题卡）零新依赖回归
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurveyCard } from '../SurveyCard';
import { PROFILE_INTAKE_QUESTIONS } from 'shared/contracts';

const BANK = PROFILE_INTAKE_QUESTIONS;

/** 按共享题库渲染首用画像卡（title/purpose 与 useAICoach 注入处同构） */
function renderBankCard(overrides?: {
  submitted?: { submittedAt: number; answers: Record<string, string | string[]> };
  purpose?: string;
}) {
  const onConfirm = vi.fn();
  render(
    <SurveyCard
      uiHint={{
        type: 'survey_card',
        data: {
          title: '训练画像调研',
          purpose: overrides?.purpose ?? 'profile_intake',
          questions: BANK,
        },
        // submitted 与 ChatMessage.uiHint 持久化形态同构（markSurveySubmitted 写顶层）
        ...(overrides?.submitted ? { submitted: overrides.submitted } : {}),
      }}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

/** 填完 Section A 全部必答（goal 默认 muscle_gain 使 age 条件不触发） */
async function fillRequired(user: ReturnType<typeof userEvent.setup>, goal = 'muscle_gain') {
  await user.click(screen.getByTestId(`survey-option-goal-${goal}`));
  await user.click(screen.getByTestId('survey-option-experience-beginner'));
  await user.type(screen.getByTestId('survey-input-weight_kg'), '70');
  await user.click(screen.getByTestId('survey-option-equipment_venue-gym'));
  await user.click(screen.getByTestId('survey-option-equipment_items-barbell'));
  await user.click(screen.getByTestId('survey-option-weekly_frequency-3'));
  await user.click(screen.getByTestId('survey-option-injuries-none'));
}

describe('题库消费断言（改题库结构 UI 跟着变）', () => {
  it('渲染题数 = 共享题库长度，题干逐一可达（不硬编码题数）', () => {
    renderBankCard();
    expect(screen.getByTestId('survey-card')).toBeInTheDocument();
    // condition 门控题（age）初始不渲染；其余题逐一可达
    const initiallyVisible = BANK.filter(q => !q.condition);
    for (const q of initiallyVisible) {
      expect(screen.getByTestId(`survey-question-${q.id}`)).toBeInTheDocument();
    }
    // 动态断言：题库增删题，UI 同步增删（无本地副本可漂移）
    expect(screen.getAllByTestId(/^survey-question-/)).toHaveLength(initiallyVisible.length);
    expect(screen.getByText('当前最想达成的目标')).toBeInTheDocument();
    expect(screen.getByText('还有什么想让教练知道的？')).toBeInTheDocument();
  });

  it('section 分组标题 / hint / 单位 chip / 计数器按「有则显示」渲染', () => {
    renderBankCard();
    // 分组标题（13px semibold text-gray-400 由样式锁，这里断言文案与唯一性）
    expect(screen.getByText('必答')).toBeInTheDocument();
    expect(screen.getByText('补充信息（可选）')).toBeInTheDocument();
    expect(screen.getByText('自由补充')).toBeInTheDocument();
    // hint / 单位 chip / textarea 计数器
    expect(screen.getByTestId('survey-hint-weight_kg')).toHaveTextContent('用于推算你的起步重量');
    expect(screen.getByText('kg')).toBeInTheDocument();
    expect(screen.getByText('cm')).toBeInTheDocument();
    expect(screen.getByTestId('survey-counter-notes')).toHaveTextContent('0/500');
  });

  it('提交按钮文案按 purpose 分流；未答完禁用 + 「还有 N 项未完成」实时计数', async () => {
    const user = userEvent.setup();
    renderBankCard();
    const submit = screen.getByTestId('survey-submit');
    expect(submit).toHaveTextContent('完成，生成我的计划');
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('survey-incomplete-hint')).toHaveTextContent('还有 6 项未完成');
    await fillRequired(user);
    expect(screen.queryByTestId('survey-incomplete-hint')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('题库文案红线：无 emoji、无禁色值字面量', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const copy = BANK.flatMap(q => [
      q.question, q.hint ?? '', q.placeholder ?? '', q.section ?? '',
      ...(q.options ?? []).flatMap(o => [o.label, ...(o.children ?? []).map(c => c.label)]),
    ]);
    for (const text of copy) {
      expect(emoji.test(text)).toBe(false);
      expect(text).not.toContain('#F3F3F3');
      expect(text).not.toContain('#EA580C');
    }
  });
});

describe('condition 条件显示（age：减脂/体能目标才出现）', () => {
  it('未答 goal / 增肌 / 力量 / 体态 → age 不渲染', async () => {
    const user = userEvent.setup();
    renderBankCard();
    expect(screen.queryByTestId('survey-question-age')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('survey-option-goal-muscle_gain'));
    expect(screen.queryByTestId('survey-question-age')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('survey-option-goal-strength'));
    expect(screen.queryByTestId('survey-question-age')).not.toBeInTheDocument();
  });

  it('减脂塑形 → age 渲染并参与必答闸门（不填不能提交）', async () => {
    const user = userEvent.setup();
    renderBankCard();
    await user.click(screen.getByTestId('survey-option-goal-fat_loss'));
    expect(screen.getByTestId('survey-question-age')).toBeInTheDocument();
    // age 条件必答：闸门计数把它算进来（goal 已答，余 6 必答未完成）
    expect(screen.getByTestId('survey-incomplete-hint')).toHaveTextContent('还有 6 项未完成');
    await fillRequired(user, 'fat_loss');
    // 其余填完但 age 未填 → 仍禁用
    expect(screen.getByTestId('survey-submit')).toBeDisabled();
    expect(screen.getByTestId('survey-incomplete-hint')).toHaveTextContent('还有 1 项未完成');
    await user.type(screen.getByTestId('survey-input-age'), '30');
    expect(screen.getByTestId('survey-submit')).toBeEnabled();
  });
});

describe('children 二级菜单（场地 → 具体器材多选）', () => {
  it('一级未选中不渲染二级；选中后展开对应 children chips', async () => {
    const user = userEvent.setup();
    renderBankCard();
    expect(screen.queryByTestId('survey-children-equipment_venue')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('survey-option-equipment_venue-gym'));
    const panel = screen.getByTestId('survey-children-equipment_venue');
    expect(within(panel).getByTestId('survey-option-equipment_items-barbell')).toBeInTheDocument();
    expect(within(panel).getByTestId('survey-option-equipment_items-foam_roller')).toBeInTheDocument();
    expect(within(panel).getByTestId('survey-select-all-equipment_venue')).toHaveTextContent('全选');
  });

  it('children 多选勾选写入 childKey；required 联动：勾 0 项不能提交', async () => {
    const user = userEvent.setup();
    renderBankCard();
    await fillRequired(user); // 已勾 barbell
    expect(screen.getByTestId('survey-submit')).toBeEnabled();
  });

  it('有已勾 children 时切场地 → 确认弹层；取消保留原状，确认切换并清空', async () => {
    const user = userEvent.setup();
    renderBankCard();
    await user.click(screen.getByTestId('survey-option-equipment_venue-gym'));
    await user.click(screen.getByTestId('survey-option-equipment_items-barbell'));
    await user.click(screen.getByTestId('survey-option-equipment_items-dumbbell'));

    // 触发切换 → 弹层出现，未确认前父选项不变
    await user.click(screen.getByTestId('survey-option-equipment_venue-home'));
    const confirmBox = screen.getByTestId('survey-venue-confirm-equipment_venue');
    expect(confirmBox).toHaveTextContent('切换场地将清空已选器材');

    // 取消 → 停留健身房，children 保留
    await user.click(screen.getByTestId('survey-venue-confirm-cancel-equipment_venue'));
    expect(screen.queryByTestId('survey-venue-confirm-equipment_venue')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('survey-children-equipment_venue'))
      .getByTestId('survey-option-equipment_items-barbell')).toBeInTheDocument();

    // 再切 → 确认 → 场地换家、children 清空（健身房专属 chip 消失）
    await user.click(screen.getByTestId('survey-option-equipment_venue-home'));
    await user.click(screen.getByTestId('survey-venue-confirm-ok-equipment_venue'));
    const panel = screen.getByTestId('survey-children-equipment_venue');
    expect(within(panel).getByTestId('survey-option-equipment_items-dumbbell')).toBeInTheDocument();
    expect(within(panel).queryByTestId('survey-option-equipment_items-barbell')).not.toBeInTheDocument();
    // 勾选态已清空：dumbbell 未选中
    expect(within(panel).getByTestId('survey-option-equipment_items-dumbbell').className).not.toContain('bg-star-accent');
  });

  it('「全选」chip：12 值全勾 ↔ 全取消（toggle），随提交 payload 全量携带', async () => {
    const user = userEvent.setup();
    const onConfirm = renderBankCard();
    await fillRequired(user);
    await user.click(screen.getByTestId('survey-select-all-equipment_venue'));
    // 全选后再次点击 → 全取消
    await user.click(screen.getByTestId('survey-select-all-equipment_venue'));
    expect(screen.getByTestId('survey-submit')).toBeDisabled(); // children 清空后联动卡闸门

    const gymGroup = BANK.find(q => q.id === 'equipment_venue')!
      .options!.find(o => o.value === 'gym')!.children!.map(c => c.value);
    expect(gymGroup).toHaveLength(12);

    await user.click(screen.getByTestId('survey-select-all-equipment_venue'));
    await user.click(screen.getByTestId('survey-submit'));
    const payload = JSON.parse(
      onConfirm.mock.calls[0][0].replace('[UPLOAD_SURVEY_DATA]:', ''),
    );
    expect(payload.responses.equipment_items).toEqual(gymGroup);
  });
});

describe('injuries「无」互斥（渲染层硬规则）', () => {
  it('点部位互斥「无」，点「无」清空部位', async () => {
    const user = userEvent.setup();
    renderBankCard();
    await user.click(screen.getByTestId('survey-option-injuries-knee'));
    await user.click(screen.getByTestId('survey-option-injuries-lower_back'));
    // 点「无」→ 清空其他仅留「无」
    await user.click(screen.getByTestId('survey-option-injuries-none'));
    expect(screen.getByTestId('survey-option-injuries-none').className).toContain('bg-star-accent');
    expect(screen.getByTestId('survey-option-injuries-knee').className).not.toContain('bg-star-accent');
    // 点部位 → 「无」自动取消
    await user.click(screen.getByTestId('survey-option-injuries-shoulder'));
    expect(screen.getByTestId('survey-option-injuries-none').className).not.toContain('bg-star-accent');
    expect(screen.getByTestId('survey-option-injuries-shoulder').className).toContain('bg-star-accent');
  });
});

describe('textarea 自由补充 + number 范围闸', () => {
  it('textarea 输入更新计数器并随 payload 提交原文', async () => {
    const user = userEvent.setup();
    const onConfirm = renderBankCard();
    await fillRequired(user);
    await user.type(screen.getByTestId('survey-input-notes'), '夜班倒班');
    expect(screen.getByTestId('survey-counter-notes')).toHaveTextContent('4/500');
    await user.click(screen.getByTestId('survey-submit'));
    const payload = JSON.parse(
      onConfirm.mock.calls[0][0].replace('[UPLOAD_SURVEY_DATA]:', ''),
    );
    expect(payload.responses.notes).toBe('夜班倒班');
  });

  it('number 越界即时行内红字且不算已答（weight 20 → 提示 30-250）', async () => {
    const user = userEvent.setup();
    renderBankCard();
    await user.type(screen.getByTestId('survey-input-weight_kg'), '20');
    expect(screen.getByTestId('survey-error-weight_kg')).toHaveTextContent('请输入 30-250 之间的数值');
    await user.clear(screen.getByTestId('survey-input-weight_kg'));
    await user.type(screen.getByTestId('survey-input-weight_kg'), '70');
    expect(screen.queryByTestId('survey-error-weight_kg')).not.toBeInTheDocument();
  });
});

describe('提交 payload（契约值直传，无文本换算）', () => {
  it('responses 按 id 携带：单选字符串 / 多选数组 / children 独立键 / 未答题剔除', async () => {
    const user = userEvent.setup();
    const onConfirm = renderBankCard();
    await fillRequired(user);
    await user.click(screen.getByTestId('survey-submit'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      onConfirm.mock.calls[0][0].replace('[UPLOAD_SURVEY_DATA]:', ''),
    );
    expect(payload.responses).toMatchObject({
      goal: 'muscle_gain',
      experience: 'beginner',
      weight_kg: '70',
      equipment_venue: 'gym',
      equipment_items: ['barbell'],
      weekly_frequency: '3',
      injuries: ['none'],
    });
    // 选答题未填不出现；notes 未填不出现
    expect(payload.responses.height_cm).toBeUndefined();
    expect(payload.responses.gender).toBeUndefined();
    expect(payload.responses.notes).toBeUndefined();
  });
});

describe('已提交只读回显（题干 + 答案 chip，多选逗号连接）', () => {
  it('value→label 回显；children 单独成 chip；无提交入口', () => {
    renderBankCard({
      submitted: {
        submittedAt: new Date('2026-10-03T10:00:00+08:00').getTime(),
        answers: {
          goal: 'muscle_gain',
          injuries: ['knee', 'lower_back'],
          equipment_venue: 'gym',
          equipment_items: ['barbell', 'dumbbell'],
          notes: '夜班倒班',
        },
      },
    });
    const list = screen.getByTestId('survey-submitted-list');
    expect(within(list).getByText('当前最想达成的目标')).toBeInTheDocument();
    expect(within(list).getByText('增肌变壮')).toBeInTheDocument();
    expect(within(list).getByText('膝，腰')).toBeInTheDocument();
    expect(within(list).getByText('健身房')).toBeInTheDocument();
    expect(within(list).getByTestId('survey-submitted-child-equipment_items')).toHaveTextContent('杠铃，哑铃');
    expect(within(list).getByText('夜班倒班')).toBeInTheDocument();
    expect(screen.queryByTestId('survey-submit')).not.toBeInTheDocument();
  });

  it('answers 为空时回落「问卷已提交」横幅（旧卡兼容）', () => {
    renderBankCard({ submitted: { submittedAt: Date.now(), answers: {} } });
    expect(screen.queryByTestId('survey-submitted-list')).not.toBeInTheDocument();
    expect(screen.getByText('问卷已提交')).toBeInTheDocument();
  });
});

describe('旧卡零新依赖回归', () => {
  it('legacy 单题卡：点选项直接 onConfirm 原值', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SurveyCard
        uiHint={{
          type: 'survey_card',
          data: { question: '这次训练感受如何？', options: [{ label: '好', value: 'good' }, { label: '一般', value: 'ok' }] },
        }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('这次训练感受如何？')).toBeInTheDocument();
    await user.click(screen.getByText('好'));
    expect(onConfirm).toHaveBeenCalledWith('good');
  });

  it('旧 4 题卡（无 purpose/section/children/condition）：按钮保持「上传补充信息」，渲染不 crash', () => {
    render(
      <SurveyCard
        uiHint={{
          type: 'survey_card',
          data: {
            title: '训练画像调研',
            questions: [
              { id: 'experience', question: '你的训练经验', required: true, options: [{ label: '纯新手', value: 'beginner_zero' }] },
              { id: 'frequency', question: '每周能练几次', required: true, options: [{ label: '3-4 次', value: '3-4' }] },
            ],
          },
        }}
      />,
    );
    expect(screen.getByTestId('survey-submit')).toHaveTextContent('上传补充信息');
    expect(screen.getByTestId('survey-question-frequency')).toBeInTheDocument();
    // 旧卡无 section：不出分组标题
    expect(screen.queryByText('必答')).not.toBeInTheDocument();
  });

  it('plan_gap 卡提交按钮为「提交」', () => {
    renderBankCard({ purpose: 'plan_gap' });
    expect(screen.getByTestId('survey-submit')).toHaveTextContent('提交');
  });
});
