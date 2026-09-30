import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { FeelModal, type FeelModalTarget, type FeelPatch } from '../FeelModal';
import { ExerciseSetEntrySchema } from 'shared/contracts';

/**
 * 组后感受弹窗测试（issue #98）：
 * - 滑块值绑定 feel 契约范围 0-100（含闭区间端点，payload 过 ExerciseSetEntrySchema 校验）
 * - 空备注不写 feel_note、有备注原样携带（≤500 契约约束）
 * - 跳过路径：不写任何字段直接关（onSkip 且 onConfirm 不触发）
 * - 语音按钮：触发转写链路（权限→启动→partial 轮询回填→停止取最终文本），
 *   mock 的是 @ 对话框同源 speechInput 模块；web（不支持）时入口隐藏
 * - 卸载兜底清理录音会话
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

const target: FeelModalTarget = {
  exId: 'ex-1',
  setId: 'set-2',
  exName: '杠铃卧推',
  setNo: 2,
  total: 4,
};

const renderModal = (onConfirm = vi.fn(), onSkip = vi.fn()) => {
  const utils = render(
    <FeelModal target={target} onConfirm={onConfirm} onSkip={onSkip} />,
  );
  const slider = utils.getByLabelText('感受强度') as HTMLInputElement;
  const confirmBtn = utils.getByRole('button', { name: '记下这组' });
  const skipBtn = utils.getByRole('button', { name: '跳过' });
  return { slider, confirmBtn, skipBtn, onConfirm, onSkip, ...utils };
};

/** 把滑块拖到指定值并确认，返回 onConfirm 收到的 patch */
const dragAndConfirm = (utils: ReturnType<typeof renderModal>, value: number): FeelPatch => {
  act(() => {
    fireEvent.change(utils.slider, { target: { value: String(value) } });
  });
  act(() => {
    fireEvent.click(utils.confirmBtn);
  });
  return utils.onConfirm.mock.calls[0][0] as FeelPatch;
};

/** 契约绑定校验：feel/feel_note 子集必须过 ExerciseSetEntrySchema（0-100 int / ≤500 字符） */
const expectContractValid = (patch: FeelPatch) => {
  const parsed = ExerciseSetEntrySchema.pick({ feel: true, feel_note: true }).safeParse(patch);
  expect(parsed.success).toBe(true);
};

describe('FeelModal（组后感受弹窗 #98）', () => {
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

  describe('滑块值绑定 feel 契约（0-100 int 原值）', () => {
    it('默认值 50（中立，一拖即达）', () => {
      const { slider } = renderModal();
      expect(slider.value).toBe('50');
    });

    it('拖到 73 确认 → onConfirm 收到 feel=73 且过契约校验', () => {
      const utils = renderModal();
      const patch = dragAndConfirm(utils, 73);
      expect(patch).toEqual({ feel: 73 });
      expectContractValid(patch);
    });

    it.each([0, 100])('闭区间端点 feel=%s 合法并过契约校验', (value) => {
      const utils = renderModal();
      const patch = dragAndConfirm(utils, value);
      expect(patch.feel).toBe(value);
      expectContractValid(patch);
    });

    it('范围外的输入被夹回 0-100（防御层，契约红线）', () => {
      const utils = renderModal();
      act(() => {
        fireEvent.change(utils.slider, { target: { value: '150' } });
      });
      act(() => {
        fireEvent.change(utils.slider, { target: { value: '-5' } });
      });
      // range input 自身钳制：浏览器把越界值夹到 min/max
      expect(Number(utils.slider.value)).toBeLessThanOrEqual(100);
      expect(Number(utils.slider.value)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('语义补充（feel_note）', () => {
    it('有备注 → 原样携带且过契约校验', () => {
      const utils = renderModal();
      act(() => {
        fireEvent.change(utils.getByLabelText('感受补充说明'), {
          target: { value: '左肩有点疼，力量比上周大' },
        });
      });
      const patch = dragAndConfirm(utils, 42);
      expect(patch).toEqual({ feel: 42, feel_note: '左肩有点疼，力量比上周大' });
      expectContractValid(patch);
    });

    it('空备注 → 不写 feel_note 字段（undefined 语义，非空串）', () => {
      const utils = renderModal();
      const patch = dragAndConfirm(utils, 60);
      expect(patch).toEqual({ feel: 60 });
      expect('feel_note' in patch).toBe(false);
    });
  });

  describe('跳过路径（不填不劣待）', () => {
    it('跳过 → onSkip 触发、onConfirm 不触发（不写任何字段）', () => {
      const utils = renderModal();
      act(() => {
        fireEvent.change(utils.slider, { target: { value: '88' } });
      });
      act(() => {
        fireEvent.click(utils.skipBtn);
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
      const utils = renderModal();
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      expect(speechMocks.requestSpeechPermissions).toHaveBeenCalledTimes(1);
      expect(speechMocks.startSpeechInput).toHaveBeenCalledWith('zh-CN');
      // 聆听态：placeholder 变化 + 按钮语义切换为停止
      expect(getNote(utils).placeholder).toBe('正在聆听…');
      expect(utils.getByRole('button', { name: '停止语音输入' })).toBeTruthy();
    });

    it('partial 轮询回填输入框，停止后取最终文本', async () => {
      speechMocks.getSpeechPartial.mockResolvedValue({ text: '左肩有点疼', running: true });
      const utils = renderModal();
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
      // 确认：feel_note 带上转写文本
      const patch = dragAndConfirm(utils, 35);
      expect(patch.feel_note).toBe('左肩有点疼');
      expectContractValid(patch);
    });

    it('聆听中确认 → 先停识别再提交（录音资源不挂着）', async () => {
      speechMocks.getSpeechPartial.mockResolvedValue({ text: '太重了', running: true });
      const utils = renderModal();
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      await act(async () => {
        vi.advanceTimersByTime(360);
      });
      act(() => {
        fireEvent.click(utils.confirmBtn);
      });
      expect(speechMocks.stopSpeechInput).toHaveBeenCalledTimes(1);
      expect(utils.onConfirm).toHaveBeenCalledTimes(1);
      expect((utils.onConfirm.mock.calls[0][0] as FeelPatch).feel_note).toBe('太重了');
    });

    it('web（不支持 STT）语音入口隐藏——与 @ 对话框同规则', () => {
      speechMocks.isSpeechInputSupported = false;
      const utils = renderModal();
      expect(utils.queryByRole('button', { name: '语音输入' })).toBeNull();
    });

    it('权限被拒 → 不启动识别、不进聆听态', async () => {
      speechMocks.requestSpeechPermissions.mockResolvedValue({ speech: 'denied', mic: 'denied' });
      const utils = renderModal();
      await act(async () => {
        fireEvent.click(getMic(utils));
      });
      expect(speechMocks.startSpeechInput).not.toHaveBeenCalled();
      expect(getNote(utils).placeholder).not.toBe('正在聆听…');
    });

    it('聆听中卸载 → 兜底 cancel 录音会话', async () => {
      const utils = renderModal();
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
