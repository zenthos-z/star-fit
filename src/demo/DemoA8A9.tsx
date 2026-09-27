/**
 * A8+A9 动作选择器演示入口（mock 阶段专用，不接入 App 路由）
 *
 * 访问 /a8a9-demo.html 即可体验；URL 参数（演示/截图驱动用）：
 *   ?screen=cart          初始进入清单视图
 *   ?sel=id1,id2,...      初始已选动作（id 见 pickerLibraryData.ts）
 *   ?history=0            新手态（热门排序 + 引导卡）
 *   ?video=1              直开视频播放页（演示 VideoPlayerModal 重写，库3 R2 素材）
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import ExercisePickerModal from '../components/picker/ExercisePickerModal';
import { VideoPlayerModal } from '../components/execution/VideoPlayerModal';
import { MOCK_EXERCISES } from '../components/picker/pickerData';
import '../index.css';

const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') === 'cart' ? 'cart' : 'browse';
const sel = (params.get('sel') || '').split(',').map(s => s.trim()).filter(Boolean);
const hasHistory = params.get('history') !== '0';
const videoMode = params.get('video') === '1';

// 演示素材：取库内有视频的动作（悬垂举腿抬髋，R2 male/female mp4 + 海报）
const demoEx = MOCK_EXERCISES.find(e => e.nameEn === 'Hanging Leg Hip Raise') ?? MOCK_EXERCISES[0];
const R2 = 'https://pub-585d42eb1aa64a67aedf483ec328d3fe.r2.dev';
const demoVideos = [
  { url: `${R2}/exercise-videos/male/${demoEx.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`, poster: `${R2}/exercise-posters/male/${demoEx.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, label: '男版演示' },
  { url: `${R2}/exercise-videos/female/${demoEx.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`, poster: `${R2}/exercise-posters/female/${demoEx.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, label: '女版演示' },
];

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

if (videoMode) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <VideoPlayerModal
        isOpen
        title={demoEx.name}
        videos={demoVideos}
        onClose={() => {}}
      />
    </React.StrictMode>,
  );
} else {
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
}
