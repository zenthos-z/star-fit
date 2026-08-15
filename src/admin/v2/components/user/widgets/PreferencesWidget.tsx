import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Edit2, Target, Clock, Dumbbell, AlertTriangle } from 'lucide-react';

interface PreferencesWidgetProps {
  data: any;
  onEdit: () => void;
}

export const PreferencesWidget: React.FC<PreferencesWidgetProps> = ({ data, onEdit }) => {
  const prefs = data?.preferences || {};
  const equipment = Array.isArray(prefs.equipment) ? prefs.equipment :
                   (prefs.equipment ? [String(prefs.equipment)] : []);
  const avoidExercises = Array.isArray(prefs.avoid_exercises) ? prefs.avoid_exercises :
                        (prefs.avoid_exercises ? [String(prefs.avoid_exercises)] : []);

  return (
    <Card className="h-full flex flex-col bg-white border-gray-200 text-gray-900 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Target className="text-blue-600" size={18} />
          训练偏好
        </h3>
        <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
          <Edit2 size={14} />
        </Button>
      </div>

      <div className="space-y-4 flex-1">
        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <Target size={16} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">目标</div>
            <div className="font-medium text-gray-900">{prefs.goal || '未设置'}</div>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
            <Clock size={16} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">时长</div>
            <div className="font-medium text-gray-900">{prefs.duration || '60'} 分钟</div>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="p-2 bg-green-50 text-green-600 rounded-lg">
            <Dumbbell size={16} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">器械</div>
            <div className="flex flex-wrap gap-1">
              {equipment.length ? (
                equipment.map((eq: string) => (
                  <Badge key={eq} size="sm" className="bg-gray-100 text-gray-700 border-gray-200">{eq}</Badge>
                ))
              ) : (
                <span className="text-gray-500 text-sm">无偏好</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="p-2 bg-red-50 text-red-600 rounded-lg">
            <AlertTriangle size={16} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">避免动作</div>
            <div className="flex flex-wrap gap-1">
              {avoidExercises.length ? (
                avoidExercises.map((ex: string) => (
                  <Badge key={ex} size="sm" className="bg-red-50 text-red-600 border-red-100">{ex}</Badge>
                ))
              ) : (
                <span className="text-gray-500 text-sm">无</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
