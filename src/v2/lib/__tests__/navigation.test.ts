import { describe, it, expect } from 'vitest';
import { navigationReducer, initialNavigation, type NavigationState } from '../navigation';

describe('navigationReducer', () => {
  it('初始为 home', () => {
    expect(initialNavigation).toEqual({ screen: 'home' });
  });

  it('home -> history -> settings，settings 返回 history', () => {
    let s: NavigationState = initialNavigation;
    s = navigationReducer(s, { type: 'OPEN_HISTORY' });
    expect(s).toEqual({ screen: 'history' });
    s = navigationReducer(s, { type: 'OPEN_SETTINGS' });
    expect(s).toEqual({ screen: 'settings' });
    s = navigationReducer(s, { type: 'BACK' });
    expect(s).toEqual({ screen: 'history' });
  });

  it('home 直接 BACK 无效（停留在 home）', () => {
    const s = navigationReducer(initialNavigation, { type: 'BACK' });
    expect(s).toEqual({ screen: 'home' });
  });

  it('历史记录详情走 HISTORY_DETAIL，BACK 回 history', () => {
    let s = navigationReducer(initialNavigation, { type: 'OPEN_HISTORY' });
    s = navigationReducer(s, { type: 'OPEN_HISTORY_DETAIL', sessionId: 'abc' });
    expect(s).toEqual({ screen: 'history-detail', sessionId: 'abc' });
    s = navigationReducer(s, { type: 'BACK' });
    expect(s).toEqual({ screen: 'history' });
  });

  it('settlement BACK 回 home', () => {
    let s = navigationReducer(initialNavigation, { type: 'SETTLEMENT' });
    expect(s).toEqual({ screen: 'settlement' });
    s = navigationReducer(s, { type: 'BACK' });
    expect(s).toEqual({ screen: 'home' });
  });

  it('overlay 与 screen 正交：AI 浮层可叠在 home 上并可关闭', () => {
    let s = navigationReducer(initialNavigation, { type: 'OPEN_OVERLAY', overlay: 'ai-coach' });
    expect(s).toEqual({ screen: 'home', overlay: 'ai-coach' });
    s = navigationReducer(s, { type: 'CLOSE_OVERLAY' });
    expect(s).toEqual({ screen: 'home' });
  });

  it('切屏时清空 overlay（历史 -> home 不残留浮层）', () => {
    let s = navigationReducer(initialNavigation, { type: 'OPEN_OVERLAY', overlay: 'ai-coach' });
    s = navigationReducer(s, { type: 'OPEN_HISTORY' });
    expect(s).toEqual({ screen: 'history' });
  });
});
