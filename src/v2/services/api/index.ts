/**
 * V2 API Services - Index
 *
 * Centralized exports for all V2 API client services.
 *
 * @version 2.0.0
 */

// ProfileService exports
export {
  ProfileService,
  type ProfileServiceV2,
  ProfileServiceError
} from './ProfileServiceV2.js';

// ExerciseService exports
export {
  ExerciseService,
  type ExerciseServiceV2,
  ExerciseServiceError,
  type Exercise,
  type ParsedExercise,
  type ExerciseTargets,
  type ExerciseType,
  type Difficulty,
  type Modifier,
  type MuscleTarget,
  type ExerciseUpdate
} from './ExerciseServiceV2.js';
