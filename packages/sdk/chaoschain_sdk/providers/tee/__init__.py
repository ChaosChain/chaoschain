"""
TEE (Trusted Execution Environment) Provider System

Pluggable TEE authentication and attestation providers for hardware-verified
agent identities and operations.

Available Providers:
- Phala dstack: CVM-based TEE authentication (requires dstack-sdk)

Usage:
    ```python
    from chaoschain_sdk.providers.tee import PhalaDstackTEE
    
    # Initialize TEE provider
    tee = PhalaDstackTEE()
    
    # Generate TEE-attested keys
    keypair = tee.generate_key()
    
    # Sign with TEE proof
    signature = tee.sign(message, keypair)
    
    # Verify attestation
    is_valid = tee.verify_attestation(signature)
    ```

Installation:
    ```bash
    pip install chaoschain-sdk[phala-tee]
    ```
"""

from typing import Protocol, Dict, Any, Optional

class TEEProvider(Protocol):
    """Base protocol for TEE authentication providers."""
    
    def generate_key(self) -> Dict[str, Any]:
        """Generate a TEE-attested keypair."""
        ...
    
    def sign(self, message: bytes, keypair: Dict[str, Any]) -> Dict[str, Any]:
        """Sign message with TEE attestation."""
        ...
    
    def verify_attestation(self, signature: Dict[str, Any]) -> bool:
        """Verify TEE attestation."""
        ...
    
    def get_attestation_report(self) -> Dict[str, Any]:
        """Get TEE attestation report."""
        ...

__all__ = [
    'TEEProvider',
]

# Phala dstack provider (lazy import - requires dstack-sdk)
def get_phala_dstack_tee():
    """
    Get Phala dstack TEE provider.
    
    Requires: pip install chaoschain-sdk[phala-tee]
    """
    try:
        from .phala_dstack import PhalaDstackTEE
        return PhalaDstackTEE
    except ImportError:
        raise ImportError(
            "Phala dstack TEE provider requires dstack-sdk.\n"
            "Install with: pip install chaoschain-sdk[phala-tee]"
        )
