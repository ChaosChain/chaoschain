"""
Gateway Client for ChaosChain SDK

This module provides the HTTP client for communicating with the ChaosChain Gateway.

BOUNDARY INVARIANTS (NON-NEGOTIABLE):
1. SDK does NOT contain workflow logic
2. SDK does NOT submit transactions directly
3. SDK only prepares inputs, calls Gateway, and polls status
4. All execution happens in Gateway

The Gateway is the ONLY transaction submitter.
The SDK is a thin client that prepares data and polls for results.
"""

import time
import base64
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

import requests


class WorkflowType(Enum):
    """Workflow types supported by Gateway."""
    WORK_SUBMISSION = "WorkSubmission"
    SCORE_SUBMISSION = "ScoreSubmission"
    CLOSE_EPOCH = "CloseEpoch"


class WorkflowState(Enum):
    """Workflow states."""
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    STALLED = "STALLED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ScoreSubmissionMode(Enum):
    """
    Score submission modes supported by Gateway.
    
    - DIRECT: Simple direct scoring via submitScoreVectorForWorker (default, MVP)
    - COMMIT_REVEAL: Commit-reveal pattern (prevents last-mover bias, time-windowed)
    """
    DIRECT = "direct"
    COMMIT_REVEAL = "commit_reveal"


@dataclass
class WorkflowProgress:
    """Progress data for a workflow."""
    arweave_tx_id: Optional[str] = None
    arweave_confirmed: Optional[bool] = None
    onchain_tx_hash: Optional[str] = None
    onchain_confirmed: Optional[bool] = None
    onchain_block: Optional[int] = None
    # Direct mode (score submission)
    score_tx_hash: Optional[str] = None
    # Commit-reveal mode (score submission)
    commit_tx_hash: Optional[str] = None
    reveal_tx_hash: Optional[str] = None


@dataclass
class WorkflowError:
    """Error information for a failed workflow."""
    step: str
    message: str
    code: Optional[str] = None


@dataclass
class WorkflowStatus:
    """Status of a workflow."""
    id: str
    type: WorkflowType
    state: WorkflowState
    step: str
    created_at: int
    updated_at: int
    progress: WorkflowProgress
    error: Optional[WorkflowError] = None


class GatewayError(Exception):
    """Error from Gateway API."""
    def __init__(self, message: str, status_code: Optional[int] = None, response: Optional[Dict] = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class GatewayConnectionError(GatewayError):
    """Failed to connect to Gateway."""
    pass


class GatewayTimeoutError(GatewayError):
    """Gateway request timed out."""
    pass


class WorkflowFailedError(GatewayError):
    """Workflow reached FAILED state."""
    def __init__(self, workflow_id: str, error: WorkflowError):
        super().__init__(f"Workflow {workflow_id} failed at step {error.step}: {error.message}")
        self.workflow_id = workflow_id
        self.error = error


class GatewayClient:
    """
    HTTP client for ChaosChain Gateway.
    
    This client provides a thin wrapper around the Gateway HTTP API.
    It does NOT contain any workflow logic — all execution happens in Gateway.
    
    Usage:
        ```python
        client = GatewayClient("http://localhost:3000")
        
        # Submit work via Gateway
        workflow = client.submit_work(
            studio_address="0x...",
            epoch=1,
            agent_address="0x...",
            data_hash="0x...",
            thread_root="0x...",
            evidence_root="0x...",
            evidence_content=b"...",
            signer_address="0x..."
        )
        
        # Poll for completion
        result = client.wait_for_completion(workflow.id)
        ```
    """
    
    def __init__(
        self,
        gateway_url: str,
        timeout: int = 30,
        max_poll_time: int = 300,
        poll_interval: int = 2
    ):
        """
        Initialize Gateway client.
        
        Args:
            gateway_url: Base URL of the Gateway (e.g., "http://localhost:3000")
            timeout: Request timeout in seconds
            max_poll_time: Maximum time to wait for workflow completion (seconds)
            poll_interval: Interval between status polls (seconds)
        """
        self.gateway_url = gateway_url.rstrip('/')
        self.timeout = timeout
        self.max_poll_time = max_poll_time
        self.poll_interval = poll_interval
    
    def _request(
        self,
        method: str,
        path: str,
        json: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make HTTP request to Gateway."""
        url = f"{self.gateway_url}{path}"
        
        try:
            response = requests.request(
                method=method,
                url=url,
                json=json,
                timeout=self.timeout
            )
        except requests.exceptions.ConnectionError as e:
            raise GatewayConnectionError(f"Failed to connect to Gateway at {url}: {e}")
        except requests.exceptions.Timeout as e:
            raise GatewayTimeoutError(f"Request to Gateway timed out: {e}")
        except requests.exceptions.RequestException as e:
            raise GatewayError(f"Gateway request failed: {e}")
        
        if response.status_code >= 400:
            try:
                error_data = response.json()
                error_message = error_data.get('error', 'Unknown error')
            except Exception:
                error_message = response.text or 'Unknown error'
            raise GatewayError(
                f"Gateway returned error: {error_message}",
                status_code=response.status_code,
                response=error_data if 'error_data' in dir() else None
            )
        
        return response.json()
    
    def _parse_workflow_status(self, data: Dict) -> WorkflowStatus:
        """Parse workflow status from API response."""
        progress_data = data.get('progress', {})
        progress = WorkflowProgress(
            arweave_tx_id=progress_data.get('arweave_tx_id'),
            arweave_confirmed=progress_data.get('arweave_confirmed'),
            onchain_tx_hash=progress_data.get('onchain_tx_hash'),
            onchain_confirmed=progress_data.get('onchain_confirmed'),
            onchain_block=progress_data.get('onchain_block'),
            score_tx_hash=progress_data.get('score_tx_hash'),
            commit_tx_hash=progress_data.get('commit_tx_hash'),
            reveal_tx_hash=progress_data.get('reveal_tx_hash'),
        )
        
        error = None
        if data.get('error'):
            error_data = data['error']
            error = WorkflowError(
                step=error_data.get('step', ''),
                message=error_data.get('message', ''),
                code=error_data.get('code'),
            )
        
        return WorkflowStatus(
            id=data['id'],
            type=WorkflowType(data['type']),
            state=WorkflowState(data['state']),
            step=data['step'],
            created_at=data['created_at'],
            updated_at=data['updated_at'],
            progress=progress,
            error=error,
        )
    
    # =========================================================================
    # Health Check
    # =========================================================================
    
    def health_check(self) -> Dict[str, Any]:
        """
        Check Gateway health.
        
        Returns:
            Health status with timestamp
        """
        return self._request('GET', '/health')
    
    def is_healthy(self) -> bool:
        """
        Check if Gateway is healthy.
        
        Returns:
            True if Gateway is responding
        """
        try:
            result = self.health_check()
            return result.get('status') == 'ok'
        except GatewayError:
            return False
    
    # =========================================================================
    # Workflow Creation
    # =========================================================================
    
    def submit_work(
        self,
        studio_address: str,
        epoch: int,
        agent_address: str,
        data_hash: str,
        thread_root: str,
        evidence_root: str,
        evidence_content: bytes,
        signer_address: str
    ) -> WorkflowStatus:
        """
        Create a work submission workflow.
        
        SDK prepares inputs; Gateway handles:
        - Evidence upload to Arweave
        - Transaction submission
        - Confirmation waiting
        
        Args:
            studio_address: Ethereum address of the studio
            epoch: Epoch number
            agent_address: Ethereum address of the submitting agent
            data_hash: Bytes32 hash of the work (as hex string)
            thread_root: Bytes32 DKG thread root (as hex string)
            evidence_root: Bytes32 evidence Merkle root (as hex string)
            evidence_content: Raw evidence bytes (will be base64 encoded)
            signer_address: Ethereum address of the signer (must be registered in Gateway)
        
        Returns:
            WorkflowStatus with workflow ID for polling
        """
        # SDK only prepares data — no execution logic here
        payload = {
            "studio_address": studio_address,
            "epoch": epoch,
            "agent_address": agent_address,
            "data_hash": data_hash,
            "thread_root": thread_root,
            "evidence_root": evidence_root,
            "evidence_content": base64.b64encode(evidence_content).decode('utf-8'),
            "signer_address": signer_address
        }
        
        result = self._request('POST', '/workflows/work-submission', json=payload)
        return self._parse_workflow_status(result)
    
    def submit_score(
        self,
        studio_address: str,
        epoch: int,
        validator_address: str,
        data_hash: str,
        scores: List[int],
        signer_address: str,
        worker_address: Optional[str] = None,
        salt: Optional[str] = None,
        mode: ScoreSubmissionMode = ScoreSubmissionMode.DIRECT
    ) -> WorkflowStatus:
        """
        Create a score submission workflow.
        
        Supports two modes:
        - DIRECT (default): Simple direct scoring, requires worker_address
        - COMMIT_REVEAL: Commit-reveal pattern, requires salt
        
        SDK prepares inputs; Gateway handles all execution.
        
        Args:
            studio_address: Ethereum address of the studio
            epoch: Epoch number
            validator_address: Ethereum address of the validator
            data_hash: Bytes32 hash of the work being scored (as hex string)
            scores: Array of dimension scores (0-10000 basis points)
            signer_address: Ethereum address of the signer
            worker_address: Ethereum address of the worker being scored (required for DIRECT mode)
            salt: Bytes32 random salt for commit-reveal (as hex string, required for COMMIT_REVEAL mode)
            mode: ScoreSubmissionMode - DIRECT (default) or COMMIT_REVEAL
        
        Returns:
            WorkflowStatus with workflow ID for polling
        
        Raises:
            ValueError: If required parameters are missing for the chosen mode
        """
        # Validate mode-specific requirements
        if mode == ScoreSubmissionMode.DIRECT:
            if not worker_address:
                raise ValueError("worker_address is required for DIRECT scoring mode")
        elif mode == ScoreSubmissionMode.COMMIT_REVEAL:
            if not salt:
                raise ValueError("salt is required for COMMIT_REVEAL scoring mode")
        
        payload = {
            "studio_address": studio_address,
            "epoch": epoch,
            "validator_address": validator_address,
            "data_hash": data_hash,
            "scores": scores,
            "signer_address": signer_address,
            "mode": mode.value
        }
        
        # Add mode-specific fields
        if worker_address:
            payload["worker_address"] = worker_address
        if salt:
            payload["salt"] = salt
        else:
            # Gateway requires salt field (even if unused in direct mode)
            payload["salt"] = "0x" + "0" * 64
        
        result = self._request('POST', '/workflows/score-submission', json=payload)
        return self._parse_workflow_status(result)
    
    def close_epoch(
        self,
        studio_address: str,
        epoch: int,
        signer_address: str
    ) -> WorkflowStatus:
        """
        Create a close epoch workflow.
        
        SDK prepares inputs; Gateway handles:
        - Precondition checks (structural only)
        - closeEpoch transaction
        - Confirmation waiting
        
        This is economically final — cannot be undone.
        
        Args:
            studio_address: Ethereum address of the studio
            epoch: Epoch number to close
            signer_address: Ethereum address of the signer
        
        Returns:
            WorkflowStatus with workflow ID for polling
        """
        payload = {
            "studio_address": studio_address,
            "epoch": epoch,
            "signer_address": signer_address
        }
        
        result = self._request('POST', '/workflows/close-epoch', json=payload)
        return self._parse_workflow_status(result)
    
    # =========================================================================
    # Workflow Status
    # =========================================================================
    
    def get_workflow(self, workflow_id: str) -> WorkflowStatus:
        """
        Get workflow status by ID.
        
        Args:
            workflow_id: UUID of the workflow
        
        Returns:
            Current workflow status
        """
        result = self._request('GET', f'/workflows/{workflow_id}')
        return self._parse_workflow_status(result)
    
    def list_workflows(
        self,
        studio: Optional[str] = None,
        state: Optional[str] = None,
        workflow_type: Optional[str] = None
    ) -> List[WorkflowStatus]:
        """
        List workflows with optional filters.
        
        Args:
            studio: Filter by studio address
            state: Filter by state ('active' for RUNNING+STALLED)
            workflow_type: Filter by type (requires state parameter)
        
        Returns:
            List of workflow statuses
        """
        params = []
        if studio:
            params.append(f"studio={studio}")
        if state:
            params.append(f"state={state}")
        if workflow_type:
            params.append(f"type={workflow_type}")
        
        query = '?' + '&'.join(params) if params else ''
        result = self._request('GET', f'/workflows{query}')
        
        return [self._parse_workflow_status(w) for w in result.get('workflows', [])]
    
    # =========================================================================
    # Polling and Waiting
    # =========================================================================
    
    def wait_for_completion(
        self,
        workflow_id: str,
        max_wait: Optional[int] = None,
        poll_interval: Optional[int] = None,
        on_progress: Optional[callable] = None
    ) -> WorkflowStatus:
        """
        Poll workflow until it reaches a terminal state.
        
        Args:
            workflow_id: UUID of the workflow
            max_wait: Maximum time to wait (seconds), defaults to max_poll_time
            poll_interval: Interval between polls (seconds)
            on_progress: Optional callback called on each poll with WorkflowStatus
        
        Returns:
            Final workflow status
        
        Raises:
            WorkflowFailedError: If workflow reaches FAILED state
            GatewayTimeoutError: If max_wait exceeded
        """
        max_wait = max_wait or self.max_poll_time
        poll_interval = poll_interval or self.poll_interval
        
        start_time = time.time()
        
        while True:
            status = self.get_workflow(workflow_id)
            
            if on_progress:
                on_progress(status)
            
            # Terminal states
            if status.state == WorkflowState.COMPLETED:
                return status
            
            if status.state == WorkflowState.FAILED:
                raise WorkflowFailedError(workflow_id, status.error)
            
            # Check timeout
            elapsed = time.time() - start_time
            if elapsed >= max_wait:
                raise GatewayTimeoutError(
                    f"Workflow {workflow_id} did not complete within {max_wait}s. "
                    f"Current state: {status.state.value}, step: {status.step}"
                )
            
            time.sleep(poll_interval)
    
    def submit_work_and_wait(
        self,
        studio_address: str,
        epoch: int,
        agent_address: str,
        data_hash: str,
        thread_root: str,
        evidence_root: str,
        evidence_content: bytes,
        signer_address: str,
        on_progress: Optional[callable] = None
    ) -> WorkflowStatus:
        """
        Submit work and wait for completion.
        
        Convenience method that combines submit_work() and wait_for_completion().
        
        Returns:
            Final workflow status (COMPLETED)
        
        Raises:
            WorkflowFailedError: If workflow fails
            GatewayTimeoutError: If timeout exceeded
        """
        workflow = self.submit_work(
            studio_address=studio_address,
            epoch=epoch,
            agent_address=agent_address,
            data_hash=data_hash,
            thread_root=thread_root,
            evidence_root=evidence_root,
            evidence_content=evidence_content,
            signer_address=signer_address
        )
        
        return self.wait_for_completion(workflow.id, on_progress=on_progress)
    
    def submit_score_and_wait(
        self,
        studio_address: str,
        epoch: int,
        validator_address: str,
        data_hash: str,
        scores: List[int],
        signer_address: str,
        worker_address: Optional[str] = None,
        salt: Optional[str] = None,
        mode: ScoreSubmissionMode = ScoreSubmissionMode.DIRECT,
        on_progress: Optional[callable] = None
    ) -> WorkflowStatus:
        """
        Submit score and wait for completion.
        
        Convenience method that combines submit_score() and wait_for_completion().
        
        Args:
            studio_address: Ethereum address of the studio
            epoch: Epoch number
            validator_address: Ethereum address of the validator
            data_hash: Bytes32 hash of the work being scored (as hex string)
            scores: Array of dimension scores (0-10000 basis points)
            signer_address: Ethereum address of the signer
            worker_address: Ethereum address of the worker being scored (required for DIRECT mode)
            salt: Bytes32 random salt for commit-reveal (as hex string, required for COMMIT_REVEAL mode)
            mode: ScoreSubmissionMode - DIRECT (default) or COMMIT_REVEAL
            on_progress: Optional callback called on each poll with WorkflowStatus
        
        Returns:
            Final workflow status (COMPLETED)
        
        Raises:
            WorkflowFailedError: If workflow fails
            GatewayTimeoutError: If timeout exceeded
        """
        workflow = self.submit_score(
            studio_address=studio_address,
            epoch=epoch,
            validator_address=validator_address,
            data_hash=data_hash,
            scores=scores,
            signer_address=signer_address,
            worker_address=worker_address,
            salt=salt,
            mode=mode
        )
        
        return self.wait_for_completion(workflow.id, on_progress=on_progress)
    
    def close_epoch_and_wait(
        self,
        studio_address: str,
        epoch: int,
        signer_address: str,
        on_progress: Optional[callable] = None
    ) -> WorkflowStatus:
        """
        Close epoch and wait for completion.
        
        Convenience method that combines close_epoch() and wait_for_completion().
        
        Returns:
            Final workflow status (COMPLETED)
        
        Raises:
            WorkflowFailedError: If workflow fails
            GatewayTimeoutError: If timeout exceeded
        """
        workflow = self.close_epoch(
            studio_address=studio_address,
            epoch=epoch,
            signer_address=signer_address
        )
        
        return self.wait_for_completion(workflow.id, on_progress=on_progress)
