/**
 * tutorialPoster — 详情页卡头教程缩略图数据链（#81）。
 *
 * 图源：A4 库数据的教程视频封面帧 poster_url。拉取复用 ExerciseTutorialModal
 * 的既有教程数据链（GET /api/exercises/:id，库数据唯一下钻路径），不另造请求；
 * 模块级缓存 + 在途去重：同一 exerciseId 只打一次后端，重开详情/同动作多卡
 * 零重放（对齐教程 Sheet 的「教程数据缓存复用」口径）。
 *
 * 懒加载口径（项目既有模式）：封面字节走 <img loading="lazy"> 原生懒加载
 * （ExercisePickerModal/VideoPlayerModal 同款），URL 元数据随卡挂载即取
 * （详情页卡量 ≤10，页内一屏量级）。
 */
import { useEffect, useState } from 'react';
import { API_BASE, getHeaders } from '../../services/geminiService';
import { preconnectAssetOrigin } from '../../lib/assetPreconnect';

interface PosterEntry {
  promise: Promise<string | null>;
  /** Promise 落定后的同步镜像（null=已确认无封面/拉取失败），供首帧免骨架回放 */
  settled?: string | null;
}

const cache = new Map<string, PosterEntry>();

/** 相对路径 → 后端源绝对 URL（与 ExerciseTutorialModal.getFullUrl 同口径） */
export function resolveAssetUrl(url: string): string {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  const baseUrl = API_BASE.replace(/\/api\/?$/, '');
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function requestPoster(exerciseId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}`, {
      headers: getHeaders({}, false),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = typeof data?.poster_url === 'string' && data.poster_url ? data.poster_url : null;
    if (!raw) return null;
    const url = resolveAssetUrl(raw);
    // 封面源提前建连（T6 同款，幂等按 origin）：点开教程 Sheet 时省一次冷握手
    preconnectAssetOrigin(url);
    return url;
  } catch {
    return null; // 拉取失败降级占位图标，不炸卡头
  }
}

/** 教程封面帧 URL（null=无封面/拉取失败）。缓存 Promise：在途去重 + 负结果复用。 */
export function tutorialPoster(exerciseId: string): Promise<string | null> {
  let entry = cache.get(exerciseId);
  if (!entry) {
    const promise = requestPoster(exerciseId).then((url) => {
      entry!.settled = url;
      return url;
    });
    entry = { promise };
    cache.set(exerciseId, entry);
  }
  return entry.promise;
}

/** 同步窥探缓存（undefined=未拉取过）；null=已确认无封面。 */
export function peekTutorialPoster(exerciseId: string): string | null | undefined {
  return cache.get(exerciseId)?.settled;
}

export interface TutorialPosterState {
  /** 封面 URL；null=无封面/拉取失败（降级占位图标） */
  posterUrl: string | null;
  /** 元数据拉取中（首帧静态骨架态；缓存命中恒 false，不闪骨架） */
  loading: boolean;
}

/** 卡头缩略图封面状态 hook：挂载即沿教程数据链取 poster_url，缓存命中同步回放。 */
export function useTutorialPoster(exerciseId: string | undefined): TutorialPosterState {
  const cached = exerciseId ? peekTutorialPoster(exerciseId) : undefined;
  const [posterUrl, setPosterUrl] = useState<string | null>(cached ?? null);
  const [loading, setLoading] = useState<boolean>(Boolean(exerciseId) && cached === undefined);

  useEffect(() => {
    if (!exerciseId) return;
    let alive = true;
    const hit = peekTutorialPoster(exerciseId);
    if (hit !== undefined) {
      setPosterUrl(hit);
      setLoading(false);
      return;
    }
    setPosterUrl(null);
    setLoading(true);
    void tutorialPoster(exerciseId).then((url) => {
      if (!alive) return;
      setPosterUrl(url);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [exerciseId]);

  return exerciseId ? { posterUrl, loading } : { posterUrl: null, loading: false };
}
