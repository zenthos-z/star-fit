/**
 * PageActionsMenu — 页级「···」菜单（信息页右上角，tab 页规范 design-spec §1）。
 *
 * iOS：原生 Liquid Glass 菜单（透明锚点按钮叠在触发钮上，系统菜单）；
 * Web/Android：自绘玻璃菜单回落。逻辑与 History.tsx 既有实现同款
 * （挂载时等入场 transform 归位再读 rect）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../lib/nativeHaptics';
import { transitions } from '../../lib/animations';
import {
  isNativeGlassMenu,
  showGlassMenu,
  hideGlassMenu,
  onGlassMenuSelect,
  type GlassMenuItem,
} from '../../lib/nativeGlassMenu';

export interface PageActionsMenuProps {
  items: GlassMenuItem[];
  /** 原生菜单选项分发（index 对应 items；separator 槽位不会回传） */
  onSelect: (index: number) => void;
}

export function PageActionsMenu({ items, onSelect }: PageActionsMenuProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // 原生菜单：挂载时等页面入场动画（scale 0.9→1）结束、rect 稳定后再挂锚点
  useEffect(() => {
    if (!isNativeGlassMenu) return;
    onGlassMenuSelect((index) => onSelectRef.current(index));
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let mounted = false;
    const mountAnchor = () => {
      if (cancelled || mounted) return;
      mounted = true;
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (rect) {
        void showGlassMenu(items, { x: rect.left, y: rect.top, size: rect.width });
      }
    };
    const waitStable = () => {
      if (cancelled || mounted) return;
      const read = () => {
        const r = menuButtonRef.current?.getBoundingClientRect();
        return r ? [r.left, r.top, r.width] : null;
      };
      let prev: number[] | null = null;
      let rounds = 0;
      const tick = () => {
        if (cancelled || mounted) return;
        const cur = read();
        const stable = prev && cur
          && Math.abs(cur[0] - prev[0]) < 0.5
          && Math.abs(cur[1] - prev[1]) < 0.5
          && Math.abs(cur[2] - prev[2]) < 0.5;
        if (cur && stable && rounds >= 2) {
          mountAnchor();
        } else {
          prev = cur;
          rounds += 1;
          pollTimer = setTimeout(tick, 80);
        }
      };
      tick();
    };
    waitStable();
    const hardTimeout = setTimeout(mountAnchor, 1500);
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(hardTimeout);
      hideGlassMenu();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSelect = (index: number, viaWeb: boolean) => {
    if (viaWeb) setMenuOpen(false);
    haptic('light');
    onSelect(index);
  };

  return (
    <>
      <button
        ref={menuButtonRef}
        onClick={() => {
          if (!isNativeGlassMenu) {
            setMenuOpen(!menuOpen);
          }
        }}
        aria-label="更多操作"
        aria-expanded={menuOpen}
        className={`w-11 h-11 shrink-0 rounded-full shadow-sm transition-all active:scale-90 flex items-center justify-center ${menuOpen ? 'bg-star-dark text-white' : 'bg-white text-gray-600'}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-5 h-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      </button>

      {/* Web/Android 自绘菜单回落 */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-30"
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.92 }}
              transition={transitions.springGentle}
              role="menu"
              className="liquid-glass absolute right-4 z-40 w-60 rounded-2xl p-1.5 flex flex-col gap-0.5"
              style={{ top: 'calc(var(--safe-top, 0px) + 60px)', transformOrigin: 'top right' }}
            >
              {items.map((item, index) =>
                'separator' in item && item.separator ? (
                  <div key={`sep-${index}`} className="my-1 h-px bg-gray-100/60 mx-2" />
                ) : (
                  <button
                    key={index}
                    onClick={() => runSelect(index, true)}
                    role="menuitem"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left active:bg-black/5 ${item.danger ? 'text-red-600' : 'text-gray-800'}`}
                  >
                    <span className="text-[15px] font-medium">{item.title}</span>
                  </button>
                ),
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
