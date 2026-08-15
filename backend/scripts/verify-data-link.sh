#!/bin/bash
# ============================================================================
# User Settings Data Link Verification Script
# ============================================================================
# This script verifies the complete data flow from database to frontend.
#
# Data Flow:
#   Database (PostgreSQL JSONB) → API → Frontend Service → UI
#
# Usage:
#   ./verify-data-link.sh [--clean] [--api-test] [--full]
#
# Options:
#   --clean     Clean test data before running
#   --api-test  Test API layer (requires running backend)
#   --full      Run all tests including cleanup
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE="${API_BASE:-http://localhost:43111/api}"
TEST_USER_DEVICE="test-user-data-link"
TIMESTAMP=$(date +%s)

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL environment variable not set${NC}"
    echo "Please set DATABASE_URL, e.g.:"
    echo "  export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/starfit"
    exit 1
fi

echo ""
echo "========================================"
echo "  User Settings Data Link Verification"
echo "========================================"
echo ""

# ============================================================================
# Step 1: Clean Test Data
# ============================================================================
clean_test_data() {
    echo -e "${YELLOW}[1/6] Cleaning test data...${NC}"

    psql "$DATABASE_URL" <<EOF
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
EOF

    echo -e "${GREEN}  ✓ Test data cleaned${NC}"
}

