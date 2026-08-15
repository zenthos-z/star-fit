# Test Fixes Required
**Generated**: 2026-02-09
**Priority**: High - All tests are currently blocked


## Summary of Fixes Applied

### 1. Jest Configuration Fixed ✓
**File**: `jest.config.cjs`

**Changes**:
- Added `isolatedModules: true` to ts-jest transform options
- Added diagnostics config to ignore warning 151002

**Status**: COMPLETED

### 2. Logger Interface Enhanced ✓
**File**: ~~`src/services/mas/config/serviceRegistry.ts`~~（DEPRECATED 旧 MAS 路径；Logger 接口增强本身通用，迁移到新 AgentService 后继续适用）

**Changes**:
- Added `fatal(message: string, meta?: Record<string, unknown>): void` to Logger interface
- Implemented `fatal` in ConsoleLogger class

**Status**: COMPLETED

### 3. Server Export Added ✓
**File**: `src/server.ts`

**Changes**:
- Exported `createServer()` function for integration testing
- Function properly initializes all routes and plugins
- Can be used in tests without starting the actual HTTP server

**Status**: COMPLETED

### 4. Test Helpers Created ✓
**File**: `tests/helpers/testHelpers.ts`

**Contents**:
- `createMockLogger()` - Creates consistent mock loggers
- `createMockLoggerWithSpies()` - Creates logger with spy accessors
- `clearMockLogger()` - Clears mock calls
- Various data builders (exercises, profiles, sessions)
- Utility functions for testing

**Status**: COMPLETED

---

## Remaining Manual Fixes Required

### 5. VectorSearchService Test Fixes
**File**: `tests/unit/services/VectorSearchService.test.ts`

**Issues**:
1. Constructor takes only 1 argument (logger), not 3
2. `generateEmbedding` expects object with `{ text: string }`, not string
3. Method name is `batchGenerateEmbeddings`, not `generateBatchEmbeddings`
4. `ExerciseSchema` import doesn't exist in shared/contracts

**Required Changes**:

```typescript
// BEFORE (Line ~44):
const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  // Missing debug!
};

// AFTER:
import { createMockLogger } from '../../helpers/testHelpers.js';
const logger = createMockLogger();

// BEFORE (Line ~60):
service: new VectorSearchService(db, logger, mockAIService),

// AFTER:
service: new VectorSearchService(logger),

// BEFORE (Line ~95):
await ctx.service.generateEmbedding('ex001');

// AFTER:
await ctx.service.generateEmbedding({ text: 'ex001' });

// BEFORE (Line ~158):
const result = await ctx.service.generateBatchEmbeddings(exerciseIds);

// AFTER:
const result = await ctx.service.batchGenerateEmbeddings({ texts: exerciseIds });

// BEFORE (Line ~15):
import { ExerciseSchema } from 'shared/contracts';

// AFTER:
// Remove this import or replace with correct schema
// ExerciseSchema may need to be created in shared/contracts/index.ts
```

### 6. userProfileService Test Fixes
**File**: `tests/unit/userProfileService.test.ts`

**Issues**:
1. Using `import.meta.url` which requires ES2020+ module setting
2. Dynamic import with `.ts` extension should use `.js`
3. `await` at top-level not allowed in non-async function

**Required Changes**:

```typescript
// BEFORE (Line ~7):
const __filename = fileURLToPath(import.meta.url);

// AFTER:
// Remove this line or refactor to not use __filename
// Or use jest's built-in path handling

// BEFORE (Line ~35):
userProfileService = (await import('../../src/services/userProfileService.ts')).UserProfileService;

// AFTER:
userProfileService = (await import('../../src/services/userProfileService.js')).UserProfileService;

// OR use regular import at top of file:
import { UserProfileService } from '../../src/services/userProfileService.js';
```

### 7. SelfHealingService Test Fixes
**File**: `tests/unit/services/SelfHealingService.test.ts`

**Issues**:
1. Mock implementation has type errors with parameters

**Required Changes**:

```typescript
// BEFORE (Line ~38):
jest.spyOn(service as any, 'getUserProfileDynamic').mockImplementation(async (userId: string) => {

// AFTER:
jest.spyOn(service as any, 'getUserProfileDynamic').mockImplementation(async (...args: unknown[]) => {
  const userId = args[0] as string;
  // ... rest of implementation
});

// OR use mockResolvedValue:
jest.spyOn(service as any, 'getUserProfileDynamic').mockResolvedValue({
  active_limitations: []
});
```

---

## Import Path Issues

All test imports should use `.js` extensions, not `.ts`:

```typescript
// CORRECT:
import { MyService } from '../../src/services/MyService.js';
import { MyType } from 'shared/contracts';

// WRONG:
import { MyService } from '../../src/services/MyService.ts';
```

---

## Missing Exports in shared/contracts

The following schemas are imported in tests but may not exist:

1. `ExerciseSchema` - Used in VectorSearchService.test.ts
2. Various profile schemas - Check if they exist

**Solution**:
Either:
1. Create the missing schemas in `shared/contracts/index.ts`
2. Use alternative types from existing schemas
3. Remove the import if not needed

---

## Quick Fix Script

To quickly apply all the fixes:

```bash
# 1. Apply jest.config.cjs fix (already done)
# 2. Apply Logger interface fix (already done)
# 3. Apply server.ts export (already done)
# 4. Use new test helpers in all test files

# In each test file, replace:
const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

# With:
import { createMockLogger } from '../helpers/testHelpers.js';
const logger = createMockLogger();
```

---

## Test Execution After Fixes

After applying all fixes, run:

```bash
# Should now work without TypeScript errors
npm run test:unit

# Run specific test file
npm test -- tests/unit/services/CompressionService.test.ts

# Run with coverage
npm run test:coverage
```

---

## Next Steps

1. Apply remaining manual fixes to test files
2. Run tests to verify they compile
3. Fix any runtime issues that appear
4. Add missing schemas to shared/contracts if needed
5. Run coverage analysis to identify gaps
6. Create new tests for uncovered critical paths

---

## Test File Status

| File | Status | Required Fixes |
|------|--------|----------------|
| CompressionService.test.ts | Blocked | None (should work after jest.config fix) |
| ProgressionService.test.ts | Blocked | None (should work after jest.config fix) |
| SelfHealingService.test.ts | Blocked | Mock implementation types |
| VectorSearchService.test.ts | Blocked | Multiple API mismatches, imports |
| userProfileService.test.ts | Blocked | ES module issues |
| api.test.ts | Blocked | createServer export (FIXED) |
| serviceLayer.test.ts | Blocked | Logger.fatal (FIXED) |

---

## Creating New Tests

When creating new tests, use the test helpers:

```typescript
import { createMockLogger, generateTestUserId, createMockExercise } from '../helpers/testHelpers.js';

describe('MyService', () => {
  let logger = createMockLogger();

  beforeEach(() => {
    logger = createMockLogger(); // Fresh logger for each test
  });

  it('should do something', async () => {
    const userId = generateTestUserId();
    const exercise = createMockExercise({ name: 'Custom Exercise' });

    // Test code here...
  });
});
```
