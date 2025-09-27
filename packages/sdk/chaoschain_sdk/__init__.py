"""
ChaosChain SDK - Developer toolkit for building verifiable, monetizable agents on the ChaosChain protocol.

The ChaosChain SDK provides developers with everything needed to build autonomous agents that can interact with the ChaosChain protocol, including:

- Native x402 payment protocol (Coinbase official implementation)
- ERC-8004 identity, reputation, and validation registries  
- Process integrity verification with cryptographic proofs
- IPFS storage for verifiable evidence
- Production-ready wallet management
- Optional Google AP2 integration (intent mandates + A2A-x402 W3C payments)

Payment Architecture:
- x402: Native HTTP 402 payments (primary)
- AP2: Intent verification (optional, requires manual install)
- A2A-x402: W3C payment methods bridge (optional, requires manual install)

Example:
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    
    # Initialize your agent with native x402 payments
    agent = ChaosChainAgentSDK(
        agent_name="MyAgent",
        agent_domain="myagent.example.com",
        agent_role="server",
        network="base-sepolia"
    )
    
    # Register on ERC-8004
    agent_id, tx_hash = agent.register_identity()
    
    # Execute x402 payment (primary method)
    payment_result = agent.execute_x402_payment(
        to_agent="ServiceProvider",
        amount=1.5,
        service_type="analysis"
    )
    ```
"""

__version__ = "0.1.2"
__author__ = "ChaosChain"
__email__ = "sumeet.chougule@nethermind.io"

# Core SDK exports
from .core_sdk import ChaosChainAgentSDK
from .chaos_agent import ChaosAgent
from .wallet_manager import WalletManager
from .payment_manager import PaymentManager
from .x402_payment_manager import X402PaymentManager
from .x402_server import X402PaywallServer
from .process_integrity import ProcessIntegrityVerifier
from .google_ap2_integration import GoogleAP2Integration, GoogleAP2IntegrationResult
from .a2a_x402_extension import A2AX402Extension

# New pluggable storage system
from .storage import UnifiedStorageManager, create_storage_manager
# Backward compatibility alias (old storage_manager.py was deprecated and removed)
StorageManager = UnifiedStorageManager
from .exceptions import (
    ChaosChainSDKError,
    AgentRegistrationError,
    PaymentError,
    StorageError,
    IntegrityVerificationError,
)

# Type exports for developers
from .types import (
    AgentRole,
    NetworkConfig,
    PaymentMethod,
    IntegrityProof,
    ValidationResult,
)

__all__ = [
    # Core classes
    "ChaosChainAgentSDK",
    "ChaosAgent", 
    "WalletManager",
    "StorageManager",  # Backward compatibility alias
    "UnifiedStorageManager",  # New pluggable storage
    "create_storage_manager",  # Factory function
    "PaymentManager",
    "X402PaymentManager",
    "X402PaywallServer",
    "ProcessIntegrityVerifier",
    "GoogleAP2Integration",
    "GoogleAP2IntegrationResult",
    "A2AX402Extension",
    
    # Exceptions
    "ChaosChainSDKError",
    "AgentRegistrationError", 
    "PaymentError",
    "StorageError",
    "IntegrityVerificationError",
    
    # Types
    "AgentRole",
    "NetworkConfig", 
    "PaymentMethod",
    "IntegrityProof",
    "ValidationResult",
    
    # Metadata
    "__version__",
    "__author__",
    "__email__",
]