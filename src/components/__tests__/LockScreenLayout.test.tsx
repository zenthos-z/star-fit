/**
 * LockScreen 区带布局 + 主钮同位 + 动作预览图组件测试（#127）
 *
 * issue #127 真机反馈：完成组进入休息态时两个白色大按钮上浮且与信息窗重叠交错。
 * 修复 = 三区带 flex 布局（信息带 flex-1 与按钮带 flex-none 恒高 172 几何互斥）
 * + 主按钮恒压底（训练/休息/倒计时三态主钮底边恒定）+ 库3 R2 封面动作预览小图。
 *
 * 断言口径「布局参数级」：jsdom 无排版引擎（offsetTop 恒 0），故锁定产生几何的
 * 布局参数本身——恒高带（height:172）+ 底对齐（justify-end）+ 主钮为栈末子节点。
 * 两态主钮同槽 = 同一恒高底对齐带内的「最后一个 h-92 子节点」，由构造保证同位。
 */
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LockScreen, { resolveExerciseThumb } from '../execution/LockScreen';
import type { Exercise } from '../../types/legacy';

// 库3 真实条目（pickerLibraryData 首条，R2 封面在库）：命中分支用真 id
const LIB_ID = 'a3v2OcKBQXOkJMXQhaqOZ'; // 悬垂举腿抬髋

const baseProps = {
  status: 'active' as const,
  startTime: Date.now() - 300_000,
  pausedDuration: 0,
  sessionId: 'sess-1',
  onExit: vi.fn(),
  onCompleteSet: vi.fn(),
  onFinishCountdown: vi.fn(),
  onEndRest: vi.fn(),
  onExtendRest: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onEnd: vi.fn(),
};

const mkExercise = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'ex-current',
  libraryId: 'ex-current',
  name: '卧推',
  type: 'resistance',
  sets: [
    { id: 's1', reps: 10, weight: 40, completed: false, status: 'PLANNED' },
    { id: 's2', reps: 10, weight: 40, completed: true, status: 'COMPLETED' },
  ],
  ...over,
});

const getBand = () =>
  document.body.querySelector('[data-testid="lock-button-band"]') as HTMLElement | null;
const getStack = () =>
  document.body.querySelector('[data-testid="lock-button-stack"]') as HTMLElement | null;

/** 区带布局契约：按钮带恒高 172 + 底锚 + 根容器 flex 列（信息带/按钮带互斥区带） */
const expectBandContract = () => {
  const band = getBand();
  expect(band).not.toBeNull();
  expect(band!.style.height).toBe('172px');
  expect(band!.style.marginBottom).toContain('safe-bottom');
  expect(band!.style.marginBottom).toContain('170px');
  // 根容器 flex-col：三带为顺序 flex 子节点 → 带间几何互斥（不重叠的构造性保证）
  expect(band!.parentElement!.className).toContain('flex-col');
  const infoBand = document.body.querySelector('[data-testid="lock-info-band"]') as HTMLElement;
  expect(infoBand.className).toContain('flex-1');
};

describe('LockScreen #127 · 主钮同位（布局参数级）', () => {
  it('训练态（confirm）：恒高底对齐带 + 单主钮占底槽', () => {
    render(<LockScreen {...baseProps} exercises={[mkExercise()]} />);

    expectBandContract();
    expect(screen.getByText('完成第 1 组')).toBeInTheDocument();

    const stack = getStack()!;
    expect(stack.children.length).toBe(1);
    // 主钮 = 白色大钮容器（h-92），是栈内唯一节点 → 底对齐带内压底
    expect(stack.firstElementChild!.className).toContain('h-[92px]');
    // 内容底对齐：栈的父级（172 恒高层）justify-end
    const aligner = stack.parentElement as HTMLElement;
    expect(aligner.style.height).toBe('172px');
    expect(aligner.style.justifyContent).toBe('flex-end');
  });

  it('休息态：主钮「结束休息」压底（与训练态主钮同槽），「+10 秒」向上生长', () => {
    const restEx = mkExercise({
      id: 'ex-rest',
      libraryId: 'ex-rest',
      sets: [
        { id: 's1', completed: true, status: 'COMPLETED', restEndTime: Date.now() + 60_000 },
      ],
    });
    render(<LockScreen {...baseProps} exercises={[restEx]} />);

    expectBandContract();
    const stack = getStack()!;
    expect(stack.children.length).toBe(2);
    // 次序 = 几何：副钮（h-64）在上、主钮（h-92）在末 → 同一恒高底对齐带内，
    // 末位 h-92 的底边 = 带底 = 训练态单主钮的底边（同位由构造保证）
    expect(stack.children[0].className).toContain('h-[64px]');
    expect(stack.children[1].className).toContain('h-[92px]');
    expect(within(stack.children[0] as HTMLElement).getByText('+10 秒')).toBeInTheDocument();
    expect(within(stack.children[1] as HTMLElement).getByText('结束休息')).toBeInTheDocument();
  });

  it('倒计时待启动态：单主钮占底槽（同训练态形态）', () => {
    const cdEx = mkExercise({
      type: 'isometric',
      sets: [{ id: 's1', targetDuration: 30, completed: false, status: 'PLANNED' }],
    });
    render(<LockScreen {...baseProps} exercises={[cdEx]} />);
    const stack = getStack()!;
    expect(stack.children.length).toBe(1);
    expect(stack.firstElementChild!.className).toContain('h-[92px]');
    expect(screen.getByText(/开始第 1 组/)).toBeInTheDocument();
  });
});

