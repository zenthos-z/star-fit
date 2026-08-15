import { EXERCISE_TYPES_CONFIG } from '../../constants';

/**
 * 获取运动类型的显示标签
 * @param type - exercise type (如 'resistance', 'bodyweight' 等)
 * @returns 中文标签 (如 '常规负重', '自重训练')，未知类型返回 '未知类型'
 */
export const getExerciseTypeLabel = (type: string): string => {
  if (!type) {
    return '未知类型';
  }
  const config = EXERCISE_TYPES_CONFIG[type as keyof typeof EXERCISE_TYPES_CONFIG];
  if (!config) {
    console.warn(`Unknown exercise type: ${type}, returning default label`);
    return '未知类型';
  }
  return config.label;
};
