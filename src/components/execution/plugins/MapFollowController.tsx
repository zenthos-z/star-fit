import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * 地图跟随控制器：人物锁定屏幕中心
 *
 * - 跟随模式（默认开）：每个新点把人物 panTo 屏幕中心，用户不操作时始终居中。
 * - 用户拖动/缩放 → 自动切"自由浏览"，由父层显示"回到中心"按钮。
 */
export const FollowModeController = ({
  positions,
  followTrigger,
  onUserGesture,
}: {
  positions: [number, number][];
  /** 变化时强制恢复跟随（如点"回到中心"按钮、切换全屏） */
  followTrigger: number;
  onUserGesture?: () => void;
}) => {
  const map = useMap();
  const followingRef = useRef(true);
  const lastPosRef = useRef<[number, number] | null>(null);
  const zoomedRef = useRef(false);

  // 用户手势 → 退出跟随（dragstart + zoomstart 都算手势）
  useEffect(() => {
    const onGesture = () => {
      if (followingRef.current) {
        followingRef.current = false;
        onUserGesture?.();
      }
    };
    map.on('dragstart', onGesture);
    map.on('zoomstart', onGesture);
    return () => {
      map.off('dragstart', onGesture);
      map.off('zoomstart', onGesture);
    };
  }, [map, onUserGesture]);

  // followTrigger 变化 → 恢复跟随并立即居中（关键：无点时也标记 following，等第一个点到来就居中）
  useEffect(() => {
    followingRef.current = true;
    zoomedRef.current = false;
    const last = lastPosRef.current;
    if (last) {
      map.setView(last, 17, { animate: true });
      zoomedRef.current = true;
    }
  }, [followTrigger, map]);

  // 程序化 setView/panTo 会触发 zoomstart —— 用标记区分：紧跟 followTrigger 的缩放不算用户手势
  useEffect(() => {
    if (followTrigger === 0) return;
    let armed = true;
    const t = setTimeout(() => { armed = false; }, 800);
    return () => clearTimeout(t);
  }, [followTrigger]);

  // 新点 → 跟随模式下 panTo 居中
  useEffect(() => {
    if (positions.length === 0) return;
    const last = positions[positions.length - 1];
    lastPosRef.current = last;
    if (!followingRef.current) return;

    if (!zoomedRef.current) {
      map.setView(last, 17);
      zoomedRef.current = true;
    } else {
      map.panTo(last, { animate: true, duration: 1.2, easeLinearity: 0.3 });
    }
  }, [positions, map]);

  return null;
};

/**
 * 位置标记（Apple 地图 / 体能训练视觉规范）
 */
export const LocationMarker = ({ position, heading }: { position: [number, number]; heading?: number }) => {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const coneRef = useRef<HTMLElement | null>(null);
  const arrowWrapRef = useRef<HTMLElement | null>(null);
  const arrowIconRef = useRef<SVGElement | null>(null);

  // 首次创建：一次性注入完整 DOM
  useEffect(() => {
    const icon = L.divIcon({
      className: 'location-marker',
      html: `
        <div id="lm-root" style="position: relative; width: 64px; height: 64px;">
          <style>
            @keyframes lm-breathe {
              0%, 100% { opacity: 0.35; transform: scale(1); }
              50% { opacity: 0.15; transform: scale(1.15); }
            }
            @keyframes lm-radar {
              0% { transform: scale(0.35); opacity: 0.5; }
              70% { transform: scale(1); opacity: 0; }
              100% { transform: scale(1); opacity: 0; }
            }
            @keyframes lm-pulse {
              0%, 100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0.45); }
              50% { box-shadow: 0 0 0 7px rgba(0, 122, 255, 0); }
            }
          </style>
          <div id="lm-cone" style="
            position: absolute; inset: 0;
            transition: transform 0.6s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease;
          ">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <defs>
                <linearGradient id="lm-cone-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#007AFF" stop-opacity="0.35"/>
                  <stop offset="100%" stop-color="#007AFF" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              <path d="M32 32 L14 8 A32 32 0 0 1 50 8 Z" fill="url(#lm-cone-grad)"/>
            </svg>
          </div>
          <!-- 方向箭头：包裹中心点，heading 旋转时白描边蓝箭头随之转动（Apple 地图位置样式） -->
          <div id="lm-arrow" style="
            position: absolute; top: 50%; left: 50%;
            width: 0; height: 0;
            transition: transform 0.6s cubic-bezier(0.25, 1, 0.5, 1);
          ">
            <!-- 箭头主体：位于圆点上方，指向正北（heading=0） -->
            <svg id="lm-arrow-icon" width="20" height="20" viewBox="0 0 20 20"
              style="position: absolute; top: -27px; left: -10px; opacity: 0; transition: opacity 0.4s ease;">
              <path d="M10 2 L15.5 16 L10 12.8 L4.5 16 Z"
                fill="#007AFF" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
          </div>
          <div style="
            position: absolute; top: 50%; left: 50%;
            width: 46px; height: 46px; margin: -23px 0 0 -23px;
            background: radial-gradient(circle, rgba(0,122,255,0.35) 0%, rgba(0,122,255,0.08) 70%);
            border-radius: 50%;
            animation: lm-breathe 2.4s ease-in-out infinite;
          "></div>
          <div style="
            position: absolute; top: 50%; left: 50%;
            width: 46px; height: 46px; margin: -23px 0 0 -23px;
            border: 2px solid rgba(0,122,255,0.6);
            border-radius: 50%;
            animation: lm-radar 3s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
          "></div>
          <div style="
            position: absolute; top: 50%; left: 50%;
            width: 17px; height: 17px; margin: -8.5px 0 0 -8.5px;
            background: #007AFF;
            border: 3px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(0,0,0,0.08);
            animation: lm-pulse 2.4s ease-in-out infinite;
          "></div>
        </div>
      `,
      iconSize: [64, 64],
      iconAnchor: [32, 32],
    });

    const marker = L.marker(position, { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    markerRef.current = marker;

    const root = marker.getElement()?.querySelector('#lm-root');
    coneRef.current = (root?.querySelector('#lm-cone') as HTMLElement) ?? null;
    arrowWrapRef.current = (root?.querySelector('#lm-arrow') as HTMLElement) ?? null;
    arrowIconRef.current = (root?.querySelector('#lm-arrow-icon') as SVGElement) ?? null;

    return () => {
      marker.remove();
      markerRef.current = null;
      coneRef.current = null;
      arrowWrapRef.current = null;
      arrowIconRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    markerRef.current?.setLatLng(position);
  }, [position]);

  useEffect(() => {
    if (!coneRef.current) return;
    if (heading !== undefined && heading !== null && Number.isFinite(heading)) {
      coneRef.current.style.opacity = '1';
      coneRef.current.style.transform = `rotate(${heading}deg)`;
      // 方向箭头同步旋转 + 显示（Apple 地图同款：白描边蓝箭头指向行进方向）
      if (arrowWrapRef.current) arrowWrapRef.current.style.transform = `rotate(${heading}deg)`;
      if (arrowIconRef.current) arrowIconRef.current.style.opacity = '1';
    } else {
      coneRef.current.style.opacity = '0';
      if (arrowIconRef.current) arrowIconRef.current.style.opacity = '0';
    }
  }, [heading]);

  return null;
};
