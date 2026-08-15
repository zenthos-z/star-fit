/**
 * Load Anchors Section Component (Enhanced with Edit)
 *
 * Displays and allows editing user's load anchors (personal records).
 * Features:
 * - Display anchors by type (resistance, bodyweight, cardio, heart rate)
 * - Quick edit inline for each anchor
 * - Add new anchor dialog
 * - Delete anchor functionality
 *
 * @module LoadAnchorsSection
 */

import React, { useMemo, useState, useEffect } from 'react';
import { Edit, Plus, Trash2, ChevronDown, ChevronUp, Anchor, Dumbbell, Activity, Footprints, Heart } from 'lucide-react';
import { Button } from '../ui/Button';
import { EditAnchorDialog } from './dialogs/EditAnchorDialog';
import type { LoadAnchor } from 'shared/contracts';

// Helper function to build API URL
const getApiUrl = (endpoint: string) => {
  // 使用与 vite.config.ts 一致的默认值
  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:43111/api';
  // 如果 endpoint 已经以 / 开头，去掉 baseUrl 的末尾斜杠
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBaseUrl}${cleanEndpoint}`;
};

interface LoadAnchorsSectionProps {
  userId: string;
  loadAnchors: Record<string, LoadAnchor>;
  onAnchorUpdate: (anchors: Record<string, LoadAnchor>) => void;
}

export const LoadAnchorsSection: React.FC<LoadAnchorsSectionProps> = ({
  userId,
  loadAnchors,
  onAnchorUpdate
}) => {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAnchor, setEditingAnchor] = useState<{ name: string; data: LoadAnchor } | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['resistance', 'bodyweight']));

  // Debug log to track loadAnchors changes
  useEffect(() => {
    console.log('[LoadAnchorsSection] loadAnchors updated:', loadAnchors);
    console.log('[LoadAnchorsSection] Keys:', Object.keys(loadAnchors || {}));
    // 罗马尼亚硬拉的数据
    if (loadAnchors?.['罗马尼亚硬拉']) {
      console.log('[LoadAnchorsSection] 罗马尼亚硬拉 data:', loadAnchors['罗马尼亚硬拉']);
    }
  }, [loadAnchors]);

  const toggleType = (type: string) => {
    const newExpanded = new Set(expandedTypes);
    if (newExpanded.has(type)) {
      newExpanded.delete(type);
    } else {
      newExpanded.add(type);
    }
    setExpandedTypes(newExpanded);
  };

  // Categorize anchors by type (仅使用扁平格式 v3.0)
  const categorizedAnchors = useMemo(() => {
    const resistance: Array<{ name: string; est1rm: number; bestWeight: number; bestReps: number; date: number; raw: any }> = [];
    const bodyweight: Array<{ name: string; value: number | string; unit: string; date: number; raw: any }> = [];
    const cardio: Array<{ name: string; value: string; unit: string; date: number; raw: any }> = [];
    const heartRate: Array<{ name: string; label: string; value: number; unit: string; date: number; raw: any }> = [];

    Object.entries(loadAnchors).forEach(([name, anchor]) => {
      const lastUpdated = anchor.last_updated || 0;

      // === 力量型：有 best_weight 或 est_1rm ===
      if (anchor.best_weight !== undefined || anchor.est_1rm !== undefined) {
        resistance.push({
          name,
          est1rm: anchor.est_1rm ?? 0,
          bestWeight: anchor.best_weight ?? 0,
          bestReps: anchor.best_reps ?? 0,
          date: lastUpdated,
          raw: anchor
        });
      }

      // === 自重型：有次数但无重量 ===
      if (anchor.best_reps && !anchor.best_weight && !anchor.est_1rm) {
        bodyweight.push({
          name,
          value: anchor.best_reps,
          unit: '次',
          date: lastUpdated,
          raw: anchor
        });
      }

      // === 有氧型：有配速 ===
      if (anchor.best_pace) {
        const pace = anchor.best_pace;
        const mins = Math.floor(pace / 60);
        const secs = pace % 60;
        cardio.push({
          name,
          value: `${mins}:${secs.toString().padStart(2, '0')}`,
          unit: '/km',
          date: lastUpdated,
          raw: anchor
        });
      }

      // === 心率指标 ===
      if (anchor.max_hr) {
        heartRate.push({
          name: 'max_hr',
          label: '最大心率',
          value: anchor.max_hr,
          unit: 'bpm',
          date: lastUpdated,
          raw: { ...anchor }
        });
      }
      if (anchor.resting_hr) {
        heartRate.push({
          name: 'resting_hr',
          label: '静息心率',
          value: anchor.resting_hr,
          unit: 'bpm',
          date: lastUpdated,
          raw: { ...anchor }
        });
      }
    });

    return { resistance, bodyweight, cardio, heartRate };
  }, [loadAnchors]);

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const handleEditAnchor = (name: string, data: LoadAnchor) => {
    setEditingAnchor({ name, data });
    setEditDialogOpen(true);
  };

  const handleDeleteAnchor = async (name: string) => {
    if (confirm(`确定要删除 "${name}" 的负荷锚点吗？`)) {
      try {
        // 调用后端的专门删除 API，而不是更新整个 profile
        const response = await fetch(getApiUrl(`/profiles/${userId}/anchors/${encodeURIComponent(name)}?replaceAnchors=true`), {
          method: 'DELETE'
        });

        if (!response.ok) {
          throw new Error('删除失败');
        }

        // 在前端也删除，以保持 UI 同步
        const newAnchors = { ...loadAnchors };
        delete newAnchors[name];
        onAnchorUpdate(newAnchors);
      } catch (error) {
        console.error('[LoadAnchorsSection] Failed to delete anchor:', error);
        alert('删除失败: ' + (error as Error).message);
      }
    }
  };

  const handleSaveAnchor = (name: string, data: LoadAnchor) => {
    const newAnchors = { ...loadAnchors, [name]: data };
    onAnchorUpdate(newAnchors);
    setEditDialogOpen(false);
    setEditingAnchor(null);
  };

  const totalAnchors =
    categorizedAnchors.resistance.length +
    categorizedAnchors.bodyweight.length +
    categorizedAnchors.cardio.length +
    categorizedAnchors.heartRate.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-testid="load-anchors-section">
      {/* Section Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Anchor size={16} className="text-gray-600" />
          <span>负荷锚点</span>
          <span className="text-xs font-normal text-gray-400">({totalAnchors})</span>
        </h3>
        <button
          onClick={() => {
            setEditingAnchor({ name: '', data: { last_updated: Date.now() } });
            setEditDialogOpen(true);
          }}
          className="text-xs flex items-center gap-1 text-star-accent hover:underline font-semibold"
        >
          <Plus size={14} />
          添加锚点
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {totalAnchors === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg">
            <Anchor className="text-gray-300 mb-2" size={32} />
            <p className="text-sm text-gray-500 font-medium mb-1">暂无负荷锚点记录</p>
            <p className="text-xs text-gray-400 mb-4">记录1RM、最佳配速等关键指标</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingAnchor({ name: '', data: { last_updated: Date.now() } });
                setEditDialogOpen(true);
              }}
              className="rounded-full shadow-sm"
            >
              <Plus size={14} className="mr-1" />
              添加第一个锚点
            </Button>
          </div>
        ) : (
          <>
            {/* Resistance Type */}
            {categorizedAnchors.resistance.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleType('resistance')}
                  className="w-full px-3 py-2 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                    <span>🏋️</span>
                    <span>力量型训练</span>
                  </span>
                  <span className="text-gray-400">
                    {expandedTypes.has('resistance') ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {expandedTypes.has('resistance') && (
                  <div className="p-2 space-y-1">
                    {categorizedAnchors.resistance.map((anchor) => (
                      <div
                        key={anchor.name}
                        className="px-3 py-2 bg-white rounded border border-gray-200 hover:border-star-accent/50 transition-colors group"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-sm font-medium text-gray-900 truncate" title={anchor.name}>
                            {anchor.name.length > 20 ? anchor.name.slice(0, 20) + '...' : anchor.name}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleEditAnchor(anchor.name, anchor.raw)}
                              className="p-1.5 text-gray-400 hover:text-star-accent hover:bg-blue-50 rounded"
                              title="编辑"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteAnchor(anchor.name)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-600">
                          <span className="flex items-center gap-1">
                            <span className="text-gray-400">1RM:</span>
                            <span className="font-semibold text-gray-800">{anchor.est1rm}</span>
                            <span className="text-gray-400">kg</span>
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="flex items-center gap-1">
                            <span className="text-gray-400">最佳:</span>
                            <span className="font-semibold text-gray-800">{anchor.bestWeight}</span>
                            <span className="text-gray-400">kg</span>
                            <span className="text-gray-400">×</span>
                            <span className="font-semibold text-gray-800">{anchor.bestReps}</span>
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="text-gray-400">{formatDate(anchor.date)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bodyweight Type */}
            {categorizedAnchors.bodyweight.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleType('bodyweight')}
                  className="w-full px-3 py-2 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                    <Activity size={14} />
                    <span>自重型训练</span>
                  </span>
                  <span className="text-gray-400">
                    {expandedTypes.has('bodyweight') ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {expandedTypes.has('bodyweight') && (
                  <div className="p-2 space-y-1">
                    {categorizedAnchors.bodyweight.map((anchor) => (
                      <div
                        key={anchor.name}
                        className="flex items-center justify-between px-3 py-2 bg-white rounded border border-gray-200 hover:border-star-accent/50 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate" title={anchor.name}>
                            {anchor.name.length > 15 ? anchor.name.slice(0, 15) + '...' : anchor.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {anchor.value} {anchor.unit}
                            <span className="text-gray-300 mx-1">•</span>
                            {formatDate(anchor.date)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditAnchor(anchor.name, anchor.raw)}
                            className="p-1.5 text-gray-400 hover:text-star-accent hover:bg-blue-50 rounded"
                            title="编辑"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteAnchor(anchor.name)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Cardio Type */}
            {categorizedAnchors.cardio.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleType('cardio')}
                  className="w-full px-3 py-2 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                    <Footprints size={14} />
                    <span>有氧型训练</span>
                  </span>
                  <span className="text-gray-400">
                    {expandedTypes.has('cardio') ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {expandedTypes.has('cardio') && (
                  <div className="p-2 space-y-1">
                    {categorizedAnchors.cardio.map((anchor) => (
                      <div
                        key={anchor.name}
                        className="flex items-center justify-between px-3 py-2 bg-white rounded border border-gray-200 hover:border-star-accent/50 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate" title={anchor.name}>
                            {anchor.name.length > 15 ? anchor.name.slice(0, 15) + '...' : anchor.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {anchor.value} {anchor.unit}
                            <span className="text-gray-300 mx-1">•</span>
                            {formatDate(anchor.date)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditAnchor(anchor.name, anchor.raw)}
                            className="p-1.5 text-gray-400 hover:text-star-accent hover:bg-blue-50 rounded"
                            title="编辑"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteAnchor(anchor.name)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Heart Rate Type */}
            {categorizedAnchors.heartRate.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleType('heartRate')}
                  className="w-full px-3 py-2 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                    <Heart size={14} />
                    <span>心率指标</span>
                  </span>
                  <span className="text-gray-400">
                    {expandedTypes.has('heartRate') ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {expandedTypes.has('heartRate') && (
                  <div className="p-2 space-y-1">
                    {categorizedAnchors.heartRate.map((anchor) => (
                      <div
                        key={anchor.name}
                        className="flex items-center justify-between px-3 py-2 bg-white rounded border border-gray-200 hover:border-star-accent/50 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {anchor.label}
                          </div>
                          <div className="text-xs text-gray-500">
                            {anchor.value} {anchor.unit}
                            <span className="text-gray-300 mx-1">•</span>
                            {formatDate(anchor.date)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditAnchor(anchor.name, anchor.raw)}
                            className="p-1.5 text-gray-400 hover:text-star-accent hover:bg-blue-50 rounded"
                            title="编辑"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteAnchor(anchor.name)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Edit Dialog */}
        {editDialogOpen && (
          <EditAnchorDialog
            anchorName={editingAnchor?.name || ''}
            anchorData={editingAnchor?.data || { last_updated: Date.now() }}
            existingNames={Object.keys(loadAnchors)}
            onSave={handleSaveAnchor}
            onClose={() => {
              setEditDialogOpen(false);
              setEditingAnchor(null);
            }}
          />
        )}
      </div>
    </div>
  );
};
