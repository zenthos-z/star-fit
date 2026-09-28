/**
 * A31 购物车批量添加组件测试（issue #31）
 *
 * 覆盖验证门：批量模式交互（选择→添加→进度→失败单条重试）组件级覆盖。
 * ExerciseService.createExercise mock 为可控序列（部分失败→重试全成），
 * 横幅断言进度/失败/重试/完成四态；载荷映射与 set_type 契约见 setTypesContract.test.ts。
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

// createExercise mock（vi.hoisted：mock 工厂导入期执行，引用须提升避免 TDZ）
const { createExerciseMock } = vi.hoisted(() => ({
  createExerciseMock: vi.fn<(p: unknown) => Promise<unknown>>(),
}));
vi.mock('../../services/api/ExerciseServiceV2', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/api/ExerciseServiceV2')>();
  return {
    ...actual,
    ExerciseService: Object.assign(actual.ExerciseService, { createExercise: createExerciseMock }),
  };
});

import BatchAddBanner from '../picker/BatchAddBanner';
import { useBatchExerciseCreate } from '../../hooks/useBatchExerciseCreate';
import type { BatchCreatePayload } from '../picker/pickerAdapter';

const payload = (name: string): BatchCreatePayload => ({
  id: 'abcd1234abcd1234abcd',
  name,
  exercise_type: 'resistance',
  targets: '{"primary":["chest"],"secondary":[]}',
  equipment_required: '["barbell"]',
  difficulty: 'beginner',
  modified_by: 'system',
});

/** 横幅整句匹配器：计数带色 span 拆散了文本节点，须按 <p> 整体 textContent 匹配 */
const bannerSentence = (text: string) => (_: unknown, el: Element | null) =>
  el?.tagName === 'P' && el.textContent === text;

/** 测试宿主：注入 hook 状态 + 触发钮（组件级覆盖批量交互闭环） */
function Host({ items }: { items: BatchCreatePayload[] }) {
  const batch = useBatchExerciseCreate();
  return (
    <div>
      <button onClick={() => batch.runBatch(items)}>开始批量添加</button>
      <button onClick={batch.retryFailed}>host-retry</button>
      <BatchAddBanner state={batch.state} onRetry={batch.retryFailed} onDismiss={batch.dismiss} />
    </div>
  );
}

describe('批量添加（useBatchExerciseCreate + BatchAddBanner）', () => {
  beforeEach(() => {
    createExerciseMock.mockReset();
  });

  it('全成路径：3 条顺序入库 → 进度走满 → done 呈现「已添加 3 个动作」', async () => {
    const user = userEvent.setup();
    createExerciseMock.mockResolvedValue({ id: 'x' });
    render(<Host items={[payload('A'), payload('B'), payload('C')]} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // idle 不渲染
    await user.click(screen.getByRole('button', { name: '开始批量添加' }));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(bannerSentence('已添加 3 个动作'))).toBeInTheDocument(),
    );
    expect(createExerciseMock).toHaveBeenCalledTimes(3);
    // 顺序循环（App 层循环既定方案，非并发）
    const calls = createExerciseMock.mock.calls.map(c => (c[0] as BatchCreatePayload).name);
    expect(calls).toEqual(['A', 'B', 'C']);
    // done 态进度条走满
    const bar = document.querySelector('[role="status"] .bg-blue-500') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('失败→重试：第 2 条失败不中断 → 呈现失败态与重试钮 → 重试仅补失败单条', async () => {
    const user = userEvent.setup();
    createExerciseMock
      .mockResolvedValueOnce({ id: 'x' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'x' })
      // 重试轮：仅失败单条
      .mockResolvedValueOnce({ id: 'x' });
    render(<Host items={[payload('A'), payload('B'), payload('C')]} />);

    await user.click(screen.getByRole('button', { name: '开始批量添加' }));
    expect(await screen.findByText(/2 个添加失败|1 个添加失败/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(bannerSentence('已添加 2 个，1 个添加失败'))).toBeInTheDocument(),
    );
    expect(createExerciseMock).toHaveBeenCalledTimes(3); // 失败不中断后续

    // 失败态进度条 = 2/3
    const bar = document.querySelector('[role="status"] .bg-blue-500') as HTMLElement;
    expect(bar.style.width).toBe('67%');

    // 单条重试：仅补失败项（B），成功项不重复创建
    await user.click(screen.getByRole('button', { name: '重试失败' }));
    await waitFor(() =>
      expect(screen.getByText(bannerSentence('已添加 3 个动作'))).toBeInTheDocument(),
    );
    expect(createExerciseMock).toHaveBeenCalledTimes(4);
    expect((createExerciseMock.mock.calls[3][0] as BatchCreatePayload).name).toBe('B');
  });

  it('手动关闭横幅回到 idle（失败态常驻不等自动收起）', async () => {
    const user = userEvent.setup();
    createExerciseMock.mockRejectedValue(new Error('offline'));
    render(<Host items={[payload('A')]} />);
    await user.click(screen.getByRole('button', { name: '开始批量添加' }));
    await waitFor(() => expect(screen.getByText(/1 个添加失败/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '关闭批量添加进度' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
