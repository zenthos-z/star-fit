import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { transitions } from '../../lib/animations';
import { haptic } from '../../../lib/nativeHaptics';

interface PosterResultViewerProps {
  /** 生成结果图（data:image/png;base64,...） */
  dataUrl: string;
  /** 重新生成：父组件重新 POST，期间 isRegenerating=true */
  onRegenerate: () => void;
  isRegenerating: boolean;
  onClose: () => void;
}

/**
 * 海报结果查看子页（z-[130]，高于父层 PosterPromptGeneratorV2 z-[120]）。
 * 深色背景突出海报；手势：pinch 双指缩放 + 双击 1x/2x + 放大后拖动平移 + 缩小于 1x 回弹。
 * fixed 全屏层自行避让安全区（body 的 env padding 对 fixed 层无效）。
 */
export const PosterResultViewer: React.FC<PosterResultViewerProps> = ({
  dataUrl,
  onRegenerate,
  isRegenerating,
  onClose,
}) => {
  const [isSharing, setIsSharing] = useState(false);
  const [shareFallback, setShareFallback] = useState(false);

  // ---- 手势状态（framer-motion MotionValue，绕过 React 渲染保证 60fps）----
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const gestureMode = useRef<'none' | 'pinch' | 'pan'>('none');
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const lastTapTime = useRef(0);
  const panLast = useRef<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 切换结果（重新生成成功）时复位视图
    scale.set(1);
    x.set(0);
    y.set(0);
  }, [dataUrl, scale, x, y]);

  const clampScale = (s: number) => Math.min(6, Math.max(1, s));

  /** 缩放中心点补偿：以视口中心为原点保持 pinch 焦点稳定 */
  const zoomAt = useCallback(
    (target: number, cx: number, cy: number) => {
      const prev = scale.get();
      const next = clampScale(target);
      if (next === prev) return;
      // 图像跟随 focal point：位移按缩放比例等比补偿
      const ratio = next / prev;
      const ox = x.get();
      const oy = y.get();
      const rect = wrapRef.current?.getBoundingClientRect();
      const px = rect ? cx - rect.left - rect.width / 2 : 0;
      const py = rect ? cy - rect.top - rect.height / 2 : 0;
      animate(x, ox * ratio - px * (ratio - 1), { duration: 0 });
      animate(y, oy * ratio - py * (ratio - 1), { duration: 0 });
      animate(scale, next, { type: 'spring', stiffness: 400, damping: 32 });
      // 未放大时平移归零
      if (next <= 1.001) {
        animate(x, 0, { type: 'spring', stiffness: 300, damping: 28 });
        animate(y, 0, { type: 'spring', stiffness: 300, damping: 28 });
      }
    },
    [scale, x, y]
  );

  const handleDoubleClick = (e: React.MouseEvent | React.TouchEvent) => {
    haptic('light');
    const point = 'clientX' in e ? e : (e as React.TouchEvent).touches[0];
    zoomAt(scale.get() > 1.5 ? 1 : 2, point?.clientX ?? 0, point?.clientY ?? 0);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gestureMode.current = 'pinch';
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchStartDist.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartScale.current = scale.get();
    } else if (e.touches.length === 1 && scale.get() > 1.001) {
      gestureMode.current = 'pan';
    }
    // 双击检测（触摸间隔 <300ms）
    const now = Date.now();
    if (e.touches.length === 1) {
      if (now - lastTapTime.current < 300) {
        handleDoubleClick(e);
        lastTapTime.current = 0;
      } else {
        lastTapTime.current = now;
      }
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (gestureMode.current === 'pinch' && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchStartDist.current > 0) {
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        zoomAt(pinchStartScale.current * (dist / pinchStartDist.current), midX, midY);
      }
    } else if (gestureMode.current === 'pan' && e.touches.length === 1 && scale.get() > 1.001) {
      const t = e.touches[0];
      const prevX = x.get();
      const prevY = y.get();
      // 触摸增量近似：以 touch target 相对上帧位移驱动（利用 movement 兜底）
      x.set(prevX + (t.clientX - (panLast.current?.x ?? t.clientX)));
      y.set(prevY + (t.clientY - (panLast.current?.y ?? t.clientY)));
      panLast.current = { x: t.clientX, y: t.clientY };
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      gestureMode.current = 'none';
      panLast.current = null;
      // 缩小于 1x → 回弹到 1x 且居中
      if (scale.get() < 1.02) {
        animate(scale, 1, { type: 'spring', stiffness: 350, damping: 28 });
        animate(x, 0, { type: 'spring', stiffness: 300, damping: 28 });
        animate(y, 0, { type: 'spring', stiffness: 300, damping: 28 });
      }
    } else if (e.touches.length === 1 && gestureMode.current === 'pinch') {
      gestureMode.current = scale.get() > 1.001 ? 'pan' : 'none';
      pinchStartDist.current = 0;
    }
  };

  // ---- 分享：优先 Web Share API（dataURL → blob File），回退 a[download] ----
  const handleShare = async () => {
    if (isSharing) return;
    haptic('success');
    setIsSharing(true);
    setShareFallback(false);
    try {
      const blob = dataUrlToBlob(dataUrl);
      const ext = blob.type.includes('svg') ? 'svg' : blob.type.includes('jpeg') ? 'jpg' : 'png';
      const file = new File([blob], `starfit-poster.${ext}`, { type: blob.type });
      const nav = navigator as Navigator & {
        canShare?: (d: { files?: File[] }) => boolean;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'Starfit 训练海报' });
      } else {
        downloadDataUrl(dataUrl);
        setShareFallback(true);
        setTimeout(() => setShareFallback(false), 2000);
      }
    } catch (err: unknown) {
      // 用户取消分享（AbortError）不算失败
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error('Share failed', err);
        downloadDataUrl(dataUrl);
        setShareFallback(true);
        setTimeout(() => setShareFallback(false), 2000);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleRegenerate = () => {
    haptic('light');
    onRegenerate();
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={transitions.springGentle}
      className="fixed inset-0 z-[130] bg-[#0A0A0A] flex flex-col rounded-t-[40px] overflow-hidden"
    >
      {/* Header：返回钮左置（HIG 同父层规格），标题居中，避让安全区 */}
      <div
        className="shrink-0 grid grid-cols-[44px_1fr_44px] items-center pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: '8px' }}
      >
        <button
          onClick={() => { haptic('light'); onClose(); }}
          aria-label="返回"
          className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/80 active:bg-white/20 active:scale-95 transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="text-center">
          <h2 className="text-lg font-black text-white tracking-tighter">生成结果</h2>
        </div>
        <div />
      </div>

      {/* 海报画布：深色底，手势缩放/平移 */}
      <div
        ref={wrapRef}
        className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden touch-none select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <motion.img
          src={dataUrl}
          alt="AI 生成的训练海报"
          draggable={false}
          style={{ scale, x, y }}
          className="max-w-[92%] max-h-[92%] object-contain rounded-2xl shadow-2xl"
        />
        {isRegenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* 页内提示（替代 alert 阻塞） */}
      {shareFallback && (
        <div className="absolute left-0 right-0 flex justify-center" style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}>
          <div className="bg-white/10 text-white/80 text-[12px] font-medium px-4 py-2 rounded-full">
            已保存到下载
          </div>
        </div>
      )}

      {/* 底部操作栏：分享（浅玻璃）/ 重新生成（深玻璃主行动），与父层底部栏同规格 */}
      <div
        className="absolute left-0 right-0 flex justify-center gap-3 px-6"
        style={{ bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          onClick={handleShare}
          disabled={isSharing}
          className="liquid-glass flex-1 h-[50px] font-semibold text-[17px] rounded-full flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {isSharing ? (
            <div className="w-5 h-5 border-2 border-gray-900/20 border-t-gray-900 rounded-full animate-spin" />
          ) : (
            <>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
              </svg>
              <span>分享</span>
            </>
          )}
        </button>

        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="liquid-glass-dark flex-1 h-[50px] text-white font-semibold text-[17px] rounded-full flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {isRegenerating ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              <span>重新生成</span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};

/** dataURL → Blob（按 dataURL 自带 MIME 解析） */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadDataUrl(dataUrl: string) {
  const mime = dataUrl.slice(0, dataUrl.indexOf(';')).replace('data:', '') || 'image/png';
  const ext = mime.includes('svg') ? 'svg' : mime.includes('jpeg') ? 'jpg' : 'png';
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `starfit-poster.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
