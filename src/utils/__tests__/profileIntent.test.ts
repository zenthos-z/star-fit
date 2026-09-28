import { describe, it, expect } from 'vitest';
import { buildProfileResumePrompt, parsePendingIntent, PROFILE_RESUME_MARKER } from '../profileIntent';

/**
 * [B5 issue#37] 待续意图工具测试：
 * - 续跑指令必须带系统标记（后端 prompt 据此识别「已写入、直接续跑」）
 * - 指令包含用户原话与任务摘要
 * - parsePendingIntent 对历史卡片/畸形数据的宽松解析（不完整 → null）
 */

describe('buildProfileResumePrompt（续跑指令组装）', () => {
  const intent = {
    user_message: '根据我的信息调整一下周计划',
    summary: '结合新的活动限制调整本周周计划',
    scenario: 'plan' as const,
  };

  it('带（系统续跑指令）标记且明确禁止重提案/重写入', () => {
    const prompt = buildProfileResumePrompt(intent);
    expect(prompt.startsWith(PROFILE_RESUME_MARKER)).toBe(true);
    expect(prompt).toContain('不要重新提案画像更新');
    expect(prompt).toContain('不要调用 update_profile');
  });

  it('包含用户原话与任务摘要', () => {
    const prompt = buildProfileResumePrompt(intent);
    expect(prompt).toContain('「根据我的信息调整一下周计划」');
    expect(prompt).toContain('结合新的活动限制调整本周周计划');
  });
});

describe('parsePendingIntent（卡片 pending_intent 宽松解析）', () => {
  it('完整形态原样解析，scenario 归一为 chat/plan', () => {
    expect(parsePendingIntent({
      user_message: '调整周计划', summary: '调整本周计划', scenario: 'plan',
    })).toEqual({ user_message: '调整周计划', summary: '调整本周计划', scenario: 'plan' });

    expect(parsePendingIntent({ user_message: '问一下', summary: '答疑' })?.scenario).toBe('chat');
    // 非法 scenario 值归一为 chat（不抛错）
    expect(parsePendingIntent({ user_message: '问一下', summary: '答疑', scenario: '乱填' })?.scenario).toBe('chat');
  });

  it('缺失 user_message / summary → null（无待续意图，不续跑）', () => {
    expect(parsePendingIntent(undefined)).toBeNull();
    expect(parsePendingIntent(null)).toBeNull();
    expect(parsePendingIntent('字符串')).toBeNull();
    expect(parsePendingIntent([])).toBeNull();
    expect(parsePendingIntent({ summary: '只有摘要' })).toBeNull();
    expect(parsePendingIntent({ user_message: '  ', summary: '摘要' })).toBeNull();
  });
});
