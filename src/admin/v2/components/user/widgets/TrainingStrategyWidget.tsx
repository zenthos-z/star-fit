import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Edit2, FileText } from 'lucide-react';

interface TrainingStrategyWidgetProps {
  data: any;
  onEdit: () => void;
}

export const TrainingStrategyWidget: React.FC<TrainingStrategyWidgetProps> = ({ data, onEdit }) => {
  const strategy = data?.training_strategy || null;

  if (!strategy) {
    return (
      <Card className="h-full flex flex-col bg-white border-gray-200 text-gray-900 shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <FileText className="text-blue-600" size={18} />
            训练策略
          </h3>
          <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
            <Edit2 size={14} />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-xl">
          未设置策略
        </div>
      </Card>
    );
  }

  // Extract preview (first 8 lines)
  const preview = strategy.split('\n').slice(0, 8).join('\n');
  const hasMore = strategy.split('\n').length > 8;

  return (
    <Card className="h-full flex flex-col bg-white border-gray-200 text-gray-900 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <FileText className="text-blue-600" size={18} />
          训练策略
        </h3>
        <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
          <Edit2 size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 p-4 rounded-xl border border-gray-100">
        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
          {preview}
          {hasMore && '\n...'}
        </pre>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span>点击编辑修改</span>
        <span>{strategy.split('\n').length} 行</span>
      </div>
    </Card>
  );
};

export default TrainingStrategyWidget;
