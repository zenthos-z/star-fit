import { z } from 'zod';
import { ExerciseActionSchema, BiometricMetricSchema, WorkoutSessionSchema } from '../../src/v2/types/protocol';
import { v4 as uuidv4 } from 'uuid';

/**
 * Infrastructure Stress Test: Protocol Validation
 * Measures the performance and robustness of Zod schemas under heavy load.
 */

async function runStressTest() {
  console.log('--- [Stress Test] Protocol Validation ---');

  const iterations = 1000;
  
  // 1. Biometric Data Stress
  console.log(`\n1. Validating ${iterations} Biometric data points...`);
  const bioStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const data = {
      type: 'HR',
      value: 70 + Math.random() * 100,
      unit: 'bpm',
      timestamp: new Date().toISOString(),
      metadata: { sensorId: 'chest-strap-01', battery: 85 }
    };
    BiometricMetricSchema.parse(data);
  }
  const bioEnd = performance.now();
  console.log(`   Result: ${iterations} items in ${(bioEnd - bioStart).toFixed(2)}ms (${((bioEnd - bioStart) / iterations).toFixed(4)}ms/item)`);

  // 2. Large Workout Session Stress
  console.log(`\n2. Validating large workout session (50 exercises, 5 sets each)...`);
  const largeSession = {
    id: uuidv4(),
    userId: 'user_stress_test',
    status: 'IN_PROGRESS',
    startTime: new Date().toISOString(),
    environment: 'GYM',
    exercises: Array.from({ length: 50 }, (_, i) => ({
      id: uuidv4(),
      exerciseId: `fit://library/exercise/ex_${i}`,
      type: 'STRENGTH',
      sets: Array.from({ length: 5 }, (_, j) => ({
        index: j,
        reps: 10,
        weight: 50,
        status: 'PLANNED'
      })),
      uiHint: { cardType: 'resistance_standard' }
    }))
  };

  const sessionStart = performance.now();
  WorkoutSessionSchema.parse(largeSession);
  const sessionEnd = performance.now();
  console.log(`   Result: Large session validated in ${(sessionEnd - sessionStart).toFixed(2)}ms`);

  // 3. Tolerance Parsing Test (Breaking schemas)
  console.log('\n3. Testing Tolerance Parsing (Invalid data with fallbacks)...');
  const invalidExercise = {
    id: uuidv4(),
    exerciseId: 'fit://test',
    type: 'INVALID_TYPE', // Should fallback to UNKNOWN
    sets: [{ index: 0, status: 'DONE_NOT_IN_ENUM' }] // Should fail if strict, check fallback logic
  };

  try {
    const parsed = ExerciseActionSchema.parse(invalidExercise);
    console.log('   Result: Successfully parsed with fallbacks:', parsed.type);
  } catch (e: any) {
    console.log('   Note: Schema is strict on enums. If tolerance is required, .catch() or .default() must be used in protocol.ts.');
    // console.log(e.errors);
  }
}

runStressTest().catch(console.error);
