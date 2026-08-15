import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { Button } from '../../ui/Button';

// Copying type from backend for consistency, but frontend should have its own types or shared ones
export type MuscleTarget =
    | '上胸' | '中下胸'
    | '前束' | '中束' | '后束'
    | '二头' | '三头' | '小臂'
    | '背部' | '下背' | '斜方肌'
    | '腹肌' | '侧腹'
    | '股四' | '腘绳' | '小腿'
    | '上臀部' | '下臀部';

interface MuscleSelectorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    selected: MuscleTarget[];
    disabledMuscles?: MuscleTarget[];
    onConfirm: (selected: MuscleTarget[]) => void;
}

const MUSCLE_GROUPS = [
    {
        name: '胸部',
        muscles: ['上胸', '中下胸'] as MuscleTarget[],
    },
    {
        name: '肩部',
        muscles: ['前束', '中束', '后束'] as MuscleTarget[],
    },
    {
        name: '手臂',
        muscles: ['二头', '三头', '小臂'] as MuscleTarget[],
    },
    {
        name: '背部',
        muscles: ['背部', '下背', '斜方肌'] as MuscleTarget[],
    },
    {
        name: '核心',
        muscles: ['腹肌', '侧腹'] as MuscleTarget[],
    },
    {
        name: '腿部',
        muscles: ['股四', '腘绳', '小腿'] as MuscleTarget[],
    },
    {
        name: '臀部',
        muscles: ['上臀部', '下臀部'] as MuscleTarget[],
    },
];

export const MuscleSelectorDialog: React.FC<MuscleSelectorDialogProps> = ({
    isOpen,
    onClose,
    title,
    subtitle,
    selected,
    disabledMuscles = [],
    onConfirm,
}) => {
    const [currentSelected, setCurrentSelected] = useState<MuscleTarget[]>([]);

    useEffect(() => {
        if (isOpen) {
            setCurrentSelected([...selected]);
        }
    }, [isOpen, selected]);

    if (!isOpen) return null;

    const toggleMuscle = (muscle: MuscleTarget) => {
        if (disabledMuscles.includes(muscle)) return;

        setCurrentSelected(prev =>
            prev.includes(muscle)
                ? prev.filter(m => m !== muscle)
                : [...prev, muscle]
        );
    };

    const handleConfirm = () => {
        onConfirm(currentSelected);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-black text-gray-900 tracking-tight">{title}</h3>
                        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {MUSCLE_GROUPS.map(group => (
                            <div key={group.name} className="space-y-3">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                                    {group.name}
                                </h4>
                                <div className="space-y-2">
                                    {group.muscles.map(muscle => {
                                        const isSelected = currentSelected.includes(muscle);
                                        const isDisabled = disabledMuscles.includes(muscle);

                                        return (
                                            <button
                                                key={muscle}
                                                disabled={isDisabled}
                                                onClick={() => toggleMuscle(muscle)}
                                                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${isSelected
                                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                                                        : isDisabled
                                                            ? 'bg-gray-50 text-gray-300 border border-gray-100 border-dashed cursor-not-allowed'
                                                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-100'
                                                    }`}
                                            >
                                                <span>{muscle}</span>
                                                {isSelected && <Check size={14} className="text-white" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-6 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose} className="rounded-xl px-6">
                        取消
                    </Button>
                    <Button onClick={handleConfirm} className="rounded-xl px-8 shadow-blue-200 shadow-md">
                        确定
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Helper for Button component if it doesn't support variant
// Since I don't know the exact structure of your Button component,
// I'll adjust it if it fails.
