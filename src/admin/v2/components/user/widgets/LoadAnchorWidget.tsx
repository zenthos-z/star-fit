import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { TrendingUp, Edit2, Dumbbell, Timer, Heart, Activity } from 'lucide-react';

interface LoadAnchorWidgetProps {
  data: any;
  onEdit?: () => void;
}

export const LoadAnchorWidget: React.FC<LoadAnchorWidgetProps> = ({ data, onEdit }) => {
  const anchors = data?.load_anchors || {};

  // Helper to extract metric display
  const getAnchorMetric = (anchor: any) => {
    if (!anchor) return null;

    // Resistance
    if (anchor.resistance) {
      const val = anchor.resistance.est_1rm || anchor.resistance.best_weight;
      if (val) return { value: val, unit: 'kg', icon: <Dumbbell size={16} />, type: 'resistance' };
    }

    // Bodyweight
    if (anchor.bodyweight) {
      const val = anchor.bodyweight.best_reps;
      if (val) return { value: val, unit: '次', icon: <Activity size={16} />, type: 'bodyweight' };
    }

    // Cardio
    if (anchor.cardio) {
      if (anchor.cardio.best_pace) {
         // Convert pace (seconds per km?) to MM:SS/km if needed, or just show number
         return { value: anchor.cardio.best_pace, unit: 's/km', icon: <Timer size={16} />, type: 'cardio' };
      }
      if (anchor.cardio.best_distance) {
        return { value: (anchor.cardio.best_distance / 1000).toFixed(2), unit: 'km', icon: <Timer size={16} />, type: 'cardio' };
      }
    }

    // Heart Rate
    if (anchor.heart_rate) {
      if (anchor.heart_rate.max_hr) return { value: anchor.heart_rate.max_hr, unit: 'bpm', icon: <Heart size={16} />, type: 'hr' };
      if (anchor.heart_rate.resting_hr) return { value: anchor.heart_rate.resting_hr, unit: 'bpm (静息)', icon: <Heart size={16} />, type: 'hr' };
    }

    // Legacy fallback
    if (anchor['1rm']) return { value: anchor['1rm'], unit: 'kg', icon: <Dumbbell size={16} />, type: 'resistance' };
    if (anchor.current) return { value: anchor.current, unit: 'kg', icon: <Dumbbell size={16} />, type: 'resistance' };

    return null;
  };

  const anchorKeys = Object.keys(anchors);
  const coreLifts = ['Barbell Bench Press', 'Barbell Squat', 'Deadlift', 'Pull Up', '5km Run'];
  const displayKeys = Array.from(new Set([...coreLifts, ...anchorKeys])).slice(0, 9); // Show max 9 items

  return (
    <Card className="h-full bg-white border-gray-200 text-gray-900 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="text-blue-600" size={18} />
          负荷锚点
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{anchorKeys.length} 条记录</span>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
              <Edit2 size={14} />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {displayKeys.map(key => {
          const anchor = anchors[key];
          const metric = getAnchorMetric(anchor);
          
          if (!metric) {
            // Placeholder for core lifts if missing
            if (coreLifts.includes(key)) {
               return (
                <div key={key} className="bg-gray-50 rounded-xl p-3 border border-dashed border-gray-200 flex flex-col justify-between h-24 opacity-50">
                  <div className="text-xs text-gray-500 truncate mb-1">{key}</div>
                  <div className="text-lg font-bold text-gray-400">--</div>
                </div>
              );
            }
            return null;
          }

          const lastUpdated = anchor.last_updated ? new Date(anchor.last_updated).toLocaleDateString() : null;

          return (
            <div key={key} className="bg-gray-50 rounded-xl p-3 border border-gray-100 relative group overflow-hidden hover:border-blue-200 transition-colors">
               <div className="absolute top-2 right-2 text-gray-400 group-hover:text-blue-500 transition-colors">
                  {metric.icon}
               </div>
              <div className="text-xs text-gray-500 mb-1 truncate pr-6" title={key}>{key}</div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-gray-900">{metric.value}</span>
                <span className="text-xs text-gray-500 font-medium">{metric.unit}</span>
              </div>
              {lastUpdated && (
                <div className="mt-2 text-[10px] text-gray-400">
                  更新于 {lastUpdated}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};
