import React from 'react';
import { Dumbbell, Activity, Heart, ArrowRight, Anchor, Footprints } from 'lucide-react';
import { Button } from '../../ui/Button';

interface LoadAnchorsSectionProps {
  loadAnchors: any;
  onOpenAnchorPage: () => void;
}

const getCountByType = (loadAnchors: any, type: string): number => {
  if (!loadAnchors || typeof loadAnchors !== 'object') return 0;

  return Object.values(loadAnchors).filter((anchor: any) => {
    if (!anchor) return false;
    switch (type) {
      case 'resistance':
        return !!anchor.resistance;
      case 'bodyweight':
        return !!anchor.bodyweight;
      case 'cardio':
        return !!anchor.cardio;
      case 'heart_rate':
        return !!anchor.heart_rate;
      default:
        return false;
    }
  }).length;
};

const AnchorTypeCard: React.FC<{ type: string; count: number; icon: React.ReactNode; color: string }> = ({
  type, count, icon, color
}) => (
  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
    <div className="flex items-center gap-2 mb-2">
      <div className={color}>{icon}</div>
      <span className="text-sm text-gray-500">{type}</span>
    </div>
    <div className="text-2xl font-bold text-gray-900">{count}</div>
    <div className="text-xs text-gray-400">个锚点</div>
  </div>
);

export const LoadAnchorsSection: React.FC<LoadAnchorsSectionProps> = ({
  loadAnchors, onOpenAnchorPage
}) => {
  return (
    <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Anchor className="text-red-600" size={20} />
          负荷锚点
        </h3>
        <Button onClick={onOpenAnchorPage} className="text-sm">
          管理负荷锚点
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>

      {/* 预览：显示各类锚点数量 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AnchorTypeCard
          type="力量型"
          count={getCountByType(loadAnchors, 'resistance')}
          icon={<Dumbbell size={20} />}
          color="text-red-600"
        />
        <AnchorTypeCard
          type="自重型"
          count={getCountByType(loadAnchors, 'bodyweight')}
          icon={<Activity size={20} />}
          color="text-blue-600"
        />
        <AnchorTypeCard
          type="有氧型"
          count={getCountByType(loadAnchors, 'cardio')}
          icon={<Footprints size={20} />}
          color="text-green-600"
        />
        <AnchorTypeCard
          type="心率型"
          count={getCountByType(loadAnchors, 'heart_rate')}
          icon={<Heart size={20} />}
          color="text-pink-600"
        />
      </div>
    </section>
  );
};
