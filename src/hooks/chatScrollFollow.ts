/**
 * chatScrollFollow（issue #55）— 聊天流「滚动跟随/让位」纯逻辑。
 *
 * ChatGPT 式交互惯例：流式更新时自动贴底跟随，但用户主动上滑阅读后
 * 暂停自动滚动，直到用户回到底部才恢复跟随。此前 isUserScrollingRef
 * 守卫从未被写入（死代码），流式期间每 200ms 的 setState 都会把页面
 * 拽回底部——「思考链加载中锁死页面滚动」的直接根因。
 *
 * 判定口径：距底部距离 = scrollHeight - scrollTop - clientHeight。
 * - 距离 > detachPx：视为用户已离开底部 → 让位（follow = false）
 * - 距离 ≤ detachPx：回到底部 → 恢复跟随（follow = true）
 * 程序化贴底（scrollTop = scrollHeight）触发的 scroll 事件距离≈0，
 * 天然不会误判为「用户离开」；内容追加不触发 scroll 事件，也不会误判。
 */

/** 聊天主容器让位阈值（px）：上滑超过此距离即暂停自动贴底。 */
export const CHAT_FOLLOW_DETACH_PX = 48;

/** 思考链小窗让位阈值（px）：窗口本身只有 ~120px 高，用更小的阈值。 */
export const THINKING_FOLLOW_DETACH_PX = 24;

export interface ScrollFollowRef {
  current: boolean;
}

/** 距底部距离（px）。注入 metrics 便于单测，不必伪造布局。 */
export function distanceFromBottom(m: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): number {
  return m.scrollHeight - m.scrollTop - m.clientHeight;
}

/**
 * 按当前滚动位置刷新 follow 状态（挂在容器的 scroll 监听 / onScroll 上）。
 */
export function updateScrollFollow(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  follow: ScrollFollowRef,
  detachPx: number = CHAT_FOLLOW_DETACH_PX,
): void {
  follow.current = distanceFromBottom(metrics) <= detachPx;
}

/** 跟随中才贴底（用户让位期间不抢占手势）。返回是否实际执行了贴底。 */
export function snapIfFollowing(
  el: { scrollTop: number; scrollHeight: number },
  follow: ScrollFollowRef,
): boolean {
  if (!follow.current) return false;
  el.scrollTop = el.scrollHeight;
  return true;
}
