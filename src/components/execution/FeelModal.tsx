import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  isSpeechInputSupported,
  requestSpeechPermissions,
  startSpeechInput,
  stopSpeechInput,
  cancelSpeechInput,
  getSpeechPartial,
} from '../../lib/speechInput';
import { haptic } from '../../lib/nativeHaptics';
import type {
  FeelModalGroup,
  FeelModalRow,
  FeelModalTarget,
  FeelConfirmPatch,
} from './feelGate';

/**
 * 组后感受聚合表单（issue #98 v2，2026-10-01 重设计）：
 * 力量类最后一组完成时弹出，聚合本动作全部组——每行一条无级滑块（0-100 连续值，
 * 已填组回显、未填组默认 50），右上角圆形对勾一次确认批量写回（删除逐组弹窗与
 * 「跳过」文字链：点外部区域 = 跳过，未确认的拖动全部丢弃）。
 *
 * 两种形态：
 * - action：组后弹窗（单动作全部组）+ 底部语义补充输入（支持语音，复用 @ 对话框
 *   iOS 原生 STT 链路，原始音频不存）；语音补充按动作级语义写入收尾组的 feel_note。
 * - gate：结算闸门补记窗（§3，可多动作分组）——只列未填组，无补充输入，
 *   底部 [补完并结束]（全部写回 → 结算）/ [跳过]（不写任何字段 → 结算）。
 *
 * 视觉（§5）：底部 sheet 420ms cubic-bezier(0.32,0.72,0,1)（既有弹层规范曲线）+
 * Liquid Glass 材质（半透白 + backdrop blur/saturate + 内侧高光）；滑块水滴拇指
 * （径向高光渐变）+ 拖动中当前值浮动回显（松手淡出）；触感按阈值触发
 * （跨越 25/50/75 轻点、≥90 单次重击），确认 success、跳过不震；全程无声。
 * 仅浅色模式硬编码色值（玻璃材质不随暗色主题翻色）。
 */

export type { FeelModalTarget, FeelConfirmPatch, FeelPatch } from './feelGate';

/** 感受滑块默认值：中立 50，单手一拖即达（契约范围 0-100 闭区间） */
const FEEL_DEFAULT = 50;

/** sheet 进出场曲线（transitions.sheet 的 CSS 等价，与 AICoachOverlay 同一串） */
const SHEET_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** 越界输入夹回契约闭区间（防御层：原生 range 已钳制，这里保 payload 契约红线） */
const clampFeel = (raw: number): number => Math.max(0, Math.min(100, Math.round(raw)));

/** 行参数摘要（等宽数字）：60kg × 8；自重动作 weight=0 → 自重 × 8 */
const paramLabel = (s: FeelModalRow): string => {
  const parts: string[] = [];
  if (s.weight != null) parts.push(s.weight === 0 ? '自重' : `${s.weight}kg`);
  if (s.reps != null) parts.push(`${s.reps}次`);
  return parts.join(' × ') || '—';
};

