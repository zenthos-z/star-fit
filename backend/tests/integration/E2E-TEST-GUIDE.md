# Complete User Workflow E2E Test Guide


## Overview

The `completeUserWorkflow.test.ts` file contains end-to-end integration tests that validate the entire user journey from registration through training plan generation, workout completion, and data collection.

## Test Scenarios

### 1. User Registration & Initial Survey
- **What it tests:**
  - Initial survey generation
  - Survey data validation
  - User profile creation in PostgreSQL
  - Three-state model initialization
  - Invalid data rejection (NA-004 redline)

- **Key validations:**
  - Survey has all required questions
  - Data validation catches invalid inputs
  - Profile created with proper structure
  - Static/Dynamic/Summary states properly separated

### 2. Training Plan Generation
- **What it tests:**
  - Plan generation based on user profile
  - Historical load anchor usage
  - Exercise selection from database
  - Weight calculation (NA-001 redline compliance)

- **Key validations:**
  - Plan contains valid exercises
  - Weights are calculated (not AI-generated)
  - Historical anchors are used when available
  - Exercise IDs match database records

### 3. Post-Workout Data Collection
- **What it tests:**
  - Workout session creation
  - Training completed event publishing
  - Metric calculations (volume, sets)
  - Post-workout survey processing
  - Feedback submission

- **Key validations:**
  - Sessions saved to database
  - Events published correctly
  - Metrics calculated by services (not AI)
  - Feedback data properly structured

### 4. Load Anchor Updates
- **What it tests:**
  - Load anchor creation and updates
  - Anchor persistence in database
  - Anchor updated event publishing
  - 1RM estimation calculations

- **Key validations:**
  - Anchors saved correctly
  - Data contracts validated (NA-003)
  - Calculations done by services (NA-001)

### 5. Self-Healing Limitation Management
- **What it tests:**
  - Active limitation creation
  - Limitation expiration and auto-clear
  - Training adjustment generation
  - Limitation data contracts

- **Key validations:**
  - Limitations created and stored
  - Auto-expiration works correctly
  - Adjustments avoid affected areas
  - Data contracts validated

### 6. Weekly Summary Compression
- **What it tests:**
  - Weekly summary generation
  - Workout history compression
  - Compression ratio calculation
  - Summary data contracts

- **Key validations:**
  - Summaries generated from workouts
  - Compression reduces token count
  - Data contracts validated

## Architecture Verification

### Three-State Model
- **Static State:** Biological/psychological characteristics
  - Updated infrequently (6 months - 1 year)
  - Contains: age, weight, height, neuro_type, permanent_injuries

- **Dynamic State:** Frequently updated training data
  - Updated after each workout
  - Contains: load_anchors, active_limitations, recovery_state

- **Summary State:** Compressed historical data
  - Updated weekly
  - Contains: recent_summary, key_metrics, trends

### Event-Driven Communication
- Tests verify event bus health
- Validates event publish/subscribe flow
- Confirms proper event metadata

### Data Contract Redlines
- **NA-001:** AI does not perform arithmetic calculations
- **NA-003:** All types from shared/contracts
- **NA-004:** No silent fallback on validation failures

## Running the Tests

### Run all E2E tests
```bash
npm run test:workflow
```

### Run with PostgreSQL
```bash
npm run test:workflow:postgres
```

### Run specific test scenario
```bash
npm run test:integration -- --testNamePattern="Scenario 1"
```

### Run with coverage
```bash
npm run test:coverage -- --testPathPattern=completeUserWorkflow
```

### Run in watch mode
```bash
npm run test:integration -- --watch completeUserWorkflow
```

## Test Data

The tests use helper functions to generate test data:

- `generateTestUserId()`: Creates unique user ID
- `generateTestWorkoutSession()`: Creates test workout data
- `generateTestSurveyData()`: Creates test survey responses

## Database

### SQLite (Default)
- Uses in-memory database
- No external dependencies
- Fast for development/testing

### PostgreSQL (Optional)
- Requires PostgreSQL server running
- Set environment variable: `TEST_DB_TYPE=postgres`
- Falls back to SQLite if unavailable

## Prerequisites

1. **PostgreSQL** (optional, for PostgreSQL tests):
   ```bash
   # Install PostgreSQL
   # Start PostgreSQL service
   # Create test database
   ```

2. **Node.js**: v18 or higher

3. **Dependencies**:
   ```bash
   npm install
   ```

## Troubleshooting

### Tests timeout
- Increase timeout in jest.config.cjs
- Check database connection
- Verify service health

### PostgreSQL connection fails
- Verify PostgreSQL is running
- Check connection settings in .env
- Tests will fall back to SQLite

### Event bus not working
- Check Redis is running (if using Redis)
- Tests will fall back to in-memory events

## CI/CD Integration

These tests run automatically:
- On every pull request
- On every push to main branch
- Before deployment

Failed tests will block deployment.

## Contributing

When adding new test scenarios:

1. Follow existing test structure
2. Use helper functions for test data
3. Verify all redlines (NA-001 through NA-004)
4. Test both success and failure cases
5. Update this guide with new scenarios

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-09 | Initial E2E test suite |

---

**Maintainer:** Starfit Development Team
**Last Updated:** 2026-02-09
