/**
 * A8+A9 动作选择器单测：筛选/搜索兜底/排序逻辑 + 筛选 Sheet + 圈选/清单/参数配置交互
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ExercisePickerModal from '../picker/ExercisePickerModal';
import PickerConfigSheet from '../picker/PickerConfigSheet';
import {
  EQUIPMENT_SHEET_ORDER,
  MOCK_EXERCISES,
  TYPE_SHEET_ORDER,
  TYPE_LABELS,
  type PickerExerciseType,
  type PickerSelectionItem,
} from '../picker/pickerData';
import {
  EMPTY_FILTERS,
  computeDragTarget,
  filterAndSortExercises,
  formatParamSummary,
  matchSearch,
  planToDraftSets,
  rowSubtitle,
  summarizeTypeDim,
} from '../picker/pickerLogic';

const byId = (id: string) => {
  const ex = MOCK_EXERCISES.find(e => e.id === id);
  if (!ex) throw new Error(`mock exercise not found: ${id}`);
  return ex;
};

const makeItem = (id: string): PickerSelectionItem => {
  const ex = byId(id);
  return { exercise: ex, sets: planToDraftSets(ex.suggestion.sets), targetRpe: ex.suggestion.targetRpe };
};

// ---------------------------------------------------------------------------
// 纯逻辑
// ---------------------------------------------------------------------------

describe('pickerLogic · 搜索兜底', () => {
  const bench = byId('bench-press');

  it('中文名可命中', () => {
    expect(matchSearch(bench, '卧推')).toBe(true);
  });
  it('英文名可命中', () => {
    expect(matchSearch(bench, 'bench')).toBe(true);
  });
  it('全拼可命中', () => {
    expect(matchSearch(bench, 'ganglingwotui')).toBe(true);
  });
  it('拼音首字母可命中', () => {
    expect(matchSearch(bench, 'glwt')).toBe(true);
  });
  it('无关词不命中', () => {
    expect(matchSearch(bench, 'yoga')).toBe(false);
  });
});

describe('pickerLogic · 三维正交筛选 + 排序', () => {
  const all = MOCK_EXERCISES;

  it('类型筛选：有氧只含有氧动作（cardio 必须可筛选）', () => {
    const result = filterAndSortExercises(all, { ...EMPTY_FILTERS, types: ['cardio'] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.exerciseType === 'cardio')).toBe(true);
  });

  it('维度内多选 OR：有氧 + 自重', () => {
    const result = filterAndSortExercises(all, { ...EMPTY_FILTERS, types: ['cardio', 'bodyweight'] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.exerciseType === 'cardio' || e.exerciseType === 'bodyweight')).toBe(true);
  });

  it('维度间 AND：力量 × 杠铃', () => {
    const result = filterAndSortExercises(all, { types: ['resistance'], muscles: [], equipment: ['杠铃'] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.exerciseType === 'resistance' && e.equipment === '杠铃')).toBe(true);
  });

  it('肌肉筛选：腿部', () => {
    const result = filterAndSortExercises(all, { types: [], muscles: ['腿部'], equipment: [] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.muscles.includes('腿部'))).toBe(true);
  });

  it('ExerciseType 9 类全集每类至少 1 个 mock 条目（筛选体系覆盖 cardio 等）', () => {
    const present = new Set(MOCK_EXERCISES.map(e => e.exerciseType));
    for (const t of TYPE_SHEET_ORDER) {
      expect(present.has(t)).toBe(true);
    }
    expect(TYPE_SHEET_ORDER).toHaveLength(9);
  });

  it('器械 Sheet 每类至少 1 个 mock 条目', () => {
    for (const e of EQUIPMENT_SHEET_ORDER) {
      expect(MOCK_EXERCISES.some(ex => ex.equipment === e)).toBe(true);
    }
  });

  it('有历史：智能排序（rank），卧推第一', () => {
    const result = filterAndSortExercises(all, EMPTY_FILTERS, '', true);
    expect(result[0].id).toBe('bench-press');
  });

  it('新手态：降级热门排序（hotRank），深蹲第一', () => {
    const result = filterAndSortExercises(all, EMPTY_FILTERS, '', false);
    expect(result[0].id).toBe('barbell-squat');
  });

  it('搜索词非空时跨全库检索，忽略筛选维度', () => {
    const result = filterAndSortExercises(all, { types: ['cardio'], muscles: [], equipment: [] }, 'bench', true);
    expect(result.map(e => e.id)).toContain('bench-press');
  });
});

describe('pickerLogic · 胶囊回显与行副标题', () => {
  it('类型胶囊回显：未选/单选/多选', () => {
    expect(summarizeTypeDim([])).toBe('所有类型');
    expect(summarizeTypeDim(['cardio'])).toBe('有氧');
    expect(summarizeTypeDim(['cardio', 'bodyweight'])).toBe('有氧等2项');
  });

  it('有氧行副标题显示时长语义', () => {
    expect(rowSubtitle(byId('treadmill-jog'))).toBe('建议 20分钟 · 跑步机');
  });

  it('力量行副标题显示目标肌群 + 器械', () => {
    expect(rowSubtitle(byId('bench-press'))).toBe('胸部 · 手臂 · 杠铃');
  });
});

describe('pickerLogic · 长按拖拽落位（computeDragTarget）', () => {
  it('下拖一行高 → 与相邻行交换', () => {
    expect(computeDragTarget(0, 66, 66, 4)).toBe(1);
  });
  it('上拖两行高 → 上移两位', () => {
    expect(computeDragTarget(3, -132, 66, 4)).toBe(1);
  });
  it('夹紧到列表边界', () => {
    expect(computeDragTarget(0, -500, 66, 4)).toBe(0);
    expect(computeDragTarget(3, 500, 66, 4)).toBe(3);
  });
  it('位移不足半行 → 保持原位', () => {
    expect(computeDragTarget(1, 20, 66, 4)).toBe(1);
  });
});

describe('pickerLogic · 参数摘要一行', () => {
  it('力量动作：「4组×8-10 · 60kg · RPE 7」', () => {
    const item = makeItem('bench-press');
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('4组×8-10 · 60kg · RPE 7');
  });

  it('自重动作显示「自重」', () => {
    const item = makeItem('pull-up');
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('3组×4-6 · 自重 · RPE 8');
  });

  it('时长型多组：「3组×45秒 · RPE 6」', () => {
    const item = makeItem('plank');
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('3组×45秒 · RPE 6');
  });

  it('时长型单组：「20分钟 · RPE 5」', () => {
    const item = makeItem('treadmill-jog');
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('20分钟 · RPE 5');
  });

  it('区间负荷：「4组×5-10 · 40-100kg · RPE 8」（深蹲，递增协议）', () => {
    const item = makeItem('barbell-squat');
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('4组×5-10 · 40-100kg · RPE 8');
  });
});

// ---------------------------------------------------------------------------
// 组件交互
// ---------------------------------------------------------------------------

describe('ExercisePickerModal · A8 主列表', () => {
  it('渲染列表 + 「常用」「为你推荐」徽标 + 近期的训练分区', () => {
    render(<ExercisePickerModal onClose={() => {}} />);
    expect(screen.getByText('添加运动')).toBeInTheDocument();
    expect(screen.getByText('近期的训练')).toBeInTheDocument();
    expect(screen.getAllByText('所有运动').length).toBeGreaterThan(0);
    expect(screen.getByText('杠铃卧推')).toBeInTheDocument();
    // 智能排序前 3（卧推/引体/深蹲）各带「常用」徽标；mock 中共 6 个「为你推荐」
    expect(screen.getAllByText('常用')).toHaveLength(3);
    expect(screen.getAllByText('为你推荐')).toHaveLength(6);
  });

  it('新手态：无「常用」徽标 + 引导卡 + 无近期分区', () => {
    render(<ExercisePickerModal hasHistory={false} onClose={() => {}} />);
    expect(screen.queryByText('常用')).not.toBeInTheDocument();
    expect(screen.getByText('初次训练，从热门开始')).toBeInTheDocument();
    expect(screen.queryByText('近期的训练')).not.toBeInTheDocument();
  });

  it('类型 Sheet：选「有氧」→ 显示 4 个结果 → 列表只剩有氧，胶囊回显', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /所有类型/ }));

    // Sheet 打开：dialog + 9 类卡片
    const dialog = screen.getByRole('dialog', { name: '类型' });
    expect(within(dialog).getByRole('button', { name: '力量' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '有氧' }));

    // CTA 实时计数（mock 中 exerciseType=cardio 共 4 个；户外为独立类型）
    expect(within(dialog).getByRole('button', { name: '显示 4 个结果' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '显示 4 个结果' }));

    // 应用后：列表只剩有氧，胶囊回显「有氧」（退出动画中的 Sheet 可能滞留 jsdom，按胶囊特征取元素）
    expect(screen.queryByText('杠铃卧推')).not.toBeInTheDocument();
    expect(screen.getByText('划船机')).toBeInTheDocument();
    const pill = screen.getAllByRole('button', { name: '有氧' }).find(b => b.getAttribute('aria-haspopup') === 'dialog');
    expect(pill).toHaveClass('bg-star-dark');
  });

  it('肌肉 Sheet：上肢/下肢/核心分组 + 选「胸部」过滤', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /所有肌肉/ }));
    const dialog = screen.getByRole('dialog', { name: '肌肉群' });
    expect(within(dialog).getByText('上肢')).toBeInTheDocument();
    expect(within(dialog).getByText('下肢')).toBeInTheDocument();
    expect(within(dialog).getByText('核心')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '胸部' }));
    await user.click(within(dialog).getByRole('button', { name: /显示 \d+ 个结果/ }));

    expect(screen.getByText('杠铃卧推')).toBeInTheDocument();
    expect(screen.queryByText('反手引体向上')).not.toBeInTheDocument();
  });

  it('器械 Sheet：清除筛选器复位胶囊与列表', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /所有器械/ }));
    // AnimatePresence 退场元素可能滞留 jsdom，取最新挂载的 dialog
    const dialog = () => {
      const dialogs = screen.getAllByRole('dialog', { name: '器械' });
      return dialogs[dialogs.length - 1];
    };
    await user.click(within(dialog()).getByRole('button', { name: '杠铃' }));
    await user.click(within(dialog()).getByRole('button', { name: '显示 5 个结果' }));
    // 用行 aria-label 断言列表（滞留退场 Sheet 的卡片文本会干扰全局 text 查询）
    expect(screen.getByLabelText('选择 杠铃卧推')).toBeInTheDocument();
    expect(screen.queryByLabelText('选择 划船机')).not.toBeInTheDocument();

    // 重开器械 Sheet（胶囊回显「杠铃」）→ 清除筛选器 → 全量恢复
    const pill = screen.getAllByRole('button', { name: '杠铃' }).find(b => b.getAttribute('aria-haspopup') === 'dialog');
    await user.click(pill!);
    await user.click(within(dialog()).getByRole('button', { name: '清除筛选器' }));
    await user.click(within(dialog()).getByRole('button', { name: /显示 \d+ 个结果/ }));
    expect(screen.getByLabelText('选择 杠铃卧推')).toBeInTheDocument();
    expect(screen.getByLabelText('选择 划船机')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /所有器械/ })).toBeInTheDocument();
  });

  it('搜索兜底：拼音首字母 glwt 命中杠铃卧推', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText('搜索运动'), 'glwt');
    expect(screen.getByText('杠铃卧推')).toBeInTheDocument();
    expect(screen.queryByText('反手引体向上')).not.toBeInTheDocument();
    // 搜索时近期分区隐藏
    expect(screen.queryByText('近期的训练')).not.toBeInTheDocument();
  });

  it('搜索兜底：英文 bench 命中', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText('搜索运动'), 'bench');
    expect(screen.getByText('杠铃卧推')).toBeInTheDocument();
  });

  it('9 类类型标签全部可用于清单页标注（TYPE_LABELS 全集）', () => {
    const types: PickerExerciseType[] = ['resistance', 'cardio', 'bodyweight', 'isometric', 'assisted', 'unilateral', 'weight_only', 'reps_only', 'outdoor'];
    types.forEach(t => expect(TYPE_LABELS[t]).toBeTruthy());
  });
});

describe('ExercisePickerModal · A9 购物车多选', () => {
  it('行圈选连续添加不关弹窗，选中态以行高亮+缩略图角标表达（无独立复选框）', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByLabelText('选择 杠铃卧推'));
    expect(screen.getByText('已选', { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText('选择 反手引体向上')).toBeInTheDocument(); // 弹窗未关
    await user.click(screen.getByLabelText('选择 反手引体向上'));
    expect(screen.getByText('2')).toBeInTheDocument();
    // 再点取消圈选
    await user.click(screen.getByLabelText('取消选择 反手引体向上'));
    expect(screen.getByLabelText('选择 反手引体向上')).toBeInTheDocument();
    // 选中行不渲染独立 checkbox/radio 控件
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('去配置进入清单页：参数摘要一行 + 移除（调序为长按拖拽，无上下箭头按钮）', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByLabelText('选择 杠铃卧推'));
    await user.click(screen.getByLabelText('选择 杠铃深蹲'));
    await user.click(screen.getByRole('button', { name: '去配置' }));

    expect(screen.getByText('训练清单')).toBeInTheDocument();
    expect(screen.getByText('4组×8-10 · 60kg · RPE 7')).toBeInTheDocument();

    // 箭头调序按钮已删除
    expect(screen.queryByLabelText(/上移 |下移 /)).not.toBeInTheDocument();
    // 长按拖拽提示存在
    expect(screen.getByText(/长按拖动调整顺序/)).toBeInTheDocument();

    // 移除深蹲 → 只剩卧推
    await user.click(screen.getByLabelText('移除 杠铃深蹲'));
    expect(screen.queryByLabelText('配置 杠铃深蹲')).not.toBeInTheDocument();
    expect(screen.getByLabelText('配置 杠铃卧推')).toBeInTheDocument();
  });

  it('选满 9 个出现琥珀色软提示', () => {
    const ids = MOCK_EXERCISES.slice(0, 9).map(e => e.id);
    render(<ExercisePickerModal defaultSelectedIds={ids} onClose={() => {}} />);
    expect(screen.getByText(/单次训练建议不超过 8 个/)).toBeInTheDocument();
  });

  it('红线自查：界面不出现「统一」「每组不同」', () => {
    render(<ExercisePickerModal defaultSelectedIds={['bench-press']} initialScreen="cart" onClose={() => {}} />);
    // 拼接构造，避免本文件自身命中红线 grep
    const banned = new RegExp('统' + '一|每' + '组不同');
    expect(screen.queryByText(banned)).not.toBeInTheDocument();
  });
});

describe('PickerConfigSheet · 参数配置（嵌套真实 ExerciseSettingsModal + 两个增量挂载点）', () => {
  const setupSheet = () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PickerConfigSheet item={makeItem('bench-press')} onChange={onChange} onClose={() => {}} />);
    return { user, onChange };
  };

  it('渲染真实面板主体区块 + 建议徽标（真组件复用，非自造形态）', () => {
    setupSheet();
    // 真实 ExerciseSettingsModal 的标志性区块
    expect(screen.getByText('目标强度')).toBeInTheDocument();
    expect(screen.getByText('训练组安排')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /动作库/ })).toBeInTheDocument();
    // 真实面板的建议来源徽标（云端 · AI）
    expect(screen.getAllByText(/云端/).length).toBeGreaterThan(0);
  });

  it('增量点：智能填充开关默认开，可切换', async () => {
    const { user } = setupSheet();
    const sw = screen.getByRole('switch', { name: '智能填充' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('增量点：组类型标注 chip → 底部选择条改「递增」→ 保存回写清单', async () => {
    const { user, onChange } = setupSheet();
    // 卧推初始组类型：热身 / 正式 / AMRAP
    expect(screen.getAllByText('热身').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AMRAP').length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('第 1 组类型：热身'));
    const sheet = screen.getByRole('dialog', { name: '第 1 组组类型选择' });
    await user.click(within(sheet).getByRole('button', { name: '递增' }));
    expect(screen.getByLabelText('第 1 组类型：递增')).toBeInTheDocument();

    // 经真实面板确认按钮保存（isCreating 语义 → 「确认添加动作」）→ 草稿回写（角色与 RPE 保留）
    await user.click(screen.getByRole('button', { name: '确认添加动作' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0][0] as PickerSelectionItem;
    expect(saved.sets).toHaveLength(4);
    expect(saved.sets[0].role).toBe('rampUp');
    expect(saved.sets[3].role).toBe('amrap');
    expect(saved.targetRpe).toBe(7);
  });
});
