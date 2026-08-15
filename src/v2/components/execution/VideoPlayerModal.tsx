import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2, Settings } from 'lucide-react';
import { API_BASE } from '../../../services/geminiService';
import { VideoSource } from '../../../types/video';

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videos: Array<{
    url: string;
    poster?: string;
    qualities?: VideoSource[];
  }>;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  isOpen,
  onClose,
  videos,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showUi, setShowUi] = useState(true);
  const [currentQuality, setCurrentQuality] = useState<'auto' | '360p' | '720p' | '1080p'>('auto');
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [touchStartX, setTouchStartX] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    
    // 从 API_BASE 推导后端基础路径
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const getCurrentVideoUrl = () => {
    const currentVideo = videos[currentIndex];
    if (!currentVideo) return '';

    let url = '';
    if (currentQuality === 'auto' || !currentVideo.qualities || currentVideo.qualities.length === 0) {
      url = getFullUrl(currentVideo.url);
    } else {
      const selectedSource = currentVideo.qualities.find(q => q.quality === currentQuality);
      url = selectedSource ? getFullUrl(selectedSource.url) : getFullUrl(currentVideo.url);
    }

    console.log('[VideoPlayerModal] Current Video URL:', url);
    return url;
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % videos.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + videos.length) % videos.length);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    const threshold = 50;

    if (touchStartX < 40 && touchEndX - touchStartX > 80) {
      onClose();
      return;
    }

    if (diff > threshold) {
      handleNext();
    } else if (diff < -threshold) {
      handlePrev();
    }
  };

  const currentVideo = videos[currentIndex];
  const sources = currentVideo?.qualities || [{ url: currentVideo.url, quality: 'original' }];

  if (!isOpen || !currentVideo) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="relative w-full h-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部信息条 */}
        {showUi && (
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-4 pb-6 bg-gradient-to-b from-black/70 to-transparent">
            <div className="text-white text-sm font-medium truncate max-w-[60%]">
              动作教学
            </div>
            <div className="flex items-center gap-2">
              {currentVideo.qualities && currentVideo.qualities.length > 0 && (
                <div className="flex items-center bg-black/60 rounded-2xl px-2 py-1 text-xs text-white gap-1 border border-white/10">
                  <Settings className="w-3 h-3" />
                  {['auto', '360p', '720p', '1080p'].map(quality => (
                    <button
                      key={quality}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentQuality(quality as 'auto' | '360p' | '720p' | '1080p');
                        if (videoRef.current) {
                          const t = videoRef.current.currentTime;
                          const playing = !videoRef.current.paused;
                          videoRef.current.load();
                          videoRef.current.currentTime = t;
                          if (playing) videoRef.current.play();
                        }
                      }}
                      className={
                        currentQuality === quality
                          ? 'px-1 text-star-accent font-bold active:scale-95 transition-transform'
                          : 'px-1 opacity-70 hover:opacity-100 active:scale-95 transition-transform'
                      }
                    >
                      {quality === 'auto' ? '自动' : quality}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-2xl text-white transition-all active:scale-95 border border-white/10 shadow-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-2xl text-white transition-all active:scale-95 border border-white/10 shadow-sm"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button
                onClick={onClose}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-2xl text-white transition-all active:scale-95 border border-white/10 shadow-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* 视频区域 */}
        <div
          className="relative w-full max-w-5xl mx-auto"
          onClick={() => setShowUi(prev => !prev)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* 左右切换按钮 */}
          {videos.length > 1 && showUi && (
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 bg-black/50 hover:bg-black/70 rounded-2xl text-white transition-all active:scale-95 opacity-0 hover:opacity-100 border border-white/10"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
          )}

          {/* 视频播放器 */}
          <video
            ref={videoRef}
            key={`${currentIndex}-${currentQuality}`}
            src={getCurrentVideoUrl()}
            poster={currentVideo.poster ? getFullUrl(currentVideo.poster) : undefined}
            className="w-full h-full max-h-[90vh] bg-black object-contain"
            controls={false}
            autoPlay
            playsInline
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              setCurrentTime(el.currentTime || 0);
              setDuration(el.duration || 0);
            }}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              setDuration(el.duration || 0);
            }}
          >
            您的浏览器不支持视频播放。
          </video>

          {/* 右侧切换按钮 */}
          {videos.length > 1 && showUi && (
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 bg-black/50 hover:bg-black/70 rounded-2xl text-white transition-all active:scale-95 opacity-0 hover:opacity-100 border border-white/10"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}

          {/* 底部控制条 */}
          {showUi && (
            <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-4 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
              <div className="flex items-center gap-3 mb-2 text-xs text-white/80">
                <span>{formatTime(currentTime)}</span>
                <div
                  className="flex-1 h-1.5 bg-white/20 rounded-2xl overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!videoRef.current || !duration) return;
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const nextTime = Math.max(0, Math.min(duration * ratio, duration));
                    videoRef.current.currentTime = nextTime;
                    setCurrentTime(nextTime);
                  }}
                >
                  <div
                    className="h-full bg-star-accent rounded-2xl transition-all"
                    style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="flex items-center justify-between text-xs text-white/80">
                <div className="flex items-center gap-2">
                  {videos.length > 1 && (
                    <span className="px-2 py-0.5 rounded-2xl bg-white/10 border border-white/10 uppercase tracking-widest font-bold text-[10px]">
                      {currentIndex + 1} / {videos.length}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const formatTime = (seconds: number) => {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
};

export default VideoPlayerModal;