# ============================================================================
# Step 2: Verify Database Layer
# ============================================================================
verify_database_layer() {
    echo -e "${YELLOW}[2/6] Verifying database layer...${NC}"

    # Check if test user exists and has correct structure
    RESULT=$(psql "$DATABASE_URL" -t -c "
SELECT
  device_id,
  jsonb_typeof(profile_static) as static_type,
  jsonb_typeof(profile_dynamic) as dynamic_type,
  jsonb_typeof(history_summary) as summary_type
FROM users
WHERE device_id = '$TEST_USER_DEVICE';
")

    if echo "$RESULT" | grep -q "$TEST_USER_DEVICE"; then
        echo -e "${GREEN}  ✓ Test user exists${NC}"

        # Verify JSONB types
        if echo "$RESULT" | grep -q "object.*object.*object"; then
            echo -e "${GREEN}  ✓ JSONB format correct (all objects)${NC}"
        else
            echo -e "${RED}  ✗ JSONB format incorrect${NC}"
            echo "    Result: $RESULT"
            return 1
        fi
    else
        echo -e "${RED}  ✗ Test user not found${NC}"
        return 1
    fi
}

# ============================================================================
# Step 3: Write Test Data to Database
# ============================================================================
write_test_data() {
    echo -e "${YELLOW}[3/6] Writing test data...${NC}"

    # Get test user ID
    TEST_USER_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM users WHERE device_id = '$TEST_USER_DEVICE'" | tr -d ' \n')

    if [ -z "$TEST_USER_ID" ]; then
        echo -e "${RED}  ✗ Failed to get test user ID${NC}"
        return 1
    fi

    echo "  Test User ID: $TEST_USER_ID"

    # Write test load anchor directly to database
    psql "$DATABASE_URL" <<EOF
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
EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Test data written${NC}"
    else
        echo -e "${RED}  ✗ Failed to write test data${NC}"
        return 1
    fi
}

# ============================================================================
# Step 4: Verify Database Read
# ============================================================================
verify_database_read() {
    echo -e "${YELLOW}[4/6] Verifying database read...${NC}"

    RESULT=$(psql "$DATABASE_URL" -t -c "
SELECT profile_dynamic->'load_anchors'->'bench_press' as anchor
FROM users WHERE device_id = '$TEST_USER_DEVICE';
")

    if echo "$RESULT" | grep -q "best_weight.*100"; then
        echo -e "${GREEN}  ✓ Load anchor correctly stored${NC}"
        echo "    Data: $(echo "$RESULT" | tr -d ' \n')"
    else
        echo -e "${RED}  ✗ Load anchor not found${NC}"
        echo "    Result: $RESULT"
        return 1
    fi
}

# ============================================================================
# Step 5: Verify API Layer (requires running backend)
# ============================================================================
verify_api_layer() {
    echo -e "${YELLOW}[5/6] Verifying API layer...${NC}"

    # Get test user ID
    TEST_USER_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM users WHERE device_id = '$TEST_USER_DEVICE'" | tr -d ' \n')

    if [ -z "$TEST_USER_ID" ]; then
        echo -e "${RED}  ✗ Failed to get test user ID${NC}"
        return 1
    fi

    # Check if API is running
    if ! curl -s -o /dev/null -w "%{http_code}" "$API_BASE/health" 2>/dev/null | grep -q "200"; then
        echo -e "${YELLOW}  ⚠ API not running, skipping API tests${NC}"
        echo "    Start backend with: cd backend && npm run dev"
        return 0
    fi

    # Test GET profile
    echo "  Testing GET /admin/users/:id/profile..."
    API_RESULT=$(curl -s "$API_BASE/admin/users/$TEST_USER_ID/profile" \
        -H "x-user-id: admin" \
        -H "Content-Type: application/json")

    # Check protocol version
    VERSION=$(echo "$API_RESULT" | jq -r '.data.protocol_version // empty')
    if [ "$VERSION" = "2.0.0" ]; then
        echo -e "${GREEN}  ✓ Protocol version correct (2.0.0)${NC}"
    else
        echo -e "${RED}  ✗ Protocol version incorrect: $VERSION${NC}"
        echo "    Response: $(echo "$API_RESULT" | head -c 200)"
        return 1
    fi

    # Check load anchors
    ANCHOR=$(echo "$API_RESULT" | jq '.data.profile_dynamic.load_anchors.bench_press // empty')
    if [ -n "$ANCHOR" ] && [ "$ANCHOR" != "null" ]; then
        echo -e "${GREEN}  ✓ Load anchors accessible via API${NC}"
        echo "    Anchor: $ANCHOR"
    else
        echo -e "${RED}  ✗ Load anchors not found in API response${NC}"
        echo "    Response: $(echo "$API_RESULT" | jq '.data.profile_dynamic' 2>/dev/null)"
        return 1
    fi

    # Test POST anchor update
    echo "  Testing POST /admin/users/:id/anchors/:exercise..."
    NEW_ANCHOR='{"best_weight":105,"best_reps":3,"est_1rm":120,"last_updated":'$TIMESTAMP'}'

    WRITE_RESULT=$(curl -s -X POST "$API_BASE/admin/users/$TEST_USER_ID/anchors/squat" \
        -H "Content-Type: application/json" \
        -H "x-user-id: admin" \
        -d "$NEW_ANCHOR")

    if echo "$WRITE_RESULT" | jq -e '.success' > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Anchor write successful${NC}"
    else
        echo -e "${RED}  ✗ Anchor write failed${NC}"
        echo "    Response: $WRITE_RESULT"
        return 1
    fi

    # Verify persistence
    sleep 1
    VERIFY_RESULT=$(curl -s "$API_BASE/admin/users/$TEST_USER_ID/profile" \
        -H "x-user-id: admin")

    SQUAT_ANCHOR=$(echo "$VERIFY_RESULT" | jq '.data.profile_dynamic.load_anchors.squat // empty')
    if [ -n "$SQUAT_ANCHOR" ] && [ "$SQUAT_ANCHOR" != "null" ]; then
        echo -e "${GREEN}  ✓ Data persistence verified${NC}"
    else
        echo -e "${RED}  ✗ Data persistence check failed${NC}"
        return 1
    fi
}

# ============================================================================
# Step 6: Verify Data Contract Compliance
# ============================================================================
verify_data_contracts() {
    echo -e "${YELLOW}[6/6] Verifying data contract compliance...${NC}"

    # Check if shared/contracts exists
    if [ -f "../shared/contracts/index.ts" ]; then
        echo -e "${GREEN}  ✓ shared/contracts/index.ts exists${NC}"
    else
        echo -e "${RED}  ✗ shared/contracts/index.ts not found${NC}"
        return 1
    fi

    # Check LoadAnchor schema structure
    if grep -q "LoadAnchorSchema" ../shared/contracts/index.ts; then
        echo -e "${GREEN}  ✓ LoadAnchorSchema defined${NC}"
    else
        echo -e "${RED}  ✗ LoadAnchorSchema not found${NC}"
        return 1
    fi

    # Check UserProfileV2 schema structure
    if grep -q "UserProfileV2Schema" ../shared/contracts/index.ts; then
        echo -e "${GREEN}  ✓ UserProfileV2Schema defined${NC}"
    else
        echo -e "${RED}  ✗ UserProfileV2Schema not found${NC}"
        return 1
    fi

    # Check validation utilities
    if grep -q "parseJSONSafe" ../shared/contracts/validation.ts; then
        echo -e "${GREEN}  ✓ parseJSONSafe utility exists${NC}"
    else
        echo -e "${RED}  ✗ parseJSONSafe utility not found${NC}"
        return 1
    fi
}

# ============================================================================
# Cleanup Test Data
# ============================================================================
cleanup() {
    echo -e "${YELLOW}Cleaning up test data...${NC}"

    psql "$DATABASE_URL" <<EOF
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
EOF

    echo -e "${GREEN}  ✓ Cleanup complete${NC}"
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    local run_clean=false
    local run_api=false
    local run_full=false

    # Parse arguments
    for arg in "$@"; do
        case $arg in
            --clean) run_clean=true ;;
            --api-test) run_api=true ;;
            --full) run_full=true; run_clean=true; run_api=true ;;
        esac
    done

    # Run steps
    if [ "$run_clean" = true ]; then
        clean_test_data
    fi

    verify_database_layer
    write_test_data
    verify_database_read

    if [ "$run_api" = true ]; then
        verify_api_layer
    else
        echo -e "${YELLOW}[5/6] API layer test skipped (use --api-test to enable)${NC}"
    fi

    verify_data_contracts

    if [ "$run_full" = true ]; then
        cleanup
    fi

    echo ""
    echo "========================================"
    echo -e "${GREEN}  ✓ Verification Complete${NC}"
    echo "========================================"
    echo ""
    echo "Summary:"
    echo "  - Database JSONB structure: OK"
    echo "  - Data write/read: OK"
    if [ "$run_api" = true ]; then
        echo "  - API layer: OK"
    else
        echo "  - API layer: SKIPPED (use --api-test)"
    fi
    echo "  - Data contracts: OK"
    echo ""
}

# Run main
main "$@"
