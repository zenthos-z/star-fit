/**
 * GPS 轨迹平滑器（2D 稳态卡尔曼 α-β + 静止零速约束 ZUPT）
 *
 * 为什么自写而不用 kalman-filter npm 包：
 * - 包的 dynamic.covariance / init 在 constant-speed 模型下行为不可控（参数变化无效果），
 *   调参黑箱；GPS 平滑本质是恒速模型的稳态卡尔曼，教科书标准解即 alpha-beta 滤波，
 *   ~70 行完全可控、可单测、零依赖。
 *
 * 算法：α-β 滤波（稳态 Kalman）
 *   predict:  p' = p + v·dt
 *   update:   r  = z - p'            （残差）
 *             p  = p' + α·r          （位置修正）
 *             v  = v + (β/dt)·r      （速度修正）
 *
 * 增益与精度联动：accuracy 差 → α/β 自动调小（更信任模型），
 * accuracy 好 → α/β 调大（更快跟上）。基准：accuracy=10m → α=0.35, β=0.06。
 *
 * ★ 静止零速约束（ZUPT，Zero-velocity Update）——治「原地不动漂出十几公里」：
 *   纯 α-β 的速度估计会被静止时的残差噪声持续充能（随机游走），预测项带着位置
 *   匀速漂走，距离照单全收。对策：检测到静止即冻结位置（轨迹不动、距离不涨）。
 *
 *   静止检测三通道（iOS WKWebView 的 navigator.geolocation 不提供 Doppler speed，
 *   恒为 null，所以无 Doppler 兜底是主路径而非备胎）：
 *   - 通道 A（快速进入）：连续 N 点落在平滑位置 R 米内（R 随 accuracy 自适应）。
 *     原理：静止噪声点围绕真值聚簇；真实移动时 α-β 滤波器稳态滞后 ≈ 步长/α
 *     （3m/s 跑步 ≈ 16~26m），远大于 R，连击自然断掉。典型 10~20s 冻结。
 *   - 通道 B（高噪声兜底）：窗口速度——45s 原始观测首/尾各 1/3 样本均值位移÷时间。
 *     多点均值把 ±15m 噪声压到 σ≈0.2 m/s，阈值能干净区分静止/移动。连续 2 次
 *     < 0.45 m/s 冻结（窗口填满需 ~45s，只在前 45s 或通道 A 失效时兜底）。
 *   - 退出（滞后防抖，任一满足即恢复动态）：Doppler > 0.6；窗口速度 > 0.6；
 *     连续 3 点距冻结点 > max(40, 3R) 米（跑步 ~5 步即触发，快速脱离）。
 *     阈值滞后设计：静止高斯噪声跑出 40m+ 的概率 ~e^-3.5，三连击概率趋零，
 *     不会在原地反复解冻-冻结制造虚距。
 *   另：速度估计钳制在 MAX_SPEED_MPS（≈百米世界纪录），单点离群无法把速度抬飞。
 */
import type { Position } from '../hooks/useGeolocation';

const DEG_LAT_M = 111320; // 1 纬度度 ≈ 米

/** 进入静止阈值（m/s）：Doppler 速度低于此值立即判定静止 */
export const ENTER_STATIC_MPS = 0.25;
/** 脱离静止阈值（m/s）：Doppler 速度高于此值立即恢复动态 */
export const EXIT_STATIC_MPS = 0.6;
/** 速度物理上限（m/s）：≈ 11（百米世界纪录约 10.4），防速度发散 */
export const MAX_SPEED_MPS = 11;
/** 静止模式速度学习率（比动态 β 小一个量级，防噪声把估计抬出静止态） */
const STATIC_BETA = 0.05;

// 通道 A：创新门限连击
/** 连续 N 点贴近平滑位置 → 静止 */
export const STATIC_STREAK = 3;
/** 贴近判定半径（m）= max(10, min(accuracy, 30))，随精度自适应 */
const STREAK_RADIUS_MIN_M = 10;
const STREAK_RADIUS_MAX_M = 30;

