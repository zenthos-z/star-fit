import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import FeelModal from '../FeelModal';
import type { FeelModalTarget, FeelConfirmPatch } from '../feelGate';
import { ExerciseSetEntrySchema } from 'shared/contracts';

/**
 * 组后感受聚合表单测试（issue #98 v2，2026-10-01 重设计）：
 * - N 行聚合渲染：每行一条滑块（等宽组号徽章 + 参数摘要），已填组回显、未填默认 50
 * - 批量确认：右上角对勾一次提交全部行（exId+setId+feel 定位写回，payload 过契约校验）
 * - 动作级语义补充：语音/文本 note 只写收尾组 feel_note（≤500 契约约束），空 note 不写字段
 * - 跳过路径：点外部区域 = 跳过，不写任何字段直接关（onSkip 且 onConfirm 不触发）
 * - 结算闸门形态（gate）：只列未填组、分组展示、无补充输入；[补完并结束]/[跳过] 两分支
 * - 语音按钮：触发转写链路（权限→启动→partial 轮询回填→停止取最终文本），
 *   mock 的是 @ 对话框同源 speechInput 模块；web（不支持）时入口隐藏
 * - 卸载兜底清理录音会话
 * 纯函数层（触发判定/闸门扫描/批量写回）另见 feelGate.test.ts。
 */

// speechInput 是 Capacitor 桥模块（jsdom 为 web 环境全 null），整体 mock 掉；
// isSpeechInputSupported 做成可变属性：iOS 态测试置 true，web 态测试置 false
const speechMocks = vi.hoisted(() => ({
  isSpeechInputSupported: true,
  requestSpeechPermissions: vi.fn(),
  startSpeechInput: vi.fn(),
  stopSpeechInput: vi.fn(),
  cancelSpeechInput: vi.fn(),
  getSpeechPartial: vi.fn(),
}));

vi.mock('../../../lib/speechInput', () => speechMocks);

/** 3 组动作、第 1 组已填 70（回显），第 2/3 组未填（默认 50） */
const actionTarget: FeelModalTarget = {
  mode: 'action',
  groups: [{
    exId: 'ex-1',
    exName: '杠铃卧推',
    sets: [
      { setId: 'set-1', setNo: 1, weight: 60, reps: 8, feel: 70 },
      { setId: 'set-2', setNo: 2, weight: 60, reps: 8 },
      { setId: 'set-3', setNo: 3, weight: 60, reps: 8 },
    ],
  }],
};

/** 闸门目标：两个动作各一组未填（分组展示语义） */
const gateTarget: FeelModalTarget = {
  mode: 'gate',
  groups: [
    { exId: 'ex-1', exName: '杠铃卧推', sets: [{ setId: 'set-2', setNo: 2, weight: 60, reps: 8 }] },
    { exId: 'ex-2', exName: '杠铃划船', sets: [{ setId: 'set-b1', setNo: 1, weight: 40, reps: 10 }] },
  ],
};

const renderModal = (target: FeelModalTarget, onConfirm = vi.fn(), onSkip = vi.fn()) => {
  const utils = render(<FeelModal target={target} onConfirm={onConfirm} onSkip={onSkip} />);
  return { onConfirm, onSkip, ...utils };
};

const getSliders = (utils: ReturnType<typeof renderModal>) =>
  utils.getAllByRole('slider') as HTMLInputElement[];

/** 把第 n 条滑块（1-based）拖到指定值 */
const dragRow = (utils: ReturnType<typeof renderModal>, rowNo: number, value: number) => {
  act(() => {
    fireEvent.change(getSliders(utils)[rowNo - 1], { target: { value: String(value) } });
  });
};

const confirmAction = (utils: ReturnType<typeof renderModal>) => {
  act(() => {
    fireEvent.click(utils.getByRole('button', { name: '确认记录全部组感受' }));
  });
  return utils.onConfirm.mock.calls[0][0] as FeelConfirmPatch[];
};

/** 契约绑定校验：feel/feel_note 子集必须过 ExerciseSetEntrySchema（0-100 int / ≤500 字符） */
const expectContractValid = (patch: FeelConfirmPatch) => {
  const parsed = ExerciseSetEntrySchema.pick({ feel: true, feel_note: true }).safeParse(patch);
  expect(parsed.success).toBe(true);
};

