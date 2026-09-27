/**
 * MuscleMapThumb — 列表行首肌群可视化小图（A8 v3）
 *
 * iOS 原生可用时：44px 缩小版 MuscleMap——上报 rect 机制照搬
 * MuscleMapSection（showNativeMuscleMap + 捕获阶段滚动监听 rAF 重报 +
 * 出视口/卸载隐藏），原生人体图覆盖在占位容器上。
 * 非 iOS / 桥未就绪：降级为紧凑肌群胶囊（主发力小号胶囊，不占行高）。
 * 数据源：primary_muscles/secondary_muscles（17 词表 → muscleMap 36 肌群映射）。
 *
 * 已知边界：原生 MuscleMapPlugin 单视图实例，列表多行同屏各自上报时会互相
 * 覆盖（后报者胜）——多行并显需原生侧支持多实例，接入时按原生能力裁量。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MUSCLE_PRIMARY_CHIP_CLASS,
  MUSCLE_PRIMARY_COLOR,
  MUSCLE_SECONDARY_COLOR,
  MUSCLE_SECONDARY_OPACITY,
  muscleLabelZh,
  toMuscleMapSlugs,
} from '../../lib/muscleMap';
import {
  hideNativeMuscleMap,
  showNativeMuscleMap,
  supportsNativeMuscleMap,
} from '../../lib/nativeMuscleMap';

interface MuscleMapThumbProps {
  primary: string[];
  secondary: string[];
}

type NativeState = 'probing' | 'active' | 'fallback';

export const MuscleMapThumb: React.FC<MuscleMapThumbProps> = ({ primary, secondary }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | null>(null);
  const [nativeState, setNativeState] = useState<NativeState>(() =>
    supportsNativeMuscleMap() ? 'probing' : 'fallback',
  );

  const payload = useCallback(
    () => ({
      primary: toMuscleMapSlugs(primary),
      secondary: toMuscleMapSlugs(secondary),
      primaryColor: MUSCLE_PRIMARY_COLOR,
      secondaryColor: MUSCLE_SECONDARY_COLOR,
      secondaryOpacity: MUSCLE_SECONDARY_OPACITY,
    }),
    [primary, secondary],
  );

  const reportRect = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return showNativeMuscleMap(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      payload(),
    );
  }, [payload]);

  const syncNativeView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 出视口（滚动远离）：隐藏，防原生图悬浮到无关内容上
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hideNativeMuscleMap();
      return;
    }
    void reportRect();
  }, [reportRect]);

  // 卸载 / 降级：隐藏原生图（清理语义独立于上报）
  useEffect(() => () => hideNativeMuscleMap(), []);
  useEffect(() => {
    if (nativeState === 'fallback') hideNativeMuscleMap();
  }, [nativeState]);

  // 首帧探测 + 数据变化重报（60ms 与 MuscleMapSection 同节奏）
  useEffect(() => {
    if (nativeState === 'fallback') return;
    const t = window.setTimeout(async () => {
      const ok = await reportRect();
      if (!ok) setNativeState('fallback');
    }, 60);
    return () => window.clearTimeout(t);
  }, [nativeState, primary, secondary, reportRect]);

  // 滚动跟随：捕获阶段监听任意滚动祖先，rAF 节流重报 rect
  useEffect(() => {
    if (nativeState !== 'active') return;
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        syncNativeView();
      });
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [nativeState, syncNativeView]);

  if (nativeState === 'fallback') {
    // 降级形态：紧凑肌群胶囊（主发力，小号不占行高；次发力在教程 sheet 详列）
    return (
      <span className="w-14 shrink-0 flex flex-wrap gap-1 content-center" aria-label={`主发力肌群 ${primary.map(muscleLabelZh).join('、')}`}>
        {primary.slice(0, 2).map((mg, i) => (
          <span
            key={`p-${i}`}
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-tight ${MUSCLE_PRIMARY_CHIP_CLASS}`}
          >
            {muscleLabelZh(mg)}
          </span>
        ))}
      </span>
    );
  }

  // probing / active：44px 占位容器（原生图覆盖其上）
  return (
    <span
      ref={containerRef}
      className="w-11 h-11 rounded-xl bg-gray-50 overflow-hidden shrink-0"
      aria-hidden="true"
    />
  );
};

export default MuscleMapThumb;