// 通道 B：窗口速度（多点均值抗噪）
/** 速度窗口时长 */
export const SPEED_WINDOW_MS = 45000;
/** 窗口最短时长：不足=证据不够，不参与判定 */
const SPEED_WINDOW_MIN_MS = 20000;
/** 窗口速度低于此值 → 静止证据一次 */
export const WINDOW_STATIC_MPS = 0.45;
/** 窗口速度高于此值 → 明确在移动（清连击/解冻） */
export const WINDOW_MOVING_MPS = 0.6;
/** 连续 N 次窗口静止证据才冻结 */
const WINDOW_ENTRY_STREAK = 2;

// 退出：远走连击
/** 连续 N 点远离冻结点 → 恢复动态 */
export const EXIT_STREAK = 3;

interface RawSample {
  t: number;
  lat: number;
  lon: number;
}

export class TrackSmoother {
  private lastLat = 0;
  private lastLon = 0;
  private vLat = 0; // 度/s
  private vLon = 0;
  private lastTimestamp = 0;
  private initialized = false;
  private isStatic = false;
  private staticStreak = 0;
  private exitStreak = 0;
  private windowStaticStreak = 0;
  private rawBuf: RawSample[] = [];

  /**
   * @param speedMps 外部 Doppler 速度（position.coords.speed，m/s，≥0 才有效）。
   *   提供时静止判定/脱离以它为准；WKWebView 下恒为 null，走通道 A/B。
   */
  filter(lat: number, lon: number, timestamp: number, accuracy: number, speedMps?: number): [number, number] {
    this.pushRaw(timestamp, lat, lon);

    if (!this.initialized) {
      // 首点直接采用；速度未知置 0（第二点残差自然建立速度）
      this.lastLat = lat;
      this.lastLon = lon;
      this.lastTimestamp = timestamp;
      this.initialized = true;
      return [lat, lon];
    }

    const dt = Math.min(30, Math.max(0.5, (timestamp - this.lastTimestamp) / 1000));
    const mPerDegLon = DEG_LAT_M * Math.cos((lat * Math.PI) / 180);
    const speedOf = (vLat: number, vLon: number) =>
      Math.hypot(vLat * DEG_LAT_M, vLon * mPerDegLon);
    const clampSpeed = () => {
      const s = speedOf(this.vLat, this.vLon);
      if (s > MAX_SPEED_MPS) {
        const k = MAX_SPEED_MPS / s;
        this.vLat *= k;
        this.vLon *= k;
      }
    };

    const windowSpeed = this.windowSpeedMps(mPerDegLon);
    const windowMoving = windowSpeed != null && windowSpeed > WINDOW_MOVING_MPS;

    if (this.isStatic) {
      // 静止模式：位置冻结（ZUPT）——轨迹不动、距离不涨，只低速维护速度估计
      const rLat = lat - this.lastLat;
      const rLon = lon - this.lastLon;
      this.vLat += (STATIC_BETA / dt) * rLat;
      this.vLon += (STATIC_BETA / dt) * rLon;
      clampSpeed();
      this.lastTimestamp = timestamp;

      const dopplerMoving = speedMps != null && speedMps > EXIT_STATIC_MPS;
      if (dopplerMoving || windowMoving) {
        this.exitStatic();
      } else if (speedMps == null) {
        // 远走连击：连续多点大幅偏离冻结点 = 真的在动（快速脱离，不等窗口）
        const dist = Math.hypot(rLat * DEG_LAT_M, rLon * mPerDegLon);
        const exitDist = Math.max(40, 3 * streakRadius(accuracy));
        if (dist > exitDist) {
          this.exitStreak++;
          if (this.exitStreak >= EXIT_STREAK) {
            this.exitStatic();
          }
        } else {
          this.exitStreak = 0;
        }
      }
      return [this.lastLat, this.lastLon];
    }

    // 动态模式：正常 α-β
    const [alpha, beta] = gainsFor(accuracy);

    const predLat = this.lastLat + this.vLat * dt;
    const predLon = this.lastLon + this.vLon * dt;
    const rLat = lat - predLat;
    const rLon = lon - predLon;

    this.lastLat = predLat + alpha * rLat;
    this.lastLon = predLon + alpha * rLon;
    this.vLat = this.vLat + (beta / dt) * rLat;
    this.vLon = this.vLon + (beta / dt) * rLon;
    clampSpeed();
    this.lastTimestamp = timestamp;

    // 静止进入判定
    if (speedMps != null) {
      // Doppler 低速下最准，单点即可判定
      if (speedMps < ENTER_STATIC_MPS) {
        this.enterStatic();
      }
    } else if (!windowMoving) {
      // 通道 A：创新门限连击（贴近平滑位置）
      const dist = Math.hypot(rLat * DEG_LAT_M, rLon * mPerDegLon);
      if (dist < streakRadius(accuracy)) {
        this.staticStreak++;
        if (this.staticStreak >= STATIC_STREAK) {
          this.enterStatic();
          return [this.lastLat, this.lastLon];
        }
      } else {
        this.staticStreak = 0;
      }
      // 通道 B：窗口速度连续静止证据（高噪声场景兜底）
      if (windowSpeed != null && windowSpeed < WINDOW_STATIC_MPS) {
        this.windowStaticStreak++;
        if (this.windowStaticStreak >= WINDOW_ENTRY_STREAK) {
          this.enterStatic();
          return [this.lastLat, this.lastLon];
        }
      } else {
        this.windowStaticStreak = 0;
      }
    } else {
      this.staticStreak = 0;
      this.windowStaticStreak = 0;
    }

    return [this.lastLat, this.lastLon];
  }