describe('LockScreen #127 · 动作预览图（三分支）', () => {
  it('分支① 库内动作有图：运动态名行渲染 R2 封面小图', () => {
    render(
      <LockScreen
        {...baseProps}
        exercises={[mkExercise({ id: LIB_ID, libraryId: LIB_ID, name: '悬垂举腿抬髋' })]}
      />
    );
    const img = document.body.querySelector('img[data-testid="action-thumb"]') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('r2.dev/exercise-posters/');
    expect(document.body.querySelector('[data-testid="action-thumb-placeholder"]')).toBeNull();
  });

  it('分支② 库外动作无图：首字占位，不渲染 img（禁空白塌陷）', () => {
    render(<LockScreen {...baseProps} exercises={[mkExercise({ id: 'custom-x', name: '卧推' })]} />);
    expect(document.body.querySelector('img[data-testid="action-thumb"]')).toBeNull();
    const ph = document.body.querySelector('[data-testid="action-thumb-placeholder"]');
    expect(ph).not.toBeNull();
    expect(ph!.textContent).toBe('卧');
  });

  it('分支③ 有图但加载失败：onError 回退首字占位', () => {
    render(
      <LockScreen
        {...baseProps}
        exercises={[mkExercise({ id: LIB_ID, libraryId: LIB_ID, name: '悬垂举腿抬髋' })]}
      />
    );
    const img = document.body.querySelector('img[data-testid="action-thumb"]') as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(document.body.querySelector('img[data-testid="action-thumb"]')).toBeNull();
    const ph = document.body.querySelector('[data-testid="action-thumb-placeholder"]');
    expect(ph).not.toBeNull();
    expect(ph!.textContent).toBe('悬');
  });

  it('休息态：下一动作预览小图渲染在「接下来」行；无下一动作则整行不出现', () => {
    const restEx = mkExercise({
      id: 'ex-rest',
      libraryId: 'ex-rest',
      name: '卧推',
      sets: [
        { id: 's1', completed: true, status: 'COMPLETED', restEndTime: Date.now() + 60_000 },
      ],
    });
    const nextEx = mkExercise({ id: LIB_ID, libraryId: LIB_ID, name: '悬垂举腿抬髋' });

    const { unmount } = render(<LockScreen {...baseProps} exercises={[restEx, nextEx]} />);
    const row = document.body.querySelector('[data-testid="lock-next-preview"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('img[data-testid="action-thumb"]')).not.toBeNull();
    expect(within(row).getByText(/接下来/)).toBeInTheDocument();
    // 休息态当前动作名行不重复放当前图（预览归下一动作）
    unmount();

    // 单动作休完 = 无下一动作：整行不渲染（无图也绝不留空洞）
    render(<LockScreen {...baseProps} exercises={[restEx]} />);
    expect(document.body.querySelector('[data-testid="lock-next-preview"]')).toBeNull();
  });

  it('resolveExerciseThumb：metadata 直供只放行 R2 域，非 R2 URL 拒收', () => {
    expect(
      resolveExerciseThumb({
        id: 'x', libraryId: 'x', name: 'x', type: 'resistance', sets: [],
        metadata: { thumbnail: 'https://pub-585d42eb1aa64a67aedf483ec328d3fe.r2.dev/exercise-posters/male/foo.jpg' },
      } as Exercise)
    ).toContain('r2.dev/exercise-posters/');
    // 库1 真人照 URL（用户拍板不要）即便混入 metadata 也不准入
    expect(
      resolveExerciseThumb({
        id: 'x', libraryId: 'x', name: 'x', type: 'resistance', sets: [],
        metadata: { thumbnail: 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Box_Skip/0.jpg' },
      } as Exercise)
    ).toBe('');
    expect(resolveExerciseThumb(undefined)).toBe('');
  });
});
