import React, { useState } from 'react';
import { IconCopy } from '../icons/IconCopy';
import { IconImage } from '../icons/IconImage';

interface OutputSectionProps {
  prompt: string;
  onGenerateImage: () => void;
}

export const OutputSection: React.FC<OutputSectionProps> = ({ prompt, onGenerateImage }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Copy failed', err);
      alert('复制失败，请手动复制');
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-2xl p-4 font-mono text-xs leading-relaxed max-h-60 overflow-y-auto custom-scrollbar relative">
        <pre className="whitespace-pre-wrap break-words text-gray-300 selection:bg-star-primary/30">
            {prompt || '请先选择风格并生成提示词...'}
        </pre>
      </div>
      
      <div className="flex flex-col sm:flex-row gap-3">
        <button
            onClick={handleCopy}
            className={`flex-1 font-black py-3.5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 uppercase italic tracking-tighter text-sm ${
                copied 
                    ? 'bg-green-500 text-white' 
                    : 'bg-white text-star-dark hover:bg-gray-50'
            }`}
        >
            {copied ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <IconCopy className="w-4 h-4" />
            )}
            <span>{copied ? '已复制' : '复制提示词'}</span>
        </button>

        <button
            onClick={onGenerateImage}
            className="flex-1 bg-star-accent text-star-dark font-black py-3.5 rounded-xl shadow-lg shadow-star-accent/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 uppercase italic tracking-tighter text-sm"
        >
            <div className="w-6 h-6 rounded-lg bg-star-dark/10 flex items-center justify-center">
                <IconImage className="w-4 h-4" />
            </div>
            <span>AI 生成海报</span>
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 text-[9px] text-white/30 font-bold uppercase tracking-widest pt-1">
        <span className="w-6 h-px bg-white/10"></span>
        PROMPT IS READY
        <span className="w-6 h-px bg-white/10"></span>
      </div>
    </div>
  );
};
