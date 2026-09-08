import React, { useState, useEffect } from 'react';
import { setTabBarHidden } from '../src/lib/nativeTabBar';

interface TimeEditorProps {
  currentDuration: number; // in milliseconds
  startTime: number;
  onConfirm: (newDurationMs: number) => void;
  onCancel: () => void;
}

const TimeEditor: React.FC<TimeEditorProps> = ({ currentDuration, startTime, onConfirm, onCancel }) => {
  const [durationMs, setDurationMs] = useState(currentDuration);

  // sheet 呈现期间把原生 tab bar 罩暗（iOS 标准层次），关闭时恢复
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);
  
  // Helpers to format Date objects to HH:mm string
  const toTimeStr = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // Initial values
  const [startStr, setStartStr] = useState(toTimeStr(startTime));
  const [endStr, setEndStr] = useState(toTimeStr(startTime + currentDuration));

  // Sync End Time display when duration changes via slider
  useEffect(() => {
      setEndStr(toTimeStr(startTime + durationMs));
  }, [durationMs, startTime]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSeconds = parseInt(e.target.value, 10);
    setDurationMs(newSeconds * 1000);
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTime = e.target.value; // HH:mm
      setStartStr(newTime);
      
      const [h, m] = newTime.split(':').map(Number);
      const newStart = new Date(startTime);
      newStart.setHours(h);
      newStart.setMinutes(m);
      
      // Calculate new duration: (Old End Time) - (New Start Time)
      // We keep the End Time fixed relative to real time, so duration adjusts.
      const currentEnd = startTime + durationMs;
      let newDuration = currentEnd - newStart.getTime();
      
      // Prevent negative duration
      if (newDuration < 0) newDuration = 0;
      
      setDurationMs(newDuration);
  };

  const handleEndTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTime = e.target.value; // HH:mm
      setEndStr(newTime);

      const [h, m] = newTime.split(':').map(Number);
      // We need to construct the End Date. Assume same day as Start Time initially.
      const newEnd = new Date(startTime); 
      newEnd.setHours(h);
      newEnd.setMinutes(m);

      // If user picks a time earlier than start time, assume it's next day (or just handle calc)
      // But simplified: just calc diff.
      let newDuration = newEnd.getTime() - startTime;
      
      // If negative, it might mean the end time is past midnight
      if (newDuration < 0) {
           newEnd.setDate(newEnd.getDate() + 1);
           newDuration = newEnd.getTime() - startTime;
      }

      setDurationMs(newDuration);
  };

  // 自适应单位：默认只显示 分:秒，≥1 小时才出现 时 位
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full max-w-md px-6 pt-3 rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom-full duration-300" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        {/* Grabber */}
        <div className="w-9 h-1.5 bg-gray-300 rounded-full mx-auto mb-4" />

        {/* iOS sheet header: 左取消（文字）·标题居中·右确认（圆形） */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onCancel}
            className="text-star-accent font-bold min-w-[52px] text-left active:opacity-50 transition-opacity"
          >
            取消
          </button>
          <h3 className="text-base font-bold text-star-dark">调整计时</h3>
          <button
            onClick={() => onConfirm(durationMs)}
            aria-label="确认"
            className="w-9 h-9 bg-star-dark text-white rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform"
          >
            <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </button>
        </div>

        {/* Big Time Display */}
        <div className="flex justify-center mb-6">
          <div className="text-6xl font-mono font-bold text-gray-800 tracking-tighter">
            {formatDuration(durationMs)}
          </div>
        </div>

        {/* Slider（保留独创滑块交互，thumb 苹果化：28px 白底圆钮+阴影） */}
        <div className="mb-6 px-4">
          <style>{`
            .time-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 9999px; background: #E5E7EB; outline: none; }
            .time-slider::-webkit-slider-thumb {
              -webkit-appearance: none; appearance: none; cursor: grab;
              width: 28px; height: 28px; border-radius: 9999px;
              background: #fff; border: 0.5px solid rgba(0,0,0,0.04);
              box-shadow: 0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16);
            }
            .time-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.05); }
            .time-slider::-moz-range-thumb {
              width: 28px; height: 28px; border-radius: 9999px; border: none;
              background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16);
            }
          `}</style>
          <input
            type="range"
            min="0"
            max={(durationMs / 1000) + 3600}
            value={Math.floor(durationMs / 1000)}
            onChange={handleSliderChange}
            className="time-slider block"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-2 font-mono">
            <span>-1h</span>
            <span>当前</span>
            <span>+1h</span>
          </div>
        </div>

        {/* Start/End Time Inputs：标签加大、间距收紧（max-w 限制行宽避免两端过散） */}
        <div className="bg-star-gray rounded-2xl px-5 py-2 flex flex-col">
           <div className="flex justify-between items-center py-3">
               <label className="text-[15px] font-bold text-gray-500">开始时间</label>
               <input
                 type="time"
                 value={startStr}
                 onChange={handleStartTimeChange}
                 className="bg-white rounded-lg px-3 py-1.5 font-mono text-[17px] font-semibold text-star-dark outline-none focus:ring-2 focus:ring-star-dark/20"
               />
           </div>
           <div className="w-full h-px bg-gray-200"></div>
           <div className="flex justify-between items-center py-3">
               <label className="text-[15px] font-bold text-gray-500">结束时间</label>
               <input
                 type="time"
                 value={endStr}
                 onChange={handleEndTimeChange}
                 className="bg-white rounded-lg px-3 py-1.5 font-mono text-[17px] font-semibold text-star-dark outline-none focus:ring-2 focus:ring-star-dark/20"
               />
           </div>
        </div>

        {/* Actions moved to sheet header (iOS style) */}
      </div>
    </div>
  );
};

export default TimeEditor;