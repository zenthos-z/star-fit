/**
 * 户外运动轨迹持久化（L2 Fact Storage 扩展）
 *
 * 目标：页面刷新 / App 闪退 / 切后台冻结时不丢轨迹与计时。
 * 设计：
 * - 单活动会话模型：同一时间只有一条 activeTrack 记录（key 固定 'active'），
 *   开始跑步时创建，结束/放弃时删除。
 * - 每 N 个点批量落盘（throttle），避免 Dexie 写入抖动。
 * - 恢复：卡片挂载时读取，存在未完成轨迹则提示"继续/放弃"。
 */
import { db } from '../storage/db';
import type { Position } from '../hooks/useGeolocation';

export interface ActiveTrack {
  key: 'active';
  startedAt: number;
  updatedAt: number;
  elapsedSec: number;
  distanceM: number;
  positions: Position[];
}

const KEY = 'active';

/** 读取未完成的活动轨迹（无则返回 undefined） */
export async function loadActiveTrack(): Promise<ActiveTrack | undefined> {
  return db.table('activeTracks').get(KEY);
}

/** 创建/全量覆盖保存活动轨迹 */
export async function saveActiveTrack(track: Omit<ActiveTrack, 'key'>): Promise<void> {
  await db.table('activeTracks').put({ ...track, key: KEY });
}

/** 删除活动轨迹（正常完成或用户放弃时调用） */
export async function clearActiveTrack(): Promise<void> {
  await db.table('activeTracks').delete(KEY);
}
