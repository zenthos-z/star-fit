/**
 * A8+A9 动作选择器演示入口（mock 阶段专用，不接入 App 路由）
 *
 * 访问 /a8a9-demo.html 即可体验；URL 参数（演示/截图驱动用）：
 *   ?screen=cart          初始进入清单视图
 *   ?sel=id1,id2,...      初始已选动作（id 见 pickerLibraryData.ts）
 *   ?history=0            新手态（热门排序 + 引导卡）
 *   ?video=1              直开视频播放页（演示 VideoPlayerModal 重写，库3 R2 素材）
 *   ?mmap=1               直开肌群可视化（演示 MuscleMapSvg Web 版，可滚动验证零漂移）
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import ExercisePickerModal from '../components/picker/ExercisePickerModal';
import { VideoPlayerModal } from '../components/execution/VideoPlayerModal';
import { MuscleMapSection } from '../components/execution/MuscleMapSection';
import { MOCK_EXERCISES } from '../components/picker/pickerData';
import '../index.css';

const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') === 'cart' ? 'cart' : 'browse';
const sel = (params.get('sel') || '').split(',').map(s => s.trim()).filter(Boolean);
const hasHistory = params.get('history') !== '0';
const videoMode = params.get('video') === '1';
const mmapMode = params.get('mmap') === '1';

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
} else if (mmapMode) {
  // 肌群可视化演示：可滚动长页内嵌 MuscleMapSection（滚动复测零漂移）
  const filler = Array.from({ length: 8 }, (_, i) => (
    <div key={i} className="bg-white rounded-[20px] shadow-sm p-4 mb-3">
      <p className="text-[15px] font-semibold text-star-dark">占位区块 {i + 1}</p>
      <p className="text-[13px] text-gray-400 mt-1">滚动验证肌群图是否随页面自然流动（零漂移）。</p>
    </div>
  ));
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="min-h-screen bg-star-gray px-4 pt-10 pb-16">
        <div className="bg-white rounded-[20px] shadow-sm p-4 mb-4">
          <p className="text-[15px] font-semibold text-star-dark">顶部标记：滚动前在此处</p>
        </div>
        <MuscleMapSection primary={['chest', 'triceps']} secondary={['shoulders', 'abdominals']} interactive />
        <div className="mt-6">{filler}</div>
        <MuscleMapSection primary={['quadriceps', 'gluteal']} secondary={['hamstring']} interactive />
        <div className="mt-6">{filler}</div>
      </div>
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ExercisePickerModal
        hasHistory={hasHistory}
        mode="batch"
        initialScreen={screen}
        defaultSelectedIds={sel}
        onClose={() => {}}
        onConfirm={items => console.log('[A8A9 Demo] confirm:', items)}
      />
    </React.StrictMode>,
  );
}
