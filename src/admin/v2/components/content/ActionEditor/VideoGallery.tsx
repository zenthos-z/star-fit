import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Play, Loader, Film } from 'lucide-react';
import { AdminService } from '../../../services/api';
import { API_BASE } from '../../../services/geminiService';

export interface AdminVideoItem {
  id: string;
  originalVideoUrl?: string;
  baseUrl?: string;
  posterUrl?: string;
  sources?: any[];
  fileName?: string;
  status?: 'processing' | 'ready' | 'error';
  progress?: number;
  createdAt?: number;
  exerciseId?: string;  // NanoID format
}

interface VideoGalleryProps {
  videos: AdminVideoItem[];
  onChange: React.Dispatch<React.SetStateAction<AdminVideoItem[]>>;
  exerciseId: string;  // NanoID format
  onSetCover?: (coverUrl: string) => void;
}

export const VideoGallery: React.FC<VideoGalleryProps> = ({
  videos,
  onChange,
  exerciseId,
  onSetCover
}) => {
  const [previewing, setPreviewing] = React.useState<AdminVideoItem | null>(null);

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const getPreviewUrl = (video: AdminVideoItem) => {
    if (video.originalVideoUrl) return getFullUrl(video.originalVideoUrl);
    if (video.baseUrl) return getFullUrl(`${video.baseUrl}/original.mp4`);
    const firstSourceUrl = (video.sources || [])
      .map((s: any) => (s ? (s.url || s.src || s.path) : ''))
      .find((u: any) => typeof u === 'string' && u.length > 0);
    return typeof firstSourceUrl === 'string' ? getFullUrl(firstSourceUrl) : '';
  };

  const getCoverUrlFromVideo = (video: AdminVideoItem) => {
    if (video.posterUrl) return video.posterUrl;
    if (video.baseUrl) return `${video.baseUrl}/poster.jpg`;
    return '';
  };

  React.useEffect(() => {
    if (!previewing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewing(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewing]);

  const getWebSocketUrl = (taskId: string) => {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    return `${wsBase}/videos/progress?taskId=${encodeURIComponent(taskId)}`;
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Optimistic UI update
    const newVideos = acceptedFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      fileName: file.name,
      status: 'processing' as const,
      progress: 0,
      createdAt: Date.now(),
    }));

    const currentVideos = [...videos, ...newVideos];
    onChange(currentVideos);

    // Upload files
    for (let i = 0; i < acceptedFiles.length; i++) {
      const file = acceptedFiles[i];
      const tempId = newVideos[i].id;

      try {
        const res = await AdminService.videos.upload(file, exerciseId);

        // Update video with real data from server
        onChange(prev => prev.map(v =>
          v.id === tempId ? {
            ...v,
            id: (res as any).taskId, // Switch to real Task ID for WS tracking
            originalVideoUrl: (res as any).originalVideoUrl,
            exerciseId: (res as any).exerciseId,
            status: 'processing',
            progress: 5
          } : v
        ));
      } catch (e) {
        onChange(prev => prev.map(v =>
          v.id === tempId ? { ...v, status: 'error' } : v
        ));
      }
    }
  }, [videos, onChange, exerciseId]);

  React.useEffect(() => {
    const wsMap = (window as any).__adminV2VideoWsMap || new Map<string, WebSocket>();
    (window as any).__adminV2VideoWsMap = wsMap;

    const processing = videos.filter(v => v.status === 'processing' && !!v.id);

    for (const v of processing) {
      if (wsMap.has(v.id)) continue;
      const ws = new WebSocket(getWebSocketUrl(v.id));
      wsMap.set(v.id, ws);

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'fit.video.progress') {
            onChange(prev =>
              prev.map(item =>
                item.id === v.id
                  ? {
                      ...item,
                      status: 'processing',
                      progress: Number(message.data?.progress ?? item.progress ?? 0),
                    }
                  : item
              )
            );
          }

          if (message.type === 'fit.video.completed') {
            const completedVideo = message.data?.videoAsset || message.data;
            console.log('[VideoGallery] Video completed, received:', completedVideo);
            console.log('[VideoGallery] Current video id:', v.id, 'new id:', completedVideo?.id);
            onChange(prev =>
              prev.map(item =>
                item.id === v.id
                  ? {
                      ...item,
                      id: completedVideo.id || item.id, // 使用真实的 video UUID
                      status: 'ready',
                      progress: 100,
                      baseUrl: completedVideo.baseUrl,
                      posterUrl: completedVideo.posterUrl,
                      sources: completedVideo.sources,
                      originalVideoUrl: completedVideo.originalVideoUrl || item.originalVideoUrl,
                      exerciseId: completedVideo.exerciseId || item.exerciseId,
                    }
                  : item
              )
            );
            ws.close();
            wsMap.delete(v.id);
          }

          if (message.type === 'fit.video.error') {
            onChange(prev =>
              prev.map(item =>
                item.id === v.id
                  ? {
                      ...item,
                      status: 'error',
                      progress: 0,
                    }
                  : item
              )
            );
            ws.close();
            wsMap.delete(v.id);
          }
        } catch {
          onChange(prev =>
            prev.map(item =>
              item.id === v.id
                ? {
                    ...item,
                    status: 'error',
                  }
                : item
            )
          );
        }
      };

      ws.onerror = () => {
        onChange(prev =>
          prev.map(item =>
            item.id === v.id
              ? {
                  ...item,
                  status: 'error',
                }
              : item
          )
        );
        ws.close();
        wsMap.delete(v.id);
      };
    }

    return () => {
      for (const [taskId, ws] of wsMap.entries()) {
        if (videos.some(v => v.id === taskId && v.status === 'processing')) {
          continue;
        }
        ws.close();
        wsMap.delete(taskId);
      }
    };
  }, [videos, onChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'video/*': [] }
  });

  const removeVideo = (index: number) => {
    onChange(videos.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4" data-testid="admin-video-gallery">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Film size={16} className="text-star-accent" />
          媒体资产
        </h3>
        <span className="text-xs text-gray-500">{videos.length} 个视频</span>
      </div>

      {/* Upload Area */}
      <div
        {...getRootProps()}
        data-testid="admin-video-upload-dropzone"
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
          isDragActive 
            ? 'border-star-accent bg-star-accent/5' 
            : 'border-gray-200 hover:border-star-accent/50 hover:bg-gray-50'
        }`}
      >
        <input data-testid="admin-video-upload-input" {...getInputProps()} />
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <Upload size={20} />
          <span className="text-xs">点击或拖拽上传视频</span>
        </div>
      </div>

      {/* Video List */}
      <div className="space-y-3">
        {videos.map((video, index) => (
          <div
            key={video.id}
            className="group flex gap-3 p-2 bg-white border border-gray-100 rounded-lg hover:shadow-sm transition-all"
            data-testid={`admin-video-item-${index}`}
          >
            {/* Thumbnail */}
            <div className="w-24 h-16 bg-black rounded-md overflow-hidden relative flex-shrink-0">
              {video.posterUrl || video.baseUrl ? (
                <img
                  src={getFullUrl(video.posterUrl || `${video.baseUrl}/poster.jpg`)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/50">
                  <Play size={20} />
                </div>
              )}

              {video.status === 'ready' && (
                <button
                  type="button"
                  onClick={() => setPreviewing(video)}
                  className="absolute inset-0 flex items-center justify-center"
                  aria-label="预览视频"
                >
                  <span className="w-9 h-9 rounded-full bg-black/55 backdrop-blur flex items-center justify-center ring-1 ring-white/25 group-hover:scale-105 transition-transform">
                    <Play size={18} className="text-white" fill="currentColor" />
                  </span>
                </button>
              )}
              
              {video.status === 'processing' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white text-xs">
                  <Loader size={16} className="animate-spin mb-1" />
                  {video.progress}%
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              <div>
                <div className="text-xs font-medium text-gray-900 truncate" title={video.fileName}>
                  {video.fileName || `Video ${index + 1}`}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {video.status === 'ready' ? '就绪' : video.status === 'error' ? '失败' : '处理中...'}
                </div>
              </div>
              
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {onSetCover && (
                  <button
                    type="button"
                    disabled={video.status !== 'ready' || !getCoverUrlFromVideo(video)}
                    onClick={() => {
                      const coverUrl = getCoverUrlFromVideo(video);
                      if (!coverUrl) return;
                      onSetCover(coverUrl);
                    }}
                    className={`text-[10px] hover:underline ${
                      video.status === 'ready' && getCoverUrlFromVideo(video)
                        ? 'text-star-accent'
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    设为封面
                  </button>
                )}
              </div>
            </div>

            {/* Remove */}
            <button 
              onClick={() => removeVideo(index)}
              className="text-gray-400 hover:text-red-500 self-start p-1"
              data-testid={`admin-video-remove-${index}`}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {previewing && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setPreviewing(null)}
        >
          <div
            className="w-full max-w-4xl bg-black rounded-xl overflow-hidden shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-black/70">
              <div className="text-xs text-white/80 truncate">{previewing.fileName || '视频预览'}</div>
              <button
                type="button"
                className="text-white/70 hover:text-white"
                onClick={() => setPreviewing(null)}
                aria-label="关闭预览"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-black">
              <video
                src={getPreviewUrl(previewing)}
                poster={getFullUrl(getCoverUrlFromVideo(previewing))}
                controls
                autoPlay
                className="w-full max-h-[70vh]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
