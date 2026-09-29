import { describe, it, expect } from 'vitest';
import {
  distanceFromBottom,
  updateScrollFollow,
  snapIfFollowing,
  CHAT_FOLLOW_DETACH_PX,
  THINKING_FOLLOW_DETACH_PX,
  type ScrollFollowRef,
} from '../chatScrollFollow';

/**
 * chatScrollFollow（issue #55-2）— 聊天流「滚动跟随/让位」纯逻辑单测。
 *
 * 用户实测：「思考链加载中整个对话界面被锁：一往上滑就被自动带回底部」。
 * 本模块把「用户是否在底部」的判定收敛为纯函数，供聊天主容器与思考链
 * 小窗共用；这里锁定 detach/attach 阈值边界与程序化贴底不误判。
 */

const metrics = (scrollHeight: number, scrollTop: number, clientHeight: number) => ({
  scrollHeight,
  scrollTop,
  clientHeight,
});

describe('distanceFromBottom', () => {
  it('贴底时距离为 0', () => {
    expect(distanceFromBottom(metrics(1000, 800, 200))).toBe(0);
  });

  it('上滑后距离为 scrollHeight - scrollTop - clientHeight', () => {
    expect(distanceFromBottom(metrics(1000, 300, 200))).toBe(500);
  });
});

describe('updateScrollFollow（让位判定）', () => {
  it('贴底 → 跟随（follow=true）', () => {
    const follow: ScrollFollowRef = { current: false };
    updateScrollFollow(metrics(1000, 800, 200), follow);
    expect(follow.current).toBe(true);
  });

  it('上滑超过阈值 → 让位（follow=false）', () => {
    const follow: ScrollFollowRef = { current: true };
    updateScrollFollow(metrics(1000, 300, 200), follow, CHAT_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(false);
  });

  it('距离恰等于阈值 → 仍视为跟随（边界含在跟随侧）', () => {
    const follow: ScrollFollowRef = { current: true };
    // scrollHeight 1000, clientHeight 200, scrollTop 752 → 距离 48 = CHAT_FOLLOW_DETACH_PX
    updateScrollFollow(metrics(1000, 752, 200), follow, CHAT_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(true);
  });

  it('距离超阈值 1px → 让位（边界外一侧）', () => {
    const follow: ScrollFollowRef = { current: true };
    updateScrollFollow(metrics(1000, 751, 200), follow, CHAT_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(false);
  });

  it('回到底部 → 恢复跟随（ChatGPT 式：手动回底才续看）', () => {
    const follow: ScrollFollowRef = { current: false };
    updateScrollFollow(metrics(1000, 795, 200), follow, CHAT_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(true);
  });

  it('思考链小窗用更小阈值（THINKING_FOLLOW_DETACH_PX）', () => {
    const follow: ScrollFollowRef = { current: true };
    // scrollHeight 5000, clientHeight 200, scrollTop 4752 → 距离 48：
    // 聊天容器阈值下算跟随，思考小窗阈值（24）下算让位
    updateScrollFollow(metrics(5000, 4752, 200), follow, CHAT_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(true);
    updateScrollFollow(metrics(5000, 4752, 200), follow, THINKING_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(false);
  });
});

describe('snapIfFollowing（贴底守卫）', () => {
  it('跟随中 → 执行贴底并返回 true', () => {
    const el = { scrollTop: 0, scrollHeight: 5000 };
    const follow: ScrollFollowRef = { current: true };
    expect(snapIfFollowing(el, follow)).toBe(true);
    expect(el.scrollTop).toBe(5000);
  });

  it('让位中 → 不贴底（不抢占用户手势）并返回 false', () => {
    const el = { scrollTop: 100, scrollHeight: 5000 };
    const follow: ScrollFollowRef = { current: false };
    expect(snapIfFollowing(el, follow)).toBe(false);
    expect(el.scrollTop).toBe(100);
  });
});
