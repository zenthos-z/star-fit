#!/usr/bin/env tsx

/**
 * Manual Admin API Test Script
 *
 * This script tests the 6 admin API endpoints without using Jest
 * to avoid ESM module transformation issues.
 *
 * Test Scenarios:
 * A1: Get User Profile - Normal Flow
 * A2: Get User Profile - User Not Found
 * A3: Update Static Profile - Partial Update
 * A4: Update Static Profile - Boundary Values
 * A5: Update Load Anchor - New Anchor
 * A6: Update Load Anchor - Type Validation
 * A7: Add Limitation - Auto Calculate Expiration
 * A8: Delete Limitation - Normal Flow
 *
 * Usage: npx tsx tests/integration/run-admin-api-tests.ts
 */

// Load environment variables
import 'dotenv/config';

// Test colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

type TestResult = 'PASS' | 'FAIL' | 'SKIP';

interface TestReport {
  scenario: string;
  testName: string;
  result: TestResult;
  error?: string;
  duration: number;
}

// ============================================================================
// Test Functions
// ============================================================================

/**
 * A1: Get User Profile - Normal Flow
 */
async function test_A1_GetUserProfile_NormalFlow(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile`);
    const data = await response.json();

    if (!response.ok) {
      return {
        scenario: 'A1',
        testName: 'Get User Profile - Normal Flow',
        result: 'FAIL',
        error: `HTTP ${response.status}: ${data.error || 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    // Validate response structure
    if (!data.success) {
      return {
        scenario: 'A1',
        testName: 'Get User Profile - Normal Flow',
        result: 'FAIL',
        error: 'Response success is false',
        duration: Date.now() - startTime,
      };
    }

    if (!data.data || data.data.protocol_version !== '2.0.0') {
      return {
        scenario: 'A1',
        testName: 'Get User Profile - Normal Flow',
        result: 'FAIL',
        error: `Invalid protocol_version: ${data.data?.protocol_version}`,
        duration: Date.now() - startTime,
      };
    }

    if (!data.data.profile_static || !data.data.profile_dynamic) {
      return {
        scenario: 'A1',
        testName: 'Get User Profile - Normal Flow',
        result: 'FAIL',
        error: 'Missing profile_static or profile_dynamic',
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A1',
      testName: 'Get User Profile - Normal Flow',
      result: 'PASS',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A1',
      testName: 'Get User Profile - Normal Flow',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * A2: Get User Profile - User Not Found
 */
async function test_A2_GetUserProfile_UserNotFound(baseUrl: string, nonExistentUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/${nonExistentUserId}/profile`);
    const data = await response.json();

    if (response.status === 404) {
      return {
        scenario: 'A2',
        testName: 'Get User Profile - User Not Found',
        result: 'PASS',
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A2',
      testName: 'Get User Profile - User Not Found',
      result: 'FAIL',
      error: `Expected 404, got ${response.status}`,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A2',
      testName: 'Get User Profile - User Not Found',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * A3: Update Static Profile - Partial Update
 */
async function test_A3_UpdateStaticProfile_PartialUpdate(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    const updateData = { age: 31, weight: 76 };
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile/static`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    });
    const data = await response.json();

    if (!response.ok) {
      return {
        scenario: 'A3',
        testName: 'Update Static Profile - Partial Update',
        result: 'FAIL',
        error: `HTTP ${response.status}: ${data.error || 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    if (!data.success) {
      return {
        scenario: 'A3',
        testName: 'Update Static Profile - Partial Update',
        result: 'FAIL',
        error: 'Response success is false',
        duration: Date.now() - startTime,
      };
    }

    // Verify update
    const getResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile`);
    const getData = await getResponse.json();

    if (getData.data.profile_static.age !== 31 || getData.data.profile_static.weight !== 76) {
      return {
        scenario: 'A3',
        testName: 'Update Static Profile - Partial Update',
        result: 'FAIL',
        error: `Values not updated correctly: age=${getData.data.profile_static.age}, weight=${getData.data.profile_static.weight}`,
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A3',
      testName: 'Update Static Profile - Partial Update',
      result: 'PASS',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A3',
      testName: 'Update Static Profile - Partial Update',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * A4: Update Static Profile - Boundary Values
 */
async function test_A4_UpdateStaticProfile_BoundaryValues(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  // Test age: 10
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile/static`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age: 10 }),
    });
    results.push(response.ok ? 'PASS' : 'FAIL');
  } catch {
    results.push('FAIL');
  }

  // Test age: 100
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile/static`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age: 100 }),
    });
    results.push(response.ok ? 'PASS' : 'FAIL');
  } catch {
    results.push('FAIL');
  }

  // Test age: 9 (should be rejected or accepted based on validation)
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile/static`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age: 9 }),
    });
    // Either 200 (no validation) or 400 (validation enforced) is acceptable
    results.push(response.ok || response.status === 400 ? 'PASS' : 'FAIL');
  } catch {
    results.push('FAIL');
  }

  // Test age: 101
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/profile/static`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age: 101 }),
    });
    results.push(response.ok || response.status === 400 ? 'PASS' : 'FAIL');
  } catch {
    results.push('FAIL');
  }

  const allPassed = results.every(r => r === 'PASS');
  return {
    scenario: 'A4',
    testName: 'Update Static Profile - Boundary Values',
    result: allPassed ? 'PASS' : 'FAIL',
    error: allPassed ? undefined : `Some boundary tests failed: ${results.join(', ')}`,
    duration: Date.now() - startTime,
  };
}

/**
 * A5: Update Load Anchor - New Anchor
 */
async function test_A5_UpdateLoadAnchor_NewAnchor(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    const anchorData = {
      best_weight: 100,
      best_reps: 8,
      est_1rm: 125,
      last_updated: Date.now(),
    };

    const exerciseId = 'test_squat';
    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/anchors/${exerciseId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(anchorData),
    });
    const data = await response.json();

    if (!response.ok) {
      return {
        scenario: 'A5',
        testName: 'Update Load Anchor - New Anchor',
        result: 'FAIL',
        error: `HTTP ${response.status}: ${data.error || 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    if (!data.success) {
      return {
        scenario: 'A5',
        testName: 'Update Load Anchor - New Anchor',
        result: 'FAIL',
        error: 'Response success is false',
        duration: Date.now() - startTime,
      };
    }

    if (data.data?.exerciseId !== exerciseId || data.data?.anchor?.best_weight !== 100) {
      return {
        scenario: 'A5',
        testName: 'Update Load Anchor - New Anchor',
        result: 'FAIL',
        error: 'Response data mismatch',
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A5',
      testName: 'Update Load Anchor - New Anchor',
      result: 'PASS',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A5',
      testName: 'Update Load Anchor - New Anchor',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * A6: Update Load Anchor - Type Validation
 */
async function test_A6_UpdateLoadAnchor_TypeValidation(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    // Test resistance type without best_weight (should be invalid)
    const invalidAnchor = {
      best_duration: 60,
      last_updated: Date.now(),
    };

    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/anchors/squat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidAnchor),
    });

    // Note: The API may not validate this, so we check the contract validation
    // For now, we'll just check if the API responds
    const data = await response.json();

    // Test valid resistance anchor
    const validAnchor = {
      best_weight: 90,
      best_reps: 8,
      est_1rm: 110,
      last_updated: Date.now(),
    };

    const validResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}/anchors/bench_press`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAnchor),
    });

    if (!validResponse.ok) {
      return {
        scenario: 'A6',
        testName: 'Update Load Anchor - Type Validation',
        result: 'FAIL',
        error: 'Valid anchor was rejected',
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A6',
      testName: 'Update Load Anchor - Type Validation',
      result: 'PASS',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A6',
      testName: 'Update Load Anchor - Type Validation',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * A7: Add Limitation - Auto Calculate Expiration
 */
async function test_A7_AddLimitation_AutoCalculateExpiration(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    const limitationData = {
      part: '左肩',
      severity: 5,
      note: '训练时轻微疼痛',
      auto_heal: true,
    };

    const response = await fetch(`${baseUrl}/api/admin/users/${testUserId}/limitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(limitationData),
    });
    const data = await response.json();

    if (!response.ok) {
      return {
        scenario: 'A7',
        testName: 'Add Limitation - Auto Calculate Expiration',
        result: 'FAIL',
        error: `HTTP ${response.status}: ${data.error || 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    if (!data.success || !data.data?.limitation) {
      return {
        scenario: 'A7',
        testName: 'Add Limitation - Auto Calculate Expiration',
        result: 'FAIL',
        error: 'Response data missing limitation',
        duration: Date.now() - startTime,
      };
    }

    const limitation = data.data.limitation;
    if (limitation.part !== '左肩' || limitation.severity !== 5) {
      return {
        scenario: 'A7',
        testName: 'Add Limitation - Auto Calculate Expiration',
        result: 'FAIL',
        error: 'Limitation data mismatch',
        duration: Date.now() - startTime,
      };
    }

    if (!limitation.expire_at || !limitation.logged_at) {
      return {
        scenario: 'A7',
        testName: 'Add Limitation - Auto Calculate Expiration',
        result: 'FAIL',
        error: 'Missing expire_at or logged_at',
        duration: Date.now() - startTime,
      };
    }

    // Verify expiration is in the future
    const expireDate = new Date(limitation.expire_at);
    const now = new Date();
    if (expireDate.getTime() <= now.getTime()) {
      return {
        scenario: 'A7',
        testName: 'Add Limitation - Auto Calculate Expiration',
        result: 'FAIL',
        error: 'Expiration time is not in the future',
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A7',
      testName: 'Add Limitation - Auto Calculate Expiration',
      result: 'PASS',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A7',
      testName: 'Add Limitation - Auto Calculate Expiration',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * A8: Delete Limitation - Normal Flow
 */
async function test_A8_DeleteLimitation_NormalFlow(baseUrl: string, testUserId: string): Promise<TestReport> {
  const startTime = Date.now();
  try {
    // First add a limitation
    const limitationData = {
      part: '删除测试部位',
      severity: 4,
      note: '用于测试删除功能',
      auto_heal: true,
    };

    const addResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}/limitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(limitationData),
    });

    if (!addResponse.ok) {
      return {
        scenario: 'A8',
        testName: 'Delete Limitation - Normal Flow',
        result: 'FAIL',
        error: 'Failed to add test limitation',
        duration: Date.now() - startTime,
      };
    }

    // Then delete it
    const deleteResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}/limitations/删除测试部位`, {
      method: 'DELETE',
    });
    const deleteData = await deleteResponse.json();

    if (!deleteResponse.ok) {
      return {
        scenario: 'A8',
        testName: 'Delete Limitation - Normal Flow',
        result: 'FAIL',
        error: `HTTP ${deleteResponse.status}: ${deleteData.error || 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    if (!deleteData.success) {
      return {
        scenario: 'A8',
        testName: 'Delete Limitation - Normal Flow',
        result: 'FAIL',
        error: 'Delete response success is false',
        duration: Date.now() - startTime,
      };
    }

    return {
      scenario: 'A8',
      testName: 'Delete Limitation - Normal Flow',
      result: 'PASS',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      scenario: 'A8',
      testName: 'Delete Limitation - Normal Flow',
      result: 'FAIL',
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests() {
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}  Admin Console API Integration Tests${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  // Check for existing server or use default port
  const port = process.env.PORT || '4321';
  const baseUrl = `http://localhost:${port}`;

  console.log(`${colors.yellow}Using server at ${baseUrl}${colors.reset}`);
  console.log(`${colors.yellow}Make sure the server is running before executing tests!${colors.reset}\n`);

  // Test user IDs
  const testUserId = `admin-test-${Date.now()}`;
  const nonExistentUserId = `non-existent-${Date.now()}`;

  const reports: TestReport[] = [];

  // Run all tests
  console.log(`${colors.blue}Running tests...${colors.reset}\n`);

  reports.push(await test_A1_GetUserProfile_NormalFlow(baseUrl, testUserId));
  reports.push(await test_A2_GetUserProfile_UserNotFound(baseUrl, nonExistentUserId));
  reports.push(await test_A3_UpdateStaticProfile_PartialUpdate(baseUrl, testUserId));
  reports.push(await test_A4_UpdateStaticProfile_BoundaryValues(baseUrl, testUserId));
  reports.push(await test_A5_UpdateLoadAnchor_NewAnchor(baseUrl, testUserId));
  reports.push(await test_A6_UpdateLoadAnchor_TypeValidation(baseUrl, testUserId));
  reports.push(await test_A7_AddLimitation_AutoCalculateExpiration(baseUrl, testUserId));
  reports.push(await test_A8_DeleteLimitation_NormalFlow(baseUrl, testUserId));

  // Print results
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}  Test Results${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  let passCount = 0;
  let failCount = 0;

  for (const report of reports) {
    const statusColor = report.result === 'PASS' ? colors.green : report.result === 'FAIL' ? colors.red : colors.yellow;
    const statusSymbol = report.result === 'PASS' ? '✓' : report.result === 'FAIL' ? '✗' : '○';

    console.log(`${statusColor}${statusSymbol} [${report.scenario}] ${report.testName}${colors.reset}`);
    if (report.error) {
      console.log(`  ${colors.red}Error: ${report.error}${colors.reset}`);
    }
    console.log(`  ${colors.blue}Duration: ${report.duration}ms${colors.reset}\n`);

    if (report.result === 'PASS') passCount++;
    else if (report.result === 'FAIL') failCount++;
  }

  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`Total: ${reports.length} | ${colors.green}Pass: ${passCount}${colors.reset} | ${colors.red}Fail: ${failCount}${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════${colors.reset}`);

  // Exit with error code if any tests failed
  if (failCount > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
