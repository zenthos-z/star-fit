import React from 'react';
import { StyleConfig } from '../styles/types';
import { IconMountain } from '../icons/IconMountain';
import { IconBuilding } from '../icons/IconBuilding';
import { IconIndustry } from '../icons/IconIndustry';
import { IconLiquid } from '../icons/IconLiquid';
import { IconNeon } from '../icons/IconNeon';
import { IconPunk } from '../icons/IconPunk';

interface StyleSelectorProps {
  selectedStyle: string;
  onSelectStyle: (styleId: string) => void;
}

const STYLE_OPTIONS: Array<{ id: string; name: string; icon: React.ReactNode }> = [
  { id: 'shanshui', name: '青绿山水', icon: <IconMountain /> },
  { id: 'bauhaus', name: '包豪斯', icon: <IconBuilding /> },
  { id: 'industrial', name: '工业重金属', icon: <IconIndustry /> },
  { id: 'liquid', name: '超限流体', icon: <IconLiquid /> },
  { id: 'cyber', name: '赛博霓虹', icon: <IconNeon /> },
  { id: 'punk', name: '复古朋克', icon: <IconPunk /> }
];

export const StyleSelector: React.FC<StyleSelectorProps> = ({ selectedStyle, onSelectStyle }) => {
  return (
    <div className="grid grid-cols-2 gap-2">
      {STYLE_OPTIONS.map((option) => (
        <button
          key={option.id}
          onClick={() => onSelectStyle(option.id)}
          className={`group text-left p-3 rounded-xl transition-all relative overflow-hidden ${
            selectedStyle === option.id
              ? 'bg-star-dark text-white shadow-md ring-2 ring-star-primary/20'
              : 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-white hover:border-star-primary/30'
          }`}
        >
          {selectedStyle === option.id && (
            <div className="absolute top-0 right-0 w-6 h-6 bg-star-primary rounded-bl-xl flex items-center justify-center">
                <svg className="w-3 h-3 text-star-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              selectedStyle === option.id 
                ? 'bg-white/10 text-star-accent' 
                : 'bg-white text-gray-400 group-hover:text-star-primary'
            }`}>
              {React.cloneElement(option.icon as React.ReactElement, { className: 'w-5 h-5' } as any)}
            </div>
            <div>
              <div className={`text-[10px] font-black uppercase tracking-tight ${selectedStyle === option.id ? 'text-white' : 'text-gray-900'}`}>
                {option.name}
              </div>
              <div className={`text-[8px] font-mono mt-0.5 ${selectedStyle === option.id ? 'text-gray-400' : 'text-gray-400'}`}>
                {option.id.toUpperCase()}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};
