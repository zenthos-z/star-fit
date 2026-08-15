import React, { useState, useEffect } from 'react';

interface TimeEditorProps {
  currentDuration: number; // in milliseconds
  startTime: number;
  onConfirm: (newDurationMs: number) => void;
  onCancel: () => void;
}

const TimeEditor: React.FC<TimeEditorProps> = ({ currentDuration, startTime, onConfirm, onCancel }) => {
  const [durationMs, setDurationMs] = useState(currentDuration);
  
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

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full max-w-md p-8 rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom-full duration-300">
        <h3 className="text-xl font-bold text-star-dark mb-6 text-center">调整计时</h3>
        
        {/* Big Time Display */}
        <div className="flex justify-center mb-8">
          <div className="text-6xl font-mono font-bold text-star-dark tracking-tighter">
            {formatDuration(durationMs)}
          </div>
        </div>

        {/* Slider */}
        <div className="mb-8 px-4">
          <input 
            type="range" 
            min="0" 
            max={(durationMs / 1000) + 3600} 
            value={Math.floor(durationMs / 1000)} 
            onChange={handleSliderChange}
            className="w-full h-12 rounded-full appearance-none bg-star-gray accent-star-dark cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-2 font-mono">
            <span>-1h</span>
            <span>当前</span>
            <span>+1h</span>
          </div>
        </div>

        {/* Start/End Time Inputs */}
        <div className="bg-star-gray rounded-xl p-4 mb-8 flex flex-col gap-4">
           <div className="flex justify-between items-center text-sm">
               <label className="text-gray-500 font-bold">开始时间</label>
               <input 
                 type="time" 
                 value={startStr}
                 onChange={handleStartTimeChange}
                 className="bg-white rounded-lg px-2 py-1 font-mono text-star-dark outline-none focus:ring-2 focus:ring-star-dark/20"
               />
           </div>
           <div className="w-full h-px bg-gray-200"></div>
           <div className="flex justify-between items-center text-sm">
               <label className="text-gray-500 font-bold">结束时间</label>
               <input 
                 type="time" 
                 value={endStr}
                 onChange={handleEndTimeChange}
                 className="bg-white rounded-lg px-2 py-1 font-mono text-star-dark outline-none focus:ring-2 focus:ring-star-dark/20"
               />
           </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={onCancel}
            className="py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
          >
            取消
          </button>
          <button 
            onClick={() => onConfirm(durationMs)}
            className="py-4 rounded-2xl font-bold bg-star-dark text-white shadow-lg hover:scale-[1.02] transition-transform"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimeEditor;