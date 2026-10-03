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
import { isNativeTabBar } from '../../lib/nativeTabBar';
import type {
  FeelModalGroup,
  FeelModalRow,
  FeelModalTarget,
  FeelConfirmPatch,
} from './feelGate';

/**
 * 组后感受聚合表单（issue #98 v2，2026-10-01 重设计；同日返工收敛材质）：
 * 力量类最后一组完成时弹出，聚合本动作全部组——每行一条无级滑块（0-100 连续值，
 * 已填组回显、未填组默认 50），右上角圆形对勾一次确认批量写回（删除逐组弹窗与
 * 「跳过」文字链：点外部区域 = 跳过，未确认的拖动全部丢弃）。
 * 结算闸门不在此组件：闸门 = FeelGateAlert 窄卡意图分流（补记入口可携多组进来）。
 *
 * 材质真源对齐（2026-10-01 项目主人返工①）：Apple glassEffect 语义映射——
 * .regular 材质 = 高不透明中性白磨砂（bg-white/95 + backdrop-blur-xl）+ 中性白
 * specular rim 边缘光（白色顶缘描边 + 内侧高光），禁彩虹色散/饱和度戏法；
 * 圆角/层次与 DeviationWarningModal（项目已拍板 iOS 模态模板）同一语言。
 *
 * 视觉：底部 sheet 420ms cubic-bezier(0.32,0.72,0,1)（既有弹层规范曲线）；
 * 滑块水滴拇指（径向高光渐变）+ 拖动中当前值浮动回显（松手淡出）；触感按阈值
 * 触发（跨越 25/50/75 轻点、≥90 单次重击），确认 success、跳过不震；全程无声。
 * 仅浅色模式硬编码色值（材质不随暗色主题翻色）。
 */

export type { FeelModalTarget, FeelConfirmPatch, FeelPatch } from './feelGate';

/** 感受滑块默认值：中立 50，单手一拖即达（契约范围 0-100 闭区间） */
const FEEL_DEFAULT = 50;

/** sheet 进出场曲线（transitions.sheet 的 CSS 等价，与 AICoachOverlay 同一串） */
const SHEET_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** 越界输入夹回契约闭区间（防御层：原生 range 已钳制，这里保 payload 契约红线） */
const clampFeel = (raw: number): number => Math.max(0, Math.min(100, Math.round(raw)));

/**
 * 避让 iOS 原生 Tab Bar（#119 缺陷1，#104 BatchAddBanner 同款避让常量）：
 * 原生 bar 悬浮在 WebView 之上（Liquid Glass 常驻），z-index 无法穿透——sheet 底缘
 * 抬到 bar 顶沿（safe-area + 72px = MainTabBar body 避让常量）。CSS 回落端 tab bar
 * z-105 在本表单 z-[150] 之下，按项目「sheet 盖 tab」规范维持贴底不抬。
 */
const TABBAR_CLEARANCE = 'calc(env(safe-area-inset-bottom, 0px) + 72px)';

/** 语音启动失败提示的自动消退时长（ms）——失败可见但不打断表单语境 */
const MIC_ERROR_TTL_MS = 3500;

/** 动作级语义补充的回显落点：首个动作的收尾组（与 buildPatches 写入落点对称，§1） */
const closingNoteOf = (t: FeelModalTarget): string => {
  const g0 = t.groups[0];
  const closing = g0?.sets[g0.sets.length - 1];
  return closing?.feel_note ?? '';
};

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
  // 多动作补记（闸门[去补记]携多组进来）按动作分段展示；单动作平铺不带段标
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
  /** 跳过：关闭不写任何字段。入口 = 点外部区域（暗场） */
  onSkip: () => void;
}

