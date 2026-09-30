import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { ExerciseSetEntry } from '../../../shared/contracts';
import {
  isSpeechInputSupported,
  requestSpeechPermissions,
  startSpeechInput,
  stopSpeechInput,
  cancelSpeechInput,
  getSpeechPartial,
} from '../../lib/speechInput';
import { haptic } from '../../lib/nativeHaptics';

/**
 * 组后感受弹窗（issue #98，采集 UI 批）：
 * 每组（力量类）完成后在组间休息语境弹出——无级滑块 0-100 快速选感受，
 * 附语义文本补充（受伤/疼痛/力量过大等滑块说不清的内容），语音按钮复用
 * @ 对话框已实现的语音转文本链路（iOS 原生 STT，原始音频不存）。
 *
 * 数据落点：写当前组的 feel / feel_note（契约 ExerciseSetEntry，#97 已备），
 * 组间形成对比序列供 Agent 分析。表单定稿 = 滑块 + 补充 + 确认，无多余元素；
 * 跳过（不填）路径必须存在且不劣待（不写任何字段直接关）。
 *
 * 视觉/交互曲线对齐既有弹层规范：底部 sheet 圆角 40px + transitions.sheet
 * 曲线（transform 420ms cubic-bezier(0.32,0.72,0,1)，与 AICoachOverlay 同族）。
 */

/** 确认时写回组级字段的补丁（契约子集，类型从 shared/contracts 导入） */
export type FeelPatch = Pick<ExerciseSetEntry, 'feel' | 'feel_note'>;

export interface FeelModalTarget {
  exId: string;
  setId: string;
  exName: string;
  setNo: number;
  total: number;
}

interface FeelModalProps {
  target: FeelModalTarget;
  onConfirm: (patch: FeelPatch) => void;
  onSkip: () => void;
}

/** sheet 进出场曲线（transitions.sheet 的 CSS 等价，与 AICoachOverlay 同一串） */
const SHEET_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** 感受滑块默认值：中立 50，单手一拖即达（契约范围 0-100 闭区间） */
const FEEL_DEFAULT = 50;

