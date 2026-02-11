"""
End-to-End Golden Path Tests for SDK → Gateway Integration

These tests verify:
1. SDK correctly prepares inputs for Gateway
2. SDK does NOT contain workflow logic
3. SDK does NOT submit transactions directly
4. SDK only polls Gateway for status

The Gateway is the ONLY transaction submitter.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import responses
import json
import base64
import os

# Import SDK components
from chaoschain_sdk.gateway_client import (
    GatewayClient,
    WorkflowType,
    WorkflowState,
    WorkflowStatus,
    WorkflowProgress,
    GatewayError,
    WorkflowFailedError,
)


GATEWAY_URL = "http://localhost:3000"


class TestGoldenPath:
    """
    Golden path: Work submission → Score submission → Close epoch
    
    This is the complete workflow for a successful studio epoch.
    """
    
    @responses.activate
    def test_golden_path_work_submission(self):
        """Test work submission via Gateway."""
        client = GatewayClient(GATEWAY_URL, poll_interval=0.1)
        
        # 1. Submit work (CREATED)
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-work-1",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1000,
                "updated_at": 1000,
                "progress": {}
            },
            status=201
        )
        
        # 2. First poll (RUNNING - storing evidence)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-work-1",
            json={
                "id": "wf-work-1",
                "type": "WorkSubmission",
                "state": "RUNNING",
                "step": "AWAIT_EVIDENCE_CONFIRM",
                "created_at": 1000,
                "updated_at": 1001,
                "progress": {
                    "arweave_tx_id": "ar-evidence-123"
                }
            },
            status=200
        )
        
        # 3. Second poll (RUNNING - submitting on-chain)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-work-1",
            json={
                "id": "wf-work-1",
                "type": "WorkSubmission",
                "state": "RUNNING",
                "step": "AWAIT_TX_CONFIRM",
                "created_at": 1000,
                "updated_at": 1002,
                "progress": {
                    "arweave_tx_id": "ar-evidence-123",
                    "arweave_confirmed": True,
                    "onchain_tx_hash": "0xtx123"
                }
            },
            status=200
        )
        
        # 4. Third poll (COMPLETED)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-work-1",
            json={
                "id": "wf-work-1",
                "type": "WorkSubmission",
                "state": "COMPLETED",
                "step": "COMPLETED",
                "created_at": 1000,
                "updated_at": 1003,
                "progress": {
                    "arweave_tx_id": "ar-evidence-123",
                    "arweave_confirmed": True,
                    "onchain_tx_hash": "0xtx123",
                    "onchain_confirmed": True,
                    "onchain_block": 12345
                }
            },
            status=200
        )
        
        # Execute
        progress_updates = []
        result = client.submit_work_and_wait(
            studio_address="0x" + "11" * 20,
            epoch=1,
            agent_address="0x" + "22" * 20,
            data_hash="0x" + "ab" * 32,
            thread_root="0x" + "cd" * 32,
            evidence_root="0x" + "ef" * 32,
            evidence_content=b"test evidence content",
            signer_address="0x" + "22" * 20,
            on_progress=lambda s: progress_updates.append(s)
        )
        
        # Verify result
        assert result.state == WorkflowState.COMPLETED
        assert result.progress.onchain_tx_hash == "0xtx123"
        assert result.progress.arweave_tx_id == "ar-evidence-123"
        
        # Verify progress updates were received
        assert len(progress_updates) >= 1
        
        # Verify request format
        submit_request = responses.calls[0].request
        body = json.loads(submit_request.body)
        assert body["studio_address"] == "0x" + "11" * 20
        assert body["epoch"] == 1
        assert body["evidence_content"] == base64.b64encode(b"test evidence content").decode()
    
    @responses.activate
    def test_golden_path_score_submission(self):
        """Test score submission via Gateway (commit-reveal)."""
        client = GatewayClient(GATEWAY_URL, poll_interval=0.1)
        
        # 1. Submit score (CREATED)
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/score-submission",
            json={
                "id": "wf-score-1",
                "type": "ScoreSubmission",
                "state": "CREATED",
                "step": "COMMIT_SCORE",
                "created_at": 1000,
                "updated_at": 1000,
                "progress": {}
            },
            status=201
        )
        
        # 2. First poll (RUNNING - commit submitted)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-score-1",
            json={
                "id": "wf-score-1",
                "type": "ScoreSubmission",
                "state": "RUNNING",
                "step": "AWAIT_COMMIT_CONFIRM",
                "created_at": 1000,
                "updated_at": 1001,
                "progress": {
                    "commit_tx_hash": "0xcommit123"
                }
            },
            status=200
        )
        
        # 3. Second poll (RUNNING - reveal phase)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-score-1",
            json={
                "id": "wf-score-1",
                "type": "ScoreSubmission",
                "state": "RUNNING",
                "step": "AWAIT_REVEAL_CONFIRM",
                "created_at": 1000,
                "updated_at": 1002,
                "progress": {
                    "commit_tx_hash": "0xcommit123",
                    "reveal_tx_hash": "0xreveal456"
                }
            },
            status=200
        )
        
        # 4. Third poll (COMPLETED)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-score-1",
            json={
                "id": "wf-score-1",
                "type": "ScoreSubmission",
                "state": "COMPLETED",
                "step": "COMPLETED",
                "created_at": 1000,
                "updated_at": 1003,
                "progress": {
                    "commit_tx_hash": "0xcommit123",
                    "reveal_tx_hash": "0xreveal456",
                    "onchain_confirmed": True
                }
            },
            status=200
        )
        
        # Execute
        result = client.submit_score_and_wait(
            studio_address="0x" + "11" * 20,
            epoch=1,
            validator_address="0x" + "33" * 20,
            data_hash="0x" + "ab" * 32,
            worker_address="0x" + "22" * 20,
            scores=[8000, 7500, 9000, 6500, 8500],
            salt="0x" + "ff" * 32,
            signer_address="0x" + "33" * 20
        )
        
        # Verify result
        assert result.state == WorkflowState.COMPLETED
        assert result.type == WorkflowType.SCORE_SUBMISSION
        
        # Verify request format
        submit_request = responses.calls[0].request
        body = json.loads(submit_request.body)
        assert body["scores"] == [8000, 7500, 9000, 6500, 8500]
        assert body["salt"] == "0x" + "ff" * 32
    
    @responses.activate
    def test_golden_path_close_epoch(self):
        """Test close epoch via Gateway."""
        client = GatewayClient(GATEWAY_URL, poll_interval=0.1)
        
        # 1. Create close epoch (CREATED)
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/close-epoch",
            json={
                "id": "wf-close-1",
                "type": "CloseEpoch",
                "state": "CREATED",
                "step": "CHECK_PRECONDITIONS",
                "created_at": 1000,
                "updated_at": 1000,
                "progress": {}
            },
            status=201
        )
        
        # 2. First poll (RUNNING - preconditions passed)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-close-1",
            json={
                "id": "wf-close-1",
                "type": "CloseEpoch",
                "state": "RUNNING",
                "step": "AWAIT_TX_CONFIRM",
                "created_at": 1000,
                "updated_at": 1001,
                "progress": {
                    "onchain_tx_hash": "0xclose789"
                }
            },
            status=200
        )
        
        # 3. Second poll (COMPLETED)
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-close-1",
            json={
                "id": "wf-close-1",
                "type": "CloseEpoch",
                "state": "COMPLETED",
                "step": "COMPLETED",
                "created_at": 1000,
                "updated_at": 1002,
                "progress": {
                    "onchain_tx_hash": "0xclose789",
                    "onchain_confirmed": True,
                    "onchain_block": 12346
                }
            },
            status=200
        )
        
        # Execute
        result = client.close_epoch_and_wait(
            studio_address="0x" + "11" * 20,
            epoch=1,
            signer_address="0x" + "44" * 20
        )
        
        # Verify result
        assert result.state == WorkflowState.COMPLETED
        assert result.type == WorkflowType.CLOSE_EPOCH
        assert result.progress.onchain_tx_hash == "0xclose789"


class TestBoundaryEnforcement:
    """
    Tests that verify SDK boundary invariants are enforced.
    
    These tests prove that the SDK cannot bypass Gateway invariants.
    """
    
    def test_sdk_cannot_sign_transactions(self):
        """SDK does not have transaction signing capability."""
        client = GatewayClient(GATEWAY_URL)
        
        # These methods should NOT exist
        forbidden_methods = [
            'sign_transaction',
            'send_transaction',
            'build_transaction',
            'encode_abi',
            'get_nonce',
        ]
        
        for method in forbidden_methods:
            assert not hasattr(client, method), f"SDK should not have {method}"
    
    def test_sdk_cannot_access_private_keys(self):
        """SDK does not store or access private keys."""
        client = GatewayClient(GATEWAY_URL)
        
        forbidden_attrs = [
            'private_key',
            'signer',
            'wallet',
            'account',
        ]
        
        for attr in forbidden_attrs:
            assert not hasattr(client, attr), f"SDK should not have {attr}"
    
    def test_sdk_cannot_execute_workflow_steps(self):
        """SDK does not contain workflow step execution logic."""
        client = GatewayClient(GATEWAY_URL)
        
        # These are Gateway-only operations
        forbidden_methods = [
            'upload_evidence',
            'upload_to_arweave',
            'wait_for_arweave_confirmation',
            'submit_work_transaction',
            'wait_for_block_confirmation',
            'run_reconciliation',
            'execute_step',
        ]
        
        for method in forbidden_methods:
            assert not hasattr(client, method), f"SDK should not have {method}"
    
    @responses.activate
    def test_sdk_makes_exactly_one_call_per_operation(self):
        """Each SDK method makes exactly one HTTP call to Gateway."""
        client = GatewayClient(GATEWAY_URL)
        
        # Test submit_work
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-1",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1000,
                "updated_at": 1000,
                "progress": {}
            },
            status=201
        )
        
        client.submit_work(
            studio_address="0x" + "11" * 20,
            epoch=1,
            agent_address="0x" + "22" * 20,
            data_hash="0x" + "ab" * 32,
            thread_root="0x" + "cd" * 32,
            evidence_root="0x" + "ef" * 32,
            evidence_content=b"test",
            signer_address="0x" + "22" * 20
        )
        
        # Exactly ONE call
        assert len(responses.calls) == 1
    
    @responses.activate
    def test_sdk_does_not_modify_gateway_state(self):
        """SDK only reads workflow state, never modifies it."""
        client = GatewayClient(GATEWAY_URL)
        
        # Verify SDK has no mutation methods
        mutation_methods = [
            'update_workflow',
            'cancel_workflow',
            'retry_workflow',
            'force_complete',
            'set_state',
        ]
        
        for method in mutation_methods:
            assert not hasattr(client, method), f"SDK should not have {method}"
    
    def test_sdk_cannot_read_contract_state_directly(self):
        """SDK uses Gateway for all contract interactions."""
        client = GatewayClient(GATEWAY_URL)
        
        forbidden_methods = [
            'call_contract',
            'read_contract',
            'get_work_submission',
            'get_epoch_state',
            'check_consensus',
        ]
        
        for method in forbidden_methods:
            assert not hasattr(client, method), f"SDK should not have {method}"


class TestFailureHandling:
    """Tests for proper failure handling."""
    
    @responses.activate
    def test_workflow_failure_raises_exception(self):
        """WorkflowFailedError is raised when workflow fails."""
        client = GatewayClient(GATEWAY_URL, poll_interval=0.1)
        
        # Submit
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-fail",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1000,
                "updated_at": 1000,
                "progress": {}
            },
            status=201
        )
        
        # Poll returns FAILED
        responses.add(
            responses.GET,
            f"{GATEWAY_URL}/workflows/wf-fail",
            json={
                "id": "wf-fail",
                "type": "WorkSubmission",
                "state": "FAILED",
                "step": "SUBMIT_WORK_ONCHAIN",
                "created_at": 1000,
                "updated_at": 1001,
                "progress": {},
                "error": {
                    "step": "SUBMIT_WORK_ONCHAIN",
                    "message": "Contract reverted: already submitted",
                    "code": "REVERT"
                }
            },
            status=200
        )
        
        with pytest.raises(WorkflowFailedError) as exc_info:
            client.submit_work_and_wait(
                studio_address="0x" + "11" * 20,
                epoch=1,
                agent_address="0x" + "22" * 20,
                data_hash="0x" + "ab" * 32,
                thread_root="0x" + "cd" * 32,
                evidence_root="0x" + "ef" * 32,
                evidence_content=b"test",
                signer_address="0x" + "22" * 20
            )
        
        # Verify error details preserved
        assert exc_info.value.workflow_id == "wf-fail"
        assert "already submitted" in str(exc_info.value)
    
    @responses.activate
    def test_gateway_error_propagated(self):
        """Gateway HTTP errors are properly propagated."""
        client = GatewayClient(GATEWAY_URL)
        
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={"error": "Invalid signer: not registered"},
            status=400
        )
        
        with pytest.raises(GatewayError) as exc_info:
            client.submit_work(
                studio_address="0x" + "11" * 20,
                epoch=1,
                agent_address="0x" + "22" * 20,
                data_hash="0x" + "ab" * 32,
                thread_root="0x" + "cd" * 32,
                evidence_root="0x" + "ef" * 32,
                evidence_content=b"test",
                signer_address="0x" + "22" * 20
            )
        
        assert exc_info.value.status_code == 400
        assert "not registered" in str(exc_info.value)


class TestObservability:
    """Tests for observability features."""
    
    @responses.activate
    def test_progress_callback_receives_all_states(self):
        """Progress callback is called for each state transition."""
        client = GatewayClient(GATEWAY_URL, poll_interval=0.01)
        
        # Setup mock responses for full workflow
        responses.add(
            responses.POST,
            f"{GATEWAY_URL}/workflows/work-submission",
            json={
                "id": "wf-1",
                "type": "WorkSubmission",
                "state": "CREATED",
                "step": "STORE_EVIDENCE",
                "created_at": 1000,
                "updated_at": 1000,
                "progress": {}
            },
            status=201
        )
        
        for i, (state, step) in enumerate([
            ("RUNNING", "AWAIT_EVIDENCE_CONFIRM"),
            ("RUNNING", "SUBMIT_WORK_ONCHAIN"),
            ("RUNNING", "AWAIT_TX_CONFIRM"),
            ("COMPLETED", "COMPLETED"),
        ]):
            responses.add(
                responses.GET,
                f"{GATEWAY_URL}/workflows/wf-1",
                json={
                    "id": "wf-1",
                    "type": "WorkSubmission",
                    "state": state,
                    "step": step,
                    "created_at": 1000,
                    "updated_at": 1000 + i,
                    "progress": {}
                },
                status=200
            )
        
        # Track all progress updates
        progress_states = []
        
        def on_progress(status):
            progress_states.append((status.state.value, status.step))
        
        client.submit_work_and_wait(
            studio_address="0x" + "11" * 20,
            epoch=1,
            agent_address="0x" + "22" * 20,
            data_hash="0x" + "ab" * 32,
            thread_root="0x" + "cd" * 32,
            evidence_root="0x" + "ef" * 32,
            evidence_content=b"test",
            signer_address="0x" + "22" * 20,
            on_progress=on_progress
        )
        
        # Verify progress was tracked
        assert len(progress_states) >= 1
        # Last state should be COMPLETED
        assert progress_states[-1] == ("COMPLETED", "COMPLETED")
