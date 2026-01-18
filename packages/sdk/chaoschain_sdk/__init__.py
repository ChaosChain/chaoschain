"""
ChaosChain SDK - Minimal, pluggable toolkit for building verifiable, monetizable agents on the ChaosChain protocol.

MINIMAL CORE (Always Available):
- ERC-8004: On-chain identity, reputation, validation registries  
- x402: Native crypto payments (Coinbase official)
- Wallet Manager: Secure key management
- Local IPFS: Basic decentralized storage

PLUGGABLE PROVIDERS (Install as Needed):
- Storage: pip install chaoschain-sdk[pinata] or [irys] or [0g-storage]
- Compute: pip install chaoschain-sdk[0g-compute] or [morpheus]
- Payments: pip install chaoschain-sdk[ap2] (requires git install)

Example (Core Only):
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    
    agent = ChaosChainAgentSDK(
        agent_name="MyAgent",
        agent_domain="myagent.example.com",
        network="base-sepolia"
    )
    
    # Register on ERC-8004
    agent_id, tx_hash = agent.register_identity()
    
    # x402 payment (always available)
    payment = agent.execute_x402_payment(to_agent="Provider", amount=1.5)
    ```

Example (With 0G):
    ```bash
    pip install chaoschain-sdk[0g]
    ```
    
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    from chaoschain_sdk.compute_providers import ZeroGInference
    
    # Inject 0G Compute Inference provider
    zerog = ZeroGInference(
        private_key=os.getenv("ZEROG_TESTNET_PRIVATE_KEY"),
        evm_rpc=os.getenv("ZEROG_TESTNET_RPC_URL")
    )
    
    agent = ChaosChainAgentSDK(
        agent_name="MyAgent",
        network="0g-testnet",
        compute_provider=zerog
    )
    ```
"""

__version__ = "0.3.2"
__author__ = "ChaosChain"
__email__ = "sumeet@chaoscha.in"

# ══════════════════════════════════════════════════════════════
# CORE EXPORTS (Always Available)
# ══════════════════════════════════════════════════════════════

from .core_sdk import ChaosChainAgentSDK
from .chaos_agent import ChaosAgent
from .wallet_manager import WalletManager
from .x402_payment_manager import X402PaymentManager

# Mandates (optional - requires mandates-core package)
try:
    from .mandate_manager import MandateManager
    from mandates_core import Mandate
    _has_mandates = True
except ImportError:
    _has_mandates = False
    MandateManager = None
    Mandate = None

# XMTP & Causal Audit (optional - requires xmtp package)
try:
    from .xmtp_client import XMTPManager, XMTPMessage
    from .dkg import DKG, DKGNode
    from .verifier_agent import VerifierAgent, AuditResult
    from .studio_manager import StudioManager, Task, WorkerBid
    _has_xmtp = True
except ImportError:
    _has_xmtp = False

# Types and enums
from .types import (
    NetworkConfig,
    AgentRole,
    AgentID,
    TransactionHash,
    PaymentMethod,
    PaymentProof,
)

# Exceptions
from .exceptions import (
    ChaosChainSDKError,
    PaymentError,
    ValidationError,
    StorageError,
    NetworkError,
    ContractError,
)

# ══════════════════════════════════════════════════════════════
# OPTIONAL EXPORTS (Require Extra Install)
# ══════════════════════════════════════════════════════════════

# Process Integrity (optional - only if verification enabled)
try:
    from .process_integrity import ProcessIntegrityVerifier
    _has_process_integrity = True
except ImportError:
    _has_process_integrity = False

# Google AP2 (optional - requires manual git install)
try:
    from .google_ap2_integration import GoogleAP2Integration, GoogleAP2IntegrationResult
    from .a2a_x402_extension import A2AX402Extension
    _has_ap2 = True
except ImportError:
    _has_ap2 = False

# x402 Paywall Server (optional - for server-mode agents)
try:
    from .x402_server import X402PaywallServer
    _has_x402_server = True
except ImportError:
    _has_x402_server = False

