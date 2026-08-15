// BatchOpsService was part of the MAS (multi-agent system) codebase that was
// deleted during the MAS → Deep Agents refactor. This test file is a stress
// test for the old architecture and is preserved for reference only — it
// cannot run without the deleted MAS service. All BatchOpsService references
// are commented out to unblock typecheck while keeping the test structure.
// import { BatchOpsService } from '../../backend/src/services/mas/batchOpsService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Infrastructure Stress Test: BatchOps Concurrency
 * Simulates high-frequency atomic updates to a single workout session.
 */

async function runBatchOpsLoadTest() {
  console.log('--- [Stress Test] BatchOps Concurrency ---');

  const mockWorkout = {
    id: uuidv4(),
    userId: 'user_stress_test',
    exercises: [
      {
        id: uuidv4(),
        exerciseId: 'fit://library/exercise/bench_press',
        sets: Array.from({ length: 5 }, (_, i) => ({
          index: i,
          reps: 10,
          weight: 60,
          status: 'PLANNED'
        }))
      }
    ],
    version: 1
  };

  const concurrentRequests = 50;
  console.log(`\n1. Simulating ${concurrentRequests} concurrent updates to one exercise...`);

  const ops = Array.from({ length: concurrentRequests }, (_, i) => ({
    op: 'replace' as const,
    path: `/exercises/0/sets/0/reps`,
    value: 10 + i
  }));

  const start = performance.now();
  
  // In a real scenario, these would be separate requests. 
  // Here we test the service's logic and memory safety.
  let currentWorkout = mockWorkout;
  const results = await Promise.all(ops.map(op => {
    try {
      // Simulate atomic application
      // Commented out: BatchOpsService removed with MAS
  // return BatchOpsService.applyOps(currentWorkout, [op]);
    } catch (e) {
      return null;
    }
  }));

  const end = performance.now();
  const successful = results.filter(r => r !== null).length;

  console.log(`   Result: ${successful}/${concurrentRequests} updates processed in ${(end - start).toFixed(2)}ms`);
  console.log(`   Final reps value: ${results[results.length - 1]?.exercises[0].sets[0].reps}`);

  // 2. Multi-path Stress
  console.log(`\n2. Simulating complex multi-path batch (100 operations in one request)...`);
  const complexOps = Array.from({ length: 100 }, (_, i) => ({
    op: 'replace' as const,
    path: `/exercises/0/sets/${i % 5}/weight`,
    value: 60 + i
  }));

  const complexStart = performance.now();
  // Commented out: BatchOpsService removed with MAS
  // const finalWorkout = BatchOpsService.applyOps(mockWorkout, complexOps);
  const complexEnd = performance.now();

  console.log(`   Result: 100-op batch applied in ${(complexEnd - complexStart).toFixed(2)}ms`);
}

runBatchOpsLoadTest().catch(console.error);
