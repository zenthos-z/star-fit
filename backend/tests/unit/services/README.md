# Unit Tests


This directory contains unit tests for Starfit backend services.

## Test Structure

```
unit/
├── services/
│   ├── ProgressionService.test.ts    # Load calculation tests
│   ├── SelfHealingService.test.ts    # Self-healing tests
│   ├── VectorSearchService.test.ts   # Vector search tests
│   ├── CompressionService.test.ts    # Data compression tests
│   └── README.md                     # This file
└── helpers/
    └── testHelpers.ts               # Test utilities
```

## Running Tests

### Run all unit tests

```bash
npm run test:unit
```

### Run specific test file

```bash
npm test -- ProgressionService.test.ts
```

### Run with coverage

```bash
npm run test:coverage
```

## Test Categories

### ProgressionService Tests

**Location**: `services/ProgressionService.test.ts`

Tests load calculation and progression logic:

- `calculateNextLoad()` with various increments
- `estimate1RM()` with Epley formula
- `updateLoadAnchors()` data persistence
- Edge cases (zero weight, negative values)
- **NA-001 Redline**: No AI in arithmetic calculations

**Test Count**: 30+ tests

### SelfHealingService Tests

**Location**: `services/SelfHealingService.test.ts`

Tests self-healing limitation management:

- `addLimitation()` with various severity levels
- `checkAndExpireLimitations()` auto-expiration
- `generateAdjustment()` training modifications
- Edge cases (invalid severity, past dates)
- Data persistence and validation

**Test Count**: 20+ tests

### VectorSearchService Tests

**Location**: `services/VectorSearchService.test.ts`

Tests semantic search functionality:

- `generateEmbedding()` for exercises
- `semanticSearch()` with filters
- `findSimilar()` recommendations
- Edge cases (empty query, no results)
- Performance benchmarks

**Test Count**: 15+ tests

### CompressionService Tests

**Location**: `services/CompressionService.test.ts`

Tests data compression and summarization:

- `compressUserHistory()` compression ratio
- `generateWeeklySummary()` AI summarization
- `updateTrends()` trend calculation
- Edge cases (no data, single session)
- Token savings verification

**Test Count**: 15+ tests

## Writing New Tests

### Template

```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
// ⚠️ DEPRECATED（旧 MAS 路径）：重构后服务迁移到新 AgentService / 领域服务层，按新结构调整此导入路径
import { YourService } from '../../../src/services/mas/services/YourService.js';

describe('YourService', () => {
  let service: YourService;
  let mockDb: Database;
  let mockLogger: Logger;

  beforeEach(() => {
    // Setup test context
    mockDb = new Database(':memory:');
    mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new YourService(mockDb, mockLogger);
  });

  afterEach(() => {
    // Cleanup
    mockDb.close();
  });

  describe('methodName', () => {
    it('should do something expected', () => {
      // Arrange
      const input = { /* test data */ };

      // Act
      const result = service.methodName(input);

      // Assert
      expect(result).toBeDefined();
      expect(result.property).toBe(expectedValue);
    });
  });
});
```

### Best Practices

1. **Arrange-Act-Assert Pattern**: Structure tests clearly
2. **Descriptive Names**: Test names should describe what is being tested
3. **Test Edge Cases**: Include boundary conditions and error cases
4. **Mock External Dependencies**: Use mocks for AI services, databases
5. **Verify Redlines**: Ensure NA-001 through NA-004 compliance
6. **Independence**: Tests should not depend on each other
7. **Fast Execution**: Unit tests should run in <100ms each

### Redlines Verification

#### NA-001: No AI in Arithmetic

```typescript
it('should verify NA-001', () => {
  const result = service.calculateSomething(100, 8);

  // Verify calculation is deterministic
  expect(result).toBe(expectedValue);

  // Verify AI was not called
  expect(mockLogger.info).not.toHaveBeenCalledWith(
    expect.stringContaining('AI')
  );
});
```

#### NA-003: Types from shared/contracts

```typescript
import { LoadAnchorSchema } from 'shared/contracts';

it('should verify NA-003', () => {
  const result = LoadAnchorSchema.parse(data);
  expect(result).toBeDefined();
});
```

#### NA-004: No Silent Fallback

```typescript
it('should verify NA-004', () => {
  const invalidData = { weight: -10 };

  expect(() => {
    service.validate(invalidData);
  }).toThrow();

  // Verify error was logged
  expect(mockLogger.error).toHaveBeenCalled();
});
```

## Test Coverage

### Current Coverage

| Service | Tests | Coverage | Status |
|---------|-------|----------|--------|
| ProgressionService | 30 | 0% | ⏳ Pending |
| SelfHealingService | 0 | 0% | ⏳ Pending |
| VectorSearchService | 0 | 0% | ⏳ Pending |
| CompressionService | 0 | 0% | ⏳ Pending |

### Target Coverage

- **Overall**: >80% statement coverage
- **Branches**: >75% branch coverage
- **Functions**: >85% function coverage
- **Lines**: >80% line coverage

## CI/CD Integration

Unit tests run automatically on:

- Every pull request
- Every push to main branch
- Before deployment to staging

Failed unit tests will:

- Block PR merge
- Prevent deployment
- Notify development team

## Troubleshooting

### Tests fail with "Cannot find module"

Ensure imports use correct paths:
```typescript
// ⚠️ DEPRECATED（旧 MAS 路径）：重构后按新 AgentService / 领域服务层路径调整
import { YourService } from '../../../src/services/mas/services/YourService.js';
```

### Mock database not working

Create in-memory database:
```typescript
const db = new Database(':memory:');
```

### Tests timeout

Increase timeout for slow operations:
```typescript
it('should complete slow operation', async () => {
  // ...
}, 30000); // 30 second timeout
```

### Coverage not generating

Ensure Jest is configured correctly:
```bash
npm run test:coverage -- --coverage
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-02-09 | Unit tests for three-state model services |
| 1.0.0 | 2026-01-17 | Initial unit tests |

---

**Maintainer**: Starfit Development Team
**Last Updated**: 2026-02-09
