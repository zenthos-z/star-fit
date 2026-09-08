/**
 * GlassSurface — 双 tier 玻璃容器。
 *
 * 原生 tier（iOS 26+）已改为「单透镜」模式，本组件在原生 tier 下渲染为
 * 纯 anchor（零尺寸占位，由 ActionSlider 直接调 setLens/setLabel）。
 * 此文件保留给 CSS tier 使用（Android 深灰扁平 / Web 玻璃）。
 */
import { useRef, type ReactNode } from 'react';
import { isNativeGlass } from './nativeGlass';

export type GlassVariant = 'regular' | 'tinted' | 'android';

interface GlassSurfaceProps {
  id: string;
  radius?: number;
  variant?: GlassVariant;
  refreshKey?: string | number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}

export default function GlassSurface({
  id, radius = 30, variant = 'regular', refreshKey = '', label,
  className = '', style, children,
}: GlassSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  void id; void radius; void variant; void refreshKey; void label; void ref;

  if (isNativeGlass) {
    // 原生 tier：透镜模式，由调用方直接控制，这里只输出透明占位
    return (
      <div className={className} style={{ ...style, background: 'transparent' }}>
        {children}
      </div>
    );
  }

  // CSS tier
  const isAndroidTier = variant === 'android' ||
    /Android/i.test(navigator.userAgent);

  if (isAndroidTier) {
    // Android 深灰扁平：Material 风格，无渐变无玻璃
    return (
      <div
        className={className}
        style={{
          ...style,
          background: variant === 'tinted' ? '#3C4043' : '#202124',
          borderRadius: radius,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          border: '1px solid #3C4043',
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={`glass-ring ${variant === 'tinted' ? 'glass-ring-tinted' : ''} ${className}`}
      style={{ ...style, borderRadius: radius }}
    >
      {children}
    </div>
  );
}
