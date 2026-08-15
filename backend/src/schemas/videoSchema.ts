import { z } from 'zod';

/**
 * 视频源信息
 */
export const VideoSourceSchema = z.object({
  quality: z.enum(['360p', '720p', '1080p']),
  url: z.string(), // 使用相对路径，前端用 getFullUrl() 处理
  size: z.number().positive(),
  bandwidth: z.number().positive(),
});

/**
 * 视频元数据
 */
export const VideoMetadataSchema = z.object({
  originalFilename: z.string(),
  duration: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  codec: z.string(),
  bitrate: z.number().positive(),
  size: z.number().positive(),
});

/**
 * 视频资产
 */
export const VideoAssetSchema = z.object({
  id: z.string().uuid(),
  exerciseName: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  type: z.enum(['local', 'cdn']).default('local'),
  baseUrl: z.string(),
  sources: z.array(VideoSourceSchema).default([]),
  posterUrl: z.string(),
  metadata: VideoMetadataSchema,
  createdAt: z.number(),
});

export type VideoAsset = z.infer<typeof VideoAssetSchema>;
export type VideoSource = z.infer<typeof VideoSourceSchema>;
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;
