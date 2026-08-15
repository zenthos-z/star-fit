// Exercise type mapping utilities

export const EXERCISE_TYPE_LABELS: Record<string, string> = {
    resistance: '常规负重',
    unilateral: '单侧训练',
    bodyweight: '自重训练',
    assisted: '辅助器械',
    isometric: '静力/等长',
    cardio: '有氧运动',
    flexibility: '柔韧性训练',
    heavy_weight: '大重量/举次',
    rep_training: '次数训练',
    outdoor: '户外运动',
};

export const getExerciseTypeLabel = (type: string): string => {
    return EXERCISE_TYPE_LABELS[type] || type;
};

export const DIFFICULTY_LABELS: Record<string, string> = {
    beginner: '初级',
    intermediate: '中级',
    advanced: '高级',
};

export const getDifficultyLabel = (difficulty: string): string => {
    return DIFFICULTY_LABELS[difficulty] || difficulty;
};
