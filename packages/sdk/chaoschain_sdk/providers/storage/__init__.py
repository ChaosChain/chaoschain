"""
Storage provider adapters.

Unified storage provider system supporting multiple backends:
- IPFS (local node, Pinata, Infura, etc.)
- Irys (programmable datachain)
- 0G Storage (decentralized, high-performance)
- More providers can be easily added

All providers implement the StorageBackend Protocol for consistency.
"""

from .base import StorageBackend, StorageResult, StorageProvider, StorageConfig

# IPFS providers (always available, no extra deps)
from .ipfs_local import LocalIPFSStorage
from .ipfs_pinata import PinataStorage

# Irys provider (always available, no extra deps)
from .irys import IrysStorage

# Try to import gRPC provider (optional, requires proto generation)
try:
    from .zerog_grpc import ZeroGStorageGRPC
    _grpc_available = True
except ImportError:
    # Proto not generated yet - create a placeholder
    class ZeroGStorageGRPC:
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "gRPC proto files not available. Generate them with:\n"
                "cd sdk/sidecar-specs && pip install grpcio-tools\n"
                "python -m grpc_tools.protoc -I. --python_out=../chaoschain_sdk/proto --grpc_python_out=../chaoschain_sdk/proto zerog_bridge.proto"
            )
    _grpc_available = False

__all__ = [
    # Base Protocol & Types
    'StorageBackend',
    'StorageResult',
    'StorageProvider',
    'StorageConfig',
    
    # IPFS Providers
    'LocalIPFSStorage',
    'PinataStorage',
    
    # Irys Provider
    'IrysStorage',
    
    # 0G Provider
    'ZeroGStorageGRPC',
]


