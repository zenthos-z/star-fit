import { useState, useEffect, useRef, useCallback } from 'react';

export interface Position {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
  heading?: number;
  isGapAfter?: boolean;
  gapDuration?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export type LocationStatus = 'idle' | 'acquiring' | 'active' | 'error' | 'permission_denied';

export interface GeolocationConfig {
  minDistance: number;
  minTime: number;
  maxAccuracy: number;
  maxSpeed: number;
  gapThreshold: number;
}

export const DEFAULT_CONFIG: GeolocationConfig = {
  minDistance: 10,
  minTime: 3000,
  maxAccuracy: 50,
  maxSpeed: 20,
  gapThreshold: 10000,
};

export interface GeolocationReturn {
  positions: Position[];
  distance: number;
  reset: () => void;
  status: LocationStatus;
  error: string | null;
  hasPermission: boolean | null;
  isInBackground: boolean;
  backgroundDuration: number;
  totalGapDuration: number;
  gapCount: number;
  config: GeolocationConfig;
  updateConfig: (config: Partial<GeolocationConfig>) => void;
}

export const useGeolocation = (active: boolean, initialConfig?: Partial<GeolocationConfig>): GeolocationReturn => {
  const [config, setConfig] = useState<GeolocationConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const [positions, setPositions] = useState<Position[]>([]);
  const [distance, setDistance] = useState(0);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isInBackground, setIsInBackground] = useState(false);
  const [backgroundDuration, setBackgroundDuration] = useState(0);
  const [totalGapDuration, setTotalGapDuration] = useState(0);
  const [gapCount, setGapCount] = useState(0);

  const watchId = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const backgroundStartTimeRef = useRef<number | null>(null);
  const backgroundTimerRef = useRef<number | null>(null);
  const lastPositionRef = useRef<Position | null>(null);

  const calculateDistance = useCallback((pos1: Position, pos2: Position): number => {
    const R = 6371e3;
    const φ1 = (pos1.latitude * Math.PI) / 180;
    const φ2 = (pos2.latitude * Math.PI) / 180;
    const Δφ = ((pos2.latitude - pos1.latitude) * Math.PI) / 180;
    const Δλ = ((pos2.longitude - pos1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }, []);

  const calculateConfidence = useCallback((position: Position): 'high' | 'medium' | 'low' => {
    const accuracy = position.accuracy ?? 100;
    if (accuracy <= 10) return 'high';
    if (accuracy <= 30) return 'medium';
    return 'low';
  }, []);

  const detectGap = useCallback((lastPos: Position, newPos: Position): boolean => {
    const timeDiff = newPos.timestamp - lastPos.timestamp;
    return timeDiff > config.gapThreshold;
  }, [config.gapThreshold]);

  const shouldAcceptPosition = useCallback((
    lastPos: Position,
    newPos: Position,
    isGap: boolean
  ): boolean => {
    const distance = calculateDistance(lastPos, newPos);
    const timeDiff = newPos.timestamp - lastPos.timestamp;

    if (isGap) {
      return true;
    }

    if (timeDiff < config.minTime) {
      return false;
    }

    if (distance < config.minDistance) {
      return false;
    }

    if (newPos.accuracy && newPos.accuracy > config.maxAccuracy) {
      return false;
    }

    const speed = distance / (timeDiff / 1000);
    if (speed > config.maxSpeed) {
      return false;
    }

    return true;
  }, [config, calculateDistance]);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock acquired');
        
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Wake Lock released');
          wakeLockRef.current = null;
        });
      }
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      setIsInBackground(true);
      backgroundStartTimeRef.current = Date.now();
      
      backgroundTimerRef.current = window.setInterval(() => {
        if (backgroundStartTimeRef.current) {
          const duration = Date.now() - backgroundStartTimeRef.current;
          setBackgroundDuration(duration);
        }
      }, 1000);
    } else {
      setIsInBackground(false);
      
      if (backgroundTimerRef.current) {
        clearInterval(backgroundTimerRef.current);
        backgroundTimerRef.current = null;
      }
      
      if (backgroundStartTimeRef.current) {
        const duration = Date.now() - backgroundStartTimeRef.current;
        backgroundStartTimeRef.current = null;
        console.log(`App was in background for ${Math.round(duration / 1000)}s`);
      }
    }
  }, []);

  const startWatching = useCallback(async (highAccuracy = true) => {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setError('您的浏览器不支持地理位置功能');
      return;
    }

    setStatus('acquiring');
    setError(null);

    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    await requestWakeLock();

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const newPos: Position = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: position.timestamp,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading ?? undefined,
          confidence: calculateConfidence({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: position.timestamp,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading ?? undefined,
          }),
        };

        setStatus('active');
        setError(null);

        setPositions((prev) => {
          if (prev.length === 0) {
            lastPositionRef.current = newPos;
            return [newPos];
          }

          const lastPos = prev[prev.length - 1];
          const isGap = detectGap(lastPos, newPos);

          if (isGap) {
            setTotalGapDuration((prev) => prev + (newPos.timestamp - lastPos.timestamp));
            setGapCount((prev) => prev + 1);
          }

          if (shouldAcceptPosition(lastPos, newPos, isGap)) {
            const positionWithGapInfo: Position = {
              ...newPos,
              isGapAfter: isGap,
              gapDuration: isGap ? newPos.timestamp - lastPos.timestamp : undefined,
            };

            const distance = calculateDistance(lastPos, positionWithGapInfo);
            if (!isGap) {
              setDistance((prevDist) => prevDist + distance);
            }

            lastPositionRef.current = positionWithGapInfo;
            return [...prev, positionWithGapInfo];
          }

          return prev;
        });
      },
      (error) => {
        console.error('Geolocation error:', error);

        if (error.code === error.TIMEOUT && highAccuracy) {
          console.log('High accuracy timeout, falling back to low accuracy...');
          startWatching(false);
          return;
        }

        switch (error.code) {
          case error.PERMISSION_DENIED:
            setStatus('permission_denied');
            setError('位置权限被拒绝，请在浏览器设置中允许位置访问');
            setHasPermission(false);
            break;
          case error.POSITION_UNAVAILABLE:
            setStatus('error');
            setError('无法获取位置信息，请检查设备定位服务');
            break;
          case error.TIMEOUT:
            setStatus('error');
            setError('获取位置超时，请稍后重试或移至开阔区域');
            break;
          default:
            setStatus('error');
            setError(`位置获取失败: ${error.message}`);
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 15000 : 30000,
        maximumAge: 0,
      }
    );
  }, [detectGap, shouldAcceptPosition, calculateDistance, calculateConfidence, requestWakeLock]);

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    releaseWakeLock();
    setStatus('idle');
  }, [releaseWakeLock]);

  const reset = useCallback(() => {
    setPositions([]);
    setDistance(0);
    setStatus('idle');
    setError(null);
    setBackgroundDuration(0);
    setTotalGapDuration(0);
    setGapCount(0);
    lastPositionRef.current = null;
  }, []);

  const updateConfig = useCallback((newConfig: Partial<GeolocationConfig>) => {
    setConfig((prev) => ({ ...prev, ...newConfig }));
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  useEffect(() => {
    if (active) {
      startWatching(true);
    } else {
      stopWatching();
    }

    return () => {
      stopWatching();
    };
  }, [active, startWatching, stopWatching]);

  return {
    positions,
    distance,
    reset,
    status,
    error,
    hasPermission,
    isInBackground,
    backgroundDuration,
    totalGapDuration,
    gapCount,
    config,
    updateConfig,
  };
};
