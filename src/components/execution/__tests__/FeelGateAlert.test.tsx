import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { FeelGateAlert } from '../FeelGateAlert';
import type { FeelModalGroup } from '../feelGate';

/**
 * 结算闸门窄卡测试（issue #98 返工②，2026-10-01）：
 * 用户原话「只希望有个弹窗，类似配重突变的卡片弹窗；不需要滑条，只做意图判断和
 * 缺少内容提示」——形态完全复用 DeviationWarningModal 窄卡 iOS Alert：
 * - 标题「还有 N 组没记感受」+ 按动作聚合的缺失提示（「动作名 · N 组」）
 * - 只分流不写值：[仍要结束] → onEnd（App 直接结算）/[去补记] → onGoFill（开聚合表单）
 * - 无滑条、无输入、无对勾——写值只发生在 FeelModal 表单本体（另见 FeelModal.test.tsx）
 */

/** 两个动作共 4 组未填（杠铃卧推 3 组 + 杠铃划船 1 组） */
const groups: FeelModalGroup[] = [
  {
    exId: 'ex-1',
    exName: '杠铃卧推',
    sets: [
      { setId: 'set-1', setNo: 1, weight: 60, reps: 8 },
      { setId: 'set-2', setNo: 2, weight: 60, reps: 8 },
      { setId: 'set-3', setNo: 3, weight: 60, reps: 8 },
    ],
  },
  { exId: 'ex-2', exName: '杠铃划船', sets: [{ setId: 'set-b1', setNo: 1, weight: 40, reps: 10 }] },
];

const renderAlert = (onEnd = vi.fn(), onGoFill = vi.fn()) => {
  const utils = render(<FeelGateAlert groups={groups} onEnd={onEnd} onGoFill={onGoFill} />);
  return { onEnd, onGoFill, ...utils };
};

describe('FeelGateAlert（结算闸门窄卡 #98 返工②）', () => {
  it('标题聚合总组数 + 按动作列出缺失提示', () => {
    const utils = renderAlert();
    expect(utils.getByText('还有 4 组没记感受')).toBeTruthy();
    expect(utils.getByText('杠铃卧推 · 3 组')).toBeTruthy();
    expect(utils.getByText('杠铃划船 · 1 组')).toBeTruthy();
  });

  it('形态红线：无滑条、无文本输入、无确认对勾（写值只发生在表单本体）', () => {
    const utils = renderAlert();
    expect(utils.queryAllByRole('slider')).toHaveLength(0);
    expect(utils.queryByRole('textbox')).toBeNull();
    expect(utils.queryByRole('button', { name: '确认记录全部组感受' })).toBeNull();
  });

  it('[仍要结束] → 只触发 onEnd（不写值直接结算，onGoFill 不触发）', () => {
    const utils = renderAlert();
    act(() => {
      fireEvent.click(utils.getByRole('button', { name: '仍要结束' }));
    });
    expect(utils.onEnd).toHaveBeenCalledTimes(1);
    expect(utils.onGoFill).not.toHaveBeenCalled();
  });

  it('[去补记] → 只触发 onGoFill（进聚合表单，onEnd 不触发）', () => {
    const utils = renderAlert();
    act(() => {
      fireEvent.click(utils.getByRole('button', { name: '去补记' }));
    });
    expect(utils.onGoFill).toHaveBeenCalledTimes(1);
    expect(utils.onEnd).not.toHaveBeenCalled();
  });

  it('单动作单组：文案降为「1 组」仍可读', () => {
    const utils = render(
      <FeelGateAlert
        groups={[{ exId: 'ex-1', exName: '杠铃卧推', sets: [{ setId: 's1', setNo: 1 }] }]}
        onEnd={vi.fn()}
        onGoFill={vi.fn()}
      />,
    );
    expect(utils.getByText('还有 1 组没记感受')).toBeTruthy();
    expect(utils.getByText('杠铃卧推 · 1 组')).toBeTruthy();
  });
});
