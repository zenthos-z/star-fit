/**
 * PlanDayDetailPage 组件测试（T10/#67 重做 + #81 教程缩略图入口）。
 *
 * 覆盖：
 * - 计划说明区：rationale 在位渲染「计划说明」；缺省整区隐藏（旧计划不炸）
 * - 三段式分组：热身动作 / 正式动作 / 收尾动作（拉伸）固定段序，空段省略
 * - 逐组参数：T9 sets 在位逐组独立行（60 kg × 8 次，不折叠）；无配重行 RPE 作负荷锚
 * - 旧计划回落：category 全 main 单段、等参数块折叠「第 1–N 组」、无说明区
 * - 休息日：弱化卡，无动作分组
 * - #81 卡头缩略图：点按开教程 Sheet（详情页独立实例）/ 无 poster 降级哑铃
 *   仍可点 / 无 exerciseId 整块不渲染退回纯文字 / 44×44 恒定（不同组数对比）
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, afterEach } from 'vitest';
import { PlanDayDetailPage } from '../PlanDayDetailPage';
import type { PlanDayDetailVM } from '../../../utils/weeklyPlanView';

// 原生触感 / tab bar / 动作库索引在 jsdom 下不可用 —— 挂桩为空实现
vi.mock('../../../lib/nativeHaptics', () => ({ haptic: vi.fn() }));
vi.mock('../../../lib/nativeTabBar', () => ({ setTabBarHidden: vi.fn() }));
vi.mock('../../../hooks/useExerciseLibraryIndex', () => ({
  useExerciseLibraryIndex: () => ({ byId: new Map(), byName: new Map() }),
}));

/** T9 结构化日：三段式 + 逐组处方 + rationale */
function structuredVM(): PlanDayDetailVM {
  return {
    entryDate: '2026-09-25',
    title: '周五 · 推拉腿',
    metaLine: '2026-W40 · 推拉腿',
    rationale: '腿日安排在力量块中段，主项按 60→65kg 递增；注意蹲深。',
    rest: false,
    exercises: [
      { exerciseId: 'e0', name: '髋部动态热身', category: 'warmup', sets: [{ setNo: 1, reps: 10, rpe: 5 }] },
      {
        exerciseId: 'e1',
        name: '杠铃深蹲',
        category: 'main',
        sets: [
          { setNo: 1, weightKg: 60, reps: 8, rpe: 7 },
          { setNo: 2, weightKg: 65, reps: 6, rpe: 8 },
        ],
      },
      { exerciseId: 'e2', name: '股四头肌静态拉伸', category: 'cooldown', sets: [{ setNo: 1, reps: 30, rpe: 4 }] },
    ],
  };
}

/** 旧计划日：无 rationale、全 main 段、等参数区间文案（可折叠） */
function legacyVM(): PlanDayDetailVM {
  return {
    entryDate: '2026-09-25',
    title: '周五 · 推拉腿',
    rest: false,
    exercises: [
      {
        exerciseId: 'e1',
        name: '杠铃深蹲',
        category: 'main',
        sets: [
          { setNo: 1, loadText: 'RPE 7–8' },
          { setNo: 2, loadText: 'RPE 7–8' },
          { setNo: 3, loadText: 'RPE 7–8' },
        ],
      },
    ],
  };
}

