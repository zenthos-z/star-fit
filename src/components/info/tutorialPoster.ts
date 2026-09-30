/**
 * tutorialPoster — 详情页卡头教程缩略图数据链（#81）。
 *
 * 图源：A4 库数据的教程视频封面帧 poster_url。拉取复用 ExerciseTutorialModal
 * 的既有教程数据链（GET /api/exercises/:id，库数据唯一下钻路径），不另造请求；
 * 模块级缓存 + 在途去重：同一 exerciseId 只打一次后端，重开详情/同动作多卡
 * 零重放（对齐教程 Sheet 的「教程数据缓存复用」口径）。
 *
 * ▸ 角标唯一依据：同响应的 video_urls（male/female 任一非空）=库内确有演示
 * 视频（#81 二次返工）。无视频动作不渲染 ▸，不做虚假可播信号。
 *
 * 懒加载口径（项目既有模式）：封面字节走 <img loading="lazy"> 原生懒加载
 * （ExercisePickerModal/VideoPlayerModal 同款），URL 元数据随卡挂载即取
 * （详情页卡量 ≤10，页内一屏量级）。
 */
import { useEffect, useState } from 'react';
import { API_BASE, getHeaders } from '../../services/geminiService';
import { preconnectAssetOrigin } from '../../lib/assetPreconnect';

/** 库条目教程素材信息（poster + 是否有演示视频） */
export interface PosterInfo {
  /** 封面帧 URL；null=无封面/拉取失败（降级占位图标） */
  posterUrl: string | null;
  /** 库内确有演示视频（video_urls male/female 任一非空）——▸ 角标唯一依据 */
  hasVideo: boolean;
}

interface PosterEntry {
  promise: Promise<PosterInfo>;
  /** Promise 落定后的同步镜像（posterUrl null=已确认无封面/拉取失败），供首帧免骨架回放 */
  settled?: PosterInfo;
}

const cache = new Map<string, PosterEntry>();

/** 相对路径 → 后端源绝对 URL（与 ExerciseTutorialModal.getFullUrl 同口径） */
export function resolveAssetUrl(url: string): string {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  const baseUrl = API_BASE.replace(/\/api\/?$/, '');
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** video_urls 解析（库列可为 JSON 字符串或对象，与 ExerciseTutorialModal 同口径） */
function parseVideoUrls(raw: unknown): { male?: string; female?: string } | null {
  if (!raw) return null;
  const vu = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
    : raw;
  return vu && typeof vu === 'object' ? (vu as { male?: string; female?: string }) : null;
}

async function requestPoster(exerciseId: string): Promise<PosterInfo> {
  try {
    const res = await fetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}`, {
      headers: getHeaders({}, false),
    });
    if (!res.ok) return { posterUrl: null, hasVideo: false };
    const data = await res.json();
    const vu = parseVideoUrls(data?.video_urls);
    const hasVideo = Boolean(vu?.male || vu?.female);
    const raw = typeof data?.poster_url === 'string' && data.poster_url ? data.poster_url : null;
    if (!raw) return { posterUrl: null, hasVideo };
    const url = resolveAssetUrl(raw);
    // 封面源提前建连（T6 同款，幂等按 origin）：点开教程 Sheet 时省一次冷握手
    preconnectAssetOrigin(url);
    return { posterUrl: url, hasVideo };
  } catch {
    return { posterUrl: null, hasVideo: false }; // 拉取失败降级占位图标，不炸卡头
  }
}

/** 教程素材信息（缓存 Promise：在途去重 + 负结果复用）。 */
export function tutorialPoster(exerciseId: string): Promise<PosterInfo> {
  let entry = cache.get(exerciseId);
  if (!entry) {
    const promise = requestPoster(exerciseId).then((info) => {
      entry!.settled = info;
      return info;
    });
    entry = { promise };
    cache.set(exerciseId, entry);
  }
  return entry.promise;
}

/** 同步窥探缓存（undefined=未拉取过）。 */
export function peekTutorialPoster(exerciseId: string): PosterInfo | undefined {
  return cache.get(exerciseId)?.settled;
}

export interface TutorialPosterState {
  /** 封面 URL；null=无封面/拉取失败（降级占位图标） */
  posterUrl: string | null;
  /** 库内确有演示视频——▸ 角标唯一依据 */
  hasVideo: boolean;
  /** 元数据拉取中（首帧静态骨架态；缓存命中恒 false，不闪骨架） */
  loading: boolean;
}

/** 卡头缩略图封面状态 hook：挂载即沿教程数据链取素材信息，缓存命中同步回放。 */
export function useTutorialPoster(exerciseId: string | undefined): TutorialPosterState {
  const cached = exerciseId ? peekTutorialPoster(exerciseId) : undefined;
  const [posterUrl, setPosterUrl] = useState<string | null>(cached?.posterUrl ?? null);
  const [hasVideo, setHasVideo] = useState<boolean>(cached?.hasVideo ?? false);
  const [loading, setLoading] = useState<boolean>(Boolean(exerciseId) && cached === undefined);

  useEffect(() => {
    if (!exerciseId) return;
    let alive = true;
    const hit = peekTutorialPoster(exerciseId);
    if (hit !== undefined) {
      setPosterUrl(hit.posterUrl);
      setHasVideo(hit.hasVideo);
      setLoading(false);
      return;
    }
    setPosterUrl(null);
    setHasVideo(false);
    setLoading(true);
    void tutorialPoster(exerciseId).then((info) => {
      if (!alive) return;
      setPosterUrl(info.posterUrl);
      setHasVideo(info.hasVideo);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [exerciseId]);

  return exerciseId ? { posterUrl, hasVideo, loading } : { posterUrl: null, hasVideo: false, loading: false };
}
