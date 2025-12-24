"""
Storage provider adapters.

Unified storage provider system supporting multiple backends:
- IPFS (local node, Pinata, Infura, etc.)
- Irys (programmable datachain)
- AR.IO (permanent storage on Arweave via Turbo)
- 0G Storage (decentralized, high-performance, CLI-based)
- More providers can be easily added

All providers implement the StorageBackend Protocol for consistency.

Usage:
    from chaoschain_sdk.providers.storage import ZeroGStorage
    
    storage = ZeroGStorage(
        storage_node=os.getenv("ZEROG_STORAGE_NODE"),
        private_key=os.getenv("ZEROG_TESTNET_PRIVATE_KEY")
    )
    
    result = storage.put(b"data")
    print(f"Stored at: {result.uri}")
"""

from .base import StorageBackend, StorageResult, StorageProvider, StorageConfig

# IPFS providers (always available, no extra deps)
from .ipfs_local import LocalIPFSStorage
from .ipfs_pinata import PinataStorage

# Irys provider (always available, no extra deps)
from .irys import IrysStorage

# AR.IO provider (requires turbo-sdk)
try:
    from .ario import ArioStorage
    _ario_available = True
except ImportError:
    ArioStorage = None
    _ario_available = False

# 0G Storage (CLI-based, no gRPC needed)
try:
    from .zerog_storage import ZeroGStorage
    _zerog_cli_available = True
except ImportError:
    ZeroGStorage = None
    _zerog_cli_available = False

# Legacy gRPC provider (deprecated, for backwards compatibility)
try:
    from .zerog_grpc import ZeroGStorageGRPC
    _grpc_available = True
except ImportError:
    # Proto not generated yet - create a placeholder
    class ZeroGStorageGRPC:
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "gRPC proto files not available (legacy). Use ZeroGStorage instead.\n"
                "For legacy gRPC: Generate proto with:\n"
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

    # AR.IO Provider
    'ArioStorage',

    # 0G Providers
    'ZeroGStorage',  # CLI-based (recommended)
    'ZeroGStorageGRPC',  # Legacy gRPC (deprecated)
]


