// 统一的视频数据类型定义

export interface VideoSource {
  quality: '360p' | '720p' | '1080p';
  url: string;
  size: number;
  bandwidth: number;
}

export interface VideoMetadata {
  originalFilename: string;
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  size: number;
}

export interface VideoAsset {
  id: string;
  exerciseId: string;  // NanoID format
  type: 'local' | 'cdn';
  baseUrl: string;
  sources: VideoSource[];
  posterUrl: string;
  metadata: VideoMetadata;
  createdAt: number;
  originalVideoUrl?: string;
}

export interface VideoCard {
  id: string;
  url: string;
  poster?: string;
  qualities?: VideoSource[];
  fileName?: string;
  createdAt?: number;
  baseUrl?: string;
  originalVideoUrl?: string;
  metadata?: VideoMetadata;
}

// 前端显示用的简化类型
export interface DisplayVideo {
  url: string;
  poster?: string;
  qualities?: VideoSource[];
}
