"""
Tests for Gateway Client

These tests verify that the SDK Gateway client:
1. Does NOT contain workflow logic
2. Does NOT submit transactions directly
3. Only prepares inputs, calls Gateway, and polls status
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import responses
import json
import base64

from chaoschain_sdk.gateway_client import (
    GatewayClient,
    WorkflowType,
    WorkflowState,
    WorkflowStatus,
    WorkflowProgress,
    GatewayError,
    GatewayConnectionError,
    GatewayTimeoutError,
    WorkflowFailedError,
)


GATEWAY_URL = "http://localhost:3000"


@pytest.fixture
def client():
    """Create a Gateway client for testing."""
    return GatewayClient(GATEWAY_URL, timeout=5, max_poll_time=10, poll_interval=0.1)


class TestHealthCheck:
    """Tests for health check endpoint."""
    
    @responses.activate
    def test_health_check_success(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/health",
            json={"status": "ok", "timestamp": 1234567890},
            status=200
        )
        
        result = client.health_check()
        
        assert result["status"] == "ok"
        assert result["timestamp"] == 1234567890
    
    @responses.activate
    def test_is_healthy_true(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/health",
            json={"status": "ok"},
            status=200
        )
        
        assert client.is_healthy() is True
    
    @responses.activate
    def test_is_healthy_false_on_error(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/health",
            json={"error": "Service unavailable"},
            status=503
        )
        
        assert client.is_healthy() is False


class TestWorkSubmission:
    """Tests for work submission workflow."""
    
    @responses.activate
    def test_submit_work_creates_workflow(self, client):
        """SDK submits to Gateway, Gateway creates workflow."""
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1234567890000,
                "updated_at": 1234567890000,
                "progress": {}
            },
            status=201
        )
        
        result = client.submit_work(
            studio_address="0xStudio",
            epoch=1,
            agent_address="0xAgent",
            data_hash="0x" + "ab" * 32,
            thread_root="0x" + "cd" * 32,
            evidence_root="0x" + "ef" * 32,
            evidence_content=b"test evidence",
            signer_address="0xSigner"
        )
        
        assert result.id == "wf-123"
        assert result.type == WorkflowType.WORK_SUBMISSION
        assert result.state == WorkflowState.CREATED
        
        # Verify request was properly formatted
        request = responses.calls[0].request
        body = json.loads(request.body)
        assert body["studio_address"] == "0xStudio"
        assert body["epoch"] == 1
        assert body["evidence_content"] == base64.b64encode(b"test evidence").decode('utf-8')
    
    @responses.activate
    def test_submit_work_sdk_does_not_execute(self, client):
        """SDK only calls Gateway — no execution logic in SDK."""
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1234567890000,
                "updated_at": 1234567890000,
                "progress": {}
            },
            status=201
        )
        
        # This should only make ONE HTTP call — no additional logic
        client.submit_work(
            studio_address="0xStudio",
            epoch=1,
            agent_address="0xAgent",
            data_hash="0x" + "ab" * 32,
            thread_root="0x" + "cd" * 32,
            evidence_root="0x" + "ef" * 32,
            evidence_content=b"test evidence",
            signer_address="0xSigner"
        )
        
        # Exactly one call to Gateway
        assert len(responses.calls) == 1
        assert responses.calls[0].request.url == f"{GATEWAY_URL}/workflows/work-submission"


class TestScoreSubmission:
    """Tests for score submission workflow."""
    
    @responses.activate
    def test_submit_score_creates_workflow(self, client):
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/score-submission",
            json={
                "id": "wf-456",
                "type": "ScoreSubmission",
                "state": "CREATED",
                "step": "COMMIT_SCORE",
                "created_at": 1234567890000,
                "updated_at": 1234567890000,
                "progress": {}
            },
            status=201
        )
        
        result = client.submit_score(
            studio_address="0xStudio",
            epoch=1,
            validator_address="0xValidator",
            data_hash="0x" + "ab" * 32,
            worker_address="0xWorker",
            scores=[8000, 7500, 9000, 6500, 8500],
            salt="0x" + "ff" * 32,
            signer_address="0xSigner"
        )
        
        assert result.id == "wf-456"
        assert result.type == WorkflowType.SCORE_SUBMISSION
        
        # Verify scores are passed correctly
        request = responses.calls[0].request
        body = json.loads(request.body)
        assert body["scores"] == [8000, 7500, 9000, 6500, 8500]


class TestCloseEpoch:
    """Tests for close epoch workflow."""
    
    @responses.activate
    def test_close_epoch_creates_workflow(self, client):
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/close-epoch",
            json={
                "id": "wf-789",
                "type": "CloseEpoch",
                "state": "CREATED",
                "step": "CHECK_PRECONDITIONS",
                "created_at": 1234567890000,
                "updated_at": 1234567890000,
                "progress": {}
            },
            status=201
        )
        
        result = client.close_epoch(
            studio_address="0xStudio",
            epoch=1,
            signer_address="0xSigner"
        )
        
        assert result.id == "wf-789"
        assert result.type == WorkflowType.CLOSE_EPOCH


class TestGetWorkflow:
    """Tests for getting workflow status."""
    
    @responses.activate
    def test_get_workflow_returns_status(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-123",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "RUNNING",
                "step": "AWAIT_TX_CONFIRM",
                "created_at": 1234567890000,
                "updated_at": 1234567891000,
                "progress": {
                    "arweave_tx_id": "ar-123",
                    "arweave_confirmed": True,
                    "onchain_tx_hash": "0xtx123"
                }
            },
            status=200
        )
        
        result = client.get_workflow("wf-123")
        
        assert result.id == "wf-123"
        assert result.state == WorkflowState.RUNNING
        assert result.progress.arweave_tx_id == "ar-123"
        assert result.progress.onchain_tx_hash == "0xtx123"
    
    @responses.activate
    def test_get_workflow_with_error(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-failed",
            json={
                "id": "wf-failed",
                "type": "WorkSubmission",
                "state": "FAILED",
                "step": "SUBMIT_WORK_ONCHAIN",
                "created_at": 1234567890000,
                "updated_at": 1234567891000,
                "progress": {},
                "error": {
                    "step": "SUBMIT_WORK_ONCHAIN",
                    "message": "Contract reverted: already submitted",
                    "code": "REVERT"
                }
            },
            status=200
        )
        
        result = client.get_workflow("wf-failed")
        
        assert result.state == WorkflowState.FAILED
        assert result.error is not None
        assert result.error.step == "SUBMIT_WORK_ONCHAIN"
        assert "already submitted" in result.error.message


class TestWaitForCompletion:
    """Tests for polling until completion."""
    
    @responses.activate
    def test_wait_returns_on_completion(self, client):
        # First poll: RUNNING
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-123",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "RUNNING",
                "step": "AWAIT_TX_CONFIRM",
                "created_at": 1234567890000,
                "updated_at": 1234567891000,
                "progress": {}
            },
            status=200
        )
        # Second poll: COMPLETED
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-123",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "COMPLETED",
                "step": "COMPLETED",
                "created_at": 1234567890000,
                "updated_at": 1234567892000,
                "progress": {
                    "onchain_tx_hash": "0xfinal",
                    "onchain_confirmed": True
                }
            },
            status=200
        )
        
        result = client.wait_for_completion("wf-123")
        
        assert result.state == WorkflowState.COMPLETED
        assert result.progress.onchain_tx_hash == "0xfinal"
    
    @responses.activate
    def test_wait_raises_on_failure(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-fail",
            json={
                "id": "wf-fail",
                "type": "WorkSubmission",
                "state": "FAILED",
                "step": "SUBMIT_WORK_ONCHAIN",
                "created_at": 1234567890000,
                "updated_at": 1234567891000,
                "progress": {},
                "error": {
                    "step": "SUBMIT_WORK_ONCHAIN",
                    "message": "Transaction reverted"
                }
            },
            status=200
        )
        
        with pytest.raises(WorkflowFailedError) as exc_info:
            client.wait_for_completion("wf-fail")
        
        assert exc_info.value.workflow_id == "wf-fail"
        assert "Transaction reverted" in str(exc_info.value)
    
    @responses.activate
    def test_wait_calls_progress_callback(self, client):
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-123",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "COMPLETED",
                "step": "COMPLETED",
                "created_at": 1234567890000,
                "updated_at": 1234567891000,
                "progress": {}
            },
            status=200
        )
        
        progress_calls = []
        
        def on_progress(status):
            progress_calls.append(status)
        
        client.wait_for_completion("wf-123", on_progress=on_progress)
        
        assert len(progress_calls) == 1
        assert progress_calls[0].state == WorkflowState.COMPLETED


class TestErrorHandling:
    """Tests for error handling."""
    
    @responses.activate
    def test_gateway_error_on_400(self, client):
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={"error": "Invalid studio_address"},
            status=400
        )
        
        with pytest.raises(GatewayError) as exc_info:
            client.submit_work(
                studio_address="invalid",
                epoch=1,
                agent_address="0xAgent",
                data_hash="0x" + "ab" * 32,
                thread_root="0x" + "cd" * 32,
                evidence_root="0x" + "ef" * 32,
                evidence_content=b"test",
                signer_address="0xSigner"
            )
        
        assert exc_info.value.status_code == 400
        assert "Invalid studio_address" in str(exc_info.value)
    
    def test_connection_error(self, client):
        # No mock = connection refused
        with pytest.raises(GatewayConnectionError):
            client.health_check()


class TestBoundaryInvariants:
    """Tests that verify SDK boundary invariants."""
    
    def test_sdk_has_no_workflow_logic(self):
        """SDK client has no methods that implement workflow steps."""
        client = GatewayClient(GATEWAY_URL)
        
        # These methods should NOT exist on SDK
        assert not hasattr(client, 'upload_to_arweave')
        assert not hasattr(client, 'submit_transaction')
        assert not hasattr(client, 'wait_for_block')
        assert not hasattr(client, 'calculate_consensus')
        assert not hasattr(client, 'distribute_rewards')
    
    def test_sdk_does_not_sign_transactions(self):
        """SDK does not have signing capability."""
        client = GatewayClient(GATEWAY_URL)
        
        # These should NOT exist
        assert not hasattr(client, 'sign_transaction')
        assert not hasattr(client, 'send_transaction')
        assert not hasattr(client, 'private_key')
        assert not hasattr(client, 'signer')
    
    def test_sdk_only_prepares_and_polls(self):
        """SDK methods are thin wrappers around HTTP calls."""
        client = GatewayClient(GATEWAY_URL)
        
        # These are the ONLY allowed operations:
        # 1. Prepare inputs and call Gateway
        assert hasattr(client, 'submit_work')
        assert hasattr(client, 'submit_score')
        assert hasattr(client, 'close_epoch')
        
        # 2. Poll for status
        assert hasattr(client, 'get_workflow')
        assert hasattr(client, 'wait_for_completion')
        
        # 3. Health check
        assert hasattr(client, 'health_check')
    
    @responses.activate
    def test_submit_work_makes_single_http_call(self, client):
        """submit_work makes exactly one HTTP call — no chaining."""
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-123",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1234567890000,
                "updated_at": 1234567890000,
                "progress": {}
            },
            status=201
        )
        
        client.submit_work(
            studio_address="0xStudio",
            epoch=1,
            agent_address="0xAgent",
            data_hash="0x" + "ab" * 32,
            thread_root="0x" + "cd" * 32,
            evidence_root="0x" + "ef" * 32,
            evidence_content=b"test",
            signer_address="0xSigner"
        )
        
        # Exactly ONE call to Gateway
        assert len(responses.calls) == 1