export const FeelModal: React.FC<FeelModalProps> = ({ target, onConfirm, onSkip }) => {
  const totalRows = target.groups.reduce((n, g) => n + g.sets.length, 0);

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(target.groups.flatMap(g => g.sets.map(s => [s.setId, s.feel ?? FEEL_DEFAULT]))),
  );
  // note 初值回显（#119 缺陷3）：打开时刻带出已填的动作级 feel_note（收尾组），
  // 之前初值恒 ''——确认后再开 note 必空，用户以为记录丢失
  const [note, setNote] = useState(() => closingNoteOf(target));
  const [isListening, setIsListening] = useState(false);
  // 语音启动失败提示（#119 缺陷2 硬验收：禁静默 return，失败必须可见）
  const [micError, setMicError] = useState<string | null>(null);
  const [draggingSetId, setDraggingSetId] = useState<string | null>(null);
  const speechPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 语音识别中用户手动编辑（删除/修改 partial 文本）→ 打开写保护，轮询停止回填
  // （@ 对话框 2026-09-17 bug 1 同源：删一个字 350ms 后被识别结果填回来）
  const userEditedRef = useRef(false);
  // 阈值触感游标：一次拖动手势内记忆上次值——跨越 25/50/75 轻点，≥90 重击一次
  const tickRef = useRef<{ setId: string; last: number; heavyFired: boolean } | null>(null);

  /** 语音失败提示：立即出现、定时自动消退（新失败刷新计时） */
  const showMicError = (msg: string) => {
    setMicError(msg);
    if (micErrorTimerRef.current !== null) clearTimeout(micErrorTimerRef.current);
    micErrorTimerRef.current = setTimeout(() => setMicError(null), MIC_ERROR_TTL_MS);
  };

  // target 换目标（复用挂载）→ 行值与 note 重开（已填回显：滑块值 + 动作级 feel_note）
  useEffect(() => {
    setValues(Object.fromEntries(target.groups.flatMap(g => g.sets.map(s => [s.setId, s.feel ?? FEEL_DEFAULT]))));
    setNote(closingNoteOf(target));
  }, [target]);

  const stopSpeechPolling = () => {
    if (speechPollRef.current !== null) {
      clearInterval(speechPollRef.current);
      speechPollRef.current = null;
    }
  };

  // 卸载时兜底清理录音轮询、失败提示计时与原生会话（确认/跳过/父层条件卸载都走这里）
  useEffect(() => {
    return () => {
      stopSpeechPolling();
      if (micErrorTimerRef.current !== null) clearTimeout(micErrorTimerRef.current);
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
    // 开始：先要权限（首次弹系统授权），再启动流式识别。
    // 失败必须有可见反馈（#119 缺陷2 硬验收：禁静默 return——真机实锤授权后点麦克风
    // 零反应，用户无从判断卡在哪一环）；话术口径对齐 AICoachOverlay 同源分支
    const perms = await requestSpeechPermissions();
    if (!perms || perms.speech !== 'granted' || perms.mic !== 'granted') {
      showMicError('语音需要麦克风与语音识别权限，请在系统设置中开启');
      return;
    }
    const ok = await startSpeechInput('zh-CN');
    if (!ok) {
      showMicError('语音启动失败，请稍后重试');
      return;
    }
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

  /** 全部行打包：动作级语义补充写入首个动作的收尾组（组级字段的动作级落点，§1）。
   *  #119 缺陷3 补语义：打开时回显过旧 note 而用户清空 → 显式写空串清除存量
   *  （不写键 = 保持原值的「首填不写字段」语义原样保留，只对回显后清空放行清除） */
  const buildPatches = (): FeelConfirmPatch[] => {
    const trimmed = note.trim().slice(0, 500);
    const echoNote = closingNoteOf(target);
    const patches: FeelConfirmPatch[] = [];
    target.groups.forEach(g => {
      g.sets.forEach((s, i) => {
        const p: FeelConfirmPatch = { exId: g.exId, setId: s.setId, feel: values[s.setId] ?? FEEL_DEFAULT };
        const isClosing = g === target.groups[0] && i === g.sets.length - 1;
        if (isClosing && trimmed) p.feel_note = trimmed;
        else if (isClosing && !trimmed && echoNote) p.feel_note = '';
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
      {/* 暗场：点外部区域 = 跳过（§4 删除二次确认与「跳过」文字链） */}
      <motion.div
        data-testid="feel-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onClick={handleSkip}
        className="absolute inset-0 bg-black/45"
      />

      {/* 底部 sheet：rounded-t-[40px] + glassEffect .regular 语义材质（中性白磨砂 + specular rim）。
          iOS 原生端底缘抬到原生 Tab Bar 之上（#119 缺陷1：bottom-0 下半部被悬浮 WebView
          之上的原生 bar 盖住，note 输入与后段滑块不可见不可点）；web 回落端维持贴底 */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.42, ease: SHEET_EASE }}
        data-testid="feel-modal"
        className="absolute inset-x-0 mx-auto w-full max-w-md rounded-t-[40px] border-t border-white"
        style={{
          bottom: isNativeTabBar ? TABBAR_CLEARANCE : 0,
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 -25px 50px -12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.95)',
          // 抬升端已让出安全区（底缘 = safe-area + 72px），只留内容呼吸余量
          paddingBottom: isNativeTabBar ? '24px' : 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        {/* 抓手条 */}
        <div className="flex justify-center pt-3">
          <div className="h-1.5 w-10 rounded-full bg-gray-900/15" />
        </div>

        {/* 语境头：唯一主动作 = 右上角圆形对勾（深藏青，一次确认全部行） */}
        <div className="relative flex items-center justify-center px-7 pt-4">
          <div className="text-center">
            <p className="text-[20px] font-bold text-gray-900">感觉如何？</p>
            <p className="mt-1 text-[13px] font-medium text-gray-500">
              {target.groups.length > 1
                ? `共 ${totalRows} 组`
                : `${actionGroup.exName} · 共 ${actionGroup.sets.length} 组`}
            </p>
          </div>
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
        </div>

        <div className="px-7 pt-5">
          {/* 行区：多动作（闸门[去补记]携多组）按动作分段；单动作平铺。超高滚动（组多不顶出屏） */}
          <div className="max-h-[38vh] space-y-4 overflow-y-auto overscroll-contain pb-1">
            {target.groups.map(g =>
              g.sets.map((s, rowIdx) => (
                <FeelSliderRow
                  key={s.setId}
                  row={s}
                  value={values[s.setId] ?? FEEL_DEFAULT}
                  dragging={draggingSetId === s.setId}
                  showGroupLabel={target.groups.length > 1 && rowIdx === 0}
                  groupName={g.exName}
                  onChange={handleSliderChange}
                  onDragStart={handleDragStart}
                  onDragEnd={() => setDraggingSetId(null)}
                />
              )),
            )}
          </div>

          {/* 语义补充：动作级一句话（支持语音）；胶囊输入（rounded-full，多行时自然撑成
              stadium）；底色/描边比 sheet 材质深一档（gray-100/gray-200，返工③-③对比度）；
              确认走右上角对勾，底部无按钮 */}
          <div className="mt-5 flex items-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-4 py-2">
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

          {/* 语音失败提示（#119 缺陷2 硬验收）：note 胶囊下一行可见反馈，定时自动消退 */}
          {micError && (
            <p
              data-testid="feel-mic-error"
              role="alert"
              className="mt-2 px-1 text-[12px] font-semibold leading-snug text-rose-500"
            >
              {micError}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

/** 供 App/闸门引用的行组类型再导出（组级聚合结构唯一定义源在 feelGate.ts） */
export type { FeelModalGroup, FeelModalRow };

export default FeelModal;