  reset(): void {
    this.initialized = false;
    this.vLat = 0;
    this.vLon = 0;
    this.lastTimestamp = 0;
    this.isStatic = false;
    this.staticStreak = 0;
    this.exitStreak = 0;
    this.windowStaticStreak = 0;
    this.rawBuf = [];
  }

  private enterStatic(): void {
    this.isStatic = true;
    this.staticStreak = 0;
    this.exitStreak = 0;
    this.windowStaticStreak = 0;
    this.vLat = 0;
    this.vLon = 0;
  }

  private exitStatic(): void {
    this.isStatic = false;
    this.staticStreak = 0;
    this.exitStreak = 0;
    this.windowStaticStreak = 0;
    // 速度清零重新建立，防带着冻结前的陈旧速度跳变
    this.vLat = 0;
    this.vLon = 0;
  }

  private pushRaw(t: number, lat: number, lon: number): void {
    this.rawBuf.push({ t, lat, lon });
    // 只保留窗口时长内的样本（留 5s 余量）
    while (this.rawBuf.length > 2 && this.rawBuf[0].t < t - SPEED_WINDOW_MS - 5000) {
      this.rawBuf.shift();
    }
  }

  /** 窗口速度（m/s）：窗口首/尾各 1/3 样本均值位移÷均值时间差；不足最短时长返回 null */
  private windowSpeedMps(mPerDegLon: number): number | null {
    const n = this.rawBuf.length;
    if (n < 3) return null;
    const first = this.rawBuf[0];
    const last = this.rawBuf[n - 1];
    if (last.t - first.t < SPEED_WINDOW_MIN_MS) return null;
    const k = Math.max(1, Math.floor(n / 3));
    let t1 = 0, lat1 = 0, lon1 = 0;
    let t2 = 0, lat2 = 0, lon2 = 0;
    for (let i = 0; i < k; i++) {
      const a = this.rawBuf[i];
      const b = this.rawBuf[n - 1 - i];
      t1 += a.t; lat1 += a.lat; lon1 += a.lon;
      t2 += b.t; lat2 += b.lat; lon2 += b.lon;
    }
    const dtS = (t2 - t1) / k / 1000;
    if (dtS <= 0) return null;
    const dLat = ((lat2 - lat1) / k) * DEG_LAT_M;
    const dLon = ((lon2 - lon1) / k) * mPerDegLon;
    return Math.hypot(dLat, dLon) / dtS;
  }
}

/** 贴近判定半径（m）：随精度自适应，钳在 [10, 30] */
function streakRadius(accuracy: number): number {
  return Math.max(STREAK_RADIUS_MIN_M, Math.min(accuracy, STREAK_RADIUS_MAX_M));
}

/** 按定位精度计算 α/β 增益。accuracy 越差增益越小（越信任模型）。 */
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