export const FeelModal: React.FC<FeelModalProps> = ({ target, onConfirm, onSkip }) => {
  const [feel, setFeel] = useState(FEEL_DEFAULT);
  const [note, setNote] = useState('');
  const [isListening, setIsListening] = useState(false);
  const speechPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 语音识别中用户手动编辑（删除/修改 partial 文本）→ 打开写保护，轮询停止回填
  // （@ 对话框 2026-09-17 bug 1 同源：删一个字 350ms 后被识别结果填回来）
  const userEditedRef = useRef(false);

  const stopSpeechPolling = () => {
    if (speechPollRef.current !== null) {
      clearInterval(speechPollRef.current);
      speechPollRef.current = null;
    }
  };

  // 卸载时兜底清理录音轮询与原生会话（确认/跳过/父层条件卸载都走这里）
  useEffect(() => {
    return () => {
      stopSpeechPolling();
      void cancelSpeechInput();
    };
  }, []);

  const stopListening = (mode: 'stop' | 'cancel') => {
    stopSpeechPolling();
    setIsListening(false);
    userEditedRef.current = false;
    void (mode === 'stop' ? stopSpeechInput() : cancelSpeechInput());
  };

  const handleMicTap = async () => {
    if (!isSpeechInputSupported) return;
    if (isListening) {
      // 停止：取最终文本回填，交用户确认提交（不自动提交）
      stopSpeechPolling();
      setIsListening(false);
      userEditedRef.current = false;
      const finalText = await stopSpeechInput();
      if (finalText && !note.trim()) setNote(finalText);
      haptic('success');
      return;
    }
    // 开始：先要权限（首次弹系统授权），再启动流式识别
    const perms = await requestSpeechPermissions();
    if (!perms || perms.speech !== 'granted' || perms.mic !== 'granted') return;
    const ok = await startSpeechInput('zh-CN');
    if (!ok) return;
    haptic('light');
    userEditedRef.current = false;
    setIsListening(true);
    // 轮询中间结果回填；用户一旦手动编辑即停写保护（识别继续跑，结果弃用）
    speechPollRef.current = setInterval(async () => {
      if (userEditedRef.current) return;
      const { text, error } = await getSpeechPartial();
      if (text) setNote(text);
      if (error) console.warn('[FeelModal] recognizer error:', error);
    }, 350);
  };

  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isListening) userEditedRef.current = true;
    setNote(e.target.value);
  };

  const handleConfirm = () => {
    if (isListening) stopListening('stop');
    haptic('success');
    const trimmed = note.trim().slice(0, 500);
    onConfirm({ feel, ...(trimmed ? { feel_note: trimmed } : {}) });
  };

  const handleSkip = () => {
    if (isListening) stopListening('cancel');
    haptic('light');
    onSkip();
  };

  return (
    <div className="fixed inset-0 z-[150]">
      {/* 暗场：盖住锁屏/训练列表，衬托 sheet */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="absolute inset-0 bg-black/45"
      />

      {/* 底部 sheet：rounded-t-[40px] + transitions.sheet 曲线（既有弹层规范） */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.42, ease: SHEET_EASE }}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[40px] bg-[#FAFAFA] shadow-[0_-8px_40px_rgba(0,0,0,0.18)]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
      >
        {/* 抓手条 */}
        <div className="flex justify-center pt-3">
          <div className="h-1.5 w-10 rounded-full bg-gray-200" />
        </div>

        <div className="px-7 pt-5">
          {/* 语境头：评的是哪一组（定位信息，非表单字段） */}
          <p className="text-center text-[20px] font-bold text-gray-900">这组感觉如何？</p>
          <p className="mt-1.5 text-center text-[13px] font-medium text-gray-400">
            {target.exName} · 第 {target.setNo} / {target.total} 组
          </p>

          {/* 当前值：大数字实时可见（tnum 与锁屏 hero 同族） */}
          <div className="mt-6 flex items-end justify-center gap-1" aria-live="polite">
            <span
              style={{ fontFeatureSettings: "'tnum'" }}
              className="text-[56px] font-semibold leading-none tracking-tight text-gray-900"
            >
              {feel}
            </span>
            <span className="pb-1 text-[14px] font-medium text-gray-400">/ 100</span>
          </div>

          {/* 无级滑块（0-100 连续，step=1 整数刻度落契约 int，禁分档离散化）。
              轨道填充经 CSS 变量注入 runnable-track（Tailwind 任意值吃不了动态值） */}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={feel}
            aria-label="感受强度"
            onChange={(e) => setFeel(Math.round(Number(e.target.value)))}
            onPointerUp={() => haptic('light')}
            onKeyUp={() => haptic('light')}
            className="mt-5 h-9 w-full cursor-pointer appearance-none bg-transparent focus:outline-none
              [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full
              [&::-webkit-slider-runnable-track]:bg-[image:var(--feel-track)]
              [&::-webkit-slider-thumb]:mt-[-11px] [&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:w-8
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-100
              [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
            style={
              {
                '--feel-track': `linear-gradient(to right, #3B82F6 ${feel}%, #E5E7EB ${feel}%)`,
              } as React.CSSProperties
            }
          />
          {/* 轴端标签：0 = 轻松，100 = 极限（解释量纲，非表单字段） */}
          <div className="mt-1 flex justify-between text-[12px] font-medium text-gray-400">
            <span>轻松</span>
            <span>极限</span>
          </div>

          {/* 语义补充：文本 + 语音按钮（复用 @ 对话框 STT，iOS 原生，不存音频） */}
          <div className="mt-6 flex items-end gap-2.5">
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={handleNoteChange}
              placeholder={isListening ? '正在聆听…' : '补充说明（选填）'}
              aria-label="感受补充说明"
              className="min-h-[56px] flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3
                text-[15px] leading-snug text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
            />
            {isSpeechInputSupported && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={handleMicTap}
                aria-label={isListening ? '停止语音输入' : '语音输入'}
                className={`relative flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-2xl transition-colors duration-200 ${
                  isListening ? 'bg-rose-500/10 text-rose-500' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {isListening && (
                  <span className="absolute right-1.5 top-1.5 flex w-2 h-2">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-rose-500 opacity-60 animate-ping" />
                    <span className="relative inline-flex w-2 h-2 rounded-full bg-rose-500" />
                  </span>
                )}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </motion.button>
            )}
          </div>

          {/* 确认：写当前组 feel/feel_note（组间形成对比序列） */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={handleConfirm}
            className="mt-6 h-14 w-full rounded-2xl bg-blue-500 text-[16px] font-semibold text-white
              shadow-lg shadow-blue-500/25 focus:outline-none"
          >
            记下这组
          </motion.button>

          {/* 跳过：不写任何字段直接关（不填路径存在且不劣待——同宽全幅可点） */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={handleSkip}
            className="mt-2 h-12 w-full rounded-2xl text-[15px] font-medium text-gray-400 focus:outline-none"
          >
            跳过
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

export default FeelModal;
