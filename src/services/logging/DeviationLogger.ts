import { ExerciseAction } from '../../types/protocol';

/**
 * DeviationLogger
 * Monitors changes between AI suggestions and user-set values.
 * Deviation recording is now handled by DeviationBuffer service.
 * This logger is kept for backward compatibility and debugging.
 */
export const DeviationLogger = {
  /**
   * Logs a deviation event if the user's change is significant.
   * @param exerciseId The fit:// URI of the exercise
   * @param original The original AI suggested value/state
   * @param current The current user-modified value/state
   * @param field The field that changed (e.g., 'weight', 'reps')
   */
  logDeviation(exerciseId: string, original: any, current: any, field: string) {
    if (original === current) return;

    // Significant deviation threshold (e.g., > 10% for weight)
    let isSignificant = true;
    if (typeof original === 'number' && typeof current === 'number') {
      const diff = Math.abs(original - current);
      const threshold = original * 0.1; // 10%
      isSignificant = diff > threshold;
    }

    if (isSignificant) {
      console.log(`[DeviationLogger] Significant deviation detected for ${exerciseId} in ${field}: ${original} -> ${current}`);
      
      // Deviation recording is now handled by DeviationBuffer
      // This logger is kept for backward compatibility and debugging
    }
  }
};
