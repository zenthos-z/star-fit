import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MUSCLE_PRIMARY_CHIP_CLASS,
  MUSCLE_PRIMARY_COLOR,
  MUSCLE_SECONDARY_CHIP_CLASS,
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

interface MuscleMapSectionProps {
  /** 主发力肌群（17 基准词表值或原样字符串） */
  primary: string[];
  /** 次发力肌群 */
  secondary: string[];
  /** 父级交互锁定（sheet 拖拽/关闭中）：false = 隐藏原生图防漂移 */
  interactive?: boolean;
}

type NativeState = 'probing' | 'active' | 'fallback';

/**
 * MuscleMapSection — 肌群可视化区（A4，issue #12 定案）。
 *
 * iOS：MuscleMap 人体图（front/back 双视图）由原生层渲染、覆盖在占位容器上，
 * 纯色高亮——主发力高饱和橙红、次发力同色系低饱和（配色见 lib/muscleMap）。
 * 容器滚动经捕获阶段监听 + rAF 节流重报 rect；出视口或 sheet 拖拽时隐藏。
 * 非 iOS / 桥未就绪（probing → fallback）→ 收起占位，仅渲染肌群胶囊（降级）。
 * 胶囊图例常驻（图例语义，与定稿参考布局一致）。
 */
export const MuscleMapSection: React.FC<MuscleMapSectionProps> = ({
  primary,
  secondary,
  interactive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
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

  // 卸载 / 交互锁定 / 降级：隐藏原生图（清理语义独立于上报，避免重报闪烁）
  useEffect(() => () => hideNativeMuscleMap(), []);
  useEffect(() => {
    if (!interactive || nativeState === 'fallback') hideNativeMuscleMap();
  }, [interactive, nativeState]);

  // 数据/交互态恢复：上报 rect（首帧含 probing → active/fallback 一次性探测）
  useEffect(() => {
    if (nativeState === 'fallback' || !interactive) return;
    const t = window.setTimeout(async () => {
      const ok = await reportRect();
      if (!ok) setNativeState('fallback');
    }, 60);
    return () => window.clearTimeout(t);
  }, [nativeState, interactive, primary, secondary, reportRect]);

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

  return (
    <div className="mt-5" role="group" aria-label="发力肌群">
      <div className="text-xs text-gray-400 font-medium mb-2">发力肌群</div>

      {/* 占位容器：原生图覆盖其上；fallback 时收起占位只留胶囊 */}
      {nativeState !== 'fallback' && (
        <div
          ref={containerRef}
          className="w-full h-48 rounded-2xl bg-gray-50 overflow-hidden"
          aria-hidden="true"
        />
      )}

      {/* 胶囊图例（常驻；降级时即肌群可视化的唯一形态） */}
      <div className={`flex flex-wrap gap-2 ${nativeState === 'active' ? 'mt-3' : ''}`}>
        {primary.map((mg, i) => (
          <span
            key={`p-${i}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${MUSCLE_PRIMARY_CHIP_CLASS}`}
          >
            {muscleLabelZh(mg)}
          </span>
        ))}
        {secondary.map((mg, i) => (
          <span
            key={`s-${i}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${MUSCLE_SECONDARY_CHIP_CLASS}`}
          >
            {muscleLabelZh(mg)}
          </span>
        ))}
      </div>
    </div>
  );
};
