import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ProfileUpdateConfirmCard } from '../cards/ProfileUpdateConfirmCard';

/**
 * [B5 issue#37] 画像确认卡状态机测试（同一气泡内流转）：
 * - idle：双按钮可点，确认回调携带 proposals
 * - 点击确认后（写入中）：按钮禁用、显示「更新中…」
 * - persisted done：终态「画像已更新」，不再渲染按钮
 * - persisted failed：「更新未完成」+ 可重试（按钮组重现）
 * - persisted cancel / 取消点击：终态「已保留原状」
 */

const BASE_DATA = {
  message: '你提到右肩卧推时有刺痛感。建议更新训练画像以保护恢复：',
  trigger: 'injury_report' as const,
  proposals: [
    { field: 'active_limitations' as const, label: '活动限制', change: '新增右肩限制', value: [{ part: 'right_shoulder', severity: 4 }] },
    { field: 'memories' as const, label: '训练记忆', change: '记录右肩刺痛', value: { note: '右肩刺痛' } },
  ],
};

const renderCard = (opts?: { decision?: any; onConfirm?: (payload: any) => void }) => {
  const onConfirm = opts?.onConfirm ?? vi.fn();
  const utils = render(
    <ProfileUpdateConfirmCard
      uiHint={{ type: 'profile_update_confirm', data: BASE_DATA as any, decision: opts?.decision }}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, ...utils };
};

const findButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(label));

describe('ProfileUpdateConfirmCard（B5 两气泡合一状态机）', () => {
  it('idle：确认点击 → onConfirm(confirm_update) 携带 proposals，随后进入写入中', () => {
    const onConfirm = vi.fn();
    const { container } = renderCard({ onConfirm });

    const confirmBtn = findButton(container, '确认更新');
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);
    expect(onConfirm).toHaveBeenCalledWith({
      action: 'confirm_update',
      proposals: BASE_DATA.proposals,
    });
    // 本地态立即进入写入中：按钮禁用 + 「更新中…」
    expect(findButton(container, '更新中')).toBeTruthy();
    expect((findButton(container, '更新中') as HTMLButtonElement).disabled).toBe(true);
  });

  it('取消点击 → onConfirm(cancel_update)，卡片转「已保留原状」', () => {
    const onConfirm = vi.fn();
    const { container } = renderCard({ onConfirm });

    fireEvent.click(findButton(container, '暂不更新')!);
    expect(onConfirm).toHaveBeenCalledWith({ action: 'cancel_update', proposals: BASE_DATA.proposals });
    expect(container.textContent).toContain('已保留原状');
    expect(findButton(container, '确认更新')).toBeFalsy();
  });

  it('persisted writing（result=pending）：保持「更新中…」禁用态', () => {
    const { container } = renderCard({
      decision: { action: 'confirm_update', decidedAt: 1, result: 'pending' },
    });
    expect(findButton(container, '更新中')).toBeTruthy();
    expect((findButton(container, '更新中') as HTMLButtonElement).disabled).toBe(true);
  });

  it('persisted done：终态「画像已更新」，不再渲染操作按钮', () => {
    const onConfirm = vi.fn();
    const { container } = renderCard({
      decision: { action: 'confirm_update', decidedAt: 1, result: 'done' },
      onConfirm,
    });
    expect(container.textContent).toContain('画像已更新');
    expect(findButton(container, '确认更新')).toBeFalsy();
    expect(findButton(container, '暂不更新')).toBeFalsy();
  });

  it('persisted failed：「更新未完成」+ 重试按钮可点（重试再次触发 confirm_update）', () => {
    const onConfirm = vi.fn();
    const { container } = renderCard({
      decision: { action: 'confirm_update', decidedAt: 1, result: 'failed' },
      onConfirm,
    });
    expect(container.textContent).toContain('更新未完成');
    const retryBtn = findButton(container, '重试更新');
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn!);
    expect(onConfirm).toHaveBeenCalledWith({
      action: 'confirm_update',
      proposals: BASE_DATA.proposals,
    });
  });

  it('persisted cancel：终态「已保留原状，未修改」', () => {
    const { container } = renderCard({
      decision: { action: 'cancel_update', decidedAt: 1 },
    });
    expect(container.textContent).toContain('已保留原状，未修改');
    expect(findButton(container, '确认更新')).toBeFalsy();
  });

  it('提案 value 可展开预览（最终值 JSON）', () => {
    const { container } = renderCard();
    const expandBtn = container.querySelector('button[aria-label="展开新值预览"]');
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn!);
    expect(container.textContent).toContain('right_shoulder');
  });
});
