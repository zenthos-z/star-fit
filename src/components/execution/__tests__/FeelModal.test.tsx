import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import FeelModal from '../FeelModal';
import type { FeelModalTarget, FeelConfirmPatch } from '../feelGate';
import { ExerciseSetEntrySchema } from 'shared/contracts';

/**
 * 组后感受聚合表单测试（issue #98 v2，2026-10-01 重设计；同日返工闸门改窄卡）：
 * - N 行聚合渲染：每行一条滑块（等宽组号徽章 + 参数摘要），已填组回显、未填默认 50
 * - 批量确认：右上角对勾一次提交全部行（exId+setId+feel 定位写回，payload 过契约校验）
 * - 动作级语义补充：语音/文本 note 只写收尾组 feel_note（≤500 契约约束），空 note 不写字段
 * - 跳过路径：点外部区域 = 跳过，不写任何字段直接关（onSkip 且 onConfirm 不触发）
 * - 语音按钮：触发转写链路（权限→启动→partial 轮询回填→停止取最终文本），
 *   mock 的是 @ 对话框同源 speechInput 模块；web（不支持）时入口隐藏
 * - 卸载兜底清理录音会话
 * 纯函数层（触发判定/闸门扫描/批量写回）另见 feelGate.test.ts；
 * 结算闸门窄卡（FeelGateAlert，只分流不写值）另见 FeelGateAlert.test.tsx。
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

/** 多动作补记目标（闸门[去补记]携多组进来）：分组段标语义 */
const multiTarget: FeelModalTarget = {
  groups: [
    {
      exId: 'ex-1',
      exName: '杠铃卧推',
      sets: [
        { setId: 'set-2', setNo: 2, weight: 60, reps: 8 },
        { setId: 'set-3', setNo: 3, weight: 60, reps: 8 },
      ],
    },
    { exId: 'ex-2', exName: '杠铃划船', sets: [{ setId: 'set-b1', setNo: 1, weight: 40, reps: 10 }] },
  ],
};

/**
 * 重开回显目标（#119 缺陷3）：确认写回后再开的形态——部分组已填 feel、
 * 收尾组带动作级 feel_note（buildPatches 的写入落点，回显读同一落点）
 */
const echoTarget: FeelModalTarget = {
  groups: [{
    exId: 'ex-1',
    exName: '杠铃卧推',
    sets: [
      { setId: 'set-1', setNo: 1, weight: 60, reps: 8, feel: 73 },
      { setId: 'set-2', setNo: 2, weight: 60, reps: 8, feel: 35 },
      { setId: 'set-3', setNo: 3, weight: 60, reps: 8, feel: 58, feel_note: '上次记的：左肩有点紧' },
    ],
  }],
};

/** 多动作回显目标：每组各自的已填值都要回显，note 取首个动作收尾组 */
const multiEchoTarget: FeelModalTarget = {
  groups: [
    {
      exId: 'ex-1',
      exName: '杠铃卧推',
      sets: [
        { setId: 'set-1', setNo: 1, weight: 60, reps: 8, feel: 80 },
        { setId: 'set-2', setNo: 2, weight: 60, reps: 8, feel_note: '卧推收尾很稳' },
      ],
    },
    { exId: 'ex-2', exName: '杠铃划船', sets: [{ setId: 'set-b1', setNo: 1, weight: 40, reps: 10, feel: 62 }] },
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

  describe('多动作补记（闸门[去补记]携多组进来）', () => {
    it('按动作分段展示段标 + 组号沿用原组号（不重新编号），全部行可写', () => {
      const utils = renderModal(multiTarget);
      expect(getSliders(utils)).toHaveLength(3);
      // 段标只出现在各动作首行
      expect(utils.getByText('杠铃卧推')).toBeTruthy();
      expect(utils.getByText('杠铃划船')).toBeTruthy();
      expect(utils.getByText('01')).toBeTruthy();
      expect(utils.getByText('02')).toBeTruthy();
      // 批量确认：全部行一次写回，exId 各归各动作
      const patches = confirmAction(utils);
      expect(patches.map(p => p.exId)).toEqual(['ex-1', 'ex-1', 'ex-2']);
      patches.forEach(expectContractValid);
    });

    it('多动作时标题只报总组数（单动作才带动作名语境）', () => {
      const utils = renderModal(multiTarget);
      expect(utils.getByText('感觉如何？')).toBeTruthy();
      expect(utils.getByText('共 3 组')).toBeTruthy();
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

    it('权限被拒 → 不启动识别、不进聆听态，提示可见（#119 缺陷2：禁静默）', async () => {
      speechMocks.requestSpeechPermissions.mockResolvedValue({ speech: 'denied', mic: 'denied' });
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      expect(speechMocks.startSpeechInput).not.toHaveBeenCalled();
      expect(getNote(utils).placeholder).not.toBe('正在聆听…');
      expect(utils.getByTestId('feel-mic-error').textContent).toContain('权限');
    });

    it('启动失败（startSpeechInput 返回 false）→ 提示出现、不进聆听态、定时消退', async () => {
      speechMocks.startSpeechInput.mockResolvedValue(false);
      const utils = renderModal(actionTarget);
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      // #119 缺陷2 硬验收：授权后点击无反应的病灶 = 这里原本静默 return
      expect(utils.getByTestId('feel-mic-error').textContent).toBe('语音启动失败，请稍后重试');
      expect(getNote(utils).placeholder).not.toBe('正在聆听…');
      expect(speechMocks.startSpeechInput).toHaveBeenCalledWith('zh-CN');
      // 3.5s 自动消退（不打断表单语境）
      await act(async () => {
        vi.advanceTimersByTime(3600);
      });
      expect(utils.queryByTestId('feel-mic-error')).toBeNull();
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

  describe('重开回显（#119 缺陷3：确认写回后再开，已填内容不丢）', () => {
    it('带已填 feel/feel_note 的组打开 → 滑块初值 + note 初值原样回显', () => {
      const utils = renderModal(echoTarget);
      const sliders = getSliders(utils);
      expect(sliders.map(s => s.value)).toEqual(['73', '35', '58']);
      expect((utils.getByLabelText('感受补充说明') as HTMLTextAreaElement).value).toBe('上次记的：左肩有点紧');
    });

    it('回显后直接确认 → feel 原值 + feel_note 原文再写回收尾组（不改不丢）', () => {
      const utils = renderModal(echoTarget);
      const patches = confirmAction(utils);
      expect(patches.map(p => p.feel)).toEqual([73, 35, 58]);
      expect(patches[2].feel_note).toBe('上次记的：左肩有点紧');
      patches.forEach(expectContractValid);
    });

    it('回显后清空 note 确认 → 收尾组写空串显式清除（下轮重开不再复活）', () => {
      const utils = renderModal(echoTarget);
      act(() => {
        fireEvent.change(utils.getByLabelText('感受补充说明'), { target: { value: '' } });
      });
      const patches = confirmAction(utils);
      expect(patches[2].feel_note).toBe('');
      patches.forEach(expectContractValid); // 空串过契约（≤500，无 min 约束）
    });

    it('多动作聚合：每组各自已填值回显，note 取首个动作收尾组', () => {
      const utils = renderModal(multiEchoTarget);
      const sliders = getSliders(utils);
      expect(sliders.map(s => s.value)).toEqual(['80', '50', '62']);
      expect((utils.getByLabelText('感受补充说明') as HTMLTextAreaElement).value).toBe('卧推收尾很稳');
    });
  });
});
