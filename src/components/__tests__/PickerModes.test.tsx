/**
 * A10 入口/出口场景区分组件测试（issue #32）
 *
 * 验证门覆盖：
 * 1. 三模式进入→交互→确认路径各一条（batch/append 多选走清单页，single-replace 单选即回填）；
 * 2. 空选择=确认禁用态（悬浮条常驻）；
 * 3. 文案 × 场景参数对应表（PICKER_MODE_CONFIRM：替换X / 添加N个 / 追加N个到队尾）；
 * 4. App 级确认行为（usePickerEntryConfirm，mock API）：会话队尾追加保持顺序
 *    + 批量入库循环 POST + 进度横幅（复用 #48 BatchAddBanner）；
 * 5. ExerciseSettingsModal 库视图接线：mode="single-replace"，确认即回填关闭。
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

// 离线桩：组件链路里的真实后端调用（建议/智能排序）统一快速失败 → 组件内既有
// 兜底生效（排序回 mock 序、参数回本地启发式），断言聚焦交互与回调契约
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline stub')));

import ExercisePickerModal from '../picker/ExercisePickerModal';
import ExerciseSettingsModal from '../ExerciseSettingsModal';
import BatchAddBanner from '../picker/BatchAddBanner';
import { usePickerEntryConfirm } from '../../hooks/usePickerEntryConfirm';
import { MOCK_EXERCISES, PICKER_MODE_CONFIRM, type PickerEntryMode, type PickerSelectionItem } from '../picker/pickerData';
import type { Exercise } from '../../types/legacy';

const findEn = (nameEn: string) => {
  const ex = MOCK_EXERCISES.find(e => e.nameEn === nameEn);
  if (!ex) throw new Error(`mock exercise not found by nameEn: ${nameEn}`);
  return ex;
};

const BENCH = 'Barbell Bench Press';
const DEADLIFT = 'Axle Deadlift';

const renderPicker = (mode: PickerEntryMode, onConfirm = vi.fn()) => {
  render(<ExercisePickerModal mode={mode} hasHistory={false} onClose={() => {}} onConfirm={onConfirm} />);
  return onConfirm;
};

/** 按顺序圈选行 */
const pick = async (user: ReturnType<typeof userEvent.setup>, nameEns: string[]) => {
  for (const nameEn of nameEns) {
    await user.click(screen.getByLabelText(`选择 ${findEn(nameEn).name}`));
  }
};

// ---------------------------------------------------------------------------
// 1-3. 三模式路径 + 空选择禁用 + 文案对应表
// ---------------------------------------------------------------------------

