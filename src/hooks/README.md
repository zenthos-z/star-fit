# V2 Hooks - Data Binding Layer

This directory contains the V2 React hooks that provide the data binding layer between the UI and the Service layer. All hooks follow the Starfit MAS development conventions.

## Architecture

### Layer Structure

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Components                         │
├─────────────────────────────────────────────────────────────┤
│                    V2 Hooks (This Layer)                     │
│  - useProfileV2, useLoadAnchors, useExercises               │
│  - Data fetching, caching, state management                  │
├─────────────────────────────────────────────────────────────┤
│                   Service Layer                              │
│  - ProfileServiceV2, ExerciseServiceV2                      │
│  - API client, validation, error handling                    │
├─────────────────────────────────────────────────────────────┤
│                    Backend API                               │
└─────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Single Source of Truth** - All types from `shared/contracts`
2. **Service Layer Usage** - Hooks delegate API calls to Service layer
3. **Data Caching** - Built-in cache with TTL to reduce API calls
4. **WebSocket Integration** - Real-time updates via WebSocket
5. **Optimistic Updates** - UI updates immediately, validated by server
6. **Error Handling** - Consistent error state and reporting

## Available Hooks

### useProfileV2

Manages user profile data with three-state model support.

**Features:**
- Fetches complete UserProfileV2
- Separate access to ProfileStatic, ProfileDynamic, HistorySummary
- Cache with 5-minute TTL
- WebSocket real-time updates
- Update methods for static and dynamic data

**Usage:**

```tsx
import { useProfileV2 } from '@/v2/hooks';

function ProfileDisplay() {
  const {
    profile,
    profileStatic,
    profileDynamic,
    loading,
    error,
    updateStatic
  } = useProfileV2(userId);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h1>Age: {profileStatic?.age}</h1>
      <button onClick={() => updateStatic({ age: 31 })}>
        Update Age
      </button>
    </div>
  );
}
```

**API:**

```typescript
interface UseProfileV2Result {
  profile: UserProfileV2 | null;
  profileStatic: ProfileStatic | null;
  profileDynamic: ProfileDynamic | null;
  historySummary: HistorySummary | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  updateStatic: (updates: Partial<ProfileStatic>) => Promise<void>;
  updateDynamic: (updates: Partial<ProfileDynamic>) => Promise<void>;
}
```

### useLoadAnchors

Manages load anchors (personal records) for exercises.

**Features:**
- Fetches all load anchors for a user
- CRUD operations for individual anchors
- Cache with 5-minute TTL
- WebSocket real-time updates
- Optimistic updates

**Usage:**

```tsx
import { useLoadAnchors } from '@/v2/hooks';

function PersonalRecords() {
  const {
    anchors,
    loading,
    updateAnchor,
    getAnchor
  } = useLoadAnchors(userId);

  const benchPress = getAnchor('bench_press');

  return (
    <div>
      <h2>Bench Press PR: {benchPress?.best_weight}kg</h2>
      <button onClick={() => updateAnchor('bench_press', {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: Date.now()
      })}>
        New PR!
      </button>
    </div>
  );
}
```

**API:**

```typescript
interface UseLoadAnchorsResult {
  anchors: LoadAnchors;
  loading: boolean;
  error: Error | null;
  getAnchor: (exerciseId: string) => LoadAnchor | undefined;
  updateAnchor: (exerciseId: string, anchor: LoadAnchor) => Promise<void>;
  deleteAnchor: (exerciseId: string) => Promise<void>;
  refetch: () => Promise<void>;
}
```

### useExercises

Manages exercise library data (future hook).

**Planned Features:**
- Fetch exercise library
- Filter by target, difficulty, equipment
- Search functionality
- Cache with TTL

## Caching Strategy

All hooks implement a consistent caching strategy:

1. **Cache Key**: User ID (or query parameters)
2. **TTL**: 5 minutes (configurable per hook)
3. **Cache Invalidation**:
   - Manual refetch
   - WebSocket updates
   - Write operations

