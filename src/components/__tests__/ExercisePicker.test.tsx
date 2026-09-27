/**
 * A8+A9 动作选择器单测（v3：全库 354 条派生数据）
 * 覆盖：筛选/搜索兜底/排序逻辑、筛选 Sheet、行圈选、长按拖拽落位、
 *       MuscleMap 降级胶囊（无真人图渲染）、教程 ⓘ 入口、真实参数面板嵌套
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { muscleLabelZh } from '../../lib/muscleMap';
import ExercisePickerModal from '../picker/ExercisePickerModal';
import PickerConfigSheet from '../picker/PickerConfigSheet';
import {
  MOCK_EXERCISES,
  RECENT_IDS,
  TYPE_SHEET_ORDER,
  TYPE_LABELS,
  type PickerExerciseType,
  type PickerSelectionItem,
} from '../picker/pickerData';
import {
  EMPTY_FILTERS,
  filterAndSortExercises,
  formatParamSummary,
  matchSearch,
  planToDraftSets,
  rowSubtitle,
  summarizeTypeDim,
  summaryOfItem,
} from '../picker/pickerLogic';

const byId = (id: string) => {
  const ex = MOCK_EXERCISES.find(e => e.id === id);
  if (!ex) throw new Error(`mock exercise not found: ${id}`);
  return ex;
};

// 离线桩：组件链路里的真实后端调用（建议/教程/动作库同步/持久化）统一快速失败，
// 避免 jsdom 资源加载器对相对 URL fetch 产生 unhandled rejection
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline stub')));

const findEn = (nameEn: string) => {
  const ex = MOCK_EXERCISES.find(e => e.nameEn === nameEn);
  if (!ex) throw new Error(`mock exercise not found by nameEn: ${nameEn}`);
  return ex;
};

const makeItem = (id: string): PickerSelectionItem => {
  const ex = byId(id);
  return { exercise: ex, sets: planToDraftSets(ex.suggestion.sets), targetRpe: ex.suggestion.targetRpe };
};

const selectedCountOf = (exs: Array<{ id: string }>) => exs.length;

// ---------------------------------------------------------------------------
// 纯逻辑
// ---------------------------------------------------------------------------

describe('pickerLogic · 搜索兜底', () => {
  const bench = findEn('Barbell Bench Press');

  it('中文名可命中', () => {
    expect(matchSearch(bench, '卧推')).toBe(true);
  });
  it('英文名可命中', () => {
    expect(matchSearch(bench, 'bench')).toBe(true);
  });
  it('英文首字母可命中（全库派生口径：en 首字母索引）', () => {
    expect(matchSearch(bench, 'bbp')).toBe(true);
  });
  it('无关词不命中', () => {
    expect(matchSearch(bench, 'yoga')).toBe(false);
  });
  it('全库条目均有搜索索引字段', () => {
    for (const e of MOCK_EXERCISES) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.pinyinInitials.length).toBeGreaterThan(0);
    }
  });
});

describe('pickerLogic · 三维正交筛选 + 排序', () => {
  const all = MOCK_EXERCISES;

  it('类型筛选：有氧只含有氧动作', () => {
    const result = filterAndSortExercises(all, { ...EMPTY_FILTERS, types: ['cardio'] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.exerciseType === 'cardio')).toBe(true);
  });

  it('维度内多选 OR：有氧 + 拉伸', () => {
    const result = filterAndSortExercises(all, { ...EMPTY_FILTERS, types: ['cardio', 'flexibility'] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.exerciseType === 'cardio' || e.exerciseType === 'flexibility')).toBe(true);
  });

  it('维度间 AND：力量 × 杠铃', () => {
    const result = filterAndSortExercises(all, { types: ['resistance'], muscles: [], equipment: ['barbell'] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.exerciseType === 'resistance' && e.equipment === 'barbell')).toBe(true);
  });

  it('肌肉筛选：胸部（按主+次肌群中文命中）', () => {
    const result = filterAndSortExercises(all, { types: [], muscles: ['胸部'], equipment: [] }, '', true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.muscles.includes('胸部'))).toBe(true);
  });

  it('类型 Sheet 覆盖库内全部类型（派生，无空卡片）', () => {
    // 库内 5 类，按展示顺序派生（力量体系在前）
    expect(TYPE_SHEET_ORDER).toEqual(['resistance', 'bodyweight', 'cardio', 'flexibility', 'unilateral']);
    for (const e of all) {
      expect(TYPE_SHEET_ORDER).toContain(e.exerciseType);
    }
  });

  it('全库 354 条且 id 唯一', () => {
    expect(all).toHaveLength(354);
    expect(new Set(all.map(e => e.id)).size).toBe(354);
  });

  it('有历史：智能排序（rank），导出首条第一', () => {
    const result = filterAndSortExercises(all, EMPTY_FILTERS, '', true);
    expect(result[0].id).toBe(all[0].id);
  });

  it('新手态：降级热门排序（hotRank）', () => {
    const result = filterAndSortExercises(all, EMPTY_FILTERS, '', false);
    expect(result[0].hotRank).toBe(1);
  });

  it('搜索词非空时跨全库检索，忽略筛选维度', () => {
    const result = filterAndSortExercises(all, { types: ['cardio'], muscles: [], equipment: [] }, 'bench', true);
    expect(result.map(e => e.id)).toContain(findEn('Barbell Bench Press').id);
  });
});

describe('pickerLogic · 胶囊回显与行副标题', () => {
  it('类型胶囊回显：未选/单选/多选', () => {
    expect(summarizeTypeDim([])).toBe('所有类型');
    expect(summarizeTypeDim(['cardio'])).toBe('有氧');
    expect(summarizeTypeDim(['cardio', 'bodyweight'])).toBe('有氧等2项');
  });

  it('有氧行副标题显示时长语义', () => {
    const c = MOCK_EXERCISES.find(e => e.exerciseType === 'cardio')!;
    expect(rowSubtitle(c)).toBe(`建议 20分钟 · ${c.equipmentLabel}`);
  });

  it('力量行副标题显示目标肌群 + 器械中文', () => {
    const bench = findEn('Barbell Bench Press');
    expect(rowSubtitle(bench)).toBe(`${bench.muscles.join(' · ')} · ${bench.equipmentLabel}`);
  });
});

describe('pickerLogic · 参数摘要一行（合成建议）', () => {
  it('拉伸（固定合成）：2组×30秒 · RPE 4', () => {
    const ex = MOCK_EXERCISES.find(e => e.exerciseType === 'flexibility')!;
    const item = makeItem(ex.id);
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('2组×30秒 · RPE 4');
  });

  it('有氧（固定合成）：20分钟 · RPE 5', () => {
    const ex = MOCK_EXERCISES.find(e => e.exerciseType === 'cardio')!;
    const item = makeItem(ex.id);
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe('20分钟 · RPE 5');
  });

  it('自重合成：3组×10-12 · 自重 · RPE 按难度', () => {
    const ex = MOCK_EXERCISES.find(e => e.equipment === 'bodyweight')!;
    const item = makeItem(ex.id);
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe(`3组×10-12 · 自重 · RPE ${ex.suggestion.targetRpe}`);
  });

  it('杠铃力量合成（卧推）：热身+正式 → 区间负荷', () => {
    const bench = findEn('Barbell Bench Press');
    const item = makeItem(bench.id);
    expect(item.sets).toHaveLength(4);
    expect(item.sets[0].role).toBe('warmup');
    expect(formatParamSummary(item.exercise, item.sets, item.targetRpe)).toBe(
      `4组×8-12 · 30-60kg · RPE ${bench.suggestion.targetRpe}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 组件交互
// ---------------------------------------------------------------------------

describe('ExercisePickerModal · A8 主列表', () => {
  it('渲染列表 + 「常用」「为你推荐」徽标 + 近期的训练分区（全库前 3 模拟）', () => {
    render(<ExercisePickerModal onClose={() => {}} />);
    // Large Title + 折叠小标题同屏存在（滚动折叠机制）
    expect(screen.getAllByText('添加运动').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('近期的训练')).toBeInTheDocument();
    for (const id of RECENT_IDS) {
      expect(screen.getByText(byId(id).name)).toBeInTheDocument();
    }
    expect(screen.getAllByText('常用')).toHaveLength(3);
    expect(screen.getAllByText('为你推荐')).toHaveLength(MOCK_EXERCISES.filter(e => e.isRecommended).length);
  });

  it('行首为库3 3D 解剖封面（R2 缩略图），不渲染 free-exercise-db 真人照片源', () => {
    const { container } = render(<ExercisePickerModal onClose={() => {}} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(0);
    // 封面均为 R2 CDN 缩略图；v2 的 raw.githubusercontent 真人照片源不再被消费
    imgs.forEach(img => {
      expect(img.getAttribute('src')).not.toContain('raw.githubusercontent.com');
    });
    expect(container.querySelector('img[src*="r2.dev/exercise-posters/male"]')).not.toBeNull();
  });

  it('新手态：无「常用」徽标 + 引导卡 + 无近期分区', () => {
    render(<ExercisePickerModal hasHistory={false} onClose={() => {}} />);
    expect(screen.queryByText('常用')).not.toBeInTheDocument();
    expect(screen.getByText('初次训练，从热门开始')).toBeInTheDocument();
    expect(screen.queryByText('近期的训练')).not.toBeInTheDocument();
  });

  it('类型 Sheet：选「有氧」→ CTA 计数=库内有氧数 → 列表只剩有氧', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /所有类型/ }));
    const dialog = screen.getByRole('dialog', { name: '类型' });
    expect(within(dialog).getByRole('button', { name: '力量' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '有氧' }));

    const n = MOCK_EXERCISES.filter(e => e.exerciseType === 'cardio').length;
    await user.click(within(dialog).getByRole('button', { name: `显示 ${n} 个结果` }));

    // 应用后：非有氧首条消失，有氧首条在列
    const cardioFirst = MOCK_EXERCISES.find(e => e.exerciseType === 'cardio')!;
    const nonCardioFirst = MOCK_EXERCISES.find(e => e.exerciseType !== 'cardio')!;
    expect(screen.queryByLabelText(`选择 ${nonCardioFirst.name}`)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`选择 ${cardioFirst.name}`)).toBeInTheDocument();
  });

  it('肌肉 Sheet：分组小标题 + 选肌群过滤', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /所有肌肉/ }));
    const dialog = screen.getByRole('dialog', { name: '肌肉群' });
    // 派生分组含区域小标题
    expect(within(dialog).getByText('上肢')).toBeInTheDocument();
    // 选「胸部」肌群
    await user.click(within(dialog).getByRole('button', { name: '胸部' }));
    const n = MOCK_EXERCISES.filter(e => e.muscles.includes('胸部')).length;
    await user.click(within(dialog).getByRole('button', { name: `显示 ${n} 个结果` }));

    const chestFirst = MOCK_EXERCISES.find(e => e.muscles.includes('胸部'))!;
    const nonChest = MOCK_EXERCISES.find(e => !e.muscles.includes('胸部'))!;
    expect(screen.getByLabelText(`选择 ${chestFirst.name}`)).toBeInTheDocument();
    expect(screen.queryByLabelText(`选择 ${nonChest.name}`)).not.toBeInTheDocument();
  });

  it('器械 Sheet：清除筛选器复位胶囊与列表', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /所有器械/ }));
    const dialog = () => {
      const dialogs = screen.getAllByRole('dialog', { name: '器械' });
      return dialogs[dialogs.length - 1];
    };
    await user.click(within(dialog()).getByRole('button', { name: '杠铃' }));
    const n = MOCK_EXERCISES.filter(e => e.equipment === 'barbell').length;
    await user.click(within(dialog()).getByRole('button', { name: `显示 ${n} 个结果` }));
    const barbellFirst = MOCK_EXERCISES.find(e => e.equipment === 'barbell')!;
    const nonBarbell = MOCK_EXERCISES.find(e => e.equipment !== 'barbell' && !RECENT_IDS.includes(e.id))!;
    expect(screen.getByLabelText(`选择 ${barbellFirst.name}`)).toBeInTheDocument();
    expect(screen.queryByLabelText(`选择 ${nonBarbell.name}`)).not.toBeInTheDocument();

    // 重开器械 Sheet（胶囊回显「杠铃」）→ 清除筛选器 → 全量恢复
    const pill = screen.getAllByRole('button', { name: '杠铃' }).find(b => b.getAttribute('aria-haspopup') === 'dialog');
    await user.click(pill!);
    await user.click(within(dialog()).getByRole('button', { name: '清除筛选器' }));
    await user.click(within(dialog()).getByRole('button', { name: /显示 \d+ 个结果/ }));
    // 清除后恢复全量：用不在近期分区的非杠铃条目断言（近期置顶条目不重复出现在所有运动）
    const nonBarbellVisible = MOCK_EXERCISES.find(e => e.equipment !== 'barbell' && !RECENT_IDS.includes(e.id))!;
    expect(screen.getByLabelText(`选择 ${barbellFirst.name}`)).toBeInTheDocument();
    expect(screen.getByLabelText(`选择 ${nonBarbellVisible.name}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /所有器械/ })).toBeInTheDocument();
  });

  it('搜索兜底：中文命中 + 无结果空态', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    const zhTarget = MOCK_EXERCISES.find(e => e.name.includes('卧推'))!;
    await user.type(screen.getByPlaceholderText('搜索运动'), '卧推');
    expect(screen.getByLabelText(`选择 ${zhTarget.name}`)).toBeInTheDocument();
    // 搜索时近期分区隐藏
    expect(screen.queryByText('近期的训练')).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('搜索运动'));
    await user.type(screen.getByPlaceholderText('搜索运动'), 'zzzznope');
    expect(screen.getByText(/未找到/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除搜索与筛选' })).toBeInTheDocument();
  });

  it('9 类类型标签全部可用于清单页标注（TYPE_LABELS 全集）', () => {
    const types: PickerExerciseType[] = ['resistance', 'cardio', 'bodyweight', 'isometric', 'assisted', 'unilateral', 'weight_only', 'reps_only', 'outdoor', 'flexibility'];
    types.forEach(t => expect(TYPE_LABELS[t]).toBeTruthy());
  });
});

describe('ExercisePickerModal · A9 购物车多选', () => {
  it('行圈选连续添加不关弹窗，选中态以行高亮+缩略图角标表达（无独立复选框）', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    const a = byId(RECENT_IDS[0]);
    const b = byId(RECENT_IDS[1]);
    await user.click(screen.getByLabelText(`选择 ${a.name}`));
    expect(screen.getByText('已选', { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText(`选择 ${b.name}`)).toBeInTheDocument(); // 弹窗未关
    await user.click(screen.getByLabelText(`选择 ${b.name}`));
    expect(screen.getByText('2')).toBeInTheDocument();
    // 再点取消圈选
    await user.click(screen.getByLabelText(`取消选择 ${b.name}`));
    expect(screen.getByLabelText(`选择 ${b.name}`)).toBeInTheDocument();
    // 选中行不渲染独立 checkbox/radio 控件
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('ⓘ 教程入口：stopPropagation 不触发行圈选，打开教程 Sheet', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    const a = byId(RECENT_IDS[0]);
    await user.click(screen.getByLabelText(`教程 ${a.name}`));
    // 行未被圈选
    expect(screen.queryByText('已选', { exact: false })).not.toBeInTheDocument();
    // ExerciseTutorialModal 真组件已打开（其头部关闭钮是列表页没有的控件）
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    // 关闭教程（真组件有关闭退场动画，waitFor 等待卸载）
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument());
  });

  it('清单页独立卡片：短按进配置/长按拖拽语义分离 + 智能填充徽标 + 直接移除', async () => {
    const user = userEvent.setup();
    render(<ExercisePickerModal onClose={() => {}} />);
    const a = byId(RECENT_IDS[0]);
    const b = byId(RECENT_IDS[1]);
    await user.click(screen.getByLabelText(`选择 ${a.name}`));
    await user.click(screen.getByLabelText(`选择 ${b.name}`));
    await user.click(screen.getByRole('button', { name: '去配置' }));

    expect(screen.getByText('训练清单')).toBeInTheDocument();
    expect(screen.getByText(summaryOfItem({ exercise: a, sets: planToDraftSets(a.suggestion.sets), targetRpe: a.suggestion.targetRpe }))).toBeInTheDocument();

    // 箭头调序按钮已删除；编辑钮已删除（长按直接拖拽，iOS 惯例）
    expect(screen.queryByLabelText(/上移 |下移 /)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();

    // 智能填充轻提示徽标（B）：每张卡片都有
    expect(screen.getAllByText('智能填充').length).toBe(selectedCountOf([a, b]));

    // 行尾双钮并存：ⓘ 教程 + 红色移除（长按拖拽用整卡手势，无独立拖柄）
    expect(screen.getByLabelText(`教程 ${b.name}`)).toBeInTheDocument();
    await user.click(screen.getByLabelText(`移除 ${b.name}`));
    expect(screen.queryByLabelText(`配置 ${b.name}`)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`配置 ${a.name}`)).toBeInTheDocument();
  });

  it('选满 9 个出现琥珀色软提示', () => {
    const ids = MOCK_EXERCISES.slice(0, 9).map(e => e.id);
    render(<ExercisePickerModal defaultSelectedIds={ids} onClose={() => {}} />);
    expect(screen.getByText(/单次训练建议不超过 8 个/)).toBeInTheDocument();
  });

  it('红线自查：界面不出现「统一」「每组不同」，列表不渲染真人图 URL', () => {
    render(<ExercisePickerModal defaultSelectedIds={[RECENT_IDS[0]]} initialScreen="cart" onClose={() => {}} />);
    const banned = new RegExp('统' + '一|每' + '组不同');
    expect(screen.queryByText(banned)).not.toBeInTheDocument();
    expect(document.body.querySelector('img')).toBeNull();
  });
});

describe('PickerConfigSheet · 参数配置（嵌套真实 ExerciseSettingsModal + 两个增量挂载点）', () => {
  const setupSheet = () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const bench = findEn('Barbell Bench Press');
    render(<PickerConfigSheet item={makeItem(bench.id)} onChange={onChange} onClose={() => {}} />);
    return { user, onChange, bench };
  };

  it('渲染真实面板主体区块 + 建议徽标（真组件复用，非自造形态）', () => {
    setupSheet();
    expect(screen.getByText('目标强度')).toBeInTheDocument();
    expect(screen.getByText('训练组安排')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /动作库/ })).toBeInTheDocument();
    // 真实面板的建议来源徽标（合成口径=本地估算）
    expect(screen.getAllByText(/本地估算/).length).toBeGreaterThan(0);
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

  it('增量点：组类型标注 chip → 行内选择条改「递增」→ 保存回写清单', async () => {
    const { user, onChange, bench } = setupSheet();
    // 合成建议含热身/正式
    expect(screen.getAllByText('热身').length).toBeGreaterThan(0);
    expect(screen.getAllByText('正式').length).toBeGreaterThan(0);

    // 点 chip → 该组行正下方展开 inline 选择条（v4：不再弹底部选择条）
    expect(screen.queryByRole('group', { name: '第 1 组类型选择' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('第 1 组类型：热身'));
    const strip = screen.getByRole('group', { name: '第 1 组类型选择' });
    await user.click(within(strip).getByRole('button', { name: '递增' }));
    expect(screen.getByLabelText('第 1 组类型：递增')).toBeInTheDocument();
    // 选择后收起
    expect(screen.queryByRole('group', { name: '第 1 组类型选择' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认添加动作' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0][0] as PickerSelectionItem;
    expect(saved.sets).toHaveLength(4);
    expect(saved.sets[0].role).toBe('rampUp');
    expect(saved.targetRpe).toBe(bench.suggestion.targetRpe);
  });
});
