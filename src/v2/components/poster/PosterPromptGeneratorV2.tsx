import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { WorkoutSession } from '../../types/protocol';
import { extractWorkoutData } from './core/dataExtractorV2';
import { generateShanShuiTemplate, generateBauhausTemplate, generateAcidTemplate, TemplateContext, VibeConfig } from '../../../../components/poster/core/templateEngine';
import { shanshuiConfig } from '../../../../components/poster/styles/shanshuiConfig';
import { bauhausConfig } from '../../../../components/poster/styles/bauhausConfig';
import { industrialConfig } from '../../../../components/poster/styles/industrialConfig';
import { liquidConfig } from '../../../../components/poster/styles/liquidConfig';
import { cyberConfig } from '../../../../components/poster/styles/cyberConfig';
import { punkConfig } from '../../../../components/poster/styles/punkConfig';
import { transitions } from '../../lib/animations';
import { haptic } from '../../../lib/nativeHaptics';

interface PosterPromptGeneratorV2Props {
  session: WorkoutSession;
  onClose: () => void;
}

const STYLE_OPTIONS = [
  { id: 'shanshui', name: '青绿山水' },
  { id: 'bauhaus', name: '包豪斯' },
  { id: 'industrial', name: '工业重金属' },
  { id: 'liquid', name: '超限流体' },
  { id: 'cyber', name: '赛博霓虹' },
  { id: 'punk', name: '复古朋克' },
] as const;

const ACID_STYLE_IDS = ['industrial', 'liquid', 'cyber', 'punk'];

const VIBE_FIELDS: Array<{ key: keyof VibeConfig; label: string; placeholder: string }> = [
  { key: 'brandingName', label: '品牌名称', placeholder: '你的昵称' },
  { key: 'slogans', label: '标语', placeholder: 'SYSTEM OVERLOAD, LEG DAY' },
  { key: 'palette', label: '色彩方案', placeholder: 'Neon Orange vs Midnight Blue' },
  { key: 'brandingStyle', label: '品牌质感', placeholder: 'Chrome Metallic 3D style' },
];

