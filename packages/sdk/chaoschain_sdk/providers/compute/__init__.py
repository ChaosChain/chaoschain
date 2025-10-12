"""
Compute provider adapters.

Unified compute provider system supporting multiple backends:
- 0G Compute (generic compute jobs via gRPC)
- 0G Inference (LLM inference via TypeScript SDK bridge)
- More providers can be easily added

All providers implement consistent interfaces for compute operations.
"""

from .base import ComputeBackend, ComputeResult, VerificationMethod

# 0G Inference Provider (always available, uses mock fallback)
from .zerog_inference import (
    ZeroGInferenceProvider,
    ZeroGInferenceConfig,
    create_0g_inference
)

# Try to import gRPC provider (optional, requires proto generation)
try:
    from .zerog_grpc import ZeroGComputeGRPC
    _grpc_available = True
except ImportError:
    # Proto not generated yet - create a placeholder
    class ZeroGComputeGRPC:
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "gRPC proto files not available. Generate them with:\n"
                "cd sdk/sidecar-specs && pip install grpcio-tools\n"
                "python -m grpc_tools.protoc -I. --python_out=../chaoschain_sdk/proto --grpc_python_out=../chaoschain_sdk/proto zerog_bridge.proto"
            )
    _grpc_available = False

__all__ = [
    # Base Protocol & Types
    'ComputeBackend',
    'ComputeResult',
    'VerificationMethod',
    
    # 0G Inference Provider (LLM)
    'ZeroGInferenceProvider',
    'ZeroGInferenceConfig',
    'create_0g_inference',
    
    # 0G Compute Provider (generic jobs)
    'ZeroGComputeGRPC',
]


