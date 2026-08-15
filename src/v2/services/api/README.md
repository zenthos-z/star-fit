# V2 API Services

This directory contains the V2 API client services for the frontend. These services provide type-safe, validated API calls to the backend following the Starfit MAS development conventions.

## Architecture

### Core Principles

1. **Data Contract Redline**: All types are imported from `shared/contracts` - no local type definitions
2. **Safe JSON Parsing**: Uses `parseJSONSafe()` instead of bare `JSON.parse()` for all JSON operations
3. **Type Safety**: Full TypeScript support with Zod validation
4. **Error Handling**: Consistent error types with detailed context
5. **Singleton Pattern**: Services are exported as singleton instances for easy consumption

### Directory Structure

```
src/v2/services/api/
├── ProfileServiceV2.ts       # User profile API client
├── ExerciseServiceV2.ts      # Exercise library API client
├── index.ts                  # Centralized exports
├── README.md                 # This file
└── __tests__/
    ├── ProfileServiceV2.test.ts
    └── ExerciseServiceV2.test.ts
```

## Available Services

### ProfileServiceV2

Manages user profile operations with the three-state model (static/dynamic/summary).

**Key Methods:**

```typescript
import { ProfileService } from '@/v2/services/api';

// Get complete profile
const profile = await ProfileService.getProfile(userId);

// Get profile static (long-term characteristics)
const staticData = await ProfileService.getProfileStatic(userId);

// Get profile dynamic (high-frequency states)
const dynamicData = await ProfileService.getProfileDynamic(userId);

// Update profile static
await ProfileService.updateProfileStatic(userId, { age: 31, weight: 80 });

// Update profile dynamic
await ProfileService.updateProfileDynamic(userId, {
  load_anchors: { 'squat': { ... } }
});

// Load anchor operations
const anchors = await ProfileService.getLoadAnchors(userId);
await ProfileService.updateLoadAnchor(userId, 'bench_press', newAnchor);

// Active limitations
await ProfileService.addActiveLimitation(userId, limitation);
await ProfileService.removeActiveLimitation(userId, 'left_shoulder');
```

**Data Contract:**

All types are from `shared/contracts`:
- `UserProfileV2` - Complete user profile
- `ProfileStatic` - Long-term biological/psychological characteristics
- `ProfileDynamic` - High-frequency changing states (load anchors, limitations)
- `HistorySummary` - Compressed historical data
- `LoadAnchors` - Exercise PR mapping
- `LoadAnchor` - Single exercise PR
- `ActiveLimitation` - Self-healing injury window

### ExerciseServiceV2

Manages exercise library operations.

**Key Methods:**

```typescript
import { ExerciseService } from '@/v2/services/api';

// Get all exercises
const exercises = await ExerciseService.getAllExercises();

// Get single exercise
const exercise = await ExerciseService.getExerciseById('exercise-123');
const byName = await ExerciseService.getExerciseByName('Bench Press');

// Filter exercises
const byTarget = await ExerciseService.getExercisesByTarget('中下胸');
const byDifficulty = await ExerciseService.getExercisesByDifficulty('intermediate');
const byEquipment = await ExerciseService.getExercisesByEquipment('barbell');

// Admin operations
await ExerciseService.createExercise(newExerciseData);
await ExerciseService.updateExercise({ exerciseId, data, modifiedBy });
await ExerciseService.deleteExercise('exercise-123');

// Statistics
const stats = await ExerciseService.getExerciseStats();
```

**Data Contract:**

- `Exercise` - Raw exercise from backend (JSON strings)
- `ParsedExercise` - Exercise with JSON fields parsed
- `ExerciseType` - Exercise type enum
- `Difficulty` - Difficulty level enum
- `MuscleTarget` - Muscle partition enum
- `ExerciseUpdate` - Update payload for admin operations

## Error Handling

All services throw typed errors with context:

```typescript
import { ProfileServiceError, ExerciseServiceError } from '@/v2/services/api';

try {
  await ProfileService.getProfile(userId);
} catch (error) {
  if (error instanceof ProfileServiceError) {
    console.error(`API Error: ${error.message}`);
    console.error(`Status: ${error.statusCode}`);
    console.error(`Endpoint: ${error.endpoint}`);
  }
}
```

## Validation

Services use Zod schemas from `shared/contracts` for runtime validation:

```typescript
import { validateWithLogging, UserProfileV2Schema } from 'shared/contracts';

// Automatic validation in service methods
const profile = await ProfileService.getProfile(userId);
// Profile is validated against UserProfileV2Schema

// Manual validation
const isValid = validateWithLogging(
  UserProfileV2Schema,
  data,
  'context',
  defaultValue
);
```

## Testing

Run tests with Vitest:

```bash
npm run test  # or configured test script
```

Tests use mock fetch to simulate API responses without network calls.

## Usage Example

```typescript
import { ProfileService, ExerciseService } from '@/v2/services/api';
import type { LoadAnchor } from 'shared/contracts';

// Component or hook
async function updatePersonalRecord(exerciseId: string, weight: number, reps: number) {
  try {
    const userId = getUserId();
    const anchor: LoadAnchor = {
      best_weight: weight,
      best_reps: reps,
      est_1rm: calculate1RM(weight, reps),
      last_updated: Date.now()
    };

    await ProfileService.updateLoadAnchor(userId, exerciseId, anchor);
    console.log('Personal record updated successfully');
  } catch (error) {
    console.error('Failed to update PR:', error);
  }
}

// Get exercises for a muscle group
async function getExercisesForWorkout(targetMuscle: MuscleTarget) {
  try {
    const exercises = await ExerciseService.getExercisesByTarget(targetMuscle);
    return exercises.filter(ex => ex.difficulty !== 'advanced');
  } catch (error) {
    console.error('Failed to fetch exercises:', error);
    return [];
  }
}
```

## Compliance

These services follow Starfit MAS development redlines:

1. **All types from `shared/contracts`** - No local type definitions
2. **No bare JSON.parse** - Uses `parseJSONSafe()` throughout
3. **Detailed error logging** - All errors logged with context
4. **Zod validation** - Runtime validation with detailed logs
5. **No silent failures** - Errors thrown or logged with details

## Future Extensions

Additional services can be added following the same pattern:

1. Import types from `shared/contracts`
2. Use `parseJSONSafe()` for all JSON parsing
3. Implement consistent error handling
4. Add Zod validation
5. Write comprehensive tests
6. Export from `index.ts`

Potential services:
- `WorkoutServiceV2` - Workout session management
- `PlanServiceV2` - Training plan operations
- `AnalysisServiceV2` - MAS analysis and insights
- `SyncServiceV2` - Data synchronization
