"""
Compute provider adapters.

All providers implement consistent interfaces for compute operations.

Available Providers:
- ZeroGInference: 0G Compute Network (TEE-verified LLM inference)
- ZeroGComputeBackend: Direct backend access for 0G Compute

Usage:
    from chaoschain_sdk.providers.compute import ZeroGInference
    
    inference = ZeroGInference(
        private_key=os.getenv("ZEROG_TESTNET_PRIVATE_KEY"),
        evm_rpc=os.getenv("ZEROG_TESTNET_RPC_URL")
    )
    
    result = inference.execute_llm_inference("What is 2+2?")
"""

from .base import ComputeBackend, ComputeResult, VerificationMethod

# Import 0G providers
try:
    from .zerog_compute import ZeroGInference, ZeroGComputeBackend
    _ZEROG_AVAILABLE = True
except ImportError:
    _ZEROG_AVAILABLE = False
    ZeroGInference = None
    ZeroGComputeBackend = None

__all__ = [
    # Base Protocol & Types
    'ComputeBackend',
    'ComputeResult',
    'VerificationMethod',
    
    # 0G Providers
    'ZeroGInference',
    'ZeroGComputeBackend',
]


