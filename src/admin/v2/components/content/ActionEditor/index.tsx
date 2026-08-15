import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { MetadataForm } from './MetadataForm';
import { VideoGallery, AdminVideoItem } from './VideoGallery';
import { RichTextEditor } from './RichTextEditor';
import { Button } from '../../ui/Button';
import { AdminService } from '../../../services/api';
import { Exercise } from '../../../services/types';
import { VideoAsset } from '../../../../../types/video';
import { API_BASE } from '../../../services/geminiService';
import { getExerciseTypeLabel } from '../../../utils/exerciseLabels';

interface ActionEditorProps {
  exerciseId?: string;
  onBack: () => void;
}

export const ActionEditor: React.FC<ActionEditorProps> = ({ exerciseId, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Partial<Exercise>>({});
  const [videos, setVideos] = useState<AdminVideoItem[]>([]);

  const setCoverFromVideo = (coverUrl: string) => {
    setData(prev => {
      const raw = String((prev as any).assets_json ?? '{}') || '{}';
      const existing = (() => {
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
          return parsed;
        } catch {
          return {};
        }
      })();

      return {
        ...prev,
        assets_json: JSON.stringify({
          ...existing,
          cover: coverUrl,
        }),
      };
    });
  };

  useEffect(() => {
    if (exerciseId) {
      loadExercise(exerciseId);
    }
  }, [exerciseId]);

  const loadExercise = async (id: string) => {
    setLoading(true);
    try {
      const exercise = await AdminService.exercises.get(id);

      // Normalize targets
      let targets = (exercise as any).targets || JSON.stringify({ primary: [], secondary: [] });
      if (typeof targets !== 'string') {
        targets = JSON.stringify(targets);
      }

      const equipmentRequired =
        typeof (exercise as any).equipment_required === 'string'
          ? (exercise as any).equipment_required
          : JSON.stringify((exercise as any).equipment_required ?? []);

      const normalized = {
        ...exercise,
        targets,
        equipment_required: equipmentRequired,
      } as Partial<Exercise>;

      setData(normalized);

      // 合并 assets_json：优先使用顶层（新数据），然后从 attributes 补充
      const mergeAssets = () => {
        const merged: Record<string, any> = {};

        console.log('[ActionEditor] Raw data.assets_json:', (normalized as any).assets_json);
        console.log('[ActionEditor] Raw attributes:', (normalized as any).attributes);

        // 从顶层 assets_json 读取（最新的数据）
        try {
          const topLevelStr = String((normalized as any).assets_json ?? '{}') || '{}';
          console.log('[ActionEditor] Parsing top-level assets_json:', topLevelStr);
          const topLevel = JSON.parse(topLevelStr);
          if (topLevel && typeof topLevel === 'object' && !Array.isArray(topLevel)) {
            Object.assign(merged, topLevel);
            console.log('[ActionEditor] Merged after top-level:', merged);
          }
        } catch (e) {
          console.error('[ActionEditor] Failed to parse top-level assets_json:', e);
        }

        // 从 attributes.assets_json 补充（旧数据中的视频）
        try {
          const attrs = (normalized as any).attributes;
          if (attrs && typeof attrs === 'object') {
            const attrsAssetsStr = String(attrs.assets_json ?? '{}');
            console.log('[ActionEditor] Parsing attributes.assets_json:', attrsAssetsStr);
            const attrsAssets = JSON.parse(attrsAssetsStr);
            if (attrsAssets && typeof attrsAssets === 'object' && !Array.isArray(attrsAssets)) {
              // 优先使用顶层的数据，但如果顶层没有视频，则使用 attributes 中的视频
              if (!merged.video && attrsAssets.video) {
                merged.video = attrsAssets.video;
                console.log('[ActionEditor] Added video from attributes');
              }
              if (!merged.cover && attrsAssets.cover) {
                merged.cover = attrsAssets.cover;
                console.log('[ActionEditor] Added cover from attributes');
              }
            }
          }
        } catch (e) {
          console.error('[ActionEditor] Failed to parse attributes.assets_json:', e);
        }

        console.log('[ActionEditor] Final merged assets:', merged);
        return merged;
      };

      const assets = mergeAssets();

      if ((assets as any).video) {
        const raw = (assets as any).video;
        const list = Array.isArray(raw) ? raw : [raw];
        setVideos(
          list
            .map((v: any, idx: number): AdminVideoItem | null => {
              if (!v) return null;
              if (typeof v === 'string') {
                const baseUrl = v.includes('/') ? v.replace(/\/[^/]+$/, '') : '';
                return {
                  id: `legacy-${idx}`,
                  originalVideoUrl: v,
                  baseUrl,
                  posterUrl: baseUrl ? `${baseUrl}/poster.jpg` : undefined,
                  sources: [],
                  fileName: `Video ${idx + 1}`,
                  status: v.endsWith('/temp.mp4') ? 'processing' : 'ready',
                  progress: v.endsWith('/temp.mp4') ? 5 : 100,
                  createdAt: Date.now(),
                  exerciseName: String((normalized as any).name || ''),
                } as any;
              }

              const asset = v as Partial<VideoAsset> & Record<string, any>;
              const baseUrl = String(asset.baseUrl || asset.base_url || '');
              const posterUrl = String(asset.posterUrl || asset.poster_url || asset.poster || (baseUrl ? `${baseUrl}/poster.jpg` : ''));
              const originalVideoUrl = String(asset.originalVideoUrl || asset.original_video_url || asset.url || (baseUrl ? `${baseUrl}/original.mp4` : ''));

              return {
                id: String(asset.id || `video-${idx}`),
                originalVideoUrl: originalVideoUrl || undefined,
                baseUrl: baseUrl || undefined,
                posterUrl: posterUrl || undefined,
                sources: (asset.sources || asset.qualities || []) as any[],
                fileName: String(asset.metadata?.originalFilename || asset.fileName || ''),
                status: baseUrl ? 'ready' : originalVideoUrl.endsWith('/temp.mp4') ? 'processing' : 'ready',
                progress: baseUrl ? 100 : originalVideoUrl.endsWith('/temp.mp4') ? 5 : 100,
                createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : Date.now(),
                exerciseName: String(asset.exerciseName || (normalized as any).name || ''),
              } as any;
            })
            .filter(Boolean) as AdminVideoItem[]
        );
      }
    } catch (e) {
      console.error('Failed to load exercise', e);
    } finally {
      setLoading(false);
    }
  };

  // 检查是否有正在处理的视频
  const hasProcessingVideos = videos.some(v => v.status === 'processing');

  const handleSave = async () => {
    // 如果有视频正在处理，禁止保存
    if (hasProcessingVideos) {
      alert('视频正在处理中，请等待处理完成后再保存');
      return;
    }

    console.log('[ActionEditor] Saving exercise:', exerciseId);
    console.log('[ActionEditor] Current data.assets_json:', (data as any).assets_json);
    console.log('[ActionEditor] Current videos:', videos);

    setSaving(true);
    try {
      // Normalize targets for validation
      let targetsStr = data.targets || JSON.stringify({ primary: [] });
      try {
        const parsed = JSON.parse(targetsStr);
        if (!parsed.primary || parsed.primary.length === 0) {
          alert('请至少选择一个主要肌群');
          setSaving(false);
          return;
        }
      } catch {
        alert('锻炼目标数据格式错误');
        setSaving(false);
        return;
      }

      const normalized: any = {
        ...data,
        id: exerciseId ? String((data as any).id ?? exerciseId) : (data.id ? String(data.id) : uuidv4()),
        exercise_type: data.exercise_type || 'resistance',
        difficulty: data.difficulty || 'beginner',
        targets: targetsStr,
        equipment_required:
          typeof (data as any).equipment_required === 'string'
            ? (data as any).equipment_required
            : JSON.stringify((data as any).equipment_required ?? []),
      };

      // Prune deprecated fields
      delete normalized.body_category;
      delete normalized.muscle_groups;

      const existingAssets = (() => {
        try {
          const parsed = JSON.parse(normalized.assets_json || '{}');
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
          return parsed;
        } catch {
          return {};
        }
      })();

      // 构建视频资源（只使用当前 videos 状态，不用旧数据）
      const videoAssetsForStorage: VideoAsset[] = videos
        .filter(v => v.status === 'ready')  // 只保存已完成的视频
        .map((v, idx): VideoAsset => {
          const baseUrl = v.baseUrl || '';
          const originalVideoUrl = v.originalVideoUrl || (baseUrl ? `${baseUrl}/original.mp4` : '');
          const posterUrl = v.posterUrl || (baseUrl ? `${baseUrl}/poster.jpg` : '');

          return {
            id: String(v.id || `video-${idx}`),
            exerciseId: String(v.exerciseId || data.id || ''),
            type: 'local',
            baseUrl,
            sources: (v.sources || []) as any,
            posterUrl,
            metadata: {
              originalFilename: v.fileName || '',
              duration: 0,
              width: 0,
              height: 0,
              codec: '',
              bitrate: 0,
              size: 0,
            },
            createdAt: v.createdAt || Date.now(),
            originalVideoUrl: originalVideoUrl || undefined,
          };
        });

      // 构建 assets_json：保留 cover，使用当前 videos
      const assetsJson = JSON.stringify({
        cover: existingAssets.cover || undefined,  // 保留封面（从 setCoverFromVideo 设置）
        ...(videoAssetsForStorage.length > 0 ? { video: videoAssetsForStorage } : {})
      });

      console.log('[ActionEditor] Built assetsJson:', assetsJson);
      console.log('[ActionEditor] Video assets for storage:', videoAssetsForStorage);

      const payload = {
        ...normalized,
        assets_json: assetsJson
      };

      if (exerciseId) {
        await AdminService.exercises.update(exerciseId, payload);
      } else {
        await AdminService.exercises.create(payload);
      }
      onBack();
    } catch (e) {
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div data-testid="admin-action-editor-loading">加载中...</div>;

  const targetsSummary = (() => {
    try {
      const parsed = JSON.parse(data.targets || '{}');
      const primary = Array.isArray(parsed.primary) ? parsed.primary[0] : '';
      return primary || '未分类';
    } catch {
      return '未分类';
    }
  })();

  return (
    <div className="h-full flex flex-col bg-star-white" data-testid="admin-action-editor">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
            data-testid="admin-action-editor-back"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {data.name || '新建动作'}
            </h2>
            <div className="text-xs text-gray-500 flex gap-2">
              <span>{targetsSummary}</span>
              <span>•</span>
              <span>{getExerciseTypeLabel(data.exercise_type || 'resistance')}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {hasProcessingVideos && (
            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
              视频处理中...
            </span>
          )}
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={hasProcessingVideos}
            icon={<Save size={16} />}
            data-testid="admin-action-editor-save"
          >
            保存更改
          </Button>
        </div>
      </div>

      {/* Content Grid */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-12">
          {/* Left: Metadata (30%) */}
          <div className="col-span-4 border-r border-gray-200 bg-gray-50/50 p-6 overflow-y-auto" data-testid="admin-action-editor-metadata">
            <MetadataForm
              data={data}
              onChange={update => setData(prev => ({ ...prev, ...update }))}
              onCoverUpload={file => AdminService.media.upload(file).then((res: any) => res.url)}
            />
          </div>

          {/* Right: Content (70%) */}
          <div className="col-span-8 p-8 overflow-y-auto bg-white" data-testid="admin-action-editor-content">
            <div className="max-w-3xl mx-auto space-y-8">
              {/* Video Section */}
              <section data-testid="admin-action-editor-videos">
                <VideoGallery
                  videos={videos}
                  onChange={setVideos}
                  exerciseId={data.id || 'temp'}
                  onSetCover={setCoverFromVideo}
                />
              </section>

              {/* Guide Section */}
              <section data-testid="admin-action-editor-guide">
                <h3 className="text-sm font-bold text-gray-900 mb-4">动作详解</h3>
                <RichTextEditor
                  content={data.content_html || ''}
                  onChange={html => setData(prev => ({ ...prev, content_html: html }))}
                  onImageUpload={file => AdminService.media.upload(file).then((res: any) => {
                    const url = res.url;
                    if (!url) return '';
                    if (url.startsWith('http') || url.startsWith('blob:')) return url;
                    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
                    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
                  })}
                />
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
