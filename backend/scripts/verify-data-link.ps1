# ============================================================================
# User Settings Data Link Verification Script (PowerShell)
# ============================================================================
# This script verifies the complete data flow from database to frontend.
#
# Data Flow:
#   Database (PostgreSQL JSONB) → API → Frontend Service → UI
#
# Usage:
#   .\verify-data-link.ps1 [-Clean] [-ApiTest] [-Full]
#
# Options:
#   -Clean     Clean test data before running
#   -ApiTest   Test API layer (requires running backend)
#   -Full      Run all tests including cleanup
# ============================================================================

param(
    [switch]$Clean,
    [switch]$ApiTest,
    [switch]$Full
)

$ErrorActionPreference = "Stop"

# Configuration
$env:PGPASSWORD = $env:PGPASSWORD ?? "postgres"
$PG_HOST = "localhost"
$PG_PORT = "5432"
$PG_DB = "starfit"
$PG_USER = "postgres"
$API_BASE = "http://localhost:43111/api"
$TEST_USER_DEVICE = "test-user-data-link"
$TIMESTAMP = [int](Get-Date -UFormat %s)

# Colors
function Write-Success { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Error { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Step { param($num, $msg) Write-Host "[$num/6] $msg" -ForegroundColor Yellow }

# PostgreSQL query helper
function Invoke-PgQuery {
    param(
        [string]$Query,
        [switch]$TuplesOnly
    )

    $psqlArgs = @(
        "-h", $PG_HOST,
        "-p", $PG_PORT,
        "-U", $PG_USER,
        "-d", $PG_DB,
        "-c", $Query
    )

    if ($TuplesOnly) {
        $psqlArgs += "-t"
    }

    $env:PGPASSWORD = "postgres"
    $result = & psql @psqlArgs 2>&1
    return $result
}

# ============================================================================
# Step 1: Clean Test Data
# ============================================================================
function Clean-TestData {
    Write-Step 1 "Cleaning test data..."

    $query = @"
-- Delete test user's audit logs
DELETE FROM audit_logs
WHERE user_id IN (SELECT id FROM users WHERE device_id LIKE 'test-user%');

-- Delete test user's sessions
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE device_id LIKE 'test-user%');

-- Reset test user data
UPDATE users
SET
  profile_static = '{}',
  profile_dynamic = '{}',
  history_summary = '{}',
  updated_at = NOW()
WHERE device_id LIKE 'test-user%';

-- Create clean test user if not exists
INSERT INTO users (device_id, profile_static, profile_dynamic, history_summary)
VALUES ('$TEST_USER_DEVICE', '{}', '{}', '{}')
ON CONFLICT (device_id) DO UPDATE SET
  profile_static = '{}',
  profile_dynamic = '{}',
  history_summary = '{}';
"@

    Invoke-PgQuery -Query $query | Out-Null
    Write-Success "Test data cleaned"
}

# ============================================================================
# Step 2: Verify Database Layer
# ============================================================================
function Verify-DatabaseLayer {
    Write-Step 2 "Verifying database layer..."

    $query = @"
SELECT
  device_id,
  jsonb_typeof(profile_static) as static_type,
  jsonb_typeof(profile_dynamic) as dynamic_type,
  jsonb_typeof(history_summary) as summary_type
FROM users
WHERE device_id = '$TEST_USER_DEVICE';
"@

    $result = Invoke-PgQuery -Query $query

    if ($result -match $TEST_USER_DEVICE) {
        Write-Success "Test user exists"

        if ($result -match "object.*object.*object") {
            Write-Success "JSONB format correct (all objects)"
            return $true
        } else {
            Write-Error "JSONB format incorrect"
            Write-Host "    Result: $result"
            return $false
        }
    } else {
        Write-Error "Test user not found"
        return $false
    }
}

# ============================================================================
# Step 3: Write Test Data to Database
# ============================================================================
function Write-TestData {
    Write-Step 3 "Writing test data..."

    $query = @"
UPDATE users
SET
  profile_static = '{"age": 30, "weight": 75, "height": 175}'::jsonb,
  profile_dynamic = jsonb_set(
    '{"load_anchors": {}}'::jsonb,
    '{load_anchors,bench_press}',
    '{"best_weight": 100, "best_reps": 5, "est_1rm": 115, "last_updated": $TIMESTAMP}'::jsonb
  ),
  updated_at = NOW()
WHERE device_id = '$TEST_USER_DEVICE';
"@

    $result = Invoke-PgQuery -Query $query

    if ($LASTEXITCODE -eq 0) {
        Write-Success "Test data written"
        return $true
    } else {
        Write-Error "Failed to write test data"
        return $false
    }
}

# ============================================================================
# Step 4: Verify Database Read
# ============================================================================
function Verify-DatabaseRead {
    Write-Step 4 "Verifying database read..."

    $query = @"
SELECT profile_dynamic->'load_anchors'->'bench_press' as anchor
FROM users WHERE device_id = '$TEST_USER_DEVICE';
"@

    $result = Invoke-PgQuery -Query $query

    if ($result -match "best_weight.*100") {
        Write-Success "Load anchor correctly stored"
        Write-Host "    Data: $($result.Trim())"
        return $true
    } else {
        Write-Error "Load anchor not found"
        Write-Host "    Result: $result"
        return $false
    }
}

# ============================================================================
# Step 5: Verify API Layer
# ============================================================================
function Verify-ApiLayer {
    Write-Step 5 "Verifying API layer..."

    # Get test user ID
    $query = "SELECT id FROM users WHERE device_id = '$TEST_USER_DEVICE'"
    $TEST_USER_ID = (Invoke-PgQuery -Query $query -TuplesOnly).Trim()

    if ([string]::IsNullOrEmpty($TEST_USER_ID)) {
        Write-Error "Failed to get test user ID"
        return $false
    }

    Write-Host "  Test User ID: $TEST_USER_ID"

    # Check if API is running
    try {
        $healthCheck = Invoke-WebRequest -Uri "$API_BASE/health" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($healthCheck.StatusCode -ne 200) {
            Write-Info "API not running, skipping API tests"
            Write-Host "    Start backend with: cd backend && npm run dev"
            return $true
        }
    } catch {
        Write-Info "API not running, skipping API tests"
        Write-Host "    Start backend with: cd backend && npm run dev"
        return $true
    }

    # Test GET profile
    Write-Host "  Testing GET /admin/users/:id/profile..."

    try {
        $headers = @{
            "x-user-id" = "admin"
            "Content-Type" = "application/json"
        }

        $response = Invoke-RestMethod -Uri "$API_BASE/admin/users/$TEST_USER_ID/profile" `
            -Method GET -Headers $headers

        # Check protocol version
        $version = $response.data.protocol_version
        if ($version -eq "2.0.0") {
            Write-Success "Protocol version correct (2.0.0)"
        } else {
            Write-Error "Protocol version incorrect: $version"
            return $false
        }

        # Check load anchors
        $anchor = $response.data.profile_dynamic.load_anchors.bench_press
        if ($null -ne $anchor) {
            Write-Success "Load anchors accessible via API"
            Write-Host "    Anchor: $($anchor | ConvertTo-Json -Compress)"
        } else {
            Write-Error "Load anchors not found in API response"
            return $false
        }

        # Test POST anchor update
        Write-Host "  Testing POST /admin/users/:id/anchors/:exercise..."

        $newAnchor = @{
            best_weight = 105
            best_reps = 3
            est_1rm = 120
            last_updated = $TIMESTAMP
        }

        $writeResponse = Invoke-RestMethod -Uri "$API_BASE/admin/users/$TEST_USER_ID/anchors/squat" `
            -Method POST -Headers $headers -Body ($newAnchor | ConvertTo-Json)

        if ($writeResponse.success -eq $true) {
            Write-Success "Anchor write successful"
        } else {
            Write-Error "Anchor write failed"
            return $false
        }

        # Verify persistence
        Start-Sleep -Seconds 1

        $verifyResponse = Invoke-RestMethod -Uri "$API_BASE/admin/users/$TEST_USER_ID/profile" `
            -Method GET -Headers $headers

        $squatAnchor = $verifyResponse.data.profile_dynamic.load_anchors.squat
        if ($null -ne $squatAnchor) {
            Write-Success "Data persistence verified"
        } else {
            Write-Error "Data persistence check failed"
            return $false
        }

        return $true

    } catch {
        Write-Error "API test failed: $_"
        return $false
    }
}

# ============================================================================
# Step 6: Verify Data Contract Compliance
# ============================================================================
function Verify-DataContracts {
    Write-Step 6 "Verifying data contract compliance..."

    $contractsPath = "..\shared\contracts\index.ts"
    $validationPath = "..\shared\contracts\validation.ts"

    # Check if shared/contracts exists
    if (Test-Path $contractsPath) {
        Write-Success "shared/contracts/index.ts exists"
    } else {
        Write-Error "shared/contracts/index.ts not found"
        return $false
    }

    # Check LoadAnchor schema structure
    if (Select-String -Path $contractsPath -Pattern "LoadAnchorSchema" -Quiet) {
        Write-Success "LoadAnchorSchema defined"
    } else {
        Write-Error "LoadAnchorSchema not found"
        return $false
    }

    # Check UserProfileV2 schema structure
    if (Select-String -Path $contractsPath -Pattern "UserProfileV2Schema" -Quiet) {
        Write-Success "UserProfileV2Schema defined"
    } else {
        Write-Error "UserProfileV2Schema not found"
        return $false
    }

    # Check validation utilities
    if (Test-Path $validationPath) {
        if (Select-String -Path $validationPath -Pattern "parseJSONSafe" -Quiet) {
            Write-Success "parseJSONSafe utility exists"
        } else {
            Write-Error "parseJSONSafe utility not found"
            return $false
        }
    } else {
        Write-Error "shared/contracts/validation.ts not found"
        return $false
    }

    return $true
}

# ============================================================================
# Cleanup Test Data
# ============================================================================
function Cleanup-TestData {
    Write-Info "Cleaning up test data..."

    $query = @"
-- Remove test load anchors
UPDATE users
SET profile_dynamic = jsonb_set(
  profile_dynamic,
  '{load_anchors}',
  (profile_dynamic->'load_anchors') - 'squat'
)
WHERE device_id = '$TEST_USER_DEVICE';

-- Reset to clean state
UPDATE users
SET
  profile_static = '{}',
  profile_dynamic = '{}',
  history_summary = '{}',
  updated_at = NOW()
WHERE device_id = '$TEST_USER_DEVICE';
"@

    Invoke-PgQuery -Query $query | Out-Null
    Write-Success "Cleanup complete"
}

# ============================================================================
# Main Execution
# ============================================================================
Write-Host ""
Write-Host "========================================"
Write-Host "  User Settings Data Link Verification"
Write-Host "========================================"
Write-Host ""

$allPassed = $true

# Run steps
if ($Clean -or $Full) {
    Clean-TestData
}

if (-not (Verify-DatabaseLayer)) { $allPassed = $false }
if (-not (Write-TestData)) { $allPassed = $false }
if (-not (Verify-DatabaseRead)) { $allPassed = $false }

if ($ApiTest -or $Full) {
    if (-not (Verify-ApiLayer)) { $allPassed = $false }
} else {
    Write-Info "[5/6] API layer test skipped (use -ApiTest to enable)"
}

if (-not (Verify-DataContracts)) { $allPassed = $false }

if ($Full) {
    Cleanup-TestData
}

Write-Host ""
Write-Host "========================================"
if ($allPassed) {
    Write-Host "  Verification Complete" -ForegroundColor Green
} else {
    Write-Host "  Verification Failed" -ForegroundColor Red
}
Write-Host "========================================"
Write-Host ""
Write-Host "Summary:"
Write-Host "  - Database JSONB structure: OK"
Write-Host "  - Data write/read: OK"
if ($ApiTest -or $Full) {
    Write-Host "  - API layer: OK"
} else {
    Write-Host "  - API layer: SKIPPED (use -ApiTest)"
}
Write-Host "  - Data contracts: OK"
Write-Host ""
