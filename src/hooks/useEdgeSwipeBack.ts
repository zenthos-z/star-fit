/**
 * useEdgeSwipeBack — iOS 左缘右滑返回手势（interactivePopGesture 语义）
 * [issue #83] AI 教练等全屏 Web 层（sheet 转场，非原生导航栈）补齐平台惯例。
 *
 * 交互语义（与 iOS 原生边缘返回一致）：
 * - 仅左缘窄带（EDGE_SWIPE_BAND_PX ≈ 20pt）起滑才触发；页面中部/右缘起滑不感知；
 * - 优先级规则（项目定夺，写死）：左缘窄带起滑后手势**永远优先** —— 捕获阶段
 *   stopPropagation + preventDefault，页面内任何横向滑动手势无条件让位，
 *   不做「横向滑动冲突检测」式的条件让步；
 * - 竖向意图不劫持：dy 占优时放行原生滚动（iOS 手势仲裁同款判定，属于意图
 *   判定而非对页面内容的让步）；
 * - 跟手：位移 60fps 直写（MotionValue / DOM style），不经 React state；
 * - 释放动画 = transitions.sheet 曲线（420ms cubic-bezier(0.32,0.72,0,1)），
 *   与 sheet 开合转场同一手感；越过屏宽 1/3 或快速轻扫即提交返回；
 * - 提交后回调 onBack —— 与返回按钮同一语义、同一通道，按钮行为不变。
 *
 * 双模式适配两类全屏层：
 * - DOM 模式（传 dom）：普通 div + CSS transition 转场（如 AICoachOverlay 根层）。
 *   hook 在手势期间接管 el.style.transform/transition，结束后还原 React 管辖值
 *   （React 只在 vdom 变化时写 DOM，字符串不一致会残留，必须显式还原）；
 * - framer 模式（不传 dom）：hook 只驱动返回的 x MotionValue，由调用方放进
 *   style={{ x }} 让 framer-motion 组合 transform（如 ChatHistoryPanel /
 *   MessageImageViewer）。提交后 x 停在全宽（exit 动画在屏外播放），重开时归零。
 *
 * 已知边界：iOS Safari 浏览器的系统级边缘手势（历史导航）先于 Web 层接管，
 * 本手势在 App 壳（WKWebView / Capacitor、Android WebView）中全量生效。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, useMotionValue, type MotionValue } from 'framer-motion';
import { transitions } from '../lib/animations';
import { haptic } from '../lib/nativeHaptics';

/** 左缘判定带宽（px）：iOS 边缘返回手势的窄带宽度（≈20pt） */
export const EDGE_SWIPE_BAND_PX = 20;

/** 激活位移（px）：右移超过该值判定为返回手势（区分点按） */
const ACTIVATE_DX_PX = 6;

/** 提交位移比例：跟手位移超过屏宽 1/3 直接提交 */
const COMMIT_RATIO = 1 / 3;

/** 提交速度（px/ms ≈ 500px/s）：快速轻扫即使位移不足也提交（iOS 轻扫即走手感） */
const COMMIT_VELOCITY = 0.5;

/** 速度采样窗口（ms） */
const VELOCITY_WINDOW_MS = 100;

/** 手势结束后吞掉误触 click 的窗口（ms）：释放点压在按钮/列表行上不误触发 */
const CLICK_GUARD_MS = 400;

/** DOM 模式适配：hook 接管元素样式所需的三个「React 管辖值」 */
export interface EdgeSwipeDomAdapter {
  /** 打开态基础变换（如 'translateY(0)'），跟手时叠加 translateX */
  restTransform: string;
  /** 关闭态停靠变换（如 'translateY(100%)'），提交动画走完后停靠 */
  closedTransform: string;
  /** React 管辖的 transition 串，手势结束（提交/取消）后还原 */
  restTransition: string;
}

interface EdgeSwipeBackOptions {
  /** 手势可用：该层处于打开态且为最顶层（被上层盖住时让位，不跨层返回） */
  enabled: boolean;
  /** 提交返回：释放动画走完再回调，与返回按钮同一语义 */
  onBack: () => void;
  /** DOM 模式适配（framer-motion 层不传，hook 只驱动 x） */
  dom?: EdgeSwipeDomAdapter;
}

export interface EdgeSwipeBackResult {
  /** 绑定到本层根元素：手势监听挂这里，capture 捕获子树全部触点。
   *  callback ref——条件渲染的层（如 AnimatePresence 内的 motion.div）后挂载时
   *  也会触发监听装配（对象 ref + 空 deps effect 会在 ref 为 null 时永久跳过）。 */
  ref: (node: HTMLDivElement | null) => void;
  /** 跟手位移（px）。framer 层放进 style={{ x }}；DOM 层由 hook 直写 style */
  x: MotionValue<number>;
}

