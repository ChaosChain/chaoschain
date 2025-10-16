"""
Base protocol and types for TEE providers.
"""

from typing import Protocol, Dict, Any, Optional
from dataclasses import dataclass

@dataclass
class TEEKeypair:
    """TEE-generated keypair with attestation."""
    public_key: str
    private_key: str  # Encrypted or ref to TEE-protected key
    attestation: Dict[str, Any]
    provider: str

@dataclass
class TEESignature:
    """TEE-attested signature."""
    signature: bytes
    attestation: Dict[str, Any]
    verified: bool
    provider: str

class TEEProvider(Protocol):
    """
    Base protocol for TEE authentication providers.
    
    All TEE providers must implement these methods to provide
    hardware-verified identity and signing for ERC-8004 agents.
    """
    
    @property
    def provider_name(self) -> str:
        """Name of the TEE provider (e.g., 'phala-dstack')."""
        ...
    
    @property
    def is_available(self) -> bool:
        """Check if TEE provider is available."""
        ...
    
    def generate_key(self, **kwargs) -> TEEKeypair:
        """
        Generate a TEE-attested keypair.
        
        Returns:
            TEEKeypair with public/private keys and attestation
        """
        ...
    
    def sign(self, message: bytes, keypair: TEEKeypair) -> TEESignature:
        """
        Sign message with TEE attestation.
        
        Args:
            message: Message to sign
            keypair: TEE-generated keypair
            
        Returns:
            TEESignature with signature and attestation proof
        """
        ...
    
    def verify_attestation(self, signature: TEESignature) -> bool:
        """
        Verify TEE attestation.
        
        Args:
            signature: TEE signature to verify
            
        Returns:
            True if attestation is valid
        """
        ...
    
    def get_attestation_report(self) -> Dict[str, Any]:
        """
        Get TEE attestation report for this environment.
        
        Returns:
            Dict with attestation details (type, measurements, etc.)
        """
        ...

__all__ = [
    'TEEProvider',
    'TEEKeypair',
    'TEESignature',
]