describe('FeelModal（组后感受聚合表单 #98 v2）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    speechMocks.isSpeechInputSupported = true;
    speechMocks.requestSpeechPermissions.mockReset().mockResolvedValue({ speech: 'granted', mic: 'granted' });
    speechMocks.startSpeechInput.mockReset().mockResolvedValue(true);
    speechMocks.stopSpeechInput.mockReset().mockResolvedValue('');
    speechMocks.cancelSpeechInput.mockReset().mockResolvedValue(undefined);
    speechMocks.getSpeechPartial.mockReset().mockResolvedValue({ text: '', running: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('聚合渲染（N 行滑块）', () => {
    it('动作全部组各一行滑块，等宽组号徽章 + 参数摘要齐备', () => {
      const utils = renderModal(actionTarget);
      expect(getSliders(utils)).toHaveLength(3);
      expect(utils.getByText('01')).toBeTruthy();
      expect(utils.getByText('02')).toBeTruthy();
      expect(utils.getByText('03')).toBeTruthy();
      expect(utils.getAllByText('60kg × 8次')).toHaveLength(3);
    });

    it('已填组回显原值，未填组默认 50', () => {
      const utils = renderModal(actionTarget);
      const sliders = getSliders(utils);
      expect(sliders[0].value).toBe('70');
      expect(sliders[1].value).toBe('50');
      expect(sliders[2].value).toBe('50');
    });

    it('闭区间端点 0/100 拖动后原值写回（契约红线）', () => {
      const utils = renderModal(actionTarget);
      dragRow(utils, 2, 0);
      dragRow(utils, 3, 100);
      const patches = confirmAction(utils);
      expect(patches.find(p => p.setId === 'set-2')?.feel).toBe(0);
      expect(patches.find(p => p.setId === 'set-3')?.feel).toBe(100);
    });
  });

  describe('批量确认（一次写回全部行）', () => {
    it('确认 → onConfirm 收到全部 N 行补丁，exId+setId 定位，拖动值生效，payload 过契约校验', () => {
      const utils = renderModal(actionTarget);
      dragRow(utils, 2, 73);
      const patches = confirmAction(utils);
      expect(patches).toHaveLength(3);
      expect(patches.map(p => p.setId)).toEqual(['set-1', 'set-2', 'set-3']);
      expect(patches[0]).toMatchObject({ exId: 'ex-1', setId: 'set-1', feel: 70 }); // 已填组原值回写
      expect(patches[1]).toMatchObject({ exId: 'ex-1', setId: 'set-2', feel: 73 });
      patches.forEach(expectContractValid);
    });

    it('未拖动的行提交默认 50（聚合补记语义）', () => {
      const utils = renderModal(actionTarget);
      const patches = confirmAction(utils);
      expect(patches.map(p => p.feel)).toEqual([70, 50, 50]);
    });

    it('语义补充只写收尾组 feel_note，原样携带且过契约校验', () => {
      const utils = renderModal(actionTarget);
      act(() => {
        fireEvent.change(utils.getByLabelText('感受补充说明'), {
          target: { value: '左肩有点疼，力量比上周大' },
        });
      });
      dragRow(utils, 3, 42);
      const patches = confirmAction(utils);
      expect(patches[0].feel_note).toBeUndefined();
      expect(patches[1].feel_note).toBeUndefined();
      expect(patches[2]).toEqual({ exId: 'ex-1', setId: 'set-3', feel: 42, feel_note: '左肩有点疼，力量比上周大' });
      patches.forEach(expectContractValid);
    });

    it('空补充 → 任何行都不写 feel_note 字段（undefined 语义，非空串）', () => {
      const utils = renderModal(actionTarget);
      const patches = confirmAction(utils);
      patches.forEach(p => expect('feel_note' in p).toBe(false));
    });
  });

  describe('跳过路径（点外部区域 = 跳过，不填不劣待）', () => {
    it('点暗场 → onSkip 触发、onConfirm 不触发（未确认的拖动全部丢弃）', () => {
      const utils = renderModal(actionTarget);
      dragRow(utils, 1, 88);
      act(() => {
        fireEvent.click(utils.getByTestId('feel-backdrop'));
      });
      expect(utils.onSkip).toHaveBeenCalledTimes(1);
      expect(utils.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('结算闸门形态（gate）', () => {
    it('只列未填组并按动作分组展示；无补充输入、无右上角对勾', () => {
      const utils = renderModal(gateTarget);
      expect(getSliders(utils)).toHaveLength(2);
      expect(utils.getByText('杠铃卧推')).toBeTruthy();
      expect(utils.getByText('杠铃划船')).toBeTruthy();
      expect(utils.queryByLabelText('感受补充说明')).toBeNull();
      expect(utils.queryByRole('button', { name: '确认记录全部组感受' })).toBeNull();
    });

    it('[补完并结束] → onConfirm 收到全部未填组补丁（不含 feel_note）', () => {
      const utils = renderModal(gateTarget);
      dragRow(utils, 1, 65);
      act(() => {
        fireEvent.click(utils.getByRole('button', { name: '补完并结束' }));
      });
      expect(utils.onConfirm).toHaveBeenCalledTimes(1);
      const patches = utils.onConfirm.mock.calls[0][0] as FeelConfirmPatch[];
      expect(patches).toEqual([
        { exId: 'ex-1', setId: 'set-2', feel: 65 },
        { exId: 'ex-2', setId: 'set-b1', feel: 50 },
      ]);
      patches.forEach(expectContractValid);
    });

    it('[跳过] → onSkip 触发、onConfirm 不触发（不写任何字段直接结算）', () => {
      const utils = renderModal(gateTarget);
      dragRow(utils, 2, 30);
      act(() => {
        fireEvent.click(utils.getByRole('button', { name: '跳过' }));
      });
      expect(utils.onSkip).toHaveBeenCalledTimes(1);
      expect(utils.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('语音转文本（复用 @ 对话框 speechInput 链路）', () => {
    const getNote = (utils: ReturnType<typeof renderModal>) =>
      utils.getByLabelText('感受补充说明') as HTMLTextAreaElement;
    const getMic = (utils: ReturnType<typeof renderModal>) =>
      utils.getByRole('button', { name: '语音输入' });

    it('点麦克风 → 要权限并启动识别，进入聆听态', async () => {
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      expect(speechMocks.requestSpeechPermissions).toHaveBeenCalledTimes(1);
      expect(speechMocks.startSpeechInput).toHaveBeenCalledWith('zh-CN');
      // 聆听态：placeholder 变化 + 按钮语义切换为停止
      expect(getNote(utils).placeholder).toBe('正在聆听…');
      expect(utils.getByRole('button', { name: '停止语音输入' })).toBeTruthy();
    });

    it('partial 轮询回填输入框，停止后取最终文本，确认时落入收尾组 feel_note', async () => {
      speechMocks.getSpeechPartial.mockResolvedValue({ text: '左肩有点疼', running: true });
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      // 350ms 轮询拿到中间结果回填
      await act(async () => {
        vi.advanceTimersByTime(360);
      });
      expect(getNote(utils).value).toBe('左肩有点疼');
      // 停止：最终文本与 partial 一致，不重复追加
      speechMocks.stopSpeechInput.mockResolvedValue('左肩有点疼');
      await act(async () => {
        fireEvent.click(utils.getByRole('button', { name: '停止语音输入' }));
      });
      expect(speechMocks.stopSpeechInput).toHaveBeenCalledTimes(1);
      expect(getNote(utils).value).toBe('左肩有点疼');
      // 确认：feel_note 带上转写文本（收尾组）
      dragRow(utils, 3, 35);
      const patches = confirmAction(utils);
      expect(patches[2].feel_note).toBe('左肩有点疼');
      patches.forEach(expectContractValid);
    });

    it('聆听中确认 → 先停识别再提交（录音资源不挂着）', async () => {
      speechMocks.getSpeechPartial.mockResolvedValue({ text: '太重了', running: true });
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      await act(async () => {
        vi.advanceTimersByTime(360);
      });
      act(() => {
        fireEvent.click(utils.getByRole('button', { name: '确认记录全部组感受' }));
      });
      expect(speechMocks.stopSpeechInput).toHaveBeenCalledTimes(1);
      expect(utils.onConfirm).toHaveBeenCalledTimes(1);
      const patches = utils.onConfirm.mock.calls[0][0] as FeelConfirmPatch[];
      expect(patches[2].feel_note).toBe('太重了');
    });

    it('web（不支持 STT）语音入口隐藏——与 @ 对话框同规则', () => {
      speechMocks.isSpeechInputSupported = false;
      const utils = renderModal(actionTarget);
      expect(utils.queryByRole('button', { name: '语音输入' })).toBeNull();
    });

    it('权限被拒 → 不启动识别、不进聆听态', async () => {
      speechMocks.requestSpeechPermissions.mockResolvedValue({ speech: 'denied', mic: 'denied' });
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      expect(speechMocks.startSpeechInput).not.toHaveBeenCalled();
      expect(getNote(utils).placeholder).not.toBe('正在聆听…');
    });

    it('聆听中卸载 → 兜底 cancel 录音会话', async () => {
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      act(() => {
        utils.unmount();
      });
      expect(speechMocks.cancelSpeechInput).toHaveBeenCalledTimes(1);
    });
  });
});
