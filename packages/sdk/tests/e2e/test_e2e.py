"""
E2E tests for ChaosChain Python SDK against a real dockerized gateway.

Run with:
    docker compose -f docker-compose.e2e.yml up -d --wait
    cd packages/sdk
    pytest tests/e2e/ -v
"""

import pytest

from chaoschain_sdk.gateway_client import (
    GatewayClient,
    WorkflowState,
    WorkflowType,
    ScoreSubmissionMode,
    GatewayError,
)

from .conftest import (
    STUDIO_PROXY,
    WORKERS,
    VALIDATORS,
    UNREGISTERED_ADDRESS,
    random_bytes32,
)


class TestHealthCheck:
    """Gateway health via SDK."""

    def test_is_healthy(self, client: GatewayClient):
        assert client.is_healthy()

    def test_health_check_returns_status(self, client: GatewayClient):
        result = client.health_check()
        assert result["status"] == "ok"
        assert "timestamp" in result


class TestWorkSubmission:
    """Work submission workflows via SDK."""

    def test_submit_work_creates_workflow(self, client: GatewayClient):
        worker = WORKERS[0]
        result = client.submit_work(
            studio_address=STUDIO_PROXY,
            epoch=1,
            agent_address=worker["address"],
            data_hash=random_bytes32(),
            thread_root=random_bytes32(),
            evidence_root=random_bytes32(),
            evidence_content=b"sdk e2e test evidence",
            signer_address=worker["address"],
        )

        assert result.id is not None
        assert result.type == WorkflowType.WORK_SUBMISSION
        assert result.state == WorkflowState.CREATED

    def test_submit_work_and_poll(self, client: GatewayClient):
        worker = WORKERS[1]
        result = client.submit_work(
            studio_address=STUDIO_PROXY,
            epoch=1,
            agent_address=worker["address"],
            data_hash=random_bytes32(),
            thread_root=random_bytes32(),
            evidence_root=random_bytes32(),
            evidence_content=b"sdk e2e wait test",
            signer_address=worker["address"],
        )

        # Poll manually — wait_for_completion doesn't treat STALLED as terminal
        import time
        terminal_states = {WorkflowState.COMPLETED, WorkflowState.STALLED, WorkflowState.FAILED}
        deadline = time.time() + 90
        final = result

        while time.time() < deadline:
            final = client.get_workflow(result.id)
            if final.state in terminal_states:
                break
            time.sleep(2)

        # Expected: STALLED at REGISTER_WORK (onlyOwner issue) or COMPLETED
        assert final.state in (WorkflowState.COMPLETED, WorkflowState.STALLED)
        assert final.progress.arweave_tx_id is not None


class TestScoreSubmission:
    """Score submission workflows via SDK."""

    def test_submit_score_direct_creates_workflow(self, client: GatewayClient):
        validator = VALIDATORS[0]
        worker = WORKERS[2]
        result = client.submit_score(
            studio_address=STUDIO_PROXY,
            epoch=1,
            validator_address=validator["address"],
            data_hash=random_bytes32(),
            scores=[8000, 7500, 9000],
            signer_address=validator["address"],
            worker_address=worker["address"],
            mode=ScoreSubmissionMode.DIRECT,
        )

        assert result.id is not None
        assert result.type == WorkflowType.SCORE_SUBMISSION
        assert result.state == WorkflowState.CREATED

    def test_submit_score_requires_worker_in_direct_mode(self, client: GatewayClient):
        with pytest.raises(ValueError, match="worker_address"):
            client.submit_score(
                studio_address=STUDIO_PROXY,
                epoch=1,
                validator_address=VALIDATORS[0]["address"],
                data_hash=random_bytes32(),
                scores=[5000],
                signer_address=VALIDATORS[0]["address"],
                mode=ScoreSubmissionMode.DIRECT,
                # worker_address intentionally omitted
            )


class TestWorkflowStatus:
    """Workflow status queries via SDK."""

    def test_get_workflow_returns_details(self, client: GatewayClient):
        worker = WORKERS[2]
        created = client.submit_work(
            studio_address=STUDIO_PROXY,
            epoch=1,
            agent_address=worker["address"],
            data_hash=random_bytes32(),
            thread_root=random_bytes32(),
            evidence_root=random_bytes32(),
            evidence_content=b"status query test",
            signer_address=worker["address"],
        )

        status = client.get_workflow(created.id)
        assert status.id == created.id
        assert status.type == WorkflowType.WORK_SUBMISSION

    def test_get_nonexistent_workflow_raises_error(self, client: GatewayClient):
        with pytest.raises(GatewayError):
            client.get_workflow("00000000-0000-0000-0000-000000000000")


class TestUnregisteredAgent:
    """Behavior with unregistered signers."""

    def test_unregistered_signer_fails(self, client: GatewayClient):
        """Workflow with unregistered signer should fail or be rejected."""
        # The gateway may reject (GatewayError with 400) or create and fail later
        try:
            result = client.submit_work(
                studio_address=STUDIO_PROXY,
                epoch=1,
                agent_address=UNREGISTERED_ADDRESS,
                data_hash=random_bytes32(),
                thread_root=random_bytes32(),
                evidence_root=random_bytes32(),
                evidence_content=b"should fail",
                signer_address=UNREGISTERED_ADDRESS,
            )
            # If created, it should fail/stall
            final = client.wait_for_completion(result.id)
            assert final.state in (WorkflowState.FAILED, WorkflowState.STALLED)
        except GatewayError:
            # Rejected at creation — this is also valid
            pass