# ══════════════════════════════════════════════════════════════
# PLUGGABLE PROVIDERS (Import Only If Installed)
# ══════════════════════════════════════════════════════════════

# Provider base protocols (always available)
from .providers.storage.base import StorageBackend, StorageResult, StorageProvider
from .providers.compute.base import ComputeBackend, ComputeResult, VerificationMethod

# Storage providers (lazy import - only if extras installed)
_storage_providers = {}
_compute_providers = {}

def _lazy_import_storage(provider_name):
    """Lazy import storage providers to avoid import errors."""
    if provider_name in _storage_providers:
        return _storage_providers[provider_name]
    
    try:
        if provider_name == "pinata":
            from .providers.storage.ipfs_pinata import PinataStorage
            _storage_providers["pinata"] = PinataStorage
            return PinataStorage
        elif provider_name == "irys":
            from .providers.storage.irys import IrysStorage
            _storage_providers["irys"] = IrysStorage
            return IrysStorage
        elif provider_name == "0g":
            # 0G Storage gRPC provider removed - use storage_provider parameter instead
            return None
        elif provider_name == "ipfs":
            from .providers.storage.ipfs_local import LocalIPFSStorage
            _storage_providers["ipfs"] = LocalIPFSStorage
            return LocalIPFSStorage
    except ImportError:
        return None

def _lazy_import_compute(provider_name):
    """Lazy import compute providers to avoid import errors."""
    if provider_name in _compute_providers:
        return _compute_providers[provider_name]
    
    # 0G Compute gRPC provider removed - use compute_providers.ZeroGInference instead
    return None

# Public API for provider access
def get_storage_provider(name: str):
    """
    Get a storage provider by name.
    
    Args:
        name: Provider name ("pinata", "irys", "0g", "ipfs")
    
    Returns:
        Provider class or None if not installed
    
    Example:
        ```python
        PinataStorage = get_storage_provider("pinata")
        if PinataStorage:
            storage = PinataStorage(jwt="...", gateway="...")
        else:
            print("Install with: pip install chaoschain-sdk[pinata]")
        ```
    """
    return _lazy_import_storage(name)

def get_compute_provider(name: str):
    """
    Get a compute provider by name.
    
    Args:
        name: Provider name ("0g", "morpheus", "chainlink")
    
    Returns:
        Provider class or None if not installed
    
    Example:
        ```python
        ZeroGCompute = get_compute_provider("0g")
        if ZeroGCompute:
            compute = ZeroGCompute(grpc_url="localhost:50052")
        else:
            print("Install with: pip install chaoschain-sdk[0g-compute]")
        ```
    """
    return _lazy_import_compute(name)

# ══════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════

__all__ = [
    # Core SDK
    "ChaosChainAgentSDK",
    "ChaosAgent",
    "WalletManager",
    "X402PaymentManager",
    
    # Types
    "NetworkConfig",
    "AgentRole",
    "AgentID",
    "TransactionHash",
    "PaymentMethod",
    "PaymentProof",
    
    # Exceptions
    "ChaosChainSDKError",
    "PaymentError",
    "ValidationError",
    "StorageError",
    "NetworkError",
    "ContractError",
    
    # Provider protocols
    "StorageBackend",
    "StorageResult",
    "StorageProvider",
    "ComputeBackend",
    "ComputeResult",
    "VerificationMethod",
    
    # Provider accessors
    "get_storage_provider",
    "get_compute_provider",
]

# Add optional exports if available
if _has_process_integrity:
    __all__.append("ProcessIntegrityVerifier")

if _has_ap2:
    __all__.extend(["GoogleAP2Integration", "GoogleAP2IntegrationResult", "A2AX402Extension"])

if _has_x402_server:
    __all__.append("X402PaywallServer")

if _has_xmtp:
    __all__.extend(["XMTPManager", "XMTPMessage", "DKG", "DKGNode", "VerifierAgent", "AuditResult", "StudioManager", "Task", "WorkerBid"])

if _has_mandates:
    __all__.extend(["MandateManager", "Mandate"])
