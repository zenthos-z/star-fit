import React from 'react';
import { Play, MoreVertical, Edit, Trash2, Check, Square } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Exercise } from '../../../services/types';
import { API_BASE } from '../../../services/geminiService';
import { getExerciseTypeLabel, getDifficultyLabel } from '../../../utils/exerciseLabels';

export type EmbeddingStatus = 'not_vectorized' | 'partial' | 'outdated' | 'current';

interface ActionCardProps {
  exercise: Exercise;
  selected?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: (shiftKey: boolean) => void;
  embeddingStatus?: EmbeddingStatus;
}

const EMBEDDING_BADGE_CONFIG = {
  not_vectorized: { label: '未向量化', variant: 'danger' },
  partial: { label: '部分向量化', variant: 'warning' },
  outdated: { label: '需更新', variant: 'info' },
  current: null, // 不显示
} as const;

export const ActionCard: React.FC<ActionCardProps> = ({ exercise, selected, onEdit, onDelete, onSelect, embeddingStatus }) => {
  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const assets = (() => {
    try {
      const parsed = JSON.parse(exercise.assets_json || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  })();
  // Check if video exists and is not empty (handle both array and single object)
  const hasVideo = assets.video && (
    Array.isArray(assets.video) ? assets.video.length > 0 : true
  );

  const embeddingBadge = EMBEDDING_BADGE_CONFIG[embeddingStatus || 'current'];

  return (
    <div
      className={`group bg-white border rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer flex flex-col relative ${selected ? 'border-star-accent ring-2 ring-star-accent/20' : 'border-gray-200'
        }`}
      onClick={onEdit}
      data-testid={`admin-exercise-card-${exercise.id}`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(e.shiftKey);
        }}
        className={`absolute top-3 left-3 z-20 flex items-center justify-center w-6 h-6 rounded border transition-opacity ${selected
          ? 'bg-star-accent border-star-accent text-white opacity-100'
          : 'bg-white border-gray-300 text-gray-400 opacity-0 group-hover:opacity-100'
          }`}
        data-testid={`admin-exercise-select-${exercise.id}`}
      >
        {selected ? <Check size={14} /> : <Square size={14} />}
      </button>

      {/* Embedding status badge */}
      {embeddingBadge && (
        <div className="absolute top-2 right-2 z-10">
          <Badge size="sm" variant={embeddingBadge.variant}>
            {embeddingBadge.label}
          </Badge>
        </div>
      )}

      {/* Cover */}
      <div className="!aspect-[4/3] w-full bg-gray-100 relative flex-shrink-0 overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {assets.cover ? (
          <img src={getFullUrl(String(assets.cover))} alt={exercise.name} className="w-full h-full object-cover absolute inset-0" />
        ) : (
          <div className="flex items-center justify-center h-full w-full text-gray-300">
            <Play size={24} />
          </div>
        )}

        {hasVideo && (
          <div className={`absolute top-2 px-1.5 py-0.5 bg-black/60 backdrop-blur rounded text-[10px] text-white font-medium flex items-center gap-1 z-10 ${embeddingBadge ? 'right-12' : 'right-2'}`}>
            <Play size={8} fill="currentColor" />
            视频
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-bold text-gray-900 line-clamp-1" title={exercise.name}>
            {exercise.name}
          </h3>
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Show menu
            }}
            className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical size={16} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge size="sm" variant="info">{getExerciseTypeLabel(exercise.exercise_type || 'resistance')}</Badge>
          <Badge size="sm" variant={
            exercise.difficulty === 'beginner' ? 'success' :
              exercise.difficulty === 'intermediate' ? 'warning' : 'danger'
          }>
            {getDifficultyLabel(exercise.difficulty || 'beginner')}
          </Badge>
        </div>

        <div className="mt-auto pt-3 border-t border-gray-50 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
            data-testid={`admin-exercise-edit-${exercise.id}`}
          >
            <Edit size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
            data-testid={`admin-exercise-delete-${exercise.id}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
