import { test, describe, expect } from 'vitest';
import { TrackSmoother, gainsFor, smoothTrack } from '../src/v2/utils/trackSmoother';
import { wgs84ToGcj02, outOfChina } from '../src/v2/utils/coordTransform';
import type { Position } from '../src/v2/hooks/useGeolocation';

const DEG_LAT_M = 111320;

// 可复现伪随机 [-1, 1]
function makeRand(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
}

describe('TrackSmoother（稳态卡尔曼 α-β 轨迹平滑）', () => {
  test('匀速直线运动：位置抖动大幅下降，平滑输出收敛到真实路径', () => {
    const smoother = new TrackSmoother();
    const rand = makeRand(42);
    // 模拟真实跑步：3m/s（配速 ~5:33/km）、1Hz 采样、±15m 横向 GPS 噪声
    const n = 60;
    const raw: [number, number][] = [];
    const smoothed: [number, number][] = [];

    for (let t = 0; t < n; t++) {
      const trueLat = 39.9 + t * (3 / DEG_LAT_M);
      const trueLon = 116.4;
      const noisyLat = trueLat + (rand() * 15) / DEG_LAT_M;
      const noisyLon = trueLon + (rand() * 15) / (DEG_LAT_M * Math.cos((39.9 * Math.PI) / 180));
      raw.push([noisyLat, noisyLon]);
      smoothed.push(smoother.filter(noisyLat, noisyLon, 1000 * (t + 1), 10));
    }

    // 米域一阶差分方差 = 位置抖动度量（越小越平滑）
    const diffVarRatio = (a: number[], b: number[]) => {
      const diff = (arr: number[]) => arr.slice(1).map((v, i) => v - arr[i]);
      const varOf = (arr: number[]) => {
        const m = arr.reduce((s, x) => s + x, 0) / arr.length;
        return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
      };
      return varOf(diff(b)) / varOf(diff(a));
    };

    const latRatio = diffVarRatio(raw.map((p) => p[0] * DEG_LAT_M), smoothed.map((p) => p[0] * DEG_LAT_M));
    const lonRatio = diffVarRatio(raw.map((p) => p[1] * DEG_LAT_M), smoothed.map((p) => p[1] * DEG_LAT_M));
    expect(latRatio).toBeLessThan(0.5);
    expect(lonRatio).toBeLessThan(0.5);

    // 平滑终点接近真实终点（累计 180s × 3m/s = 540m 北向）
    const trueEndLat = 39.9 + 59 * (3 / DEG_LAT_M);
    const [endLat] = smoothed[smoothed.length - 1];
    expect(Math.abs((endLat - trueEndLat) * DEG_LAT_M)).toBeLessThan(15);
  });

  test('真跑步步长下航向更顺（9m/点 × 3m 噪声）', () => {
    const smoother = new TrackSmoother();
    const rand = makeRand(7);
    // 3s/点（useGeolocation minTime）× 3m/s = 9m 步长
    const jag = (pts: [number, number][]) => {
      let sum = 0;
      for (let i = 2; i < pts.length; i++) {
        const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
        const a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
        let d = Math.abs(a2 - a1);
        if (d > Math.PI) d = 2 * Math.PI - d;
        sum += d;
      }
      return sum;
    };

    const raw: [number, number][] = [];
    const smoothed: [number, number][] = [];
    for (let t = 0; t < 60; t++) {
      const trueLat = 39.9 + t * (9 / DEG_LAT_M);
      const noisyLat = trueLat + (rand() * 3) / DEG_LAT_M;
      const noisyLon = 116.4 + (rand() * 3) / (DEG_LAT_M * Math.cos((39.9 * Math.PI) / 180));
      raw.push([noisyLat, noisyLon]);
      smoothed.push(smoother.filter(noisyLat, noisyLon, 3000 * (t + 1), 8));
    }
    const ratio = jag(smoothed) / jag(raw);
    expect(ratio).toBeLessThan(0.7);
  });

  test('reset 后重新开始滤波', () => {
    const smoother = new TrackSmoother();
    smoother.filter(39.9, 116.4, 1000, 10);
    smoother.filter(39.9001, 116.4, 2000, 10);
    smoother.reset();
    // reset 后首点直接返回原值
    const [lat, lon] = smoother.filter(22.5, 114.05, 3000, 10);
    expect(lat).toBe(22.5);
    expect(lon).toBe(114.05);
  });

  test('不连续轨迹由调用方跳过平滑（useGeolocation 的 isGap 分支约定）', () => {
    const smoother = new TrackSmoother();
    // 约定：gap 点不进 smoother（见 useGeolocation），reset 是处理大跳变的正式途径
    smoother.filter(39.9, 116.4, 1000, 10);
    smoother.filter(39.90005, 116.4, 4000, 10);
    smoother.reset();
    const [lat] = smoother.filter(39.90135, 116.4, 51000, 30);
    // reset 后新点作为轨迹起点原样采用
    expect(lat).toBe(39.90135);
  });

  test('gainsFor：精度越差增益越小（越信任模型）', () => {
    const [aGood, bGood] = gainsFor(3);
    const [aBad, bBad] = gainsFor(30);
    expect(aGood).toBeGreaterThan(aBad);
    expect(bGood).toBeGreaterThan(bBad);
  });

  test('smoothTrack 便捷函数输出等长序列', () => {
    const positions: Position[] = Array.from({ length: 10 }, (_, i) => ({
      latitude: 39.9 + i * (3 / DEG_LAT_M),
      longitude: 116.4,
      timestamp: 1000 * (i + 1),
      accuracy: 8,
    }));
    const result = smoothTrack(positions);
    expect(result).toHaveLength(10);
    expect(result[0].latitude).toBe(positions[0].latitude);
  });
});

describe('wgs84ToGcj02（国测局坐标转换）', () => {
  test('国内坐标加偏，偏移量与业界参考一致', () => {
    const [lat, lon] = wgs84ToGcj02(39.90734, 116.39134); // 天安门
    expect(Math.abs(lat - 39.90874)).toBeLessThan(0.001);
    expect(Math.abs(lon - 116.39758)).toBeLessThan(0.001);
  });

  test('海外坐标原样返回', () => {
    const [lat, lon] = wgs84ToGcj02(40.7128, -74.006); // 纽约
    expect(lat).toBe(40.7128);
    expect(lon).toBe(-74.006);
  });

  test('outOfChina 边界判断', () => {
    expect(outOfChina(-74.006, 40.7128)).toBe(true);
    expect(outOfChina(116.39134, 39.90734)).toBe(false);
  });
});
