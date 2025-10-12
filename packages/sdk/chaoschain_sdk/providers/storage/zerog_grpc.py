"""
0G Storage provider via gRPC sidecar bridge.

This adapter communicates with a gRPC sidecar service that wraps the official
0G Storage SDK (Rust/Go). The sidecar handles the heavy lifting via native SDKs.

gRPC Service:
- StorageService on port 50051
- Methods: Put, Get, Verify, Delete, HealthCheck

Documentation:
- 0G Storage: https://docs.0g.ai/concepts/storage
- Official SDK: https://github.com/0gfoundation/0g-storage-client
- Proto: sdk/sidecar-specs/zerog_bridge.proto
"""

import os
import hashlib
import grpc
from typing import Optional, Dict, Tuple
from rich import print as rprint

# Import generated protobuf code
# Note: Generate with: python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. zerog_bridge.proto
try:
    from chaoschain_sdk.proto import zerog_bridge_pb2 as pb
    from chaoschain_sdk.proto import zerog_bridge_pb2_grpc as pb_grpc
    PROTO_AVAILABLE = True
except ImportError:
    PROTO_AVAILABLE = False
    pb = None
    pb_grpc = None

from .base import StorageBackend, StorageResult


class ZeroGStorageGRPC:
    """
    0G Storage provider via gRPC sidecar.
    
    Connects to a gRPC sidecar service that wraps 0G's Rust/Go SDK.
    The sidecar provides a gRPC API for storage operations.
    
    Features:
    - 95% lower costs than AWS
    - Instant retrieval (200 MBPS)
    - Both structured (KV) and unstructured (Log) data
    - Perfect for AI datasets and agent evidence trails
    
    Configuration:
    - ZEROG_GRPC_URL: gRPC endpoint of sidecar (default: localhost:50051)
    - ZEROG_API_KEY: API key for authentication
    - ZEROG_TIMEOUT: Request timeout in seconds (default: 120)
    """
    
    def __init__(
        self,
        grpc_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: int = 120
    ):
        if not PROTO_AVAILABLE:
            rprint("[yellow]⚠️  gRPC proto files not generated. ZeroGStorageGRPC will not be functional.[/yellow]")
            rprint("[cyan]   Generate proto: cd sdk/sidecar-specs && python -m grpc_tools.protoc -I. --python_out=../chaoschain_sdk/proto --grpc_python_out=../chaoschain_sdk/proto zerog_bridge.proto[/cyan]")
            self._available = False
            return
        
        self.grpc_url = grpc_url or os.getenv('ZEROG_GRPC_URL', 'localhost:50051')
        self.api_key = api_key or os.getenv('ZEROG_API_KEY')
        self.timeout = timeout
        
        # Create gRPC channel
        self.channel = grpc.insecure_channel(self.grpc_url)
        self.stub = pb_grpc.StorageServiceStub(self.channel)
        
        # Check if sidecar is available
        self._available = False
        try:
            health_response = self.stub.HealthCheck(
                pb.HealthCheckRequest(),
                timeout=2
            )
            if health_response.status == pb.HealthCheckResponse.STATUS_HEALTHY:
                self._available = True
                rprint(f"[green]✅ 0G Storage gRPC service available at {self.grpc_url}[/green]")
                rprint(f"[cyan]   Status: {health_response.message}[/cyan]")
                if health_response.metrics:
                    rprint(f"[cyan]   Version: {health_response.metrics.get('version', 'unknown')}[/cyan]")
            else:
                rprint(f"[yellow]⚠️  0G Storage gRPC service unhealthy: {health_response.message}[/yellow]")
        except grpc.RpcError as e:
            rprint(f"[yellow]⚠️  0G Storage gRPC service not available: {e.code()}[/yellow]")
            rprint(f"[cyan]📘 Start sidecar: cd sdk/sidecar-specs/server && make run[/cyan]")
            rprint(f"[cyan]📘 Or set ZEROG_GRPC_URL to your sidecar endpoint[/cyan]")
    
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
    
    def _compute_hash(self, data: bytes) -> str:
        """Compute KECCAK-256 hash for ERC-8004 compatibility."""
        return '0x' + hashlib.sha3_256(data).hexdigest()
    
    def put(
        self,
        blob: bytes,
        *,
        mime: Optional[str] = None,
        tags: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None
    ) -> StorageResult:
        """
        Upload data to 0G Storage via gRPC.
        
        Args:
            blob: Data to store (binary)
            mime: Optional MIME type
            tags: Optional metadata tags
            idempotency_key: Optional key for safe retries
        
        Returns:
            StorageResult with URI, hash, and metadata
        """
        if not self._available:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="0G_Storage",
                error="0G Storage gRPC service not available"
            )
        
        try:
            # Build gRPC request
            request = pb.PutRequest(
                data=blob,
                mime_type=mime or "",
                tags=tags or {},
                idempotency_key=idempotency_key or ""
            )
            
            # Call gRPC service
            rprint(f"[yellow]📤 Uploading {len(blob)} bytes to 0G Storage via gRPC...[/yellow]")
            
            response = self.stub.Put(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata(idempotency_key)
            )
            
            if not response.success:
                return StorageResult(
                    success=False,
                    uri="",
                    hash="",
                    provider="0G_Storage",
                    error=response.error or "Upload failed"
                )
            
            rprint(f"[green]✅ Uploaded to 0G Storage: {response.uri}[/green]")
            rprint(f"[cyan]   Root Hash: {response.root_hash}[/cyan]")
            rprint(f"[cyan]   TX Hash: {response.tx_hash}[/cyan]")
            
            # Convert protobuf metadata to dict
            metadata_dict = dict(response.metadata)
            
            return StorageResult(
                success=True,
                uri=response.uri,
                hash=response.data_hash,
                provider=response.provider,
                metadata={
                    "root_hash": response.root_hash,
                    "tx_hash": response.tx_hash,
                    **metadata_dict
                }
            )
            
        except grpc.RpcError as e:
            error_msg = f"gRPC error ({e.code()}): {e.details()}"
            rprint(f"[red]❌ 0G Storage upload failed: {error_msg}[/red]")
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="0G_Storage",
                error=error_msg
            )
        except Exception as e:
            error_msg = f"Unexpected error: {str(e)}"
            rprint(f"[red]❌ 0G Storage upload failed: {error_msg}[/red]")
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="0G_Storage",
                error=error_msg
            )
    
    def get(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from 0G Storage via gRPC.
        
        Args:
            uri: URI of the data to retrieve (e.g., "0g://object/abc123")
        
        Returns:
            Tuple of (data bytes, metadata dict)
        
        Raises:
            Exception: If retrieval fails
        """
        if not self._available:
            raise Exception("0G Storage gRPC service not available")
        
        try:
            request = pb.GetRequest(uri=uri)
            
            rprint(f"[yellow]📥 Retrieving from 0G Storage: {uri}[/yellow]")
            
            response = self.stub.Get(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata()
            )
            
            if not response.success:
                raise Exception(response.error or "Retrieval failed")
            
            rprint(f"[green]✅ Retrieved {len(response.data)} bytes from 0G Storage[/green]")
            
            # Convert protobuf metadata to dict
            metadata_dict = dict(response.metadata) if response.metadata else None
            
            return response.data, metadata_dict
            
        except grpc.RpcError as e:
            error_msg = f"gRPC error ({e.code()}): {e.details()}"
            rprint(f"[red]❌ 0G Storage retrieval failed: {error_msg}[/red]")
            raise Exception(error_msg)
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """
        Verify data integrity in 0G Storage via gRPC.
        
        Args:
            uri: URI of the data to verify
            expected_hash: Expected KECCAK-256 hash
        
        Returns:
            True if data matches expected hash, False otherwise
        """
        if not self._available:
            rprint(f"[yellow]⚠️  0G Storage gRPC service not available for verification[/yellow]")
            return False
        
        try:
            request = pb.VerifyRequest(
                uri=uri,
                expected_hash=expected_hash
            )
            
            rprint(f"[yellow]🔍 Verifying data integrity in 0G Storage...[/yellow]")
            
            response = self.stub.Verify(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata()
            )
            
            if response.is_valid:
                rprint(f"[green]✅ Data integrity verified (hash: {response.actual_hash})[/green]")
            else:
                rprint(f"[red]❌ Data integrity check failed[/red]")
                rprint(f"[red]   Expected: {expected_hash}[/red]")
                rprint(f"[red]   Actual: {response.actual_hash}[/red]")
            
            return response.is_valid
            
        except grpc.RpcError as e:
            rprint(f"[red]❌ Verification failed: {e.code()} - {e.details()}[/red]")
            return False
    
    def delete(self, uri: str, idempotency_key: Optional[str] = None) -> bool:
        """
        Delete data from 0G Storage via gRPC.
        
        Args:
            uri: URI of the data to delete
            idempotency_key: Optional key for safe retries
        
        Returns:
            True if deletion succeeded, False otherwise
        """
        if not self._available:
            rprint(f"[yellow]⚠️  0G Storage gRPC service not available for deletion[/yellow]")
            return False
        
        try:
            request = pb.DeleteRequest(
                uri=uri,
                idempotency_key=idempotency_key or ""
            )
            
            rprint(f"[yellow]🗑️  Deleting from 0G Storage: {uri}[/yellow]")
            
            response = self.stub.Delete(
                request,
                timeout=self.timeout,
                metadata=self._get_metadata(idempotency_key)
            )
            
            if response.success:
                rprint(f"[green]✅ Deleted from 0G Storage: {uri}[/green]")
            else:
                rprint(f"[red]❌ Deletion failed: {response.error}[/red]")
            
            return response.success
            
        except grpc.RpcError as e:
            rprint(f"[red]❌ Deletion failed: {e.code()} - {e.details()}[/red]")
            return False
    
    def __del__(self):
        """Clean up gRPC channel on destruction."""
        if hasattr(self, 'channel'):
            self.channel.close()
