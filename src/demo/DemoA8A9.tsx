/**
 * A8+A9 动作选择器演示入口（mock 阶段专用，不接入 App 路由）
 *
 * 访问 /a8a9-demo.html 即可体验；URL 参数（演示/截图驱动用）：
 *   ?screen=cart          初始进入清单视图
 *   ?sel=id1,id2,...      初始已选动作（id 见 pickerData.ts MOCK_EXERCISES）
 *   ?history=0            新手态（热门排序 + 引导卡）
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import ExercisePickerModal from '../components/picker/ExercisePickerModal';
import '../index.css';

const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') === 'cart' ? 'cart' : 'browse';
const sel = (params.get('sel') || '').split(',').map(s => s.trim()).filter(Boolean);
const hasHistory = params.get('history') !== '0';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ExercisePickerModal
      hasHistory={hasHistory}
      initialScreen={screen}
      defaultSelectedIds={sel}
      onClose={() => {}}
      onConfirm={items => console.log('[A8A9 Demo] confirm:', items)}
    />
  </React.StrictMode>,
);
