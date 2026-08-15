
import { ExerciseType } from '../types';

/**
 * Exercise Classification Logic Table
 * Defines rules for matching keywords to exercise types.
 * Priority determines the order of checking (lower number = higher priority).
 */
export interface ClassificationRule {
    type: ExerciseType;
    keywords: string[];
    priority: number;
    description: string;
}

export const EXERCISE_CLASSIFICATION_RULES: ClassificationRule[] = [
    {
        type: 'cardio',
        keywords: ['有氧', 'cardio', '跑', 'run', 'row', '划船机', 'cycling', '单车', 'elliptical', '椭圆机', 'ski', '滑雪'],
        priority: 10,
        description: 'Time or Distance based endurance activities'
    },
    {
        type: 'outdoor',
        keywords: ['户外', 'outdoor', 'gps', '徒步', 'hiking', '健走'],
        priority: 5, // Higher priority than cardio
        description: 'GPS tracked outdoor activities'
    },
    {
        type: 'isometric',
        keywords: ['静力', '支撑', 'plank', 'hold', 'wall sit', '靠墙', 'static'],
        priority: 20,
        description: 'Time based static holds'
    },
    {
        type: 'weight_only',
        keywords: ['1rm', 'pr test', '极限', 'max', 'heavy single', 'dead hang', '悬垂'],
        priority: 30,
        description: 'Weight focused, reps are usually 1 or irrelevant'
    },
    {
        type: 'reps_only',
        keywords: ['burpee', '波比', 'jump', '跳', 'jack', '开合跳', 'swing', '甩', 'battle rope', '战绳', 'box jump'],
        priority: 40,
        description: 'Repetition focused, weight is usually bodyweight or fixed'
    },
    {
        type: 'bodyweight',
        keywords: ['自重', 'bodyweight', '俯卧撑', 'push-up', 'pull-up', '引体', 'dip', '徒手', 'crunch', '卷腹', 'sit-up', '仰卧起坐'],
        priority: 50,
        description: 'Bodyweight resistance, can have added weight'
    },
    {
        type: 'assisted',
        keywords: ['辅助', 'assisted', 'band', '弹力带'],
        priority: 60,
        description: 'Assisted bodyweight movements (negative weight)'
    },
    {
        type: 'unilateral',
        keywords: ['单侧', 'unilateral', 'single', 'lunge', '箭步', 'split squat', '分腿蹲'],
        priority: 70,
        description: 'One side at a time, requires double volume calculation'
    }
];

/**
 * Heuristic function to guess exercise type based on name and category.
 * Uses the Logic Table (EXERCISE_CLASSIFICATION_RULES) for matching.
 */
export const guessExerciseType = (name: string, category: string): ExerciseType => {
    const lowerName = name.toLowerCase();
    const lowerCat = category.toLowerCase();

    // Sort rules by priority
    const sortedRules = [...EXERCISE_CLASSIFICATION_RULES].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
        // Check category matches for Cardio (special case)
        if (rule.type === 'cardio' && (lowerCat.includes('有氧') || lowerCat.includes('cardio'))) {
            return 'cardio';
        }

        // Check keywords in name
        if (rule.keywords.some(k => lowerName.includes(k.toLowerCase()))) {
            return rule.type;
        }
    }

    // Default fallback
    return 'resistance';
};

/**
 * Heuristic function to guess cardio subtype based on name.
 * 'DISTANCE' for running, cycling, etc.
 * 'GENERAL' for jump rope, boxing, etc.
 */
export const guessCardioSubtype = (name: string): 'DISTANCE' | 'GENERAL' => {
    const lowerName = name.toLowerCase();
    const distanceKeywords = [
        '跑', 'run', 'cycling', '单车', '骑', 'row', '划船', 
        'elliptical', '椭圆机', 'ski', '滑雪', '游', 'swim',
        '步行', '走', 'walk', 'hiking', '徒步', '户外', 'outdoor'
    ];
    
    if (distanceKeywords.some(k => lowerName.includes(k))) {
        return 'DISTANCE';
    }
    return 'GENERAL';
};