export function useEdgeSwipeBack({ enabled, onBack, dom }: EdgeSwipeBackOptions): EdgeSwipeBackResult {
  // callback ref → 元素就绪状态驱动监听装配（涵盖「组件常驻、根元素条件渲染」的层）
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), []);
  const x = useMotionValue(0);

  // 回调快照进 ref：touch 监听只在挂载时装一次，回调读最新值
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const domRef = useRef(dom);
  domRef.current = dom;

  // 重开时归零：上一轮提交后 x 停在全宽（framer 层 exit 在屏外播放），下次呈现必须从 0 开始。
  // useLayoutEffect：在 framer 起播/首帧绘制前复位，避免 opacity 动画期间闪现右移位。
  useLayoutEffect(() => {
    if (enabled) x.set(0);
  }, [enabled, x]);

  useEffect(() => {
    if (!el) return;
    const target = el;

    // ── 手势状态机：idle → armed（触点落左缘窄带）→ owned（跟手接管）→ commit | cancel ──
    let armed = false;   // 等待意图判定
    let owned = false;   // hook 接管元素期间（跟手 + 释放动画，DOM 模式下独占 transform）
    let startX = 0;
    let startY = 0;
    let width = 0;
    let releaseAnim: ReturnType<typeof animate> | null = null;
    let clickGuardUntil = 0;
    const samples: Array<{ x: number; t: number }> = [];

    const setDom = (fn: (style: CSSStyleDeclaration) => void) => {
      const d = domRef.current;
      if (!d) return;
      fn(target.style);
    };

    // DOM 模式：owned 期间 x 驱动 style.transform（60fps 直写，不经 React state）
    const unsubX = x.on('change', (v) => {
      const d = domRef.current;
      if (!d || !owned) return;
      target.style.transform = `${d.restTransform} translateX(${v}px)`;
    });

    /** 手势收尾：先落最终变换（transition 仍为 none，无 CSS 动画），再还原 React 管辖的 transition */
    const restoreDom = (finalTransform: string) => {
      setDom((s) => { s.transition = 'none'; });
      setDom((s) => { s.transform = finalTransform; });
      setDom((s) => { s.transition = domRef.current?.restTransition ?? ''; });
    };

    /** 立即中止释放动画并交还元素（新一轮触点抢占 / 卸载清理时用） */
    const abortRelease = () => {
      if (!releaseAnim) return;
      releaseAnim.stop();
      releaseAnim = null;
      owned = false;
      if (domRef.current) restoreDom(domRef.current.restTransform);
    };

    const velocityOf = (): number => {
      const now = performance.now();
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
      if (samples.length < 2) return 0;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = b.t - a.t;
      return dt > 0 ? (b.x - a.x) / dt : 0;
    };

    /** 释放结算：sheet 曲线滑到目标位，走完再提交/还原 */
    const settle = (commit: boolean) => {
      clickGuardUntil = performance.now() + CLICK_GUARD_MS;
      releaseAnim = animate(x, commit ? width : 0, {
        ...transitions.sheet,
        onComplete: () => {
          releaseAnim = null;
          owned = false;
          if (commit) {
            if (domRef.current) {
              // 停靠关闭位并还原样式所有权；owned 已 false，x 归零不会改写停靠值
              restoreDom(domRef.current.closedTransform);
              x.set(0);
            }
            onBackRef.current();
          } else if (domRef.current) {
            restoreDom(domRef.current.restTransform);
          }
        },
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      abortRelease(); // 上一段释放动画未完又按下：立即交还元素，重新判定
      if (!enabledRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      armed = t.clientX <= EDGE_SWIPE_BAND_PX;
      if (!armed) return;
      startX = t.clientX;
      startY = t.clientY;
      width = window.innerWidth;
      samples.length = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armed) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!owned) {
        // 意图判定：右移且横向占优才激活；竖向意图放行原生滚动（iOS 同款仲裁）
        if (dx > ACTIVATE_DX_PX && dx > Math.abs(dy)) {
          owned = true;
          setDom((s) => { s.transition = 'none'; });
          haptic('light');
        } else {
          return; // 未激活：不拦截，点按/竖向滚动照常
        }
      }
      // 已接管：永远优先 —— 捕获阶段截断子树（页面内横向手势无条件让位）+ 阻止原生滚动
      e.preventDefault();
      e.stopPropagation();
      x.set(Math.min(Math.max(dx, 0), width));
      samples.push({ x: t.clientX, t: performance.now() });
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!armed) return;
      armed = false;
      if (!owned) return; // 点按/未激活：click 照常
      const t = e.changedTouches[0];
      const dx = t ? Math.max(0, t.clientX - startX) : 0;
      const commit = dx > width * COMMIT_RATIO ||
        (dx > ACTIVATE_DX_PX && velocityOf() > COMMIT_VELOCITY);
      if (t) e.preventDefault(); // 已接管手势的终结：阻止合成 click 链
      settle(commit);
    };

    const onTouchCancel = () => {
      if (!armed) return;
      armed = false;
      if (!owned) return;
      settle(false); // 系统打断（来电/手势冲突）：一律弹回
    };

    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < clickGuardUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    target.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    target.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    target.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    target.addEventListener('touchcancel', onTouchCancel, { capture: true });
    target.addEventListener('click', onClickCapture, { capture: true });

    return () => {
      unsubX();
      target.removeEventListener('touchstart', onTouchStart, { capture: true });
      target.removeEventListener('touchmove', onTouchMove, { capture: true });
      target.removeEventListener('touchend', onTouchEnd, { capture: true });
      target.removeEventListener('touchcancel', onTouchCancel, { capture: true });
      target.removeEventListener('click', onClickCapture, { capture: true });
      abortRelease();
    };
    // 元素就绪/更换时装配（callback ref 驱动）；enabled/onBack 经 ref 快照读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);

  return { ref, x };
}
