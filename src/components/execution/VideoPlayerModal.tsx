/**
 * VideoPlayerModal — 动作演示视频播放页（v4 重写）
 *
 * 重写要点（用户批注执行）：
 * - 安全区：顶栏/控制条避开状态栏与灵动岛（safe-area-inset-*），横屏全屏同样避让
 * - 控制层符合通用视频播放习惯：点击画面显隐、中央大播放钮、底部进度条 +
 *   时间 + 播放/暂停 + 全屏，播放中 2.5s 自动隐藏
 * - 多视频选择（库3 male/female 双版本）移到播放器下方：横向滚动预览图条
 *   （thumbnails 作预览图，点按切换视频源），不放顶部
 * - 横屏：容器 Fullscreen API 全屏（系统随设备旋转出横屏画面），全屏内控制条
 *   同样走安全区避让
 * - 选型：源为 R2 直链 MP4（无 HLS/多码率），原生 <video> + 轻控制层即可承载，
 *   不新增 video.js/vidstack 等重依赖（新增依赖说明见 worker_done）
 * - 教程内容渲染不受影响：本组件仅承载视频播放分支
 */

import React, { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../services/geminiService';
import { VideoSource } from '../../types/video';
import { haptic } from '../../lib/nativeHaptics';

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 播放页标题（动作名） */
  title?: string;
  videos: Array<{
    url: string;
    poster?: string;
    /** 预览条标签（如「男版演示」「女版演示」） */
    label?: string;
    qualities?: VideoSource[];
  }>;
}

const UI_HIDE_MS = 2500;

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  isOpen,
  onClose,
  title,
  videos,
}) => {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = videos[index];

  // 开关：锁定背景滚动 + 重置到第一个源
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setIndex(0);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setUiVisible(true);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Esc 关闭 / 全屏态同步
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [onClose]);

  // 播放中自动隐藏控制层
  useEffect(() => {
    if (uiTimer.current) clearTimeout(uiTimer.current);
    if (playing) {
      uiTimer.current = setTimeout(() => setUiVisible(false), UI_HIDE_MS);
    } else {
      setUiVisible(true);
    }
    return () => {
      if (uiTimer.current) clearTimeout(uiTimer.current);
    };
  }, [playing, currentTime, index]);

  if (!isOpen || videos.length === 0) return null;

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    haptic('light');
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const toggleFullscreen = () => {
    haptic('light');
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const wakeUi = () => {
    setUiVisible(true);
    if (uiTimer.current) clearTimeout(uiTimer.current);
    if (playing) uiTimer.current = setTimeout(() => setUiVisible(false), UI_HIDE_MS);
  };

  const selectSource = (i: number) => {
    if (i === index) return;
    haptic('light');
    setIndex(i);
    setCurrentTime(0);
    setDuration(0);
    setUiVisible(true);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in">
      {/* 顶部栏：安全区避让（状态栏/灵动岛） */}
      <div
        className="shrink-0 px-4 pb-2 flex items-center gap-3 bg-black"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
      >
        <button
          onClick={() => { haptic('light'); onClose(); }}
          aria-label="关闭视频"
          className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-white/90 active:bg-white/10 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span className="flex-1 min-w-0 truncate text-[15px] font-medium text-white/90">{title ?? '动作演示'}</span>
        <span className="w-11" aria-hidden="true" />
      </div>

      {/* 播放器：容器全屏（横屏旋转由系统接管），画面点按显隐控制层 */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 flex items-center justify-center bg-black"
        onClick={() => wakeUi()}
      >
        <video
          ref={videoRef}
          key={current.url}
          src={getFullUrl(current.url)}
          poster={current.poster ? getFullUrl(current.poster) : undefined}
          playsInline
          preload="metadata"
          className="w-full max-h-full object-contain bg-black"
          onClick={e => { e.stopPropagation(); togglePlay(); }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={e => setDuration(e.currentTarget.duration)}
          onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        />

        {/* 中央大播放钮 */}
        {!playing && (
          <button
            onClick={e => { e.stopPropagation(); togglePlay(); }}
            aria-label="播放"
            className="absolute z-10 w-16 h-16 rounded-full bg-black/55 backdrop-blur border border-white/20 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <svg className="w-7 h-7 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 000-1.76L9.56 4.26A1.04 1.04 0 008 5.14z" />
            </svg>
          </button>
        )}

        {/* 底部控制条：进度 + 时间 + 播放/暂停 + 全屏（安全区避让，横屏全屏同样生效） */}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 px-4 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-200 ${
            uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={e => {
              const t = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = t;
              setCurrentTime(t);
            }}
            aria-label="播放进度"
            className="w-full h-6 bg-transparent appearance-none cursor-pointer [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/25 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:-mt-[5px]"
          />
          <div className="flex items-center gap-3 mt-0.5 text-white">
            <button
              onClick={e => { e.stopPropagation(); togglePlay(); }}
              aria-label={playing ? '暂停' : '播放'}
              className="w-9 h-9 -ml-1 flex items-center justify-center active:scale-90 transition-transform"
            >
              {playing ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 000-1.76L9.56 4.26A1.04 1.04 0 008 5.14z" />
                </svg>
              )}
            </button>
            <span className="text-xs font-medium tabular-nums text-white/90">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <span className="flex-1" />
            <button
              onClick={e => { e.stopPropagation(); toggleFullscreen(); }}
              aria-label={isFullscreen ? '退出全屏' : '全屏'}
              className="w-9 h-9 flex items-center justify-center active:scale-90 transition-transform"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {isFullscreen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M15 9h4.5M15 9V4.5M9 15v4.5M9 15H4.5M15 15h4.5M15 15v4.5" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 多视频选择：播放器下方横向预览图条（male/female 双版本，点按切换） */}
      {videos.length > 1 && (
        <div
          className="shrink-0 bg-black px-4 pt-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
        >
          <p className="text-xs text-white/50 font-medium mb-2">切换演示版本</p>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {videos.map((v, i) => (
              <button
                key={v.url + i}
                onClick={() => selectSource(i)}
                aria-label={v.label ?? `视频 ${i + 1}`}
                className={`shrink-0 w-28 rounded-xl overflow-hidden border-2 transition-colors ${
                  i === index ? 'border-blue-500' : 'border-white/15'
                } bg-gray-900`}
              >
                {v.poster ? (
                  <img src={getFullUrl(v.poster)} alt="" loading="lazy" className="w-full aspect-video object-cover" />
                ) : (
                  <span className="w-full aspect-video flex items-center justify-center text-white/40 text-xs">演示</span>
                )}
                <span className={`block text-[11px] font-medium py-1 text-center ${i === index ? 'text-blue-400' : 'text-white/70'}`}>
                  {v.label ?? `版本 ${i + 1}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
