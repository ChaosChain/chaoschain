"""
0G Compute provider via gRPC unified bridge.

This adapter communicates with a TypeScript/Node.js gRPC server that uses the
official 0G SDKs (@0glabs/0g-serving-broker for Compute, @0glabs/0g-ts-sdk for Storage).

gRPC Service:
- Unified server on port 50051
- Methods: Submit, Status, Result, Attestation
- Real 0G SDK integration (NO MOCKS)

Documentation:
- 0G Compute SDK: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/sdk
- 0G Storage SDK: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
- Server: sdk/sidecar-specs/typescript-server/
- Proto: sdk/sidecar-specs/zerog_bridge.proto
"""

import os
import json
import grpc
import time
from typing import Dict, Optional, Any
from rich import print as rprint

# Import generated protobuf code
try:
    from chaoschain_sdk.proto import zerog_bridge_pb2 as pb
    from chaoschain_sdk.proto import zerog_bridge_pb2_grpc as pb_grpc
    PROTO_AVAILABLE = True
except ImportError:
    PROTO_AVAILABLE = False
    pb = None
    pb_grpc = None

from .base import ComputeBackend, ComputeResult, VerificationMethod


class ZeroGComputeGRPC:
    """
    0G Compute provider via gRPC sidecar.
    
    Connects to a gRPC sidecar service that wraps 0G's Rust/Go SDK.
    The sidecar provides a gRPC API for compute operations.
    
    Features:
    - Decentralized GPU marketplace
    - Verifiable compute (TEE-ML, ZK-ML, OP-ML)
    - Cost-effective AI inference
    - Perfect for agent process integrity verification
    
    Configuration:
    - ZEROG_COMPUTE_GRPC_URL: gRPC endpoint (default: localhost:50051)
    - ZEROG_API_KEY: API key for authentication (optional)
    - ZEROG_TIMEOUT: Request timeout in seconds (default: 180)
    """
    
    def __init__(
        self,
        grpc_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: int = 180
    ):
        if not PROTO_AVAILABLE:
            rprint("[yellow]⚠️  gRPC proto files not generated. ZeroGComputeGRPC will not be functional.[/yellow]")
            rprint("[cyan]   Generate proto: cd sdk/sidecar-specs && python -m grpc_tools.protoc -I. --python_out=../chaoschain_sdk/proto --grpc_python_out=../chaoschain_sdk/proto zerog_bridge.proto[/cyan]")
            self._available = False
            return
        
        self.grpc_url = grpc_url or os.getenv('ZEROG_COMPUTE_GRPC_URL', 'localhost:50051')
        self.api_key = api_key or os.getenv('ZEROG_API_KEY')
        self.timeout = timeout
        
        # Create gRPC channel
        self.channel = grpc.insecure_channel(self.grpc_url)
        self.stub = pb_grpc.ComputeServiceStub(self.channel)
        
        # Check if sidecar is available
        self._available = False
        try:
            # Try a simple method call to test connectivity
            # Use Status method with a dummy job ID as health check
            # (since custom HealthCheck is not implemented)
            test_response = self.stub.Status(
                pb.StatusRequest(job_id="health_check_test"),
                timeout=2
            )
            # If we get any response (even an error about the job), server is up
            self._available = True
            rprint(f"[green]✅ 0G Compute gRPC service available at {self.grpc_url}[/green]")
        except grpc.RpcError as e:
            # Check if it's just a not found error (server is up but job doesn't exist)
            if e.code() in [grpc.StatusCode.NOT_FOUND, grpc.StatusCode.INVALID_ARGUMENT]:
                self._available = True
                rprint(f"[green]✅ 0G Compute gRPC service available at {self.grpc_url}[/green]")
            else:
                rprint(f"[yellow]⚠️  0G Compute gRPC service not available: {e.code()}[/yellow]")
                rprint(f"[cyan]📘 Start sidecar: cd sdk/sidecar-specs/server && make run[/cyan]")
                rprint(f"[cyan]📘 Or set ZEROG_COMPUTE_GRPC_URL to your sidecar endpoint[/cyan]")
    
    @property
    def provider_name(self) -> str:
        return "0g"
    
    @property
    def is_available(self) -> bool:
        return self._available
    
    def _get_metadata(self, idempotency_key: Optional[str] = None) -> list:
        """Build gRPC metadata with auth and idempotency."""
        metadata = []
        
        if self.api_key:
            metadata.append(('authorization', f'Bearer {self.api_key}'))
        
        if idempotency_key:
            metadata.append(('idempotency-key', idempotency_key))
        
        return metadata
    
    def _convert_verification_method(self, method: VerificationMethod):
        """Convert SDK VerificationMethod to protobuf enum."""
        if not PROTO_AVAILABLE or pb is None:
            return None
        mapping = {
            VerificationMethod.NONE: pb.VERIFICATION_METHOD_NONE,
            VerificationMethod.TEE_ML: pb.VERIFICATION_METHOD_TEE_ML,
            VerificationMethod.ZK_ML: pb.VERIFICATION_METHOD_ZK_ML,
            VerificationMethod.OP_ML: pb.VERIFICATION_METHOD_OP_ML,
        }
        return mapping.get(method, pb.VERIFICATION_METHOD_UNSPECIFIED)
    
    def _convert_pb_verification_method(self, pb_method: int) -> VerificationMethod:
        """Convert protobuf enum to SDK VerificationMethod."""
        if not PROTO_AVAILABLE or pb is None:
            return VerificationMethod.NONE
        mapping = {
            pb.VERIFICATION_METHOD_NONE: VerificationMethod.NONE,
            pb.VERIFICATION_METHOD_TEE_ML: VerificationMethod.TEE_ML,
            pb.VERIFICATION_METHOD_ZK_ML: VerificationMethod.ZK_ML,
            pb.VERIFICATION_METHOD_OP_ML: VerificationMethod.OP_ML,
        }
        return mapping.get(pb_method, VerificationMethod.NONE)
    
    def submit(
        self,
        task: Dict[str, Any],
        verification: VerificationMethod = VerificationMethod.NONE,
        idempotency_key: Optional[str] = None
    ) -> str:
        """
        Submit a compute task to 0G Compute Network via gRPC.
        
        Args:
            task: Task specification dict (e.g., {"model": "llama2", "prompt": "..."})
            verification: Desired verification method
            idempotency_key: Optional key for safe retries
        
        Returns:
            Job ID for tracking the task
        
        Raises:
            Exception: If submission fails
        """
        if not self._available:
            raise Exception("0G Compute gRPC service not available")
        
        try:
            # Convert task dict to JSON
            task_json = json.dumps(task)
            
            # Build gRPC request
            request = pb.SubmitRequest(
                task_json=task_json,
                verification_method=self._convert_verification_method(verification),
                idempotency_key=idempotency_key or ""
            )
            
            rprint(f"[yellow]⚙️  Submitting compute task to 0G Compute Network...[/yellow]")
            rprint(f"[cyan]   Task: {task_json[:100]}...[/cyan]")
            rprint(f"[cyan]   Verification: {verification.value}[/cyan]")
            
            # Call gRPC service
            response = self.stub.Submit(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata(idempotency_key)
            )
            
            if not response.success:
                raise Exception(response.error or "Submission failed")
            
            rprint(f"[green]✅ Task submitted to 0G Compute: {response.job_id}[/green]")
            
            return response.job_id
            
        except grpc.RpcError as e:
            error_msg = f"gRPC error ({e.code()}): {e.details()}"
            rprint(f"[red]❌ 0G Compute submission failed: {error_msg}[/red]")
            raise Exception(error_msg)
    
    def status(self, job_id: str) -> Dict[str, Any]:
        """
        Get status of a compute job via gRPC.
        
        Args:
            job_id: Job ID to query
        
        Returns:
            Status dict with state, progress, and metadata
        
        Raises:
            Exception: If status check fails
        """
        if not self._available:
            raise Exception("0G Compute gRPC service not available")
        
        try:
            request = pb.StatusRequest(job_id=job_id)
            
            response = self.stub.Status(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata()
            )
            
            if not response.success:
                raise Exception(response.error or "Status check failed")
            
            # Convert protobuf metadata to dict
            metadata_dict = dict(response.metadata) if response.metadata else {}
            
            return {
                "state": response.state,
                "progress": response.progress,
                "metadata": metadata_dict
            }
            
        except grpc.RpcError as e:
            error_msg = f"gRPC error ({e.code()}): {e.details()}"
            rprint(f"[red]❌ Status check failed: {error_msg}[/red]")
            raise Exception(error_msg)
    
    def result(self, job_id: str) -> ComputeResult:
        """
        Get result of a completed compute job via gRPC.
        
        Args:
            job_id: Job ID to retrieve results for
        
        Returns:
            ComputeResult with output, execution hash, and proof
        
        Raises:
            Exception: If result retrieval fails
        """
        if not self._available:
            raise Exception("0G Compute gRPC service not available")
        
        try:
            request = pb.ResultRequest(job_id=job_id)
            
            rprint(f"[yellow]📥 Retrieving compute result for job: {job_id}[/yellow]")
            
            response = self.stub.Result(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata()
            )
            
            if not response.success:
                return ComputeResult(
                    success=False,
                    output=None,
                    execution_hash="",
                    provider="0G_Compute",
                    verification_method=VerificationMethod.NONE,
                    proof=None,
                    metadata=None,
                    error=response.error or "Result retrieval failed"
                )
            
            # Parse output JSON
            output = json.loads(response.output_json) if response.output_json else None
            
            # Convert protobuf metadata to dict
            metadata_dict = dict(response.metadata) if response.metadata else None
            
            # Convert verification method
            verification_method = self._convert_pb_verification_method(response.verification_method)
            
            rprint(f"[green]✅ Result retrieved from 0G Compute[/green]")
            rprint(f"[cyan]   Execution Hash: {response.execution_hash}[/cyan]")
            rprint(f"[cyan]   Verification: {verification_method.value}[/cyan]")
            if response.proof:
                rprint(f"[cyan]   Proof Size: {len(response.proof)} bytes[/cyan]")
            
            return ComputeResult(
                success=True,
                output=output,
                execution_hash=response.execution_hash,
                provider="0G_Compute",
                verification_method=verification_method,
                proof=response.proof if response.proof else None,
                metadata=metadata_dict
            )
            
        except grpc.RpcError as e:
            error_msg = f"gRPC error ({e.code()}): {e.details()}"
            rprint(f"[red]❌ Result retrieval failed: {error_msg}[/red]")
            return ComputeResult(
                success=False,
                output=None,
                execution_hash="",
                provider="0G_Compute",
                verification_method=VerificationMethod.NONE,
                proof=None,
                metadata=None,
                error=error_msg
            )
    
    def attestation(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Get attestation (verification proof) for a compute job via gRPC.
        
        Args:
            job_id: Job ID to get attestation for
        
        Returns:
            Attestation dict with proof data, or None if not available
        """
        if not self._available:
            rprint(f"[yellow]⚠️  0G Compute gRPC service not available for attestation[/yellow]")
            return None
        
        try:
            request = pb.AttestationRequest(job_id=job_id)
            
            rprint(f"[yellow]🔏 Retrieving attestation for job: {job_id}[/yellow]")
            
            response = self.stub.Attestation(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata()
            )
            
            if not response.success:
                rprint(f"[yellow]⚠️  Attestation not available: {response.error}[/yellow]")
                return None
            
            # Parse attestation JSON
            attestation_data = json.loads(response.attestation_json) if response.attestation_json else {}
            attestation_data["signature"] = response.signature
            
            rprint(f"[green]✅ Attestation retrieved[/green]")
            
            return attestation_data
            
        except grpc.RpcError as e:
            rprint(f"[yellow]⚠️  Attestation retrieval failed: {e.code()} - {e.details()}[/yellow]")
            return None
    
    def wait_for_completion(
        self,
        job_id: str,
        poll_interval: int = 5,
        max_wait: int = 300
    ) -> ComputeResult:
        """
        Wait for a compute job to complete via gRPC polling.
        
        Args:
            job_id: Job ID to wait for
            poll_interval: Seconds between status checks
            max_wait: Maximum seconds to wait
        
        Returns:
            ComputeResult when job completes
        
        Raises:
            TimeoutError: If job doesn't complete within max_wait
        """
        rprint(f"[yellow]⏳ Waiting for job {job_id} to complete...[/yellow]")
        
        start_time = time.time()
        last_progress = -1
        
        while True:
            # Check timeout
            elapsed = time.time() - start_time
            if elapsed > max_wait:
                raise TimeoutError(f"Job {job_id} did not complete within {max_wait}s")
            
            # Get status
            try:
                status = self.status(job_id)
                state = status["state"]
                progress = status.get("progress", 0)
                
                # Show progress if changed
                if progress != last_progress:
                    rprint(f"[cyan]   Progress: {progress}% ({state})[/cyan]")
                    last_progress = progress
                
                # Check if completed
                if state == "completed":
                    rprint(f"[green]✅ Job {job_id} completed![/green]")
                    return self.result(job_id)
                elif state == "failed":
                    raise Exception(f"Job {job_id} failed")
                
            except Exception as e:
                rprint(f"[yellow]⚠️  Status check error: {e}[/yellow]")
            
            # Wait before next check
            time.sleep(poll_interval)
    
    def __del__(self):
        """Clean up gRPC channel on destruction."""
        if hasattr(self, 'channel'):
            self.channel.close()
