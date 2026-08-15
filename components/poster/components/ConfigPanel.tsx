import React from 'react';
import { StyleConfig, VibeConfig } from '../styles/types';

interface ConfigPanelProps {
  styleConfig: StyleConfig;
  vibeConfig: VibeConfig;
  onVibeConfigChange: (config: VibeConfig) => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ styleConfig, vibeConfig, onVibeConfigChange }) => {
  const isAcidStyle = styleConfig.type === 'acid';

  return (
    <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 space-y-5">
      {isAcidStyle && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-gray-400 tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-star-primary"></span>
              品牌名称
            </label>
            <input
              type="text"
              value={vibeConfig.brandingName || ''}
              onChange={(e) => onVibeConfigChange({ ...vibeConfig, brandingName: e.target.value })}
              placeholder="你的昵称"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-star-primary focus:ring-4 focus:ring-star-primary/5 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-gray-400 tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              标语 (Slogans)
            </label>
            <input
              type="text"
              value={vibeConfig.slogans || ''}
              onChange={(e) => onVibeConfigChange({ ...vibeConfig, slogans: e.target.value })}
              placeholder="SYSTEM OVERLOAD, LEG DAY"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-star-primary focus:ring-4 focus:ring-star-primary/5 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-gray-400 tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-star-accent"></span>
              色彩方案 (Palette)
            </label>
            <input
              type="text"
              value={vibeConfig.palette || ''}
              onChange={(e) => onVibeConfigChange({ ...vibeConfig, palette: e.target.value })}
              placeholder="Neon Orange vs Midnight Blue"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-star-primary focus:ring-4 focus:ring-star-primary/5 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-gray-400 tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
              品牌质感 (Texture)
            </label>
            <input
              type="text"
              value={vibeConfig.brandingStyle || ''}
              onChange={(e) => onVibeConfigChange({ ...vibeConfig, brandingStyle: e.target.value })}
              placeholder="Chrome Metallic 3D style"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-star-primary focus:ring-4 focus:ring-star-primary/5 transition-all"
            />
          </div>
        </div>
      )}
      
      {!isAcidStyle && (
        <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-300">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-xs text-gray-400 italic font-medium">
            当前风格使用默认配置，无需额外设置。
          </div>
        </div>
      )}
    </div>
  );
};
