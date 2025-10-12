"""
Compute provider base protocol.

Defines the interface that all compute providers must implement.
"""

from typing import Protocol, Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum


class VerificationMethod(str, Enum):
    """Supported verification methods."""
    TEE_ML = "tee-ml"  # Trusted Execution Environment
    ZK_ML = "zk-ml"    # Zero-Knowledge Machine Learning
    OP_ML = "op-ml"    # Optimistic Machine Learning
    NONE = "none"      # No verification


@dataclass
class ComputeResult:
    """Result of a compute operation."""
    success: bool
    output: Any
    execution_hash: str
    job_id: Optional[str] = None
    proof: Optional[bytes] = None
    verification_method: VerificationMethod = VerificationMethod.NONE
    provider: str = "local"
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    attestation_url: Optional[str] = None  # URL to verification attestation


class ComputeBackend(Protocol):
    """
    Protocol for compute backends.
    
    All compute providers must implement this interface to be compatible
    with the ChaosChain SDK compute system.
    """
    
    def submit(
        self,
        task: Dict[str, Any],
        *,
        verification: VerificationMethod = VerificationMethod.NONE,
        idempotency_key: Optional[str] = None
    ) -> str:
        """
        Submit a compute task.
        
        Args:
            task: Task specification (provider-specific format)
            verification: Verification method to use
            idempotency_key: For retry safety (optional)
            
        Returns:
            Job ID for tracking
        """
        ...
    
    def status(self, job_id: str) -> Dict[str, Any]:
        """
        Check job status.
        
        Args:
            job_id: Job identifier
            
        Returns:
            Status dict with fields:
            - status: "pending" | "running" | "completed" | "failed"
            - progress: Optional progress percentage
            - metadata: Provider-specific metadata
        """
        ...
    
    def result(self, job_id: str, *, timeout: int = 300) -> ComputeResult:
        """
        Get job result (blocks until complete or timeout).
        
        Args:
            job_id: Job identifier
            timeout: Maximum seconds to wait
            
        Returns:
            ComputeResult with output and proof
        """
        ...
    
    def attestation(self, job_id: str) -> Dict[str, Any]:
        """
        Get verification attestation.
        
        Args:
            job_id: Job identifier
            
        Returns:
            Attestation dict with:
            - verified: bool
            - method: VerificationMethod
            - proof: bytes
            - signature: Optional signature
            - certificate: Optional TEE certificate
        """
        ...
    
    def cancel(self, job_id: str) -> bool:
        """
        Cancel a running job.
        
        Args:
            job_id: Job identifier
            
        Returns:
            True if cancelled successfully
        """
        ...
    
    @property
    def provider_name(self) -> str:
        """Get provider name (e.g., '0g', 'morpheus', 'chainlink-cre')."""
        ...
    
    @property
    def is_available(self) -> bool:
        """Check if provider is available and configured."""
        ...
    
    @property
    def supported_verifications(self) -> list[VerificationMethod]:
        """Get list of supported verification methods."""
        ...


