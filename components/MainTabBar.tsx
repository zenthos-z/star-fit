// MainTabBar — 底部导航：2 页签（历史 / 开始运动）+ 独立 AI 圆钮（BookPlayer 式）。
// iOS：原生系统 Tab Bar（Liquid Glass 官方视觉+交互）覆盖 WebView 底部，
//      本组件只做安全区占位 + 事件接线；其他端：CSS 玻璃回落。
import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { isNativeTabBar, showTabBar, setCurrentTab, hideTabBar, onTabSelect, onAiTap as bindAiTap, getSelectedTab } from '../src/lib/nativeTabBar';

export type MainTab = 0 | 1;

interface MainTabBarProps {
  tab: MainTab;
  onSelect: (tab: MainTab) => void;
  onAiTap: () => void;
  /** 沉浸场景（结算页/教程等）整体隐藏 */
  hidden?: boolean;
}

const TAB_META = [
  { title: '历史', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { title: '开始运动', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
] as const;

const MainTabBar: React.FC<MainTabBarProps> = ({ tab, onSelect, onAiTap, hidden }) => {
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const aiTapRef = useRef(onAiTap);
  aiTapRef.current = onAiTap;
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
      selectRef.current(index as MainTab);
    });
    bindAiTap(() => aiTapRef.current());
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
      if (cur === 2) {
        aiTapRef.current();
        setCurrentTab(1); // 搜索位不驻留，弹回运动页
      } else if (cur !== tabRef.current) {
        setCurrentTab(cur);
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
            onClick={() => onSelect(i as MainTab)}
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

      {/* 独立 AI 圆钮（BookPlayer 式，不参与 tab 切换） */}
      <button
        type="button"
        aria-label="AI Agent"
        onClick={() => aiTapRef.current()}
        className="w-11 h-11 rounded-full liquid-glass shadow-md flex items-center justify-center self-center mr-3 active:scale-90 transition-transform shrink-0 text-gray-800"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9L12 3z" />
        </svg>
      </button>
    </nav>,
    document.body,
  );
};

export default MainTabBar;
