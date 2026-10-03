/**
 * surveyProfileWrite #114 B5b 单测：问卷答案 → 静态画像写库映射
 * 覆盖（spec §4 修法 3）：
 * - id 直取直写（value 即契约枚举值，零文本换算）
 * - experience→training_age 月数确定性 map、equipment_items 追加 bodyweight
 * - 频次只收单值 1-7：区间字符串（'3-4'）warn+skip，不再 parseInt 静默取下界（缺口 3a）
 * - 嵌套键（basic_info/preferences），无顶层私造键（weekly_frequency_days /
 *   raw_injuries 顶层死代码不再复活，缺口 3b/3c）
 * - 枚举外值 warn+skip（不静默写错值、不回退默认）；未知键忽略（旧 Agent 措辞卡不 crash）
 * - injuries/notes 不进静态画像（原文交 Agent，修法 2）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildProfileIntakeStaticPatch } from '../surveyProfileWrite';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('id 直取直写（value 即契约枚举值）', () => {
  it('共享题库提交值 → 嵌套 patch 全量映射', () => {
    const patch = buildProfileIntakeStaticPatch({
      goal: 'muscle_gain',
      experience: 'beginner',
      weight_kg: '70',
      age: '28',
      height_cm: '175',
      gender: 'male',
      equipment_venue: 'gym',
      equipment_items: ['barbell', 'dumbbell'],
      weekly_frequency: '3',
      session_minutes: '60',
    });
    expect(patch).toEqual({
      basic_info: { weight: 70, age: 28, height: 175, gender: 'male', training_age: 3 },
      preferences: {
        goal: 'muscle_gain',
        equipment: ['barbell', 'dumbbell', 'bodyweight'],
        weekly_frequency_days: 3,
        time_constraint: 60,
      },
    });
  });

  it('equipment_items 固定追加 bodyweight 且幂等', () => {
    const withBw = buildProfileIntakeStaticPatch({ equipment_items: ['band', 'bodyweight'] });
    expect((withBw!.preferences as Record<string, unknown>).equipment).toEqual(['band', 'bodyweight']);
  });

  it('injuries / notes 不进静态画像（原文交 Agent，修法 2）', () => {
    const patch = buildProfileIntakeStaticPatch({
      injuries: ['knee'],
      notes: '夜班倒班',
      goal: 'fat_loss',
    });
    expect(patch).toEqual({ preferences: { goal: 'fat_loss' } });
    expect(JSON.stringify(patch)).not.toContain('raw_injuries');
    expect(JSON.stringify(patch)).not.toContain('notes');
  });
});

describe('确定性 map 与数值域（无 AI、无文本换算）', () => {
  it('experience 四档 → training_age 月数 1/3/12/36（纯新手 1，spec §2.6）', () => {
    expect(buildProfileIntakeStaticPatch({ experience: 'beginner_zero' })!.basic_info)
      .toEqual({ training_age: 1 });
    expect(buildProfileIntakeStaticPatch({ experience: 'beginner' })!.basic_info)
      .toEqual({ training_age: 3 });
    expect(buildProfileIntakeStaticPatch({ experience: 'intermediate' })!.basic_info)
      .toEqual({ training_age: 12 });
    expect(buildProfileIntakeStaticPatch({ experience: 'advanced' })!.basic_info)
      .toEqual({ training_age: 36 });
  });

  it('weekly_frequency 只收单值整数 1-7：\'3\' → 3，\'3-4\' / \'5+\' / 0 / 9 → warn+skip（缺口 3a 根治守门）', () => {
    expect(buildProfileIntakeStaticPatch({ weekly_frequency: '3' })!.preferences)
      .toEqual({ weekly_frequency_days: 3 });
    for (const bad of ['3-4', '5+', '0', '9']) {
      const patch = buildProfileIntakeStaticPatch({ weekly_frequency: bad });
      expect(patch).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('weekly_frequency'), bad);
      warnSpy.mockClear();
    }
  });
});

describe('归一兜底：枚举外 warn+skip，不静默写错值', () => {
  it('goal 中文/漂移值（旧 Agent 措辞卡）→ 跳过该字段并 console.warn', () => {
    const patch = buildProfileIntakeStaticPatch({ goal: '增肌塑形', experience: 'beginner' });
    expect(patch!.preferences).toBeUndefined(); // goal 枚举外被跳过，preferences 无可写
    expect(patch!.basic_info).toEqual({ training_age: 3 });
    expect(JSON.stringify(patch)).not.toContain('"goal"');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('goal'), '增肌塑形');
  });

  it('gender 契约枚举外 → 跳过；experience 题库枚举外 → 跳过', () => {
    expect(buildProfileIntakeStaticPatch({ gender: '未知' })).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gender'), '未知');
    warnSpy.mockClear();
    expect(buildProfileIntakeStaticPatch({ experience: '玩过几年' })).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('experience'), '玩过几年');
  });
});

describe('旧卡兼容：未知键忽略不 crash', () => {
  it('旧 4 题卡键（frequency/equipment 区间与档位值）全忽略 → null', () => {
    const patch = buildProfileIntakeStaticPatch({
      frequency: '3-4',
      equipment: 'gym_full',
      training_goal: '增肌',
      目标: '增肌',
    });
    expect(patch).toBeNull();
  });

  it('空 responses → null（调用方跳过请求）', () => {
    expect(buildProfileIntakeStaticPatch({})).toBeNull();
  });
});
