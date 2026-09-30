/**
 * usePickerEntryConfirm 来源分流测试（issue #85）
 *
 * 覆盖验证门三形态：
 *  1. 全库内批次：不 POST、无横幅（状态保持 idle）、session id 锚定库行 id
 *  2. 混合批次：仅自建条目 POST（载荷名/计数），库内条目照常入会话
 *  3. 纯自建批次：行为与修复前一致（顺序 POST、会话 id 与载荷同源、done 收尾）
 *
 * 库内条目直接取 MOCK_EXERCISES（buildPickerExercises 派生，source='library'），
 * 自建条目以 source:'custom' 覆写构造。
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

import { usePickerEntryConfirm } from '../usePickerEntryConfirm';
import BatchAddBanner from '../../components/picker/BatchAddBanner';
import { MOCK_EXERCISES, type PickerExercise, type PickerSelectionItem } from '../../components/picker/pickerData';
import type { BatchCreatePayload } from '../../components/picker/pickerAdapter';
import type { Exercise } from '../../types/legacy';

const makeItem = (overrides?: Partial<PickerExercise>): PickerSelectionItem => ({
  exercise: { ...MOCK_EXERCISES[0], ...overrides },
  sets: [{ id: 'set-1', role: 'working', weight: 40, reps: 10, durationSec: 0 }],
  targetRpe: 7,
});

/** 横幅整句匹配器：计数带色 span 拆散了文本节点，须按 <p> 整体 textContent 匹配 */
const bannerSentence = (text: string) => (_: unknown, el: Element | null) =>
  el?.tagName === 'P' && el.textContent === text;

/** 测试宿主：注入 hook + 横幅 + 状态探针（idle/running/partial/done 直读） */
function Host({ items, onAdded }: { items: PickerSelectionItem[]; onAdded: (ex: Exercise[]) => void }) {
  const entry = usePickerEntryConfirm({ onExercisesAdded: onAdded });
  return (
    <div>
      <button onClick={() => entry.confirm(items)}>confirm</button>
      <span data-testid="status">{entry.state.status}</span>
      <BatchAddBanner state={entry.state} onRetry={entry.retryFailed} onDismiss={entry.dismiss} />
    </div>
  );
}

describe('usePickerEntryConfirm 来源分流（issue #85 三形态）', () => {
  const onAdded = vi.fn<(ex: Exercise[]) => void>();

  beforeEach(() => {
    createExerciseMock.mockReset();
    onAdded.mockReset();
    createExerciseMock.mockResolvedValue({ id: 'x' });
  });

  it('形态1 全库内批次：不 POST、状态保持 idle 无横幅、session id 锚定库行 id', async () => {
    const user = userEvent.setup();
    const libraryItems = MOCK_EXERCISES.slice(0, 4).map(ex => makeItem({ ...ex }));
    render(<Host items={libraryItems} onAdded={onAdded} />);

    await user.click(screen.getByRole('button', { name: 'confirm' }));

    // 不触批量创建 API（库内已有行，POST 必撞 exercises_name_key）
    expect(createExerciseMock).not.toHaveBeenCalled();
    // 会话照常全量追加
    expect(onAdded).toHaveBeenCalledTimes(1);
    const exercises = onAdded.mock.calls[0][0];
    expect(exercises).toHaveLength(4);
    expect(exercises.map(e => e.id)).toEqual(libraryItems.map(i => i.exercise.id));
    // 状态保持 idle：横幅不渲染（假失败横幅根除）
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('形态2 混合批次：仅自建 1 条 POST，库内 3 条只入会话', async () => {
    const user = userEvent.setup();
    const custom = makeItem({ source: 'custom', nameEn: 'Custom Landmine Press', name: '自建地雷推举' });
    const items = [
      ...MOCK_EXERCISES.slice(0, 3).map(ex => makeItem({ ...ex })),
      custom,
    ];
    render(<Host items={items} onAdded={onAdded} />);

    await user.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('done'));
    // 仅自建 1 条触达创建 API，载荷名 = 自建英文名
    expect(createExerciseMock).toHaveBeenCalledTimes(1);
    const payload = createExerciseMock.mock.calls[0][0] as BatchCreatePayload;
    expect(payload.name).toBe('Custom Landmine Press');
    // 会话 4 条全追加；自建 session id 与入库载荷同源
    const exercises = onAdded.mock.calls[0][0];
    expect(exercises).toHaveLength(4);
    const customSession = exercises.find(e => e.name === '自建地雷推举');
    expect(customSession?.id).toBe(payload.id);
    // 库内条目 session id = 库行 id（非生成 id）
    const libraryIds = exercises.filter(e => e.name !== '自建地雷推举').map(e => e.id);
    expect(libraryIds).toEqual(items.slice(0, 3).map(i => i.exercise.id));
  });

  it('形态3 纯自建批次：行为与修复前一致（顺序 POST、id 同源、done 收尾）', async () => {
    const user = userEvent.setup();
    const items = [
      makeItem({ source: 'custom', nameEn: 'Custom A', name: '自建A' }),
      makeItem({ source: 'custom', nameEn: 'Custom B', name: '自建B' }),
    ];
    render(<Host items={items} onAdded={onAdded} />);

    await user.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('done'));
    expect(createExerciseMock).toHaveBeenCalledTimes(2);
    expect(createExerciseMock.mock.calls.map(c => (c[0] as BatchCreatePayload).name)).toEqual(['Custom A', 'Custom B']);
    const payloadIds = createExerciseMock.mock.calls.map(c => (c[0] as BatchCreatePayload).id);
    const exercises = onAdded.mock.calls[0][0];
    expect(exercises.map(e => e.id)).toEqual(payloadIds);
    // 横幅正常呈现 done 成功态（自建批次反馈语义不变）
    expect(await screen.findByText(bannerSentence('已添加 2 个动作'))).toBeInTheDocument();
  });
});