describe('A10 三模式 · 进入→交互→确认', () => {
  it('batch：多选→去配置→清单页确认「添加2个」，onConfirm 按选择顺序回传 2 项；空选择时禁用', async () => {
    const user = userEvent.setup();
    const onConfirm = renderPicker('batch');

    // 空选择禁用态：悬浮条常驻，去配置禁用（确认钮在清单页承载）
    expect(screen.getByRole('button', { name: '去配置' })).toBeDisabled();

    await pick(user, [BENCH, DEADLIFT]);
    const goConfig = screen.getByRole('button', { name: '去配置' });
    expect(goConfig).toBeEnabled();
    await user.click(goConfig);

    // 清单页确认钮：文案=添加N个，行为=onConfirm 全量回传（顺序即圈选顺序）
    const confirm = screen.getByRole('button', { name: '添加2个' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const items = onConfirm.mock.calls[0][0] as PickerSelectionItem[];
    expect(items.map(i => i.exercise.nameEn)).toEqual([BENCH, DEADLIFT]);
  });

  it('batch 空清单直入：确认「添加动作」禁用（空选择=禁用态，行为与文案一致）', () => {
    render(<ExercisePickerModal mode="batch" hasHistory={false} initialScreen="cart" onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole('button', { name: PICKER_MODE_CONFIRM.batch.emptyLabel })).toBeDisabled();
    expect(screen.getByText('还没有选择动作')).toBeInTheDocument();
  });

  it('append：多选→清单页确认「追加2个到队尾」，行为与文案一致（同一路径不同文案）', async () => {
    const user = userEvent.setup();
    const onConfirm = renderPicker('append');

    await pick(user, [BENCH, DEADLIFT]);
    await user.click(screen.getByRole('button', { name: '去配置' }));

    const confirm = screen.getByRole('button', { name: '追加2个到队尾' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    const items = onConfirm.mock.calls[0][0] as PickerSelectionItem[];
    expect(items.map(i => i.exercise.nameEn)).toEqual([BENCH, DEADLIFT]);
  });

  it('single-replace：无清单流程，单选语义（新选替换旧选），确认「替换X」回传单项；空选择禁用', async () => {
    const user = userEvent.setup();
    const onConfirm = renderPicker('single-replace');

    // 空选择禁用态：无「去配置」（购物车流程隐藏），确认钮通用文案禁用
    expect(screen.queryByRole('button', { name: '去配置' })).not.toBeInTheDocument();
    const emptyLabel = PICKER_MODE_CONFIRM['single-replace'].emptyLabel;
    expect(screen.getByRole('button', { name: emptyLabel })).toBeDisabled();

    // 单选语义：先选卧推，再选硬拉 → 选择收敛为硬拉（替换旧选）
    await user.click(screen.getByLabelText(`选择 ${findEn(BENCH).name}`));
    expect(screen.getByRole('button', { name: `替换${findEn(BENCH).name}` })).toBeEnabled();
    await user.click(screen.getByLabelText(`选择 ${findEn(DEADLIFT).name}`));
    expect(screen.queryByRole('button', { name: `替换${findEn(BENCH).name}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `替换${findEn(DEADLIFT).name}` })).toBeEnabled();

    // 已选计数恒 1（单选；计数块=「已选 N 个动作」整段文本）
    const counter = screen.getByText('已选', { exact: false });
    expect(counter.textContent).toContain('1');

    // 确认=回传单个选中项（回填契约：数组长度 1）
    await user.click(screen.getByRole('button', { name: `替换${findEn(DEADLIFT).name}` }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const items = onConfirm.mock.calls[0][0] as PickerSelectionItem[];
    expect(items).toHaveLength(1);
    expect(items[0].exercise.nameEn).toBe(DEADLIFT);

    // 再点已选行=取消 → 回到空选择禁用态
    await user.click(screen.getByLabelText(`取消选择 ${findEn(DEADLIFT).name}`));
    expect(screen.getByRole('button', { name: emptyLabel })).toBeDisabled();
  });

  it('文案 × 场景参数对应表（清单页确认钮逐模式断言）', async () => {
    const user = userEvent.setup();
    const table: Array<{ mode: PickerEntryMode; confirm: string }> = [
      { mode: 'batch', confirm: '添加2个' },
      { mode: 'append', confirm: '追加2个到队尾' },
    ];
    for (const { mode, confirm } of table) {
      const { unmount } = render(<ExercisePickerModal mode={mode} hasHistory={false} onClose={() => {}} onConfirm={() => {}} />);
      await pick(user, [BENCH, DEADLIFT]);
      await user.click(screen.getByRole('button', { name: '去配置' }));
      expect(screen.getByRole('button', { name: confirm })).toBeInTheDocument();
      unmount();
    }
    // single-replace 文案带动作名（替换X），计数型文案生成器逐字断言
    expect(PICKER_MODE_CONFIRM['single-replace'].label(1, findEn(BENCH).name)).toBe(`替换${findEn(BENCH).name}`);
    expect(PICKER_MODE_CONFIRM.batch.label(3)).toBe('添加3个');
    expect(PICKER_MODE_CONFIRM.append.label(3)).toBe('追加3个到队尾');
  });

  it('缺省 mode=batch（存量调用点回归：购物车流程保留）', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal hasHistory={false} onClose={() => {}} onConfirm={() => {}} />);
    await pick(user, [BENCH]);
    expect(screen.getByRole('button', { name: '去配置' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// 4. App 级确认行为（usePickerEntryConfirm + BatchAddBanner，mock API）
// ---------------------------------------------------------------------------

/** 测试宿主：picker（入口场景）→ confirm → 会话追加回调 + 批量入库横幅 */
function EntryHost({
  mode,
  onExercisesAdded,
}: {
  mode: PickerEntryMode;
  onExercisesAdded: (exercises: Exercise[]) => void;
}) {
  const entry = usePickerEntryConfirm({ onExercisesAdded });
  return (
    <div>
      <ExercisePickerModal
        mode={mode}
        hasHistory={false}
        onClose={() => {}}
        onConfirm={items => entry.confirm(items)}
      />
      <BatchAddBanner state={entry.state} onRetry={entry.retryFailed} onDismiss={entry.dismiss} />
    </div>
  );
}

/** 横幅整句匹配器：计数带色 span 拆散了文本节点，须按 <p> 整体 textContent 匹配 */
const bannerSentence = (text: string) => (_: unknown, el: Element | null) =>
  el?.tagName === 'P' && el.textContent === text;

describe('A10 App 级确认行为（usePickerEntryConfirm + BatchAddBanner）', () => {
  beforeEach(() => {
    createExerciseMock.mockReset();
    createExerciseMock.mockResolvedValue({ id: 'x' });
  });

  it('append 确认：会话队尾追加保持清单顺序 + 批量入库循环 POST + 横幅进度走满', async () => {
    const user = userEvent.setup();
    const onExercisesAdded = vi.fn();
    render(<EntryHost mode="append" onExercisesAdded={onExercisesAdded} />);

    await pick(user, [BENCH, DEADLIFT]);
    await user.click(screen.getByRole('button', { name: '去配置' }));
    await user.click(screen.getByRole('button', { name: '追加2个到队尾' }));

    // 会话追加：顺序 = 圈选顺序（追加队尾语义），组均为未开始的 PLANNED 草稿
    expect(onExercisesAdded).toHaveBeenCalledTimes(1);
    const added = onExercisesAdded.mock.calls[0][0] as Exercise[];
    expect(added).toHaveLength(2);
    expect(added[0].name).toBe(findEn(BENCH).name);
    expect(added[1].name).toBe(findEn(DEADLIFT).name);
    expect(added[0].sets.length).toBeGreaterThan(0);
    expect(added[0].sets[0].status).toBe('PLANNED');

    // 批量入库：顺序循环单条 POST，id 与会话 Exercise 同源（session id = 库 id 约定）
    await waitFor(() => expect(createExerciseMock).toHaveBeenCalledTimes(2));
    const postNames = createExerciseMock.mock.calls.map(c => (c[0] as { name: string }).name);
    expect(postNames).toEqual([findEn(BENCH).nameEn, findEn(DEADLIFT).nameEn]);
    expect((createExerciseMock.mock.calls[0][0] as { id: string }).id).toBe(added[0].id);
    expect(added[0].libraryId).toBe(added[0].id);

    // 横幅进度走满（#48 BatchAddBanner 复用）
    await waitFor(() => expect(screen.getByText(bannerSentence('已添加 2 个动作'))).toBeInTheDocument());
  });

  it('batch 确认（mock API 同一路径，模式仅文案差异）', async () => {
    const user = userEvent.setup();
    const onExercisesAdded = vi.fn();
    render(<EntryHost mode="batch" onExercisesAdded={onExercisesAdded} />);

    await pick(user, [BENCH]);
    await user.click(screen.getByRole('button', { name: '去配置' }));
    await user.click(screen.getByRole('button', { name: '添加1个' }));

    expect(onExercisesAdded).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(createExerciseMock).toHaveBeenCalledTimes(1));
  });

  it('批量入库失败不阻断会话追加（横幅呈现失败态，单条重试仅补失败项）', async () => {
    const user = userEvent.setup();
    const onExercisesAdded = vi.fn();
    createExerciseMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'x' })
      .mockResolvedValueOnce({ id: 'x' }); // 重试轮：仅失败单条
    render(<EntryHost mode="append" onExercisesAdded={onExercisesAdded} />);

    await pick(user, [BENCH, DEADLIFT]);
    await user.click(screen.getByRole('button', { name: '去配置' }));
    await user.click(screen.getByRole('button', { name: '追加2个到队尾' }));

    // 会话追加先落账（本地优先，不因入库失败回滚）
    expect(onExercisesAdded).toHaveBeenCalledTimes(1);
    expect(onExercisesAdded.mock.calls[0][0]).toHaveLength(2);

    // 失败态常驻 + 单条重试补失败项
    await waitFor(() =>
      expect(screen.getByText(bannerSentence('已添加 1 个，1 个添加失败'))).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: '重试失败' }));
    await waitFor(() =>
      expect(screen.getByText(bannerSentence('已添加 2 个动作'))).toBeInTheDocument(),
    );
    expect(createExerciseMock).toHaveBeenCalledTimes(3);
    expect((createExerciseMock.mock.calls[2][0] as { name: string }).name).toBe(findEn(BENCH).nameEn);
  });
});

// ---------------------------------------------------------------------------
// 5. ExerciseSettingsModal 库视图接线（single-replace）
// ---------------------------------------------------------------------------

describe('ExerciseSettingsModal · 配置页库视图 = single-replace', () => {
  it('mode 传入 single-replace：无「去配置」，圈选即回填并关闭库视图（onLibraryOpenChange(false)）', async () => {
    const user = userEvent.setup();
    const onLibraryOpenChange = vi.fn();
    const bench = findEn(BENCH);
    render(
      <ExerciseSettingsModal
        exercise={{
          protocol_version: '2.0.0',
          id: bench.id,
          exerciseId: `fit://library/exercise/${bench.id}`,
          type: 'resistance',
          sets: [{ index: 0, reps: 10, weight: 60, status: 'PLANNED' }],
          metadata: { name: bench.name, nameEn: bench.nameEn, libraryId: bench.id },
        }}
        onClose={() => {}}
        onSave={() => {}}
        isLibraryOpen
        onLibraryOpenChange={onLibraryOpenChange}
      />,
    );

    // 库视图以 single-replace 呈现（购物车流程隐藏 + 空选择禁用态）
    expect(screen.queryByRole('button', { name: '去配置' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '替换动作' })).toBeDisabled();

    // 单选 → 确认「替换X」→ 回填表单并关闭库视图（回配置表单）
    await user.click(screen.getByLabelText(`选择 ${bench.name}`));
    await user.click(screen.getByRole('button', { name: `替换${bench.name}` }));
    expect(onLibraryOpenChange).toHaveBeenCalledWith(false);
  });
});
