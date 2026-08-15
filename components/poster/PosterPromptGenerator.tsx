import React, { useState, useEffect } from 'react';
import { Session } from '../../types';
import { extractWorkoutData } from './core/dataExtractor';
import { generateShanShuiTemplate, generateBauhausTemplate, generateAcidTemplate, TemplateContext, VibeConfig } from './core/templateEngine';
import { shanshuiConfig } from './styles/shanshuiConfig';
import { bauhausConfig } from './styles/bauhausConfig';
import { industrialConfig } from './styles/industrialConfig';
import { liquidConfig } from './styles/liquidConfig';
import { cyberConfig } from './styles/cyberConfig';
import { punkConfig } from './styles/punkConfig';
import { StyleSelector } from './components/StyleSelector';
import { ConfigPanel } from './components/ConfigPanel';
import { OutputSection } from './components/OutputSection';

interface PosterPromptGeneratorProps {
  session: Session;
  onClose: () => void;
}

export const PosterPromptGenerator: React.FC<PosterPromptGeneratorProps> = ({ session, onClose }) => {
  const [selectedStyle, setSelectedStyle] = useState('shanshui');
  const [vibeConfig, setVibeConfig] = useState<VibeConfig>({});
  const [finalPrompt, setFinalPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const workoutData = extractWorkoutData(session);

  useEffect(() => {
    generatePrompt();
  }, [selectedStyle, vibeConfig]);

  const generatePrompt = () => {
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
  };

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
    <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="text-lg font-black text-star-dark">训练提示词生成器</h2>
          <button
            onClick={onClose}
            className="bg-gray-100 hover:bg-gray-200 rounded-full p-2 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          <StyleSelector 
            selectedStyle={selectedStyle}
            onSelectStyle={setSelectedStyle}
          />

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

          <OutputSection
            prompt={finalPrompt}
            onGenerateImage={handleGenerateImage}
          />
        </div>
      </div>
    </div>
  );
};
