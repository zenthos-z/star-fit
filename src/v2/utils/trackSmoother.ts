/**
 * GPS 轨迹平滑器（2D 稳态卡尔曼滤波，alpha-beta 参数化）
 *
 * 为什么自写而不用 kalman-filter npm 包：
 * - 包的 dynamic.covariance / init 在 constant-speed 模型下行为不可控（参数变化无效果），
 *   调参黑箱；GPS 平滑本质是恒速模型的稳态卡尔曼，教科书标准解即 alpha-beta 滤波，
 *   ~50 行完全可控、可单测、零依赖。
 *
 * 算法：α-β 滤波（稳态 Kalman）
 *   predict:  p' = p + v·dt
 *   update:   r  = z - p'            （残差）
 *             p  = p' + α·r          （位置修正）
 *             v  = v + (β/dt)·r      （速度修正）
 *
 * 增益与精度联动：accuracy 差 → α/β 自动调小（更信任模型），
 * accuracy 好 → α/β 调大（更快跟上）。基准：accuracy=10m → α=0.35, β=0.06。
 */
import type { Position } from '../hooks/useGeolocation';

const DEG_LAT_M = 111320; // 1 纬度度 ≈ 米

export class TrackSmoother {
  private lastLat = 0;
  private lastLon = 0;
  private vLat = 0; // 度/s
  private vLon = 0;
  private lastTimestamp = 0;
  private initialized = false;

  filter(lat: number, lon: number, timestamp: number, accuracy: number): [number, number] {
    if (!this.initialized) {
      // 首点直接采用；速度未知置 0（第二点残差自然建立速度）
      this.lastLat = lat;
      this.lastLon = lon;
      this.lastTimestamp = timestamp;
      this.initialized = true;
      return [lat, lon];
    }

    const dt = Math.min(30, Math.max(0.5, (timestamp - this.lastTimestamp) / 1000));
    const [alpha, beta] = gainsFor(accuracy);

    const predLat = this.lastLat + this.vLat * dt;
    const predLon = this.lastLon + this.vLon * dt;
    const rLat = lat - predLat;
    const rLon = lon - predLon;

    this.lastLat = predLat + alpha * rLat;
    this.lastLon = predLon + alpha * rLon;
    this.vLat = this.vLat + (beta / dt) * rLat;
    this.vLon = this.vLon + (beta / dt) * rLon;
    this.lastTimestamp = timestamp;

    return [this.lastLat, this.lastLon];
  }

  reset(): void {
    this.initialized = false;
    this.vLat = 0;
    this.vLon = 0;
    this.lastTimestamp = 0;
  }
}

/** 按定位精度计算 α/β 增益。accuracy 越差越信任运动模型。 */
export function gainsFor(accuracy: number): [number, number] {
  // accuracy 10m → (0.35, 0.06)；3m → (0.55, 0.15)；30m → (0.2, 0.02)
  const a = Math.min(50, Math.max(1, accuracy));
  const alpha = Math.max(0.15, 0.55 - 0.008 * (a - 3));
  const beta = Math.max(0.02, 0.15 - 0.0027 * (a - 3));
  return [alpha, beta];
}

/** 便捷：直接平滑一个 Position 序列（测试/批处理用） */
export function smoothTrack(positions: Position[]): Position[] {
  const smoother = new TrackSmoother();
  return positions.map((p) => {
    const [lat, lon] = smoother.filter(p.latitude, p.longitude, p.timestamp, p.accuracy ?? 10);
    return { ...p, latitude: lat, longitude: lon };
  });
}
