"""
Type definitions for the ChaosChain SDK.

This module contains all the type definitions, enums, and data classes
used throughout the ChaosChain SDK for type safety and developer experience.
"""

from enum import Enum
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from datetime import datetime


class AgentRole(str, Enum):
    """Supported agent roles in the ChaosChain protocol."""
    SERVER = "server"
    VALIDATOR = "validator" 
    CLIENT = "client"


class NetworkConfig(str, Enum):
    """Supported blockchain networks."""
    ETHEREUM_SEPOLIA = "ethereum-sepolia"
    BASE_SEPOLIA = "base-sepolia"
    OPTIMISM_SEPOLIA = "optimism-sepolia"
    LOCAL = "local"


class PaymentMethod(str, Enum):
    """W3C-compliant payment methods supported by the SDK."""
    BASIC_CARD = "basic-card"
    GOOGLE_PAY = "https://google.com/pay"
    APPLE_PAY = "https://apple.com/apple-pay"
    PAYPAL = "https://paypal.com"
    A2A_X402 = "https://a2a.org/x402"


@dataclass
class IntegrityProof:
    """Cryptographic proof of process integrity."""
    proof_id: str
    function_name: str
    code_hash: str
    execution_hash: str
    timestamp: datetime
    agent_name: str
    verification_status: str
    ipfs_cid: Optional[str] = None


@dataclass
class ValidationResult:
    """Result of agent validation process."""
    validation_id: str
    validator_agent_id: int
    score: int
    quality_rating: str
    validation_summary: str
    detailed_assessment: Dict[str, Any]
    timestamp: datetime
    ipfs_cid: Optional[str] = None


@dataclass
class PaymentProof:
    """Proof of payment execution."""
    payment_id: str
    from_agent: str
    to_agent: str
    amount: float
    currency: str
    payment_method: PaymentMethod
    transaction_hash: str
    timestamp: datetime
    receipt_data: Dict[str, Any]


@dataclass
class AgentIdentity:
    """On-chain agent identity information."""
    agent_id: int
    agent_name: str
    agent_domain: str
    wallet_address: str
    registration_tx: str
    network: NetworkConfig


@dataclass
class EvidencePackage:
    """Comprehensive evidence package for proof of agency."""
    package_id: str
    agent_identity: AgentIdentity
    work_proof: Dict[str, Any]
    integrity_proof: Optional[IntegrityProof]
    payment_proofs: List[PaymentProof]
    validation_results: List[ValidationResult]
    ipfs_cid: Optional[str] = None
    created_at: datetime = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()


@dataclass
class ContractAddresses:
    """Contract addresses for a specific network."""
    identity_registry: str
    reputation_registry: str
    validation_registry: str
    network: NetworkConfig


# Type aliases for common patterns
AgentID = int
TransactionHash = str
IPFSHash = str
WalletAddress = str