describe('PlanDayDetailPage（T10/#67）', () => {
  it('T9 计划：说明区渲染 rationale，三段式分组齐全', () => {
    render(<PlanDayDetailPage detail={structuredVM()} onClose={() => undefined} />);
    expect(screen.getByLabelText('计划说明')).toBeDefined();
    expect(screen.getByText(/60→65kg 递增/)).toBeDefined();
    expect(screen.getByText('热身动作')).toBeDefined();
    expect(screen.getByText('正式动作')).toBeDefined();
    expect(screen.getByText('收尾动作（拉伸）')).toBeDefined();
  });

  it('T9 计划：逐组独立行（60 kg × 8 / 65 kg × 6），不折叠', () => {
    render(<PlanDayDetailPage detail={structuredVM()} onClose={() => undefined} />);
    // 深蹲两行组号独立（第 1 / 第 2 组），配重与次数逐一出现
    expect(screen.getByText('60')).toBeDefined();
    expect(screen.getByText('65')).toBeDefined();
    expect(screen.getByText('8')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
    expect(screen.getByText('第 2 组')).toBeDefined();
    // 旧式折叠行不应出现（逐组处方永不折叠）
    expect(screen.queryByText(/第 1–\d+ 组/)).toBeNull();
  });

  it('无配重行（热身/拉伸）：RPE 作负荷锚展示', () => {
    render(<PlanDayDetailPage detail={structuredVM()} onClose={() => undefined} />);
    expect(screen.getByText('RPE 5')).toBeDefined();
    expect(screen.getByText('RPE 4')).toBeDefined();
  });

  it('旧计划回落：无说明区、单 main 段、等参数块折叠为「第 1–3 组」', () => {
    render(<PlanDayDetailPage detail={legacyVM()} onClose={() => undefined} />);
    expect(screen.queryByLabelText('计划说明')).toBeNull();
    // 空段省略：只余正式动作段
    expect(screen.getByText('正式动作')).toBeDefined();
    expect(screen.queryByText('热身动作')).toBeNull();
    expect(screen.queryByText('收尾动作（拉伸）')).toBeNull();
    // 等参数块折叠单行，不逐组展开
    expect(screen.getByText('第 1–3 组')).toBeDefined();
    expect(screen.queryByText('第 2 组')).toBeNull();
    expect(screen.getByText('RPE 7–8')).toBeDefined();
  });

  it('休息日：弱化卡，无说明区与动作分组', () => {
    const rest: PlanDayDetailVM = {
      entryDate: '2026-09-26',
      title: '周六',
      rest: true,
      exercises: [],
    };
    render(<PlanDayDetailPage detail={rest} onClose={() => undefined} />);
    expect(screen.getByText('休息恢复')).toBeDefined();
    expect(screen.queryByLabelText('计划说明')).toBeNull();
    expect(screen.queryByText('正式动作')).toBeNull();
  });

  it('detail=null → 不渲染（AnimatePresence 关闭态）', () => {
    render(<PlanDayDetailPage detail={null} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ============================================================================
// #81 卡头教程缩略图入口
// ============================================================================

/** 教程数据链桩：按 exerciseId 约定 poster 响应；未约定的 id 一律无封面 */
function stubTutorialFetch(posterById: Record<string, string | null> = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(posterById).find(([id]) => url.includes(`/exercises/${id}`));
    return {
      ok: true,
      json: async () => ({ poster_url: hit ? hit[1] : null }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** 单动作日 VM（exerciseId 可选；组数可调，用于尺寸恒定对比） */
function singleExerciseVM(opts: {
  exerciseId?: string;
  name: string;
  setCount: number;
}): PlanDayDetailVM {
  return {
    entryDate: '2026-09-25',
    title: '周五 · 腿',
    rest: false,
    exercises: [
      {
        ...(opts.exerciseId ? { exerciseId: opts.exerciseId } : {}),
        name: opts.name,
        category: 'main',
        sets: Array.from({ length: opts.setCount }, (_, i) => ({
          setNo: i + 1,
          weightKg: 60 + i * 5,
          reps: 8 - i,
        })),
      },
    ],
  };
}

describe('PlanDayDetailPage #81 卡头教程缩略图', () => {
  beforeEach(() => {
    // 模块级 poster 缓存跨用例共享 → 各用例 exerciseId 全局唯一；fetch 统一收口防漏网请求
    stubTutorialFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('卡头缩略图存在（44×44 radius-10），点按打开教程 Sheet（详情页独立实例）', async () => {
    const user = userEvent.setup();
    const fetchMock = stubTutorialFetch({ px1: 'https://cdn.example.com/poster-px1.jpg' });
    render(
      <PlanDayDetailPage detail={singleExerciseVM({ exerciseId: 'px1', name: '杠铃深蹲', setCount: 3 })} onClose={() => undefined} />,
    );
    // 封面帧沿既有教程数据链拉取（GET /api/exercises/:id，不另造请求路径）
    // 页面经 portal 挂 document.body → 查询走 document 全局，不能用 render().container
    await waitFor(() => expect(document.body.querySelector('img[src*="poster-px1"]')).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/exercises/px1'), expect.anything());
    // 缩略图视觉盒 44×44 + radius-10
    const box = screen.getByTestId('thumb-box');
    expect(box.className).toContain('h-11 w-11');
    expect(box.className).toContain('rounded-[10px]');
    // 点按热区外扩 6px（44 → 56）
    expect(box.parentElement!.className).toContain('after:-inset-1.5');
    // 点按打开教程 Sheet：ExerciseTutorialModal 头部关闭钮出现（主页返回链之外）
    await user.click(screen.getByLabelText('查看「杠铃深蹲」教程'));
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    // Sheet 标题即动作显示名
    expect(screen.getAllByText('杠铃深蹲').length).toBeGreaterThan(1);
  });

  it('无 poster → gray-50 底+哑铃灰标降级，点击仍进教程；拉取中为静态骨架', async () => {
    const user = userEvent.setup();
    let resolveFetch: (v: unknown) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => new Promise((res) => { resolveFetch = res; })));
    render(
      <PlanDayDetailPage detail={singleExerciseVM({ exerciseId: 'px2', name: '腿举', setCount: 1 })} onClose={() => undefined} />,
    );
    // 拉取中：静态骨架灰底（gray-100），无 img 无降级图标，不闪跳
    const box = screen.getByTestId('thumb-box');
    expect(box.className).toContain('bg-gray-100');
    expect(document.body.querySelector('img')).toBeNull();
    // 确认无封面 → gray-50 + 哑铃占位
    resolveFetch({ ok: true, json: async () => ({ poster_url: null }) });
    await waitFor(() => expect(box.className).toContain('bg-gray-50'));
    expect(document.body.querySelector('img')).toBeNull();
    expect(box.querySelector('svg path')).not.toBeNull();
    // 降级态仍可点进教程
    await user.click(screen.getByLabelText('查看「腿举」教程'));
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('旧计划无 exerciseId → 缩略图整块不渲染，卡头退回现状纯文字', () => {
    render(
      <PlanDayDetailPage detail={singleExerciseVM({ name: '山羊挺身', setCount: 2 })} onClose={() => undefined} />,
    );
    expect(screen.queryByLabelText('查看「山羊挺身」教程')).toBeNull();
    expect(document.body.querySelector('[data-testid="thumb-box"]')).toBeNull();
    // 卡头无固定 48px 行高（退回 pb-2.5 自然行高），名称与组数徽标照常展示
    expect(screen.getByText('山羊挺身')).toBeInTheDocument();
    expect(screen.getByText('2 组')).toBeInTheDocument();
  });

  it('44×44 恒定：1 组与 3 组动作的缩略图视觉盒类名逐字一致', () => {
    render(
      <PlanDayDetailPage
        detail={{
          entryDate: '2026-09-25',
          title: '周五 · 腿',
          rest: false,
          exercises: [
            { exerciseId: 'px4a', name: '髋铰链热身', category: 'warmup', sets: [{ setNo: 1, reps: 10, rpe: 5 }] },
            {
              exerciseId: 'px4b',
              name: '杠铃深蹲',
              category: 'main',
              sets: [
                { setNo: 1, weightKg: 60, reps: 8 },
                { setNo: 2, weightKg: 65, reps: 6 },
                { setNo: 3, weightKg: 70, reps: 5 },
              ],
            },
          ],
        }}
        onClose={() => undefined}
      />,
    );
    const boxes = screen.getAllByTestId('thumb-box');
    expect(boxes).toHaveLength(2);
    // 尺寸/圆角类名逐字一致——卡高随组数变化，缩略图永远 44×44 radius-10
    const sizeClass = (el: HTMLElement) => el.className.match(/h-11 w-11|rounded-\[10px\]/g)?.sort().join(' ');
    expect(sizeClass(boxes[0])).toBe('h-11 w-11 rounded-[10px]');
    expect(sizeClass(boxes[0])).toBe(sizeClass(boxes[1]));
  });
});
