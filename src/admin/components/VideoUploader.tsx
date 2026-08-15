import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, X, GripVertical, Play, Trash2 } from 'lucide-react';
import { API_BASE } from '@/services/geminiService';
import { VideoPlayerModal } from '../../v2/components/execution/VideoPlayerModal';
import { VideoCard, DisplayVideo } from '../../types/video';

interface VideoUploaderProps {
  videos: VideoCard[];
  exerciseId: string;  // NanoID format
  onVideosChange: (videos: VideoCard[]) => void;
}

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  videos,
  exerciseId,
  onVideosChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ progress: 0, message: '', fileName: '' });
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [playingVideoIndex, setPlayingVideoIndex] = useState(0);
  const dragIndex = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket 进度监听
  useEffect(() => {
    // 为每个上传的视频创建 WebSocket 连接
    const taskIds = videos.map(v => v.id);
    if (taskIds.length === 0) return;

    taskIds.forEach(taskId => {
      // 避免重复连接
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(`ws://localhost:43111/api/videos/progress?taskId=${taskId}`);

      ws.onopen = () => {
        console.log(`[VideoUploader] WebSocket connected for task: ${taskId}`);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[VideoUploader] WebSocket message:', message);

          if (message.type === 'fit.video.progress') {
            setUploadProgress(prev => ({
              ...prev,
              progress: message.data.progress,
              message: message.data.message || prev.message
            }));
          } else if (message.type === 'fit.video.completed') {
            // 处理完成，更新视频信息
            const completedVideo = message.data.videoAsset || message.data;
            const updatedVideos = videos.map(v =>
              v.id === taskId ? {
                ...v,
                poster: completedVideo.posterUrl,
                qualities: completedVideo.sources,
                url: completedVideo.baseUrl + '/original.mp4',
                baseUrl: completedVideo.baseUrl,
                originalVideoUrl: completedVideo.originalVideoUrl,
              } : v
            );
            onVideosChange(updatedVideos);

            setUploadProgress({ progress: 100, message: '处理完成', fileName: '' });
            setTimeout(() => setUploadProgress({ progress: 0, message: '', fileName: '' }), 2000);
          } else if (message.type === 'fit.video.error') {
            const errorMessage = message.data.error || '处理失败';
            setUploadProgress({ progress: 0, message: `错误: ${errorMessage}`, fileName: '' });
            setTimeout(() => setUploadProgress({ progress: 0, message: '', fileName: '' }), 3000);
          }
        } catch (err) {
          console.error('[VideoUploader] WebSocket message parse error:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[VideoUploader] WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('[VideoUploader] WebSocket closed');
      };

      wsRef.current = ws;
    });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [videos, onVideosChange]);

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const apiBase = API_BASE.replace(/\/api\/?$/, '');
    return `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const handleDragOverForUpload = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      uploadVideo(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      uploadVideo(file);
    }
  };

  const uploadVideo = async (file: File) => {
    const apiBase = API_BASE.replace(/\/api\/?$/, '');

    setUploadProgress({ progress: 0, message: '正在上传视频...', fileName: file.name });

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(prev => ({ ...prev, progress, message: `正在上传... ${progress}%` }));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          if (response.success) {
            setUploadProgress({ progress: 100, message: '视频已上传，正在后台处理...', fileName: file.name });

            const fullVideoUrl = `${apiBase}${response.originalVideoUrl}`;
            const newVideo: VideoCard = {
              id: response.taskId || Date.now().toString(),
              url: fullVideoUrl,
              originalVideoUrl: response.originalVideoUrl,
              fileName: file.name,
              createdAt: Date.now(),
            };

            onVideosChange([...videos, newVideo]);

            setTimeout(() => setUploadProgress({ progress: 0, message: '', fileName: '' }), 2000);
          }
        }
      });

      xhr.addEventListener('error', () => {
        setUploadProgress({ progress: 0, message: '上传失败', fileName: file.name });
        setTimeout(() => setUploadProgress({ progress: 0, message: '', fileName: '' }), 3000);
      });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('exerciseId', exerciseId || 'temp-exercise');

      xhr.open('POST', `${API_BASE}/videos/upload`);
      xhr.send(formData);
    } catch (err) {
      console.error('[VideoUploader] Upload error:', err);
      setUploadProgress({ progress: 0, message: '上传失败', fileName: file.name });
      setTimeout(() => setUploadProgress({ progress: 0, message: '', fileName: '' }), 3000);
    }
  };

  const handleDelete = (index: number) => {
    const updated = videos.filter((_, i) => i !== index);
    onVideosChange(updated);
  };

  const handleDragStart = (index: number) => {
    dragIndex.current = index;
    console.log('[VideoUploader] Drag start at index:', index);
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;

    const newVideos = [...videos];
    const draggedItem = newVideos[dragIndex.current];
    newVideos.splice(dragIndex.current, 1);
    newVideos.splice(index, 0, draggedItem);

    dragIndex.current = index;
    onVideosChange(newVideos);
    console.log('[VideoUploader] Drag to index:', index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
    console.log('[VideoUploader] Drag end');
  };

  return (
    <div className="space-y-4">
      {/* 上传区域或视频列表 */}
      {videos.length === 0 ? (
        /* 拖拽上传区域 */
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            isDragging
              ? 'border-star-accent bg-star-accent/10'
              : 'border-admin-border hover:border-star-accent/50 bg-admin-card/50'
          }`}
          onDragOver={handleDragOverForUpload}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="video-upload"
            className="hidden"
            accept="video/*"
            onChange={handleFileSelect}
          />
          <label
            htmlFor="video-upload"
            className="cursor-pointer flex flex-col items-center gap-4"
          >
            <div className="w-16 h-16 rounded-full bg-admin-border flex items-center justify-center">
              <Upload className="w-8 h-8 text-admin-muted" />
            </div>
            <div>
              <div className="text-sm text-white font-medium">
                {isDragging ? '松开鼠标上传' : '点击或拖拽上传视频'}
              </div>
              <div className="text-xs text-admin-muted mt-1">
                支持 MP4、MOV 等格式
              </div>
            </div>
          </label>
        </div>
      ) : (
        /* 视频卡片列表 */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {videos.map((video, index) => (
            <div
              key={video.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              className="group relative flex-shrink-0 w-56 bg-admin-card border border-admin-border rounded-lg overflow-hidden hover:border-star-accent/50 transition-colors"
            >
              {/* 视频封面 */}
              <div className="relative w-full h-32 bg-black">
                {video.poster ? (
                  <img
                    src={getFullUrl(video.poster)}
                    alt={video.fileName || `视频 ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                    <Play className="w-8 h-8 text-gray-600" />
                  </div>
                )}

                {/* 播放按钮覆盖层 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlayingVideoIndex(index);
                    setShowVideoModal(true);
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <div className="w-12 h-12 bg-star-accent rounded-full flex items-center justify-center shadow-lg">
                    <Play className="w-6 h-6 text-black ml-1" fill="currentColor" />
                  </div>
                </button>
              </div>

              {/* 卡片内容 */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">
                      {video.fileName || `视频 ${index + 1}`}
                    </div>
                    {video.qualities && video.qualities.length > 0 && (
                      <div className="text-xs text-admin-muted mt-1">
                        {video.qualities.map(q => q.quality).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(index);
                    }}
                    className="p-1 rounded hover:bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    title="删除视频"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* 拖拽手柄 */}
                <div className="cursor-grab active:cursor-grabbing flex justify-center mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical className="w-4 h-4 text-admin-muted" />
                </div>
              </div>

              {/* 默认播放标记 */}
              {index === 0 && (
                <div className="absolute top-2 left-2 px-2 py-1 bg-star-accent text-black text-xs font-bold rounded-full">
                  默认播放
                </div>
              )}
            </div>
          ))}

          {/* 上传更多视频 */}
          <div
            className={`flex-shrink-0 w-56 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
              isDragging
                ? 'border-star-accent bg-star-accent/10'
                : 'border-admin-border hover:border-star-accent/50 bg-admin-card/30 cursor-pointer'
            }`}
            onDragOver={handleDragOverForUpload}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              id="video-upload-more"
              className="hidden"
              accept="video/*"
              onChange={handleFileSelect}
            />
            <label htmlFor="video-upload-more" className="cursor-pointer flex flex-col items-center justify-center gap-2 h-full min-h-[180px]">
              <Plus className="w-6 h-6 text-admin-muted" />
              <span className="text-sm text-admin-muted">上传更多视频</span>
            </label>
          </div>
        </div>
      )}

      {/* 上传进度 */}
      {uploadProgress.progress > 0 && (
        <div className="p-4 bg-admin-card border border-admin-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white">{uploadProgress.fileName}</span>
            <span className="text-sm text-star-accent">{uploadProgress.progress}%</span>
          </div>
          <div className="w-full bg-admin-border rounded-full h-2 overflow-hidden">
            <div
              className="bg-star-accent h-2 transition-all duration-300 ease-out"
              style={{ width: `${uploadProgress.progress}%` }}
            />
          </div>
          <div className="text-xs text-admin-muted mt-2 text-center">
            {uploadProgress.message}
          </div>
        </div>
      )}

      {/* Video Player Modal */}
      {showVideoModal && videos.length > 0 && (
        <VideoPlayerModal
          isOpen={showVideoModal}
          onClose={() => setShowVideoModal(false)}
          videos={[
            {
              url: videos[playingVideoIndex].url,
              poster: videos[playingVideoIndex].poster,
              qualities: videos[playingVideoIndex].qualities,
            } as DisplayVideo
          ]}
        />
      )}
    </div>
  );
};

const Plus = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

export default VideoUploader;
