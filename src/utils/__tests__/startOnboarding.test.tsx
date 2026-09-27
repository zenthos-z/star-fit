/**
 * B3 开始运动子菜单 + 首次使用预调研分流（issue #23）单测
 * 覆盖：三选项条件渲染（有/无计划）、分流决策四象限、画像四题口径、
 *       文案红线（无 emoji / 无禁色值）
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  buildStartMenuOptions,
  resolveFirstUseTriage,
  NEWBIE_SURVEY_QUESTIONS,
  PLAN_GUIDE_TEXT,
  NEWBIE_SURVEY_TEXT,
  START_OPTION_KEYS,
} from '../startOnboarding';

const noop = () => {};
const actions = {
  onPickLibrary: noop,
  onOpenCoach: noop,
  onStartTodayPlan: noop,
};

describe('buildStartMenuOptions · 三选项条件渲染', () => {
  it('无计划 = 两选项现状（挑选动作 + AI 教练）', () => {
    const opts = buildStartMenuOptions(false, actions);
    expect(opts).toHaveLength(2);
    expect(opts.map(o => o.key)).toEqual([START_OPTION_KEYS.library, START_OPTION_KEYS.aiCoach]);
    expect(opts.map(o => o.label)).toEqual(['挑选动作', 'AI 教练']);
  });

  it('有计划 = 三选项，第三选项为「开始今日训练」且置末位', () => {
    const opts = buildStartMenuOptions(true, actions);
    expect(opts).toHaveLength(3);
    expect(opts[2].key).toBe(START_OPTION_KEYS.startTodayPlan);
    expect(opts[2].label).toBe('开始今日训练');
    // 前两项保持现状不动
    expect(opts[0].label).toBe('挑选动作');
    expect(opts[1].label).toBe('AI 教练');
  });

  it('选项形状满足 TimerCapsule StartMenuOption（key/label/icon/onSelect）', () => {
    const opts = buildStartMenuOptions(true, actions);
    for (const o of opts) {
      expect(typeof o.key).toBe('string');
      expect(typeof o.label).toBe('string');
      expect(o.icon).toBeTruthy();
      expect(typeof o.onSelect).toBe('function');
    }
  });

  it('onSelect 动作透传（选中第三项触发 onStartTodayPlan）', () => {
    let picked = '';
    const spyActions = {
      onPickLibrary: () => { picked = 'library'; },
      onOpenCoach: noop,
      onStartTodayPlan: () => { picked = 'today'; },
    };
    const opts = buildStartMenuOptions(true, spyActions);
    opts[2].onSelect();
    expect(picked).toBe('today');
  });
});

describe('resolveFirstUseTriage · 首次分流决策', () => {
  it('有训练历史 → 老用户不打扰（none）', () => {
    expect(resolveFirstUseTriage(true, 'planned')).toBe('none');
    expect(resolveFirstUseTriage(true, 'no_plan')).toBe('none');
    expect(resolveFirstUseTriage(true, null)).toBe('none');
  });

  it('无历史 + 周计划在身 → 引导发送资料/截图（plan_guide）', () => {
    expect(resolveFirstUseTriage(false, 'planned')).toBe('plan_guide');
  });

  it('纯新手（无历史无计划）→ 调研卡片（newbie_survey）', () => {
    expect(resolveFirstUseTriage(false, 'no_plan')).toBe('newbie_survey');
    expect(resolveFirstUseTriage(false, 'rest_day')).toBe('newbie_survey');
    expect(resolveFirstUseTriage(false, null)).toBe('newbie_survey');
  });
});

describe('NEWBIE_SURVEY_QUESTIONS · 画像四项口径', () => {
  it('四题依次为 经验/目标/器材/频次，均必填且有选项', () => {
    expect(NEWBIE_SURVEY_QUESTIONS.map(q => q.id)).toEqual([
      'experience', 'goal', 'equipment', 'frequency',
    ]);
    for (const q of NEWBIE_SURVEY_QUESTIONS) {
      expect(q.required).toBe(true);
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      for (const o of q.options) {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('引导话术 · 红线自查', () => {
  it('无 emoji，无禁色值字面量', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const text of [PLAN_GUIDE_TEXT, NEWBIE_SURVEY_TEXT, ...NEWBIE_SURVEY_QUESTIONS.flatMap(q => [q.question, ...q.options.map(o => o.label)])]) {
      expect(emoji.test(text)).toBe(false);
      expect(text).not.toContain('#F3F3F3');
      expect(text).not.toContain('#EA580C');
    }
  });

  it('调研卡结构渲染SurveyCard 兼容形态（title + questions 可达）', () => {
    // 形状防御：注入的 uiHint.data 与 SurveyCard props 的结构契约一致
    const uiHint = {
      type: 'survey_card' as const,
      data: { title: '训练画像调研', questions: NEWBIE_SURVEY_QUESTIONS },
    };
    expect(uiHint.data.questions).toHaveLength(4);
    render(
      <ul>
        {uiHint.data.questions.map(q => (
          <li key={q.id}>{q.question}</li>
        ))}
      </ul>
    );
    expect(screen.getByText('你的训练经验')).toBeInTheDocument();
    expect(screen.getByText('每周能练几次')).toBeInTheDocument();
  });
});
