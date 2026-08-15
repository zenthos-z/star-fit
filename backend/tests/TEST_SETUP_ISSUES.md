# Test Setup Issues and Solutions
**Generated**: 2026-02-09
**Status**: Critical Issues Blocking Test Execution


## Current Situation

The test suite is currently **completely blocked** due to ES module configuration issues. The project uses:
- `"type": "module"` in package.json
- Complex import mappings for shared contracts
- Jest with ts-jest preset for ES modules
- Node.js native test runner (tsx) as alternative

## Root Causes

### 1. ES Module Import Resolution

**Issue**: Tests import from `'shared/contracts'` but Node.js/Jest cannot resolve this path.

**Root Cause**: The backend's package.json has:
```json
"imports": {
  "#shared/contracts/*": "../shared/contracts/*.js",
  "shared/contracts/*": "../shared/contracts/*.js"
}
```

But tests use bare imports like:
```typescript
import { HistorySummarySchema } from 'shared/contracts';
```

**Problem**: The import mapping requires a wildcard (`*`) but tests don't provide it.

### 2. Jest ES Module Configuration

**Issue**: Jest cannot parse test files with ES module imports.

**Error**:
```
SyntaxError: Cannot use import statement outside a module
```

**Root Cause**: ts-jest with `useESM: true` requires specific configuration that conflicts with the project's module setup.

### 3. Module Resolution Conflicts

**Issue**: Different parts of the project use different import styles:
- Source files: `import { X } from '../../../src/services/...'`
- Shared contracts: `import { X } from 'shared/contracts'`
- Test files: Mix of both

## Immediate Solutions

### Option 1: Fix Import Paths (Recommended)

**Change all test imports to use relative paths**:

```typescript
// BEFORE:
import { HistorySummarySchema } from 'shared/contracts';

// AFTER:
import { HistorySummarySchema } from '../../../shared/contracts/index.js';
```

**Pros**:
- Works with current Jest configuration
- No additional setup needed
- Explicit dependencies

**Cons**:
- Verbose imports
- Harder to maintain

### Option 2: Update Jest Module Mapper

**Update jest.config.cjs**:

```javascript
moduleNameMapper: {
  '^(\\.{1,2}/.*)\\.js$': '$1',
  '^shared/contracts$': '<rootDir>/../shared/contracts/index.js',
  '^shared/contracts/(.*)$': '<rootDir>/../shared/contracts/$1',
  '^shared/(.*)$': '<rootDir>/../shared/$1',
},
```

**Pros**:
- Keeps import statements clean
- Centralized configuration

**Cons**:
- Still may have ES module issues
- Requires careful mapping maintenance

### Option 3: Use Node.js Native Test Runner (tsx)

**Switch from Jest to tsx --test**:

```bash
# Instead of:
npm run test:unit

# Use:
npx tsx --test tests/unit/services/*.test.ts
```

**Update package.json**:
```json
{
  "scripts": {
    "test:unit": "tsx --test tests/unit/**/*.test.ts",
    "test:integration": "tsx --test tests/integration/**/*.test.ts",
    "test:coverage": "tsx --test --coverage tests/**/*.test.ts" // Note: coverage may need c8 or nyc
  }
}
```

**Pros**:
- Native ES module support
- No Jest configuration needed
- Works with existing module setup

**Cons**:
- Different test syntax (Node.js test runner vs Jest)
- Coverage tooling different (c8/nyc vs Istanbul)
- Migration effort for existing tests

### Option 4: Use Vitest (Recommended for Long-term)

**Install Vitest**:
```bash
cd backend
npm install --save-dev vitest @vitest/ui
```

**Create vitest.config.ts**:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      'shared/contracts': '../shared/contracts/index.ts',
    },
  },
});
```

**Pros**:
- Native ESM support
- Jest-compatible API
- Better performance
- Active development

**Cons**:
- New dependency
- Migration effort

## Recommended Action Plan

### Phase 1: Quick Fix (Today)

1. **Update all test imports to use relative paths**
   - Find and replace `'shared/contracts'` with `'../../../shared/contracts/index.js'`
   - This unblocks testing immediately

2. **Simplify Jest configuration**
   - Remove complex module mapping
   - Use standard relative imports

### Phase 2: Proper Solution (This Week)

1. **Set up npm workspace or proper package linking**
   ```bash
   # Option A: npm workspaces
   # In root package.json:
   "workspaces": ["backend", "shared"]

   # Option B: Link the shared package
   cd backend
   npm link ../shared
   ```

2. **Update imports to use package name**
   ```typescript
   import { HistorySummarySchema } from '@starfit/shared';
   ```

3. **Configure Jest properly**
   - Use proper module resolution
   - Enable coverage reporting

### Phase 3: Long-term Solution (Next Sprint)

1. **Migrate to Vitest**
   - Better ESM support
   - Jest-compatible API
   - Faster test execution

2. **Set up coverage reporting**
   - Generate coverage reports
   - Set coverage thresholds
   - Integrate with CI/CD

## File-by-File Fix Instructions

### tests/unit/services/CompressionService.test.ts

**Line 15** - Change:
```typescript
import { HistorySummarySchema, WorkoutSessionSchema } from 'shared/contracts';
```

To:
```typescript
import { HistorySummarySchema, WorkoutSessionSchema } from '../../../shared/contracts/index.js';
```

### tests/unit/services/ProgressionService.test.ts

**Line 14** - Change:
```typescript
import type { LoadAnchor } from 'shared/contracts';
```

To:
```typescript
import type { LoadAnchor } from '../../../shared/contracts/index.js';
```

### tests/unit/services/SelfHealingService.test.ts

**Line X** - Find and replace all `'shared/contracts'` imports.

### tests/integration/*.test.ts

Same changes for all integration test files.

## Verification Steps

After applying fixes:

1. **Test a single file**:
   ```bash
   npm test -- tests/unit/services/CompressionService.test.ts
   ```

2. **Run all unit tests**:
   ```bash
   npm run test:unit
   ```

3. **Run with coverage**:
   ```bash
   npm run test:coverage
   ```

4. **Check coverage report**:
   - Look for coverage directory
   - Open HTML report if available

## Alternative: Skip Import Fixes with Test Setup

If fixing imports is too disruptive, create a test setup file:

**tests/setup.ts**:
```typescript
// Register module resolution
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('tsx', pathToFileURL(new URL('../', import.meta.url)));
```

**Update jest.config.cjs**:
```javascript
setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
```

## Coverage Tools

If switching away from Jest:

1. **c8** (Node.js native):
   ```bash
   npm install --save-dev c8
   npx c8 tsx --test tests/**/*.test.ts
   ```

2. **nyc** (Istanbul):
   ```bash
   npm install --save-dev nyc
   npx nyc tsx --test tests/**/*.test.ts
   ```

## Current Status Summary

- **Total Test Files**: 11
- **Blocked by Configuration**: 11 (100%)
- **Passing Tests**: 0
- **Coverage Measurable**: No

**Blocking Issues**:
1. ES module import resolution
2. Jest configuration for ESM
3. Shared package not properly linked

**Estimated Time to Fix**:
- Quick fix (import paths): 2-4 hours
- Proper solution (workspaces/linking): 4-8 hours
- Migration to Vitest: 1-2 days

## Next Actions

1. **Immediate**: Apply quick fix to unblock testing
2. **Today**: Run tests and generate coverage report
3. **This Week**: Implement proper solution
4. **Next Sprint**: Consider Vitest migration
