/**
 * VideoProcessingService - 视频上传和处理服务
 *
 * 功能：
 * - 视频文件上传
 * - 自动压缩生成多个清晰度版本 (360p/720p/1080p)
 * - 生成视频封面和预览图
 * - 支持 Range 请求实现流式播放
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketProgressBroadcaster } from './websocketProgressService.js';
import { VideoAssetSchema, VideoAsset } from '../schemas/videoSchema.js';

const execAsync = promisify(exec);

// ============================================
// 进度事件发射器
// ============================================

export const videoProgressEmitter = new EventEmitter();

export interface VideoProgressEvent {
  stage: 'uploading' | 'compressing' | 'poster' | 'complete' | 'error';
  progress: number; // 0-100
  message: string;
  exerciseName: string;
}

// ============================================
// 类型定义
// ============================================

export interface VideoUploadOptions {
  exerciseName: string;
  generatePoster?: boolean;
  qualities?: VideoQuality[];
}

export type VideoQuality = '360p' | '720p' | '1080p';

export interface VideoMetadata {
  originalFilename: string;
  duration: number; // 秒
  width: number;
  height: number;
  size: number; // 字节
  codec: string;
  bitrate: number;
}

export interface ProcessedVideo {
  id: string;
  exerciseName: string;
  baseUrl: string;
  originalVideoUrl: string;
  sources: {
    quality: VideoQuality;
    url: string;
    size: number;
    bandwidth: number;
  }[];
  posterUrl: string;
  metadata: VideoMetadata;
  createdAt: number;
}

// ============================================
// VideoProcessingService
// ============================================

export const VideoProcessingService = {
  /**
   * 获取视频元数据
   */
  async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,bit_rate -show_entries format=duration,size -of json "${filePath}"`;
    const { stdout } = await execAsync(command);
    const data = JSON.parse(stdout);

    const stream = data.streams[0];
    const format = data.format;

    return {
      originalFilename: path.basename(filePath),
      duration: parseFloat(format.duration),
      width: stream.width,
      height: stream.height,
      size: parseInt(format.size),
      codec: stream.codec_name,
      bitrate: parseInt(stream.bit_rate) || 0,
    };
  },

  /**
   * 压缩视频到指定清晰度（带进度回调）
   */
  async compressVideo(
    inputPath: string,
    outputPath: string,
    quality: VideoQuality,
    exerciseName: string,
    qualityIndex: number, // 当前是第几个清晰度（用于进度计算）
    totalQualities: number, // 总共多少个清晰度
    taskId?: string, // 用于 WebSocket 进度广播
    crf: number = 23 // CRF 值，越小质量越高（18-28 是合理范围）
  ): Promise<{ size: number; bitrate: number }> {
    let scaleFilter: string;
    let maxBitrate: string;
    let qualityLabel: string;

    // 清晰度配置
    switch (quality) {
      case '360p':
        scaleFilter = 'scale=-2:360';
        maxBitrate = '800k'; // 800 kbps
        qualityLabel = '低清晰度 (360p)';
        break;
      case '720p':
        scaleFilter = 'scale=-2:720';
        maxBitrate = '3000k'; // 3 Mbps
        qualityLabel = '中清晰度 (720p)';
        break;
      case '1080p':
        scaleFilter = 'scale=-2:1080';
        maxBitrate = '6000k'; // 6 Mbps
        qualityLabel = '高清晰度 (1080p)';
        break;
    }

    // 计算当前阶段的进度（50% - 90%）
    const stageProgress = 50 + Math.floor((qualityIndex / totalQualities) * 40);

    if (taskId) {
      WebSocketProgressBroadcaster.broadcast(taskId, {
        type: 'fit.video.progress',
        data: {
          stage: 'compressing',
          progress: stageProgress,
          message: `正在压缩${qualityLabel}...`
        }
      });
    }

    // 使用 spawn 实现进度跟踪
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', crf.toString(),
        '-vf', scaleFilter,
        '-maxrate', maxBitrate,
        '-bufsize', maxBitrate,
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let lastProgress = 0;

      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        // 解析 FFmpeg 进度输出
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          // 简单的进度估算（基于时间）
          const hours = parseInt(timeMatch[1]) * 3600;
          const minutes = parseInt(timeMatch[2]) * 60;
          const seconds = parseInt(timeMatch[3]);
          const currentTime = hours + minutes + seconds;

          // 假设视频长度约 60 秒（实际应该从元数据获取）
          const estimatedDuration = 60;
          const progress = Math.min((currentTime / estimatedDuration) * 100, 95);

          if (progress - lastProgress > 5) { // 每 5% 更新一次
            lastProgress = progress;
            if (taskId) {
              WebSocketProgressBroadcaster.broadcast(taskId, {
                type: 'fit.video.progress',
                data: {
                  stage: 'compressing',
                  progress: stageProgress,
                  message: `正在压缩${qualityLabel}... ${Math.round(progress)}%`
                }
              });
            }
          }
        }
      });

      ffmpeg.on('close', async (code) => {
        if (code === 0) {
          try {
            const stats = await fs.stat(outputPath);
            resolve({ size: stats.size, bitrate: parseInt(maxBitrate) });
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });
  },

  /**
   * 处理视频上传（生成多清晰度版本）
   */
  async processVideoUpload(
    inputPath: string,
    options: VideoUploadOptions,
    taskId?: string
  ): Promise<ProcessedVideo> {
    const {
      exerciseName,
      generatePoster = true,
      qualities = ['360p', '720p', '1080p']
    } = options;

    // 广播进度：开始处理
    if (taskId) {
      WebSocketProgressBroadcaster.broadcast(taskId, {
        type: 'fit.video.progress',
        data: {
          stage: 'extracting_metadata',
          progress: 0,
          message: '开始处理视频...'
        }
      });
    }

    try {
      const metadata = await this.getVideoMetadata(inputPath);

      const videoId = uuidv4();
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const videosDir = path.join(uploadsDir, 'videos');
      const exerciseDir = path.join(videosDir, exerciseName);
      const videoDir = path.join(exerciseDir, videoId);
      await fs.mkdir(videoDir, { recursive: true });

      const originalVideoPath = path.join(videoDir, 'original.mp4');
      if (inputPath !== originalVideoPath) {
        await fs.rename(inputPath, originalVideoPath);
      }
      console.log(`[VideoProcessing] Original video saved to: ${originalVideoPath}`);

      const posterPath = path.join(videoDir, 'poster.jpg');
      const posterUrl = `/uploads/videos/${exerciseName}/${videoId}/poster.jpg`;

      if (generatePoster) {
        if (taskId) {
          WebSocketProgressBroadcaster.broadcast(taskId, {
            type: 'fit.video.progress',
            data: {
              stage: 'generating_poster',
              progress: 30,
              message: '正在生成封面图...'
            }
          });
        }
        await this.generatePoster(originalVideoPath, posterPath, Math.floor(metadata.duration / 2));
      }

      // 5. 生成多个清晰度版本
      const sources: {
        quality: VideoQuality;
        url: string;
        size: number;
        bandwidth: number;
      }[] = [];
      for (let i = 0; i < qualities.length; i++) {
        const quality = qualities[i];
        const outputPath = path.join(videoDir, `${quality}.mp4`);
        const result = await this.compressVideo(
          originalVideoPath,
          outputPath,
          quality,
          exerciseName,
          i,
          qualities.length,
          taskId
        );

        sources.push({
          quality,
          url: `/uploads/videos/${exerciseName}/${videoId}/${quality}.mp4`,
          size: result.size,
          bandwidth: result.bitrate,
        });
      }

      console.log(`[VideoProcessing] Video processing complete. Generated: ${sources.length} qualities`);

      const createdAt = Date.now();
      const baseUrl = `/uploads/videos/${exerciseName}/${videoId}`;

      VideoAssetSchema.parse({
        id: videoId,
        exerciseName,
        type: 'local',
        baseUrl,
        sources,
        posterUrl,
        metadata,
        createdAt
      });

      return {
        id: videoId,
        exerciseName,
        baseUrl,
        originalVideoUrl: `${baseUrl}/original.mp4`,
        sources,
        posterUrl,
        metadata,
        createdAt,
      };
    } catch (error) {
      // 广播错误事件
      if (taskId) {
        WebSocketProgressBroadcaster.broadcast(taskId, {
          type: 'fit.video.error',
          data: {
            taskId,
            error: error instanceof Error ? error.message : String(error),
            stage: 'processing',
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        });
      }
      throw error;
    }
  },

  /**
   * 生成视频封面/预览图
   */
  async generatePoster(
    inputPath: string,
    outputPath: string,
    timestamp: number | string = 1 // 截取时间点（秒）
  ): Promise<void> {
    // 截取第 1 秒的帧作为封面
    const command = `ffmpeg -i "${inputPath}" -ss ${timestamp} -vframes 1 -vf "scale=320:-1" "${outputPath}" -y`;
    await execAsync(command);
  },

  /**
   * 清理文件名（移除特殊字符）
   */
  sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-') // 保留中文、字母、数字
      .replace(/-+/g, '-') // 合并连续的连字符
      .replace(/^-|-$/g, ''); // 移除首尾连字符
  },

  /**
   * 检查 FFmpeg 是否已安装
   */
  async checkFFmpegInstalled(): Promise<boolean> {
    try {
      await execAsync('ffmpeg -version');
      return true;
    } catch {
      return false;
    }
  },

  /**
   * 删除视频文件（所有清晰度版本）
   */
  async deleteVideo(exerciseName: string): Promise<void> {
    const videoDir = path.join(
      process.cwd(),
      'uploads',
      'videos',
      this.sanitizeFilename(exerciseName)
    );

    if (existsSync(videoDir)) {
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  },
};

// ============================================
// 辅助函数
// ============================================

/**
 * 计算视频带宽（用于 HLS 流式播放）
 */
export function calculateBandwidth(size: number, duration: number): number {
  return Math.floor((size * 8) / duration); // bps
}
