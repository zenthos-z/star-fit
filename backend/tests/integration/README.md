# Integration Tests


This directory contains integration tests for the Starfit backend system.

## Test Structure

```
integration/
├── completeWorkflow.test.ts         # Complete workflow integration tests
├── completeUserWorkflow.test.ts     # End-to-end user journey tests
├── api.test.ts                      # API endpoint integration tests
├── serviceLayer.test.ts             # Service layer architecture tests
├── memoryNodeMigration.test.ts      # ⚠️ DEPRECATED（旧 MAS Memory 节点迁移测试，随 MAS 移除）
├── helpers/
│   ├── serviceMocks.ts             # Mock service implementations
│   └── testDatabase.ts             # Test database setup utilities
└── README.md                       # This file
```

## Running Tests

### Run all integration tests

```bash
npm run test:integration
```

### Run specific test file

```bash
npm test -- completeWorkflow.test.ts
```

### Run with coverage

```bash
npm run test:coverage -- --testPathPattern=integration
```

## Test Categories

### 1. Complete Workflow Tests (`completeWorkflow.test.ts`)

Tests the complete data flow through the three-state model:

#### Training Flow: Workout → Load Anchor Update → Summary Compression
- Creates workout session
- Updates load anchors based on performance
- Generates weekly summary
- Verifies three-state separation
- Validates NA-001 redline (AI does not perform arithmetic)

#### Self-Healing Flow: Create Limitation → Expire → Auto-Clear
- Creates active limitation
- Checks and expires limitations
- Generates training adjustments
- Verifies auto-clear mechanism

#### Vector Search Flow: Semantic Query → Embedding → Rule Filter → Results
- Performs semantic search with filters
- Finds similar exercises
- Validates search results structure

#### Three-State Model: Static/Dynamic/Summary Separation
- Verifies proper state separation
- Validates update frequency constraints
- Tests independent state updates

#### Data Contract Redlines Verification
- NA-001: AI does not perform arithmetic calculations
- NA-003: All types from shared/contracts
- NA-004: No silent fallback on validation failures

### 2. Complete User Workflow Tests (`completeUserWorkflow.test.ts`)

End-to-end integration tests for the complete user journey:

#### Scenario 1: User Registration & Initial Survey
- Generates initial survey questions
- Validates survey data submission
- Creates user profile with three-state model
- Verifies PostgreSQL profile creation
- Tests invalid data rejection (NA-004)

#### Scenario 2: Training Plan Generation
- Generates training plan based on user profile
- Uses historical load anchors when available
- Validates exercise selection from database
- Verifies weight calculation (NA-001 compliance)

#### Scenario 3: Post-Workout Data Collection
- Saves completed workout sessions
- Publishes training completed events
- Calculates session metrics without AI
- Processes post-workout survey feedback

#### Scenario 4: Load Anchor Updates
- Updates load anchors after workout
- Verifies anchor persistence in database
- Tests anchor updated event publishing
- Validates 1RM estimation calculations

#### Scenario 5: Self-Healing Limitation Management
- Creates active limitations
- Tests limitation expiration and auto-clear
- Generates training adjustments
- Verifies limitation data contracts

#### Scenario 6: Weekly Summary Compression
- Generates weekly summary from workouts
- Compresses workout history
- Validates compression ratios
- Tests summary data contracts

#### Architecture Verification
- Three-State Model separation
- Event-Driven communication
- Data Contract redlines (NA-001 through NA-004)

### 2. API Tests (`api.test.ts`)

Tests API endpoints:

- User profile CRUD operations
- Load anchor merging
- Error handling
- Data persistence

## Test Utilities

### Mock Services

Located in `helpers/serviceMocks.ts`:

- `MockProgressionService`: Simulates load calculations
- `MockSelfHealingService`: Simulates limitation management
- `MockVectorSearchService`: Simulates semantic search
- `MockCompressionService`: Simulates data compression

### Test Database Setup

Located in `helpers/testDatabase.ts`:

- `createTestDatabase()`: Creates SQLite or PostgreSQL test database
- `createTestDb()`: Creates in-memory SQLite database
- `createTestPostgresClient()`: Creates PostgreSQL test client
- `cleanupTestDb()`: Cleans up test database
- `generateTestUserId()`: Generates unique test user ID
- `generateTestWorkoutSession()`: Generates test workout data
- `generateTestSurveyData()`: Generates test survey responses

### Test Context

The `createTestContext()` function sets up:
- In-memory SQLite database
- Mock logger
- Test user ID
- All service instances

The new `completeUserWorkflow.test.ts` uses:
- `createTestDatabase()`: Database setup
- `createMockLogger()`: Logger instance
- Service instances with real database connections

## Writing New Tests

### Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createTestContext, cleanupTestContext } from '../helpers/testSetup';

describe('Feature Name', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = createTestContext();
  });

  afterAll(() => {
    cleanupTestContext(ctx);
  });

  it('should do something', async () => {
    // Arrange
    const testData = { /* ... */ };

    // Act
    const result = await someService.doSomething(testData);

    // Assert
    expect(result).toBeDefined();
  });
});
```

### Best Practices

1. **Use `createTestContext()`** for consistent test setup
2. **Clean up resources** in `afterAll()`
3. **Test both success and failure scenarios**
4. **Verify redlines compliance** (NA-001 through NA-004)
5. **Use descriptive test names** that explain what is being tested
6. **Mock external dependencies** (AI services, databases, etc.)
7. **Test edge cases**: empty data, null values, invalid inputs

## Redlines Verification

### NA-001: AI does not perform arithmetic calculations

```typescript
it('should verify NA-001', async () => {
  const result = progressionService.estimate1RM(100, 8);

  // Verify calculation is done by service
  expect(typeof result).toBe('number');

  // Verify AI was not called
  const aiCalls = logger.info.mock.calls.filter(
    call => call[0]?.includes('AI')
  );
  expect(aiCalls.length).toBe(0);
});
```

### NA-003: All types from shared/contracts

```typescript
import { ProfileStaticSchema } from 'shared/contracts';

it('should verify NA-003', async () => {
  // Validate using shared schemas
  const result = ProfileStaticSchema.parse(data);
  expect(result).toBeDefined();
});
```

### NA-004: No silent fallback on validation failures

```typescript
it('should verify NA-004', async () => {
  const invalidData = { age: 'not a number' };

  expect(() => {
    ProfileStaticSchema.parse(invalidData);
  }).toThrow();

  // Verify error was logged
  expect(logger.error).toHaveBeenCalled();
});
```

## Troubleshooting

### Tests fail with "Database is locked"

Ensure each test uses a unique user ID or clean up properly:

```typescript
const testUserId = `test-user-${uuidv4()}`;
```

### Mock services not working

Import from the correct path:

```typescript
import { serviceMocks } from '../helpers/serviceMocks';
```

### Tests timeout

Increase timeout for slow operations:

```typescript
it('should complete slow operation', async () => {
  // ...
}, 30000); // 30 second timeout
```

## CI/CD Integration

These tests run automatically on:

- Every pull request
- Every push to main branch
- Before deployment

Failed tests will block deployment.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0.0 | 2026-02-09 | Added complete user workflow E2E tests |
| 2.0.0 | 2026-02-09 | Complete workflow integration tests |
| 1.0.0 | 2026-01-17 | Initial API tests |

---

**Maintainer**: Starfit Development Team
**Last Updated**: 2026-02-09