```typescript
// Cache implementation pattern
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): Data | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}
```

## WebSocket Integration

Hooks automatically subscribe to relevant WebSocket events:

### Profile Events

- `profile_updated` - Full profile update
- `profile_static_updated` - Static state update
- `profile_dynamic_updated` - Dynamic state update
- `history_summary_updated` - History summary update

### Load Anchors Events

- `load_anchors_updated` - Anchors update
- `profile_updated` (with field check) - Profile update affecting anchors

**Event Handler Pattern:**

```typescript
useEffect(() => {
  const unsubscribe = socketService.subscribe('event_name', (payload) => {
    if (payload.userId === currentUserId) {
      invalidateCache(currentUserId);
      refetch();
    }
  });

  return () => unsubscribe();
}, [userId]);
```

## Error Handling

All hooks provide consistent error handling:

```typescript
interface HookResult {
  error: Error | null;
  // ... other fields
}

// Usage
if (error) {
  return <ErrorMessage error={error} />;
}
```

Error types from Service layer are propagated:
- `ProfileServiceError` - Profile operation errors
- `ExerciseServiceError` - Exercise operation errors

## Optimistic Updates

Write operations use optimistic updates for better UX:

```typescript
const updateAnchor = async (exerciseId: string, anchor: LoadAnchor) => {
  try {
    // Optimistic update - update UI immediately
    setAnchors(prev => ({
      ...prev,
      [exerciseId]: anchor
    }));

    // Server update
    await updateLoadAnchor(userId, exerciseId, anchor);

    // Validate with server state
    invalidateCache(userId);
    await loadAnchors();
  } catch (error) {
    // Revert on error
    setError(error);
    throw error;
  }
};
```

## Testing

Hooks are tested with `@testing-library/react`:

```bash
npm run test  # or configured test script
```

Test files follow the pattern `__tests__/*.test.ts`:

- `useProfileV2.test.ts` - Profile hook tests
- `useLoadAnchors.test.ts` - Load anchors hook tests

**Test Coverage:**

- Data fetching on mount
- Cache behavior
- WebSocket event handling
- Update methods
- Error handling
- Edge cases (empty userId, null data, etc.)

## Best Practices

### 1. Always Handle Loading and Error States

```tsx
function MyComponent() {
  const { data, loading, error } = useHook(userId);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay error={error} />;
  if (!data) return <EmptyState />;

  return <DataDisplay data={data} />;
}
```

### 2. Use Stable User IDs

```tsx
// Good - stable reference
const userId = localStorage.getItem('user_id');
const { profile } = useProfileV2(userId);

// Bad - changes on every render
const { profile } = useProfileV2(getCurrentUserId());
```

### 3. Leverage Cache

```tsx
// Multiple components using same hook share cache
function Component1() {
  useProfileV2(userId); // Fetches from API
}

function Component2() {
  useProfileV2(userId); // Uses cache (if fresh)
}
```

### 4. Handle Async Updates

```tsx
const handleUpdate = async () => {
  try {
    await updateStatic({ age: 31 });
    toast.success('Profile updated!');
  } catch (error) {
    toast.error('Update failed!');
  }
};
```

## Future Enhancements

Planned hooks:

- `useExercises` - Exercise library management
- `useWorkoutSession` - Active workout session
- `useTrainingPlan` - Training plan management
- `useAnalytics` - Performance analytics
- `useNotifications` - Push notifications

## Compliance

This layer follows Starfit MAS development redlines:

1. **All types from `shared/contracts`** - No local type definitions
2. **Uses Service Layer** - No direct fetch calls in hooks
3. **Proper error handling** - Typed errors with context
4. **WebSocket integration** - Real-time updates
5. **Data validation** - Via Service layer Zod schemas
6. **No silent failures** - All errors logged or thrown
