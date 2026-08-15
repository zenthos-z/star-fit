import React, { useState } from 'react';
import { motion } from 'framer-motion';

// Simplified SVG Paths for Front and Back Body
// These are standard low-poly representations
const BODY_PATHS = {
    front: {
        chest: "M100,80 Q130,120 100,150 Q70,120 100,80 Z M200,80 Q230,120 200,150 Q170,120 200,80 Z",
        shoulders: "M60,80 Q80,60 100,80 L100,110 Q80,130 60,110 Z M240,80 Q220,60 200,80 L200,110 Q220,130 240,110 Z",
        abs: "M110,160 L190,160 L180,250 L120,250 Z",
        arms: "M50,120 L70,180 L50,220 L30,180 Z M250,120 L270,180 L250,220 L230,180 Z",
        legs: "M110,260 L140,260 L145,400 L115,400 Z M160,260 L190,260 L185,400 L155,400 Z",
    },
    back: {
        back: "M100,80 L200,80 L180,200 L120,200 Z",
        shoulders: "M60,80 L100,80 L100,120 L60,120 Z M200,80 L240,80 L240,120 L200,120 Z",
        arms: "M50,120 L70,220 L30,220 Z M250,120 L270,220 L230,220 Z",
        legs: "M110,260 L140,260 L145,400 L115,400 Z M160,260 L190,260 L185,400 L155,400 Z",
        glutes: "M110,220 L190,220 L190,260 L110,260 Z"
    }
};

// Reusable Body SVG Component
const BodySVG = ({ view, intensities, width = 200, height = 400 }: { view: 'front' | 'back', intensities: Record<string, number>, width?: number, height?: number }) => {
    const paths = view === 'front' ? BODY_PATHS.front : BODY_PATHS.back;

    const getColor = (part: string) => {
        const intensity = intensities[part] || 0;
        // Blue scale
        if (intensity === 0) return '#f3f4f6'; // gray-100
        if (intensity < 0.3) return '#bfdbfe'; // blue-200
        if (intensity < 0.6) return '#60a5fa'; // blue-400
        if (intensity < 0.8) return '#3b82f6'; // blue-500
        return '#1d4ed8'; // blue-700
    };

    return (
        <svg width="100%" height="100%" viewBox="0 0 300 450" className="drop-shadow-sm">
            {Object.entries(paths).map(([part, d]) => (
                <motion.path
                    key={part}
                    d={d}
                    fill={getColor(part)}
                    stroke="white"
                    strokeWidth="2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, fill: getColor(part) }}
                    transition={{ duration: 0.5 }}
                    whileHover={{ scale: 1.02, fill: '#93c5fd' }} // Highlight on hover
                    className="cursor-pointer transition-colors"
                >
                    <title>{part} (Intensity: {Math.round((intensities[part] || 0) * 100)}%)</title>
                </motion.path>
            ))}
        </svg>
    );
};

export const MuscleHeatmap = ({ data }: { data: Record<string, number> }) => {
    const [view, setView] = useState<'front' | 'back'>('front');

    return (
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col items-center">
            <div className="flex w-full justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-gray-900">部位概览</h3>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setView('front')}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${view === 'front' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        正面
                    </button>
                    <button
                        onClick={() => setView('back')}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${view === 'back' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        背面
                    </button>
                </div>
            </div>

            <div className="relative h-[240px] w-full flex justify-center items-center bg-blue-50/30 rounded-lg">
                <div className="w-[120px] h-full">
                    <BodySVG view={view} intensities={data} />
                </div>

                {/* Heatmap Legend */}
                <div className="absolute bottom-2 right-2 flex flex-col gap-1 text-[10px] text-gray-400">
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-700"></div> 重点
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-200"></div> 辅助
                    </div>
                </div>
            </div>
        </div>
    );
};
