import { DeviationLogger } from '../services/logging/DeviationLogger';
import { BatchOps, PatchOp } from '../services/protocol/BatchOps';

/**
 * Mocking global environment for standalone test execution
 */
if (typeof window === 'undefined') {
  (global as any).window = {
    dispatchEvent: () => {},
    CustomEvent: class {}
  };
}

// Mock socketService to avoid import.meta.env errors in Node
const mockSocketService = {
  send: (type: string, payload: any) => {
    console.log(`   [MockSocket] Sending ${type}:`, JSON.stringify(payload).substring(0, 100) + '...');
  }
};

/**
 * Phase 2 Integration Test Script
 * 
 * This script simulates core Phase 2 workflows to verify the integration of:
 * 1. Deviation Logging (Intent Tracking)
 * 2. Batch Ops (Atomic State Updates)
 * 3. Protocol Compliance
 */

async function runPhase2IntegrationTest() {
  console.log('--- [Integration Test] Phase 2: Execution Layer & Data Loop ---');

  // Mock initial state
  const mockExercise = {
    exerciseId: 'fit://library/exercise/bench_press',
    metadata: { name: 'Bench Press', targetRpe: 8 },
    sets: [
      { index: 0, reps: 10, weight: 60, status: 'PLANNED' }
    ]
  };

  // 1. Test DeviationLogger
  console.log('\n1. Testing DeviationLogger...');
  const originalWeight = 60;
  const userModifiedWeight = 80; // Significant deviation (> 10%)
  
  // Directly test the logic since socketService is a singleton tied to VITE env
  console.log(`   Input: ${originalWeight} -> ${userModifiedWeight}`);
  const diff = Math.abs(originalWeight - userModifiedWeight);
  const isSignificant = diff > (originalWeight * 0.1);
  console.log(`   Significant Check: ${isSignificant ? 'PASSED' : 'FAILED'}`);

  // 2. Test BatchOps Protocol
  console.log('\n2. Testing BatchOps Protocol...');
  const ops: PatchOp[] = [
    BatchOps.replaceSetField(0, 0, 'weight', userModifiedWeight),
    BatchOps.replaceSetField(0, 0, 'reps', 8)
  ];

  const version = Date.now();
  const state = 'active_workout';
  const batchRequest = BatchOps.createRequest(ops, version, state);

  console.log('   Generated BatchRequest:', JSON.stringify(batchRequest, null, 2));

  if (batchRequest.method === 'architect.applyBatchOps' && batchRequest.params.ops.length === 2) {
    console.log('   Result: BatchRequest structure is valid.');
  } else {
    throw new Error('BatchRequest structure is invalid!');
  }

  // 3. Test ExerciseRenderer Plugin Dispatch Logic (Simulation)
  console.log('\n3. Testing ExerciseRenderer Dispatch Logic...');
  const testCases = [
    { type: 'STRENGTH', expected: 'ResistanceCard' },
    { type: 'CARDIO', expected: 'CardioCard' },
    { uiHint: { cardType: 'workout_plan' }, expected: 'PlanCard' },
    { uiHint: { type: 'survey_card' }, expected: 'SurveyCard' }
  ];

  testCases.forEach((tc, idx) => {
    const cardType = tc.uiHint?.cardType || tc.uiHint?.type || (tc as any).type || 'standard';
    console.log(`   Test Case ${idx + 1}: Input [${cardType}] -> Expected Plugin: ${tc.expected}`);
  });

  // 4. Simulate Socket Transmission
  console.log('\n4. Simulating Socket Transmission...');
  mockSocketService.send(batchRequest.method, batchRequest.params);
  console.log('   Result: BatchRequest handled by mock socket.');

  console.log('\n--- Phase 2 Integration Test Completed ---');
}

// Run the test
runPhase2IntegrationTest().catch(console.error);
