import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WorkoutSession } from '../../types/protocol';
import { extractWorkoutData } from './core/dataExtractorV2';
import { generateShanShuiTemplate, generateBauhausTemplate, generateAcidTemplate, TemplateContext, VibeConfig } from '../../../../components/poster/core/templateEngine';
import { shanshuiConfig } from '../../../../components/poster/styles/shanshuiConfig';
import { bauhausConfig } from '../../../../components/poster/styles/bauhausConfig';
import { industrialConfig } from '../../../../components/poster/styles/industrialConfig';
import { liquidConfig } from '../../../../components/poster/styles/liquidConfig';
import { cyberConfig } from '../../../../components/poster/styles/cyberConfig';
import { punkConfig } from '../../../../components/poster/styles/punkConfig';
import { StyleSelector } from '../../../../components/poster/components/StyleSelector';
import { ConfigPanel } from '../../../../components/poster/components/ConfigPanel';
import { OutputSection } from '../../../../components/poster/components/OutputSection';
import { modalBackdrop, modalContent, tapScale, staggerContainer, staggerItem } from '../../lib/animations';

interface PosterPromptGeneratorV2Props {
  session: WorkoutSession;
  onClose: () => void;
}

export const PosterPromptGeneratorV2: React.FC<PosterPromptGeneratorV2Props> = ({ session, onClose }) => {
  const [selectedStyle, setSelectedStyle] = useState('shanshui');
  const [vibeConfig, setVibeConfig] = useState<VibeConfig>({});
  const [finalPrompt, setFinalPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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

  return (
    <AnimatePresence>
      <>
        <motion.div
          {...modalBackdrop}
          className="fixed inset-0 bg-star-gray/95 backdrop-blur-md z-[120]"
        />

        <motion.div
          {...modalContent}
          className="fixed inset-0 z-[120] flex flex-col items-center p-4 overflow-y-auto pt-6 pb-20"
        >
        {/* Header */}
        <div className="w-full max-w-2xl flex justify-between items-center mb-6 px-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-star-dark shadow-lg flex items-center justify-center text-star-accent">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-black text-star-dark italic uppercase tracking-tighter leading-none">海报生成器</h2>
              <p className="text-[9px] font-mono text-gray-400 mt-1 uppercase tracking-widest font-bold">Poster Engine • AI Prompt Gen</p>
            </div>
          </div>
          <motion.button
            {...tapScale}
            onClick={onClose}
            className="bg-white rounded-xl p-3 shadow-sm text-gray-400 hover:text-star-dark transition-all border border-gray-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </motion.button>
        </div>

        {/* Content with stagger animation */}
        <motion.div
          variants={staggerContainer.variants}
          initial="initial"
          animate="animate"
          className="w-full max-w-2xl space-y-4"
        >
          {/* Style Selector Section */}
          <motion.div variants={staggerItem} className="bg-white rounded-[2rem] p-6 shadow-lg border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-3 bg-star-primary rounded-full"></div>
              <h3 className="text-[11px] font-black text-star-dark uppercase tracking-widest">选择视觉风格</h3>
            </div>
            <StyleSelector
              selectedStyle={selectedStyle}
              onSelectStyle={setSelectedStyle}
            />
          </motion.div>

          {/* Config Panel Section */}
          <motion.div variants={staggerItem} className="bg-white rounded-[2rem] p-6 shadow-lg border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-3 bg-purple-500 rounded-full"></div>
              <h3 className="text-[11px] font-black text-star-dark uppercase tracking-widest">调整氛围参数</h3>
            </div>
            <ConfigPanel
              styleConfig={
                selectedStyle === 'shanshui' ? shanshuiConfig :
                selectedStyle === 'bauhaus' ? bauhausConfig :
                selectedStyle === 'industrial' ? industrialConfig :
                selectedStyle === 'liquid' ? liquidConfig :
                selectedStyle === 'cyber' ? cyberConfig :
                punkConfig
              }
              vibeConfig={vibeConfig}
              onVibeConfigChange={setVibeConfig}
            />
          </motion.div>

          {/* Output Section */}
          <motion.div variants={staggerItem} className="bg-star-dark rounded-[2rem] p-6 shadow-xl border border-white/5 relative overflow-hidden">
             {/* Decorative pattern */}
             <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
                <svg width="100" height="100" viewBox="0 0 100 100">
                    <circle cx="100" cy="0" r="80" stroke="white" strokeWidth="0.5" fill="none" />
                    <circle cx="100" cy="0" r="60" stroke="white" strokeWidth="0.5" fill="none" />
                </svg>
            </div>

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-3 bg-star-accent rounded-full"></div>
                <h3 className="text-[11px] font-black text-white uppercase tracking-widest">生成的提示词</h3>
              </div>
              <OutputSection
                prompt={finalPrompt}
                onGenerateImage={handleGenerateImage}
              />
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
      </>
    </AnimatePresence>
  );
};