/** 行内滑块：可视轨/填充/水滴拇指 + 阈值触感 + 浮动值回显，原生 range 透明覆盖（可达性） */
const FeelSliderRow: React.FC<{
  row: FeelModalRow;
  value: number;
  dragging: boolean;
  showGroupLabel: boolean;
  groupName?: string;
  onChange: (setId: string, raw: number) => void;
  onDragStart: (setId: string) => void;
  onDragEnd: () => void;
}> = ({ row, value, dragging, showGroupLabel, groupName, onChange, onDragStart, onDragEnd }) => (
  <div>
    {showGroupLabel && (
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">{groupName}</p>
    )}
    <div className="flex items-baseline gap-3">
      <span className="w-6 shrink-0 font-mono text-[13px] font-bold leading-none text-gray-400">
        {String(row.setNo).padStart(2, '0')}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-700"
        style={{ fontFeatureSettings: "'tnum'", fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        {paramLabel(row)}
      </span>
    </div>
    <div className="relative mt-1 h-9">
      {/* 浮动值回显：拖动中跟随拇指上方，松手淡出（left 夹在轨内防两端裁切） */}
      <div
        data-testid={`feel-echo-${row.setId}`}
        aria-hidden="true"
        className={`pointer-events-none absolute -top-7 -translate-x-1/2 rounded-full bg-[#1B2436] px-2 py-0.5
          text-[11px] font-bold leading-none text-white transition-opacity duration-300 ${
            dragging ? 'opacity-100' : 'opacity-0'
          }`}
        style={{
          left: `${Math.max(8, Math.min(92, value))}%`,
          fontFeatureSettings: "'tnum'",
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {value}
      </div>
      {/* 轨道 + 填充（无刻度） */}
      <div className="pointer-events-none absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-gray-900/10" />
      <div
        className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#1B2436]"
        style={{ width: `${value}%` }}
      />
      {/* 水滴拇指：径向高光渐变 + 内外双层投影（Liquid Glass 同族材质） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${value}%`,
          background: 'radial-gradient(circle at 35% 30%, #ffffff 0%, #f8fafc 65%, #dbe2ea 100%)',
          border: '0.5px solid rgba(255,255,255,0.85)',
          boxShadow:
            '0 2px 10px rgba(15,23,42,0.28), inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(15,23,42,0.08)',
        }}
      />
      {/* 原生 range 透明覆盖整行（键盘/读屏/测试可达；拇指放大接管命中区） */}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={`第 ${row.setNo} 组感受强度`}
        data-testid={`feel-slider-${row.setId}`}
        onChange={(e) => onChange(row.setId, Number(e.target.value))}
        onPointerDown={() => onDragStart(row.setId)}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onBlur={onDragEnd}
        onKeyDown={() => onDragStart(row.setId)}
        onKeyUp={onDragEnd}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent focus:outline-none
          [&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:w-9 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0
          [&::-moz-range-thumb]:h-9 [&::-moz-range-thumb]:w-9 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:opacity-0
          [&::-moz-range-track]:bg-transparent"
      />
    </div>
  </div>
);

interface FeelModalProps {
  target: FeelModalTarget;
  /** 批量确认：全部行（含未拖动的默认 50 行）一次写回 */
  onConfirm: (patches: FeelConfirmPatch[]) => void;
  /** 跳过：action=关闭不写；gate=不写任何字段直接进结算。入口=点外部区域 / gate [跳过] */
  onSkip: () => void;
}

export const FeelModal: React.FC<FeelModalProps> = ({ target, onConfirm, onSkip }) => {
  const isGate = target.mode === 'gate';
  const totalRows = target.groups.reduce((n, g) => n + g.sets.length, 0);

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(target.groups.flatMap(g => g.sets.map(s => [s.setId, s.feel ?? FEEL_DEFAULT]))),
  );
  const [note, setNote] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [draggingSetId, setDraggingSetId] = useState<string | null>(null);
  const speechPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 语音识别中用户手动编辑（删除/修改 partial 文本）→ 打开写保护，轮询停止回填
  // （@ 对话框 2026-09-17 bug 1 同源：删一个字 350ms 后被识别结果填回来）
  const userEditedRef = useRef(false);
  // 阈值触感游标：一次拖动手势内记忆上次值——跨越 25/50/75 轻点，≥90 重击一次
  const tickRef = useRef<{ setId: string; last: number; heavyFired: boolean } | null>(null);

  // target 换目标（复用挂载）→ 行值重开（已填回显，未填默认）
  useEffect(() => {
    setValues(Object.fromEntries(target.groups.flatMap(g => g.sets.map(s => [s.setId, s.feel ?? FEEL_DEFAULT]))));
  }, [target]);

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

  // 滑块变更：值夹回契约区间 + 阈值触感（跨 25/50/75 轻点，≥90 单次重击/手势）
  const handleSliderChange = (setId: string, raw: number) => {
    const v = clampFeel(raw);
    setValues(prev => ({ ...prev, [setId]: v }));
    const t = tickRef.current;
    if (!t || t.setId !== setId) {
      if (v >= 90) haptic('heavy');
      tickRef.current = { setId, last: v, heavyFired: v >= 90 };
      return;
    }
    for (const th of [25, 50, 75]) {
      if ((t.last < th && v >= th) || (t.last >= th && v < th)) haptic('light');
    }
    if (v >= 90 && !t.heavyFired) {
      haptic('heavy');
      t.heavyFired = true;
    }
    t.last = v;
  };

  const handleDragStart = (setId: string) => {
    setDraggingSetId(setId);
    tickRef.current = null; // 新手势重新计阈值
  };

  /** 全部行打包：动作级语义补充写入首个动作的收尾组（组级字段的动作级落点，§1） */
  const buildPatches = (): FeelConfirmPatch[] => {
    const trimmed = note.trim().slice(0, 500);
    const patches: FeelConfirmPatch[] = [];
    target.groups.forEach(g => {
      g.sets.forEach((s, i) => {
        const p: FeelConfirmPatch = { exId: g.exId, setId: s.setId, feel: values[s.setId] ?? FEEL_DEFAULT };
        if (!isGate && g === target.groups[0] && i === g.sets.length - 1 && trimmed) {
          p.feel_note = trimmed;
        }
        patches.push(p);
      });
    });
    return patches;
  };

  const handleConfirm = () => {
    if (isListening) stopListening('stop');
    haptic('success');
    onConfirm(buildPatches());
  };

  // 跳过：不写任何字段直接关（不弹二次确认；跳过路径不震动）
  const handleSkip = () => {
    if (isListening) stopListening('cancel');
    onSkip();
  };

  const actionGroup = target.groups[0];

  return (
    <div className="fixed inset-0 z-[150]">
      {/* 暗场：点外部区域 = 跳过（§4 删除二次确认与「跳过」文字链；gate 模式放行结算） */}
      <motion.div
        data-testid="feel-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onClick={handleSkip}
        className="absolute inset-0 bg-black/45"
      />

      {/* 底部 sheet：rounded-t-[40px] + Liquid Glass 材质（§5 半透白 + blur/saturate + 内侧高光） */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.42, ease: SHEET_EASE }}
        data-testid="feel-modal"
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[40px] border-t border-white/60"
        style={{
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(48px) saturate(180%)',
          WebkitBackdropFilter: 'blur(48px) saturate(180%)',
          boxShadow: '0 -12px 48px rgba(15,23,42,0.25), inset 0 1px 0 rgba(255,255,255,0.85)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        {/* 抓手条 */}
        <div className="flex justify-center pt-3">
          <div className="h-1.5 w-10 rounded-full bg-gray-900/15" />
        </div>

        {/* 语境头：action 形态唯一主动作 = 右上角圆形对勾（深藏青，一次确认全部行） */}
        <div className="relative flex items-center justify-center px-7 pt-4">
          <div className="text-center">
            <p className="text-[20px] font-bold text-gray-900">
              {isGate ? `还有 ${totalRows} 组没记感受` : '感觉如何？'}
            </p>
            <p className="mt-1 text-[13px] font-medium text-gray-500">
              {isGate ? '补记或跳过后结束训练' : `${actionGroup.exName} · 共 ${actionGroup.sets.length} 组`}
            </p>
          </div>
          {!isGate && (
            <motion.button
              type="button"
              data-testid="feel-confirm"
              aria-label="确认记录全部组感受"
              whileTap={{ scale: 0.9 }}
              onClick={handleConfirm}
              className="absolute right-7 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center
                rounded-full bg-[#1B2436] text-white shadow-lg shadow-[#1B2436]/30 focus:outline-none"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </motion.button>
          )}
        </div>

        <div className="px-7 pt-5">
          {/* 行区：多动作（gate）分组展示；单动作平铺。超高滚动（组多不顶出屏） */}
          <div className="max-h-[38vh] space-y-4 overflow-y-auto overscroll-contain pb-1">
            {target.groups.map(g =>
              g.sets.map((s, rowIdx) => (
                <FeelSliderRow
                  key={s.setId}
                  row={s}
                  value={values[s.setId] ?? FEEL_DEFAULT}
                  dragging={draggingSetId === s.setId}
                  showGroupLabel={isGate && rowIdx === 0}
                  groupName={g.exName}
                  onChange={handleSliderChange}
                  onDragStart={handleDragStart}
                  onDragEnd={() => setDraggingSetId(null)}
                />
              )),
            )}
          </div>

          {isGate ? (
            /* 闸门双按钮（§3）：补完并结束 = 全部写回 → 结算；跳过 = 不写 → 结算 */
            <div className="mt-5">
              <motion.button
                type="button"
                data-testid="feel-gate-confirm"
                whileTap={{ scale: 0.97 }}
                onClick={handleConfirm}
                className="h-14 w-full rounded-2xl bg-[#1B2436] text-[16px] font-semibold text-white
                  shadow-lg shadow-[#1B2436]/25 focus:outline-none"
              >
                补完并结束
              </motion.button>
              <motion.button
                type="button"
                data-testid="feel-gate-skip"
                whileTap={{ scale: 0.98 }}
                onClick={handleSkip}
                className="mt-2 h-12 w-full rounded-2xl text-[15px] font-medium text-gray-500 focus:outline-none"
              >
                跳过
              </motion.button>
            </div>
          ) : (
            /* 语义补充：动作级一句话（支持语音）；确认走右上角对勾，底部无按钮 */
            <div className="mt-5 flex items-end gap-2.5">
              <div className="flex flex-1 items-center gap-2 rounded-[22px] border border-white/80 bg-white/70 px-4 py-2 shadow-sm">
                <textarea
                  rows={1}
                  maxLength={500}
                  value={note}
                  onChange={handleNoteChange}
                  data-testid="feel-note"
                  aria-label="感受补充说明"
                  placeholder={isListening ? '正在聆听…' : '记录细节（支持语音）'}
                  className="max-h-24 min-h-[36px] w-full resize-none bg-transparent py-2 text-[15px] leading-snug
                    text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
                {isSpeechInputSupported && (
                  <motion.button
                    type="button"
                    data-testid="feel-mic"
                    whileTap={{ scale: 0.92 }}
                    onClick={handleMicTap}
                    aria-label={isListening ? '停止语音输入' : '语音输入'}
                    className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                      transition-colors duration-200 ${
                        isListening ? 'bg-rose-500/10 text-rose-500' : 'bg-[#1B2436]/[0.08] text-gray-500'
                      }`}
                  >
                    {isListening && (
                      <span className="absolute right-1 top-1 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
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
                      className="h-5 w-5"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  </motion.button>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

/** 供 App/闸门引用的行组类型再导出（组级聚合结构唯一定义源在 feelGate.ts） */
export type { FeelModalGroup, FeelModalRow };

export default FeelModal;