export const PosterPromptGeneratorV2: React.FC<PosterPromptGeneratorV2Props> = ({ session, onClose }) => {
  const [selectedStyle, setSelectedStyle] = useState('shanshui');
  const [vibeConfig, setVibeConfig] = useState<VibeConfig>({});
  const [finalPrompt, setFinalPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const workoutData = extractWorkoutData(session);

  const generatePrompt = useCallback(() => {
    let context: TemplateContext;
    let config: any;

    switch (selectedStyle) {
      case 'shanshui':
        config = shanshuiConfig;
        context = { data: workoutData, config };
        setFinalPrompt(generateShanShuiTemplate(context));
        break;
      case 'bauhaus':
        config = bauhausConfig;
        context = { data: workoutData, config };
        setFinalPrompt(generateBauhausTemplate(context));
        break;
      case 'industrial':
        config = industrialConfig;
        context = { data: workoutData, config, vibeConfig };
        setFinalPrompt(generateAcidTemplate(context));
        break;
      case 'liquid':
        config = liquidConfig;
        context = { data: workoutData, config, vibeConfig };
        setFinalPrompt(generateAcidTemplate(context));
        break;
      case 'cyber':
        config = cyberConfig;
        context = { data: workoutData, config, vibeConfig };
        setFinalPrompt(generateAcidTemplate(context));
        break;
      case 'punk':
        config = punkConfig;
        context = { data: workoutData, config, vibeConfig };
        setFinalPrompt(generateAcidTemplate(context));
        break;
      default:
        config = shanshuiConfig;
        context = { data: workoutData, config };
        setFinalPrompt(generateShanShuiTemplate(context));
    }
  }, [selectedStyle, vibeConfig, workoutData]);

  useEffect(() => {
    generatePrompt();
  }, [generatePrompt]);

  const handleSelectStyle = (id: string) => {
    if (id === selectedStyle) return;
    haptic('light');
    setSelectedStyle(id);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(finalPrompt).then(() => {
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Copy failed', err);
      alert('复制失败，请手动复制');
    });
  };

  // 功能逻辑与原版一致：生成图片暂未实现，提示用户用提示词手动生成
  const handleGenerateImage = async () => {
    setIsGenerating(true);
    try {
      alert('生成图片功能暂未实现，请稍后使用提示词手动生成图片。');
    } catch (error) {
      console.error('Generate image error:', error);
      alert('生成图片失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const isAcidStyle = ACID_STYLE_IDS.includes(selectedStyle);

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={transitions.springGentle}
      className="fixed inset-0 z-[120] bg-[#FAFAFA] flex flex-col rounded-t-[40px] overflow-hidden"
    >
      {/* Header：返回钮左置（HIG），标题居中，整体避让状态栏安全区 */}
      <div
        className="shrink-0 grid grid-cols-[44px_1fr_44px] items-center px-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: '8px' }}
      >
        <button
          onClick={() => { haptic('light'); onClose(); }}
          aria-label="返回"
          className="w-11 h-11 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center text-gray-500 active:bg-gray-100 active:scale-95 transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="text-center">
          <h2 className="text-lg font-black text-gray-900 tracking-tighter">AI 海报</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {workoutData.date} · {workoutData.duration}
          </p>
        </div>
        <div />
      </div>

      {/* 内容区：flex 撑满剩余高度，尽量一屏放下；提示词预览内部滚动兜底 */}
      <div
        className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto px-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]"
        style={{
          paddingTop: '8px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
        }}
      >
        {/* 风格选择：单行横滑 chips，不占纵向空间 */}
        <div className="shrink-0 bg-white rounded-[40px] p-3 shadow-sm border border-gray-50">
          <div className="flex gap-2 overflow-x-auto pb-1 -mb-1" style={{ scrollbarWidth: 'none' }}>
            {STYLE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => handleSelectStyle(option.id)}
                className={`shrink-0 h-11 px-4 rounded-full text-[13px] font-semibold transition-all active:scale-95 ${
                  selectedStyle === option.id
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-500 active:bg-gray-100'
                }`}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>

        {/* 氛围参数：仅 acid 系风格需要，其余风格不渲染（免空卡片占位） */}
        {isAcidStyle && (
          <div className="shrink-0 bg-white rounded-[40px] p-5 shadow-sm border border-gray-50">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-2 h-2 rounded-full border-2 border-blue-500" />
              <span className="text-sm font-semibold text-gray-900">氛围参数</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {VIBE_FIELDS.map((field) => (
                <div key={String(field.key)} className={field.key === 'slogans' || field.key === 'palette' ? 'col-span-1' : 'col-span-1'}>
                  <label className="block text-[11px] text-gray-400 font-medium mb-1.5">{field.label}</label>
                  <input
                    type="text"
                    value={vibeConfig[field.key] || ''}
                    onChange={(e) => setVibeConfig({ ...vibeConfig, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-3 py-2.5 text-[13px] font-medium text-gray-900 placeholder:text-gray-300 outline-none focus:border-blue-400 focus:bg-white transition-all"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 提示词预览：占满剩余高度，内部滚动 */}
        <div className="flex-1 min-h-[120px] flex flex-col bg-white rounded-[40px] p-5 shadow-sm border border-gray-50">
          <div className="flex items-center gap-2.5 mb-3 shrink-0">
            <span className="w-2 h-2 rounded-full border-2 border-blue-500" />
            <span className="text-sm font-semibold text-gray-900">提示词</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 rounded-3xl p-4">
            <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-600 font-mono">
              {finalPrompt || '请选择风格生成提示词…'}
            </pre>
          </div>
        </div>
      </div>

      {/* 底部操作栏：玻璃双钮（复制 = 浅玻璃 / 生成 = 深玻璃主行动），避让底部安全区 */}
      <div
        className="absolute left-0 right-0 flex justify-center gap-3 px-6"
        style={{ bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          onClick={handleCopy}
          className={`liquid-glass flex-1 h-[50px] font-semibold text-[17px] rounded-full flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform ${
            copied ? 'text-green-600' : 'text-gray-900'
          }`}
        >
          {copied ? (
            <>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>已拷贝</span>
            </>
          ) : (
            <>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              <span>复制提示词</span>
            </>
          )}
        </button>

        <button
          onClick={handleGenerateImage}
          disabled={isGenerating}
          className="liquid-glass-dark flex-1 h-[50px] text-white font-semibold text-[17px] rounded-full flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {isGenerating ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span>AI 生成海报</span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};
