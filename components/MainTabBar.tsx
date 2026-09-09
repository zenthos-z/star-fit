// MainTabBar — 底部导航：3 页签（历史 / 开始运动 / AI Agent）。
// iOS：原生系统 Tab Bar（Liquid Glass 官方视觉+交互）覆盖 WebView 底部，
//      本组件只做安全区占位 + 事件接线；其他端：CSS 玻璃回落。
import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { isNativeTabBar, showTabBar, setCurrentTab, hideTabBar, onTabSelect, getSelectedTab } from '../src/lib/nativeTabBar';
import { haptic } from '../src/lib/nativeHaptics';

export type MainTab = 0 | 1 | 2;

interface MainTabBarProps {
  tab: MainTab;
  onSelect: (tab: MainTab) => void;
  /** 沉浸场景（结算页/教程等）整体隐藏 */
  hidden?: boolean;
}

const TAB_META = [
  { title: '历史', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { title: '开始运动', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { title: 'AI Agent', icon: 'M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9L12 3z' },
] as const;

const MainTabBar: React.FC<MainTabBarProps> = ({ tab, onSelect, hidden }) => {
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    if (!isNativeTabBar) return;
    document.body.classList.add('native-tabbar');
    return () => { document.body.classList.remove('native-tabbar'); };
  }, []);

  // 原生系统 Tab Bar：常驻创建 + 事件接线
  useEffect(() => {
    if (!isNativeTabBar || hidden) return;
    showTabBar(tabRef.current);
    onTabSelect((index) => {
      setCurrentTab(index);
      haptic('light'); // tab 切换：轻触感（原生 delegate 路径）
      selectRef.current(index as MainTab);
    });
    return () => hideTabBar();
  }, [hidden]);

  // JS 侧路由变化（如结算回主页）→ 同步原生选中态
  useEffect(() => {
    if (!isNativeTabBar || hidden) return;
    setCurrentTab(tab);
  }, [tab, hidden]);

  // 轮询兜底：tabs 模式下系统 delegate/KVO 回调不可靠，300ms 轮询原生选中索引
  useEffect(() => {
    if (!isNativeTabBar || hidden) return;
    let last = -2;
    const t = setInterval(async () => {
      const cur = await getSelectedTab();
      if (cur === null || cur === last) return;
      console.log('[poll] tab ->', cur);
      last = cur;
      if (cur !== tabRef.current) {
        setCurrentTab(cur);
        haptic('light'); // tab 切换：轻触感（轮询兜底路径）
        selectRef.current(cur as MainTab);
      }
    }, 300);
    return () => clearInterval(t);
  }, [hidden]);

  if (isNativeTabBar) {
    // 原生 tab bar 悬浮在 WebView 之上（玻璃透出内容）：
    // Web 只需全局留出底部安全区 + bar 高度的滚动余量，不做占位分割
    return createPortal(
      <style>{`
        body.native-tabbar { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 72px); }
      `}</style>,
      document.head,
    );
  }

  // ===== 非 iOS 回落：CSS 玻璃 3 页签 =====
  return createPortal(
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex liquid-glass"
      style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}
      aria-label="主导航"
    >
      {TAB_META.map((t, i) => {
        const active = tab === i;
        return (
          <button
            key={t.title}
            type="button"
            aria-current={active ? 'page' : undefined}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 relative"
            onClick={() => {
              haptic('light'); // tab 切换：轻触感（CSS 回落路径）
              onSelect(i as MainTab);
            }}
          >
            {active && (
              <span className="absolute inset-x-3 inset-y-1 rounded-full bg-star-accent/10" />
            )}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2}
              stroke="currentColor"
              className={`w-5 h-5 relative z-10 ${active ? 'text-star-accent' : 'text-star-dark/60'}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
            <span className={`text-[10px] font-black tracking-wide relative z-10 ${active ? 'text-star-accent' : 'text-star-dark/60'}`}>
              {t.title}
            </span>
          </button>
        );
      })}
    </nav>,
    document.body,
  );
};

export default MainTabBar;
