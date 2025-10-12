#!/bin/bash
# End-to-End gRPC Test Script for 0G Bridge
# Tests both Storage and Compute services

set -e

echo "🧪 0G Bridge gRPC End-to-End Test Suite"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
STORAGE_PORT=50051
COMPUTE_PORT=50052

# Test counter
PASSED=0
FAILED=0

# Helper function
run_test() {
    local test_name="$1"
    local command="$2"
    
    echo -n "Testing: $test_name ... "
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAILED++))
        return 1
    fi
}

echo "1️⃣  Service Discovery Tests"
echo "----------------------------"

run_test "Storage Service is discoverable" \
    "grpcurl -plaintext localhost:$STORAGE_PORT list | grep -q 'zerog.bridge.v1.StorageService'"

run_test "Compute Service is discoverable" \
    "grpcurl -plaintext localhost:$COMPUTE_PORT list | grep -q 'zerog.bridge.v1.ComputeService'"

echo ""
echo "2️⃣  Health Check Tests"
echo "----------------------"

run_test "Storage Service health check" \
    "grpcurl -plaintext -d '{}' localhost:$STORAGE_PORT grpc.health.v1.Health/Check | grep -q 'SERVING'"

run_test "Compute Service health check" \
    "grpcurl -plaintext -d '{}' localhost:$COMPUTE_PORT grpc.health.v1.Health/Check | grep -q 'SERVING'"

echo ""
echo "3️⃣  Storage Service Method Tests"
echo "---------------------------------"

run_test "Storage.Put method exists" \
    "grpcurl -plaintext localhost:$STORAGE_PORT list zerog.bridge.v1.StorageService | grep -q 'Put'"

run_test "Storage.Get method exists" \
    "grpcurl -plaintext localhost:$STORAGE_PORT list zerog.bridge.v1.StorageService | grep -q 'Get'"

run_test "Storage.Verify method exists" \
    "grpcurl -plaintext localhost:$STORAGE_PORT list zerog.bridge.v1.StorageService | grep -q 'Verify'"

run_test "Storage.Delete method exists" \
    "grpcurl -plaintext localhost:$STORAGE_PORT list zerog.bridge.v1.StorageService | grep -q 'Delete'"

echo ""
echo "4️⃣  Compute Service Functional Tests"
echo "-------------------------------------"

# Submit a job
echo "   Submitting compute job..."
JOB_RESPONSE=$(grpcurl -plaintext -d '{
  "task_json": "{\"model\": \"test-model\", \"prompt\": \"test prompt\"}",
  "verification_method": 2,
  "idempotency_key": "test-e2e-'$(date +%s)'"
}' localhost:$COMPUTE_PORT zerog.bridge.v1.ComputeService/Submit)

JOB_ID=$(echo "$JOB_RESPONSE" | grep -o '"jobId": "[^"]*"' | cut -d'"' -f4)

run_test "Compute.Submit creates job" \
    "[[ -n '$JOB_ID' ]]"

if [[ -n "$JOB_ID" ]]; then
    run_test "Compute.Status returns job status" \
        "grpcurl -plaintext -d '{\"job_id\": \"$JOB_ID\"}' localhost:$COMPUTE_PORT zerog.bridge.v1.ComputeService/Status | grep -q 'success'"
    
    run_test "Compute.Result returns job output" \
        "grpcurl -plaintext -d '{\"job_id\": \"$JOB_ID\"}' localhost:$COMPUTE_PORT zerog.bridge.v1.ComputeService/Result | grep -q 'outputJson'"
    
    run_test "Compute.Attestation returns proof" \
        "grpcurl -plaintext -d '{\"job_id\": \"$JOB_ID\"}' localhost:$COMPUTE_PORT zerog.bridge.v1.ComputeService/Attestation | grep -q 'attestationJson'"
fi

echo ""
echo "5️⃣  gRPC Reflection Tests"
echo "-------------------------"

run_test "Storage Service supports reflection" \
    "grpcurl -plaintext localhost:$STORAGE_PORT list | grep -q 'grpc.reflection'"

run_test "Compute Service supports reflection" \
    "grpcurl -plaintext localhost:$COMPUTE_PORT list | grep -q 'grpc.reflection'"

echo ""
echo "=========================================="
echo "📊 Test Results Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total:  $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi

