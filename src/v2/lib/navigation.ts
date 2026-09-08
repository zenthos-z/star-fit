// 导航状态机：screen（互斥全屏层）+ overlay（可叠加浮层）。
// 规则：settings 只能从 history 进入（BACK 固定回 history，与既有交互一致）。
// 消费方：main/App.tsx（useReducer 承载原 currentRoute/viewHistorySession/isAiOverlayOpen 等平行 state）。
export type Overlay = 'ai-coach' | 'exercise-settings' | 'tutorial' | 'reorder' | 'time-editor' | null;

export type NavigationState =
  | { screen: 'home'; overlay?: Overlay }
  | { screen: 'history'; overlay?: Overlay }
  | { screen: 'settings' }                                  // BACK 固定回 history
  | { screen: 'history-detail'; sessionId: string; overlay?: Overlay } // BACK 回 history
  | { screen: 'settlement' };                               // BACK 回 home

export const initialNavigation: NavigationState = { screen: 'home' };

export type NavigationAction =
  | { type: 'OPEN_HISTORY' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'OPEN_HISTORY_DETAIL'; sessionId: string }
  | { type: 'SETTLEMENT' }
  | { type: 'HOME' }
  | { type: 'BACK' }
  | { type: 'OPEN_OVERLAY'; overlay: Exclude<Overlay, null> }
  | { type: 'CLOSE_OVERLAY' };

export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  const withOverlay = (s: NavigationState, overlay: Overlay): NavigationState => {
    if (s.screen === 'settings' || s.screen === 'settlement') return s; // 这两层不承载 overlay
    const next = { ...s, overlay };
    if (overlay === null) delete (next as { overlay?: Overlay }).overlay; // 关闭时移除键，状态保持规范形
    return next;
  };
  switch (action.type) {
    case 'OPEN_HISTORY':        return withOverlay({ screen: 'history' }, null);
    case 'OPEN_SETTINGS':       return { screen: 'settings' };
    case 'OPEN_HISTORY_DETAIL': return withOverlay({ screen: 'history-detail', sessionId: action.sessionId }, null);
    case 'SETTLEMENT':          return { screen: 'settlement' };
    case 'HOME':                return withOverlay({ screen: 'home' }, null);
    case 'BACK':
      switch (state.screen) {
        case 'settings':        return { screen: 'history' };
        case 'history-detail':  return { screen: 'history' };
        case 'settlement':      return { screen: 'home' };
        default:                return state;   // home/history 的 BACK 由各自组件处理
      }
    case 'OPEN_OVERLAY':        return withOverlay(state, action.overlay);
    case 'CLOSE_OVERLAY':       return withOverlay(state, null);
    default:                    return state;
  }
}
