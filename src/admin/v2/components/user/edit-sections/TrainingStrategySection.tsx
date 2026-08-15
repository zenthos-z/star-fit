import React from 'react';
import { FileText, Edit2 } from 'lucide-react';

interface TrainingStrategySectionProps {
  data: any;
  onEdit: () => void;
}

export const TrainingStrategySection: React.FC<TrainingStrategySectionProps> = ({ data, onEdit }) => {
  const strategy = data?.training_strategy || null;

  if (!strategy) {
    return (
      <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <FileText className="text-blue-600" size={20} />
            训练策略
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-xl py-8">
          未设置策略
        </div>
      </section>
    );
  }

  const preview = strategy.split('\n').slice(0, 8).join('\n');
  const hasMore = strategy.split('\n').length > 8;

  return (
    <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileText className="text-blue-600" size={20} />
          训练策略
        </h3>
        <button
          onClick={onEdit}
          className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
          aria-label="编辑策略"
        >
          <Edit2 size={16} />
        </button>
      </div>

      <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 overflow-auto max-h-64">
        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
          {preview}
          {hasMore && '\n...'}
        </pre>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span>点击编辑按钮修改策略</span>
        <span>{strategy.split('\n').length} 行</span>
      </div>
    </section>
  );
};

export default TrainingStrategySection;
