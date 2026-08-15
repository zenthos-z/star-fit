import React, { useRef, useEffect } from 'react';

interface ParticleBackgroundProps {
  isActive: boolean;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  size: number;
  alpha: number;
}

export const ParticleBackground: React.FC<ParticleBackgroundProps> = ({ isActive, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Configuration
  const gridSpacing = 20; // 变量意义：网格间距，控制粒子分布的密集程度
  const rippleWidth = 300; // 变量意义：波纹宽度，控制波纹的范围
  const rippleInterval = 120; // 2 seconds at 60fps，意思是每个波纹周期的时间间隔
  const rippleDuration = 500; // Match interval for full-cycle control
  const waveTimerRef = useRef<number>(rippleInterval);
  const rippleRadiusRef = useRef<number>(2000); // 变量意义：波纹半径，控制波纹的范围

  // Origin point for the ripple
  const rippleOriginRef = useRef({ x: 0, y: 0 });// 变量意义：波纹原点，控制波纹的中心位置

  // Colors
  const grayColor = { r: 200, g: 200, b: 200 }; // Darker gray for visibility
  const orangeColor = { r: 255, g: 120, b: 20 }; // Brighter, more vivid orange

  const activeRef = useRef(isActive);
  useEffect(() => {
    activeRef.current = isActive;
    // Trigger immediate ripple when starting
    if (isActive) {
        rippleOriginRef.current = {
            x: window.innerWidth / 2,
            y: 80
        };
        waveTimerRef.current = 0;
    }
  }, [isActive]);

  useEffect(() => {
    let lastTriggerTime = 0;
    const handleInteraction = (e: MouseEvent | TouchEvent) => {
      const now = Date.now();
      if (now - lastTriggerTime < 100) return; // 意义：控制交互事件的触发间隔，防止频繁触发
      lastTriggerTime = now;

      const x = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const y = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('a') || target.tagName === 'BUTTON') {
          rippleOriginRef.current = { x, y };
          waveTimerRef.current = 0; 
      }
    };

    window.addEventListener('mousedown', handleInteraction, { capture: true, passive: true });
    window.addEventListener('touchstart', handleInteraction, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousedown', handleInteraction, true);
      window.removeEventListener('touchstart', handleInteraction, true);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastWidth = 0;
    let lastHeight = 0;
    let resizeTimeout: NodeJS.Timeout | null = null;

    const resizeCanvas = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      
      resizeTimeout = setTimeout(() => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        
        if (newWidth === lastWidth && newHeight === lastHeight) {
          return;
        }
        
        lastWidth = newWidth;
        lastHeight = newHeight;
        
        canvas.width = newWidth;
        canvas.height = newHeight;
        
        if (rippleOriginRef.current.x === 0) {
            rippleOriginRef.current = {
                x: canvas.width / 2,
                y: 80
            };
        }
        
        initParticles();
      }, 100);
    };

    const initParticles = () => {
      particlesRef.current = [];
      const width = canvas.width;
      const height = canvas.height;
      
      const cols = Math.ceil(width / gridSpacing) + 1;
      const rows = Math.ceil(height / gridSpacing) + 1;
      
      const offsetX = (width - (cols - 1) * gridSpacing) / 2;
      const offsetY = (height - (rows - 1) * gridSpacing) / 2;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const x = i * gridSpacing + offsetX;
            const y = j * gridSpacing + offsetY;

            particlesRef.current.push({
                x: x,
                y: y,
                baseX: x,
                baseY: y,
                size: 1.2,
                alpha: 0.25
            });
        }
      }
    };

    // 意义：动画循环中的自动波纹逻辑，控制波纹的周期和范围
    const loop = () => {
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Progress the active ripple animation (ALWAYS runs until duration ends)
      if (waveTimerRef.current < rippleInterval) {
          waveTimerRef.current++;
      }

      // Calculate non-linear ripple radius (Energy burst: very fast start, very slow end)
      const maxRadius = Math.max(canvas.width, canvas.height) * 1.5;
      if (waveTimerRef.current < rippleDuration) {
          const t = waveTimerRef.current / rippleDuration;
          // easeOutQuint: 1 - (1 - t)^5 (Sharp contrast between fast start and slow end)
          const easedT = 1 - Math.pow(1 - t, 5);
          rippleRadiusRef.current = easedT * maxRadius;
      } else {
          rippleRadiusRef.current = maxRadius + rippleWidth;
      }

      const origin = rippleOriginRef.current;
      const radius = rippleRadiusRef.current;
      
      // Energy decay based on distance from origin
      const currentProgress = radius / maxRadius;
      const energyFactor = Math.max(0.4, 1 - currentProgress * 0.8); // Fades from 100% to 40% energy

      // Draw particles
      particlesRef.current.forEach(p => {
        let color = `rgba(${grayColor.r}, ${grayColor.g}, ${grayColor.b}, ${p.alpha})`;
        let size = p.size;
        
        // Calculate distance from particle to origin
        const dx = p.x - origin.x;
        const dy = p.y - origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Single-pulse algorithm v3: STRICTLY SINGLE WAVEFRONT
        
        // Is the particle inside the active band?
        if (dist < radius && dist > radius - rippleWidth) {
            const normalizedPos = 1 - ((radius - dist) / rippleWidth);
            const rippleIntensity = Math.pow(normalizedPos, 2) * energyFactor; 

            const colorMix = Math.pow(rippleIntensity, 0.3);
            
            const r = grayColor.r + (orangeColor.r - grayColor.r) * colorMix;
            const g = grayColor.g + (orangeColor.g - grayColor.g) * colorMix;
            const b = grayColor.b + (orangeColor.b - grayColor.b) * colorMix;
            
            const a = p.alpha + (1.0 - p.alpha) * rippleIntensity; 
            
            color = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
            size = p.size * (1 + 1.2 * rippleIntensity); 
        }

        // --- Sunken Effect Rendering ---
        
        // 1. Bottom-right Highlight (creates depth)
        ctx.beginPath();
        ctx.arc(p.x + size * 0.4, p.y + size * 0.4, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, 0.12)`;
        ctx.fill();

        // 2. Top-left Shadow (creates the 'sunken' feel)
        ctx.beginPath();
        ctx.arc(p.x - size * 0.2, p.y - size * 0.2, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 0, 0, 0.08)`;
        ctx.fill();

        // 3. Main Particle Body
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    loop();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []); 

  return (
    <div ref={containerRef} className={`fixed inset-0 pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
};
