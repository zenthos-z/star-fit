/**
 * WGS-84 → GCJ-02 坐标转换（国测局加偏算法，业界标准近似实现）
 *
 * 背景：GPS 硬件输出 WGS-84 真坐标；国内地图底图（高德/腾讯/GeoQ）全部使用
 * GCJ-02 加偏坐标系。不转换则轨迹整体偏移 300~500 米。
 *
 * 用法约定：
 * - 仅在【渲染到国内底图】前转换；数据库与距离计算一律使用 WGS-84 原始值。
 * - 精度：标准近似算法，误差 ~1-2m，远小于 GPS 本身噪声。
 * - 海外坐标（outOfChina）原样返回，不加偏。
 */

const PI = Math.PI;
const A = 6378245.0; // 长半轴
const EE = 0.00669342162296594323; // 偏心率平方

const transformLat = (x: number, y: number): number => {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
};

const transformLon = (x: number, y: number): number => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
};

/** 是否在中国大陆坐标范围外（范围外不加偏） */
export const outOfChina = (lon: number, lat: number): boolean => {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
};

/** WGS-84 → GCJ-02。返回 [latitude, longitude]（Leaflet 顺序）。 */
export const wgs84ToGcj02 = (lat: number, lon: number): [number, number] => {
  if (outOfChina(lon, lat)) {
    return [lat, lon];
  }
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  const mgLat = lat + dLat;
  const mgLon = lon + dLon;
  return [mgLat, mgLon];
};
