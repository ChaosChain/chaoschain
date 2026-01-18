"""
Production-ready base agent for ChaosChain protocol interactions.

This module provides the foundational ChaosAgent class that handles
ERC-8004 registry interactions, identity management, and core protocol operations.
"""

import json
import os
import time
from typing import Dict, Optional, Any, Tuple, List
from web3 import Web3
from web3.contract import Contract
from eth_account.messages import encode_defunct
from eth_abi import encode as abi_encode
from rich import print as rprint

from .types import NetworkConfig, AgentID, TransactionHash, ContractAddresses
from .exceptions import (
    AgentRegistrationError, 
    NetworkError, 
    ContractError,
    ConfigurationError
)
from .wallet_manager import WalletManager


class ChaosAgent:
    """
    Base class for ChaosChain agents interacting with ERC-8004 registries.
    
    Provides core functionality for agent identity management, contract interactions,
    and protocol operations across multiple blockchain networks.
    
    Attributes:
        agent_domain: Domain where the agent's identity is hosted
        wallet_manager: Wallet manager for transaction handling
        network: Target blockchain network
        agent_id: On-chain agent identifier (set after registration)
    """
    
    def __init__(self, agent_name: str, agent_domain: str, wallet_manager: WalletManager, 
                 network: NetworkConfig = NetworkConfig.BASE_SEPOLIA):
        """
        Initialize the ChaosChain base agent.
        
        Args:
            agent_name: Name of the agent for wallet lookup
            agent_domain: Domain where agent's identity is hosted
            wallet_manager: Wallet manager instance
            network: Target blockchain network
        """
        self.agent_name = agent_name
        self.agent_domain = agent_domain
        self.wallet_manager = wallet_manager
        self.network = network
        self.agent_id: Optional[AgentID] = None
        
        # Get wallet address from manager using provided agent name
        self.address = wallet_manager.get_wallet_address(self.agent_name)
        
        # Initialize Web3 connection
        self.w3 = wallet_manager.w3
        self.chain_id = wallet_manager.chain_id
        
        # Load contract addresses and initialize contracts
        self._load_contract_addresses()
        self._load_contracts()
        
        rprint(f"[green]🌐 Connected to {self.network} (Chain ID: {self.chain_id})[/green]")
    
    def _load_contract_addresses(self):
        """
        Load deployed ERC-8004 v1.0 contract addresses.
        
        These are the official ERC-8004 v1.0 contracts deployed on testnets.
        Source: /Users/sumeet/Desktop/erc-8004-contracts/contracts
        """
        # Network-specific configuration with actual deployed addresses
        contract_addresses = {
            NetworkConfig.BASE_SEPOLIA: {
                'identity_registry': '0x8004AA63c570c570eBF15376c0dB199918BFe9Fb',
                'reputation_registry': '0x8004bd8daB57f14Ed299135749a5CB5c42d341BF',
                'validation_registry': '0x8004C269D0A5647E51E121FeB226200ECE932d55',
                'usdc_token': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70'
            },
            NetworkConfig.ETHEREUM_SEPOLIA: {
                # Official ERC-8004 Registries (Jan 2026 spec - https://github.com/erc-8004/erc-8004-contracts)
                'identity_registry': '0x8004A818BFB912233c491871b3d84c89A494BD9e',
                'reputation_registry': '0x8004B663056A597Dffe9eCcC1965A193B7388713',
                'validation_registry': '0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5',
                'usdc_token': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70',
                # ChaosChain Protocol v0.4.30 (deployed Jan 17, 2026) - VERIFIED ON-CHAIN
                # ERC-8004 Jan 2026 compatible: No feedbackAuth, string tags, endpoint parameter
                # Multi-agent submitWorkMultiAgent now works (feedbackAuth removed)
                'chaos_registry': '0x7F38C1aFFB24F30500d9174ed565110411E42d50',
                'chaos_core': '0xF6a57f04736A52a38b273b0204d636506a780E67',
                'rewards_distributor': '0x0549772a3fF4F095C57AEFf655B3ed97B7925C19',
                'studio_factory': '0x230e76a105A9737Ea801BB7d0624D495506EE257',
                # LogicModules
                'prediction_logic': '0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3'
            },
            NetworkConfig.OPTIMISM_SEPOLIA: {
                'identity_registry': '0x0000000000000000000000000000000000000000',  # Not yet deployed
                'reputation_registry': '0x0000000000000000000000000000000000000000',
                'validation_registry': '0x0000000000000000000000000000000000000000',
                'usdc_token': '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70'
            },
            NetworkConfig.LINEA_SEPOLIA: {
                'identity_registry': '0x8004aa7C931bCE1233973a0C6A667f73F66282e7',
                'reputation_registry': '0x8004bd8483b99310df121c46ED8858616b2Bba02',
                'validation_registry': '0x8004c44d1EFdd699B2A26e781eF7F77c56A9a4EB',
                'usdc_token': '0x0000000000000000000000000000000000000000',  # TODO: Add Linea USDC
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70'
            },
            NetworkConfig.HEDERA_TESTNET: {
                'identity_registry': '0x4c74ebd72921d537159ed2053f46c12a7d8e5923',
                'reputation_registry': '0xc565edcba77e3abeade40bfd6cf6bf583b3293e0',
                'validation_registry': '0x18df085d85c586e9241e0cd121ca422f571c2da6',
                'usdc_token': '0x0000000000000000000000000000000000000000',  # TODO: Add Hedera USDC
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70'
            },
            NetworkConfig.BSC_TESTNET: {
                'identity_registry': '0xabbd26d86435b35d9c45177725084ee6a2812e40',
                'reputation_registry': '0xeced1af52a0446275e9e6e4f6f26c99977400a6a',
                'validation_registry': '0x7866bd057f09a4940fe2ce43320518c8749a921e',
                'usdc_token': '0x0000000000000000000000000000000000000000',  # TODO: Add BSC USDC
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70'
            },
            NetworkConfig.ZEROG_TESTNET: {
                'identity_registry': '0x80043ed9cf33a3472768dcd53175bb44e03a1e4a',
                'reputation_registry': '0x80045d7b72c47bf5ff73737b780cb1a5ba8ee202',
                'validation_registry': '0x80041728e0aadf1d1427f9be18d52b7f3afefafb',
                'usdc_token': '0x0000000000000000000000000000000000000000',  # 0G uses native A0GI token
                'treasury': '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70'
            }
        }
        
        network_contracts = contract_addresses.get(self.network)
        if not network_contracts:
            raise ConfigurationError(f"No deployed contracts configured for network: {self.network}")
        
        self.contract_addresses = ContractAddresses(
            identity_registry=network_contracts['identity_registry'],
            reputation_registry=network_contracts['reputation_registry'], 
            validation_registry=network_contracts['validation_registry'],
            rewards_distributor=network_contracts.get('rewards_distributor'),
            chaos_core=network_contracts.get('chaos_core'),
            network=self.network
        )
    
    def _load_contracts(self):
        """Load contract instances with embedded ABIs."""
        try:
            # Embedded minimal ABIs - no external files needed
            identity_abi = self._get_identity_registry_abi()
            reputation_abi = self._get_reputation_registry_abi()
            validation_abi = self._get_validation_registry_abi()
            
            rprint(f"[green]📋 Contracts ready for {self.network.value}[/green]")
            
            # Create contract instances
            self.identity_registry = self.w3.eth.contract(
                address=self.contract_addresses.identity_registry,
                abi=identity_abi
            )
            
            self.reputation_registry = self.w3.eth.contract(
                address=self.contract_addresses.reputation_registry,
                abi=reputation_abi
            )
            
            self.validation_registry = self.w3.eth.contract(
                address=self.contract_addresses.validation_registry,
                abi=validation_abi
            )
            
        except Exception as e:
            raise ContractError(f"Failed to load contracts: {str(e)}")
    
    def _get_identity_registry_abi(self) -> list:
        """
        Get embedded Identity Registry ABI for ERC-8004 v1.0.
        
        v1.0 uses ERC-721 with URIStorage extension. Key changes:
        - register() functions replace newAgent()
        - Agents are ERC-721 NFTs with tokenURI
        - ownerOf() to get agent owner
        - tokenURI() to get registration file
        """
        return [
            # ERC-8004 v1.0 Registration Functions
                {
                    "inputs": [
                    {"name": "tokenURI_", "type": "string"},
                    {
                        "name": "metadata",
                        "type": "tuple[]",
                        "components": [
                            {"name": "key", "type": "string"},
                            {"name": "value", "type": "bytes"}
                        ]
                    }
                    ],
                "name": "register",
                    "outputs": [{"name": "agentId", "type": "uint256"}],
                    "stateMutability": "nonpayable",
                    "type": "function"
                },
                {
                "inputs": [{"name": "tokenURI_", "type": "string"}],
                "name": "register",
                "outputs": [{"name": "agentId", "type": "uint256"}],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "register",
                "outputs": [{"name": "agentId", "type": "uint256"}],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            # ERC-721 Standard Functions
            {
                "inputs": [{"name": "tokenId", "type": "uint256"}],
                "name": "ownerOf",
                "outputs": [{"name": "owner", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "tokenId", "type": "uint256"}],
                "name": "tokenURI",
                "outputs": [{"name": "", "type": "string"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "tokenId", "type": "uint256"}
                ],
                "name": "transferFrom",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "to", "type": "address"},
                    {"name": "tokenId", "type": "uint256"}
                ],
                "name": "approve",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "operator", "type": "address"},
                    {"name": "approved", "type": "bool"}
                ],
                "name": "setApprovalForAll",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "tokenId", "type": "uint256"}],
                "name": "getApproved",
                "outputs": [{"name": "operator", "type": "address"}],
                    "stateMutability": "view",
                    "type": "function"
            },
            {
                "inputs": [
                    {"name": "owner", "type": "address"},
                    {"name": "operator", "type": "address"}
                ],
                "name": "isApprovedForAll",
                "outputs": [{"name": "approved", "type": "bool"}],
                "stateMutability": "view",
                "type": "function"
            },
            # Metadata Functions
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "key", "type": "string"},
                    {"name": "value", "type": "bytes"}
                ],
                "name": "setMetadata",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "key", "type": "string"}
                ],
                "name": "getMetadata",
                "outputs": [{"name": "value", "type": "bytes"}],
                "stateMutability": "view",
                "type": "function"
            },
            # Additional Functions
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "newUri", "type": "string"}
                ],
                "name": "setAgentUri",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            # Events
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": False, "name": "tokenURI", "type": "string"},
                    {"indexed": True, "name": "owner", "type": "address"}
                ],
                "name": "Registered",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": True, "name": "indexedKey", "type": "string"},
                    {"indexed": False, "name": "key", "type": "string"},
                    {"indexed": False, "name": "value", "type": "bytes"}
                ],
                "name": "MetadataSet",
                "type": "event"
            },
            # ERC-721 Standard Events
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "from", "type": "address"},
                    {"indexed": True, "name": "to", "type": "address"},
                    {"indexed": True, "name": "tokenId", "type": "uint256"}
                ],
                "name": "Transfer",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "owner", "type": "address"},
                    {"indexed": True, "name": "approved", "type": "address"},
                    {"indexed": True, "name": "tokenId", "type": "uint256"}
                ],
                "name": "Approval",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "owner", "type": "address"},
                    {"indexed": True, "name": "operator", "type": "address"},
                    {"indexed": False, "name": "approved", "type": "bool"}
                ],
                "name": "ApprovalForAll",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": False, "name": "newUri", "type": "string"},
                    {"indexed": True, "name": "updatedBy", "type": "address"}
                ],
                "name": "UriUpdated",
                "type": "event"
            }
        ]
    
    def _get_reputation_registry_abi(self) -> list:
        """
        Get embedded Reputation Registry ABI for ERC-8004 Jan 2026.
        
        Jan 2026 KEY CHANGES from Oct 2025:
        - REMOVED feedbackAuth parameter - feedback is now permissionless
        - ADDED endpoint parameter for endpoint being reviewed
        - CHANGED tag1, tag2 from bytes32 to string
        - ADDED feedbackIndex to NewFeedback event
        - readFeedback returns string tags and feedbackIndex parameter renamed
        """
        return [
            # Core Functions (Jan 2026 spec)
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "score", "type": "uint8"},
                    {"name": "tag1", "type": "string"},        # CHANGED: bytes32 -> string
                    {"name": "tag2", "type": "string"},        # CHANGED: bytes32 -> string
                    {"name": "endpoint", "type": "string"},    # NEW: endpoint parameter
                    {"name": "feedbackURI", "type": "string"}, # RENAMED: feedbackUri -> feedbackURI
                    {"name": "feedbackHash", "type": "bytes32"}
                    # REMOVED: feedbackAuth parameter
                ],
                "name": "giveFeedback",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "feedbackIndex", "type": "uint64"}
                ],
                "name": "revokeFeedback",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "clientAddress", "type": "address"},
                    {"name": "feedbackIndex", "type": "uint64"},
                    {"name": "responseURI", "type": "string"},  # RENAMED: responseUri -> responseURI
                    {"name": "responseHash", "type": "bytes32"}
                ],
                "name": "appendResponse",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            # Read Functions (Jan 2026 spec)
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "clientAddresses", "type": "address[]"},
                    {"name": "tag1", "type": "string"},  # CHANGED: bytes32 -> string
                    {"name": "tag2", "type": "string"}   # CHANGED: bytes32 -> string
                ],
                "name": "getSummary",
                "outputs": [
                    {"name": "count", "type": "uint64"},
                    {"name": "averageScore", "type": "uint8"}
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "clientAddress", "type": "address"},
                    {"name": "feedbackIndex", "type": "uint64"}  # RENAMED: index -> feedbackIndex
                ],
                "name": "readFeedback",
                "outputs": [
                    {"name": "score", "type": "uint8"},
                    {"name": "tag1", "type": "string"},   # CHANGED: bytes32 -> string
                    {"name": "tag2", "type": "string"},   # CHANGED: bytes32 -> string
                    {"name": "isRevoked", "type": "bool"}
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "clientAddresses", "type": "address[]"},
                    {"name": "tag1", "type": "string"},   # CHANGED: bytes32 -> string
                    {"name": "tag2", "type": "string"},   # CHANGED: bytes32 -> string
                    {"name": "includeRevoked", "type": "bool"}
                ],
                "name": "readAllFeedback",
                "outputs": [
                    {"name": "clientAddresses_", "type": "address[]"},
                    {"name": "feedbackIndexes", "type": "uint64[]"},  # NEW: feedbackIndexes
                    {"name": "scores", "type": "uint8[]"},
                    {"name": "tag1s", "type": "string[]"},   # CHANGED: bytes32[] -> string[]
                    {"name": "tag2s", "type": "string[]"},   # CHANGED: bytes32[] -> string[]
                    {"name": "revokedStatuses", "type": "bool[]"}
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "agentId", "type": "uint256"}],
                "name": "getClients",
                "outputs": [{"name": "clientList", "type": "address[]"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "clientAddress", "type": "address"}
                ],
                "name": "getLastIndex",
                "outputs": [{"name": "lastIndex", "type": "uint64"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "getIdentityRegistry",
                "outputs": [{"name": "registry", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            },
            # Events (Jan 2026 spec)
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": True, "name": "clientAddress", "type": "address"},
                    {"indexed": False, "name": "feedbackIndex", "type": "uint64"},  # NEW
                    {"indexed": False, "name": "score", "type": "uint8"},
                    {"indexed": True, "name": "tag1", "type": "string"},   # CHANGED: bytes32 -> string
                    {"indexed": False, "name": "tag2", "type": "string"},  # CHANGED: bytes32 -> string
                    {"indexed": False, "name": "endpoint", "type": "string"},       # NEW
                    {"indexed": False, "name": "feedbackURI", "type": "string"},    # RENAMED
                    {"indexed": False, "name": "feedbackHash", "type": "bytes32"}
                ],
                "name": "NewFeedback",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": True, "name": "clientAddress", "type": "address"},
                    {"indexed": False, "name": "feedbackIndex", "type": "uint64"},
                    {"indexed": True, "name": "responder", "type": "address"},
                    {"indexed": False, "name": "responseURI", "type": "string"},  # RENAMED
                    {"indexed": False, "name": "responseHash", "type": "bytes32"}
                ],
                "name": "ResponseAppended",
                "type": "event"
            }
        ]
    
    def _get_validation_registry_abi(self) -> list:
        """
        Get embedded Validation Registry ABI for ERC-8004 v1.0.
        
        v1.0 uses URI-based validation with off-chain evidence storage.
        Key changes:
        - validationRequest() uses validatorAddress instead of validatorAgentId
        - requestUri and requestHash for off-chain evidence
        - validationResponse() uses requestHash with response (0-100)
        - Support for multiple responses per request (progressive validation)
        """
        return [
            # Core Functions
                {
                    "inputs": [
                    {"name": "validatorAddress", "type": "address"},
                    {"name": "agentId", "type": "uint256"},
                    {"name": "requestUri", "type": "string"},
                    {"name": "requestHash", "type": "bytes32"}
                    ],
                    "name": "validationRequest",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                },
                {
                    "inputs": [
                    {"name": "requestHash", "type": "bytes32"},
                        {"name": "response", "type": "uint8"},
                    {"name": "responseUri", "type": "string"},
                    {"name": "responseHash", "type": "bytes32"},
                    {"name": "tag", "type": "bytes32"}
                    ],
                "name": "validationResponse",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
            },
            # Read Functions
            {
                "inputs": [{"name": "requestHash", "type": "bytes32"}],
                "name": "getValidationStatus",
                "outputs": [
                    {"name": "validatorAddress", "type": "address"},
                    {"name": "agentId", "type": "uint256"},
                    {"name": "response", "type": "uint8"},
                    {"name": "responseHash", "type": "bytes32"},
                    {"name": "tag", "type": "bytes32"},
                    {"name": "lastUpdate", "type": "uint256"}
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "agentId", "type": "uint256"},
                    {"name": "validatorAddresses", "type": "address[]"},
                    {"name": "tag", "type": "bytes32"}
                ],
                "name": "getSummary",
                "outputs": [
                    {"name": "count", "type": "uint64"},
                    {"name": "avgResponse", "type": "uint8"}
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "agentId", "type": "uint256"}],
                "name": "getAgentValidations",
                "outputs": [{"name": "requestHashes", "type": "bytes32[]"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [{"name": "validatorAddress", "type": "address"}],
                "name": "getValidatorRequests",
                "outputs": [{"name": "requestHashes", "type": "bytes32[]"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "getIdentityRegistry",
                "outputs": [{"name": "registry", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            },
            # Events
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "validatorAddress", "type": "address"},
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": False, "name": "requestUri", "type": "string"},
                    {"indexed": True, "name": "requestHash", "type": "bytes32"}
                ],
                "name": "ValidationRequest",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "validatorAddress", "type": "address"},
                    {"indexed": True, "name": "agentId", "type": "uint256"},
                    {"indexed": True, "name": "requestHash", "type": "bytes32"},
                    {"indexed": False, "name": "response", "type": "uint8"},
                    {"indexed": False, "name": "responseUri", "type": "string"},
                    {"indexed": False, "name": "responseHash", "type": "bytes32"},
                    {"indexed": False, "name": "tag", "type": "bytes32"}
                ],
                "name": "ValidationResponse",
                "type": "event"
            }
        ]
    
    
    def _generate_token_uri(self) -> str:
        """
        Generate ERC-8004 v1.0 compliant agent registration JSON.
        
        Returns inline data URI with registration metadata.
        This can be replaced with IPFS or HTTP endpoints in production.
        """
        registration_data = {
            "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
            "name": self.agent_name,
            "description": f"ChaosChain agent deployed at {self.agent_domain}",
            "image": "https://chaoscha.in/agent-avatar.png",  # Default avatar
            "endpoints": [
                {
                    "name": "agentWallet",
                    "endpoint": f"eip155:{self.chain_id}:{self.address}"
                }
            ],
            "registrations": [
                {
                    "agentId": 0,  # Will be filled after registration
                    "agentRegistry": f"eip155:{self.chain_id}:{self.contract_addresses.identity_registry}"
                }
            ],
            "supportedTrust": ["reputation", "crypto-economic"]
        }
        
        # Convert to inline data URI (can be replaced with IPFS in production)
        json_str = json.dumps(registration_data)
        return f"data:application/json;base64,{json_str}"
    
    def register_agent(
        self, 
        token_uri: Optional[str] = None,
        metadata: Optional[Dict[str, bytes]] = None
    ) -> Tuple[AgentID, TransactionHash]:
        """
        Register this agent on the ERC-8004 v1.0 IdentityRegistry.
        
        v1.0 uses ERC-721 based registration with tokenURI and optional metadata.
        
        Args:
            token_uri: Optional custom tokenURI. If not provided, generates default.
            metadata: Optional dict of on-chain metadata {key: value_bytes}.
                     Example: {"agentName": b"MyAgent", "agentWallet": address_bytes}
        
        Returns:
            Tuple of (agent_id, transaction_hash)
        """
        rprint(f"[yellow]🔧 Registering agent: {self.agent_name} ({self.agent_domain})[/yellow]")
        
        # v1.0: Check if already registered using ERC-721 Enumerable methods
        # ERC-8004 IdentityRegistry is ERC-721 based
        try:
            # Use balanceOf to check if this wallet owns any agent NFTs
            balance = self.identity_registry.functions.balanceOf(self.address).call()
            
            if balance > 0:
                rprint(f"[blue]🔍 Wallet owns {balance} agent NFT(s), checking...[/blue]")
                
                # Use tokenOfOwnerByIndex to get the first agent ID owned by this wallet
                try:
                    existing_agent_id = self.identity_registry.functions.tokenOfOwnerByIndex(
                        self.address, 0
                    ).call()
                    self.agent_id = existing_agent_id
                    rprint(f"[green]✅ Agent already registered with ID: {self.agent_id}[/green]")
                    return self.agent_id, "already_registered"
                except Exception as enum_error:
                    # If tokenOfOwnerByIndex not available, try iterating through recent tokens
                    rprint(f"[yellow]⚠️  Enumerable not available, checking recent tokens...[/yellow]")
                    try:
                        total_supply = self.identity_registry.functions.totalSupply().call()
                        # Check last 100 tokens for ownership
                        for potential_id in range(total_supply, max(0, total_supply - 100), -1):
                            try:
                                owner = self.identity_registry.functions.ownerOf(potential_id).call()
                                if owner.lower() == self.address.lower():
                                    self.agent_id = potential_id
                                    rprint(f"[green]✅ Agent already registered with ID: {self.agent_id}[/green]")
                                    return self.agent_id, "already_registered"
                            except:
                                continue
                    except:
                        pass
            else:
                rprint(f"[blue]🔍 No existing agent found for this wallet[/blue]")
                    
        except Exception as e:
            rprint(f"[blue]🔍 Could not check existing registrations: {e}[/blue]")
            pass
        
        try:
            # Generate tokenURI if not provided
            if token_uri is None:
                token_uri = self._generate_token_uri()
                rprint(f"[blue]📝 Generated tokenURI for registration[/blue]")
            
            # v1.0: Choose register function based on metadata
            if metadata:
                # Convert metadata dict to MetadataEntry[] array
                metadata_entries = [(key, value) for key, value in metadata.items()]
                rprint(f"[blue]📋 Registering with {len(metadata_entries)} metadata entries[/blue]")
                contract_call = self.identity_registry.functions['register(string,(string,bytes)[])'](
                    token_uri,
                    metadata_entries
                )
            else:
                # Use simple register(tokenURI) function
                contract_call = self.identity_registry.functions['register(string)'](token_uri)
            
            # Estimate gas
            gas_estimate = contract_call.estimate_gas({'from': self.address})
            gas_limit = int(gas_estimate * 1.2)  # Add 20% buffer
            
            rprint(f"[yellow]⛽ Gas estimate: {gas_estimate}, using limit: {gas_limit}[/yellow]")
            
            # Build transaction
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': gas_limit,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            # Sign and send transaction
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            
            rprint(f"[yellow]⏳ Waiting for transaction confirmation...[/yellow]")
            # Handle both old and new Web3.py versions
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                # v1.0: Extract agent ID from Registered event logs
                try:
                    # Find the Registered event in logs
                    registered_event = self.identity_registry.events.Registered()
                    logs = registered_event.process_receipt(receipt)
                    if logs:
                        self.agent_id = logs[0]['args']['agentId']
                        rprint(f"[green]✅ Agent registered successfully with ID: {self.agent_id}[/green]")
                        rprint(f"[blue]📋 View on explorer: Transaction {tx_hash.hex()[:10]}...[/blue]")
                        return self.agent_id, tx_hash.hex()
                except Exception as log_error:
                    rprint(f"[yellow]⚠️  Could not parse event logs: {log_error}[/yellow]")
                    # Fallback: Use ERC-721 methods to find agent ID
                    try:
                        # First try tokenOfOwnerByIndex (ERC-721 Enumerable)
                        self.agent_id = self.identity_registry.functions.tokenOfOwnerByIndex(
                            self.address, 0
                        ).call()
                        rprint(f"[green]✅ Agent registered with ID: {self.agent_id}[/green]")
                        return self.agent_id, tx_hash.hex()
                    except:
                        # Fallback: Check recent tokens by totalSupply
                        try:
                            total_supply = self.identity_registry.functions.totalSupply().call()
                            for potential_id in range(total_supply, max(0, total_supply - 10), -1):
                                try:
                                    owner = self.identity_registry.functions.ownerOf(potential_id).call()
                                    if owner.lower() == self.address.lower():
                                        self.agent_id = potential_id
                                        rprint(f"[green]✅ Agent registered with ID: {self.agent_id}[/green]")
                                        return self.agent_id, tx_hash.hex()
                                except:
                                    continue
                        except:
                            pass
                    
                    raise AgentRegistrationError("Registration succeeded but could not determine agent ID")
            else:
                raise AgentRegistrationError("Transaction failed")
                
        except Exception as e:
            error_msg = str(e)
            rprint(f"[red]❌ Registration failed: {error_msg}[/red]")
            
            # Check for specific error types
            if "insufficient funds" in error_msg.lower():
                rprint(f"[yellow]💰 Insufficient ETH for gas fees in wallet: {self.address}[/yellow]")
                rprint(f"[blue]Please fund this wallet using Base Sepolia faucet:[/blue]")
                rprint(f"[blue]https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet[/blue]")
            
            raise AgentRegistrationError(f"Failed to register {self.agent_domain}: {error_msg}")
    
    def get_agent_id(self, use_cache: bool = True) -> Optional[AgentID]:
        """
        Get the agent's on-chain ID (ERC-8004 v1.0) with optional local caching.
        
        v1.0: Agents are ERC-721 NFTs. Check if this wallet owns any agent tokens.
        
        Caching: When a wallet has many NFTs, iteration is slow. The SDK now caches
        agent IDs in a local file (chaoschain_agent_ids.json) for fast lookup.
        
        Args:
            use_cache: If True, check local cache first (default: True)
        
        Returns:
            Agent ID if registered, None otherwise
        """
        if self.agent_id:
            return self.agent_id
        
        # Check local cache first (fast!)
        if use_cache:
            cached_id = self._load_agent_id_from_cache()
            if cached_id:
                self.agent_id = cached_id
                rprint(f"[dim]📦 Using cached agent ID: {cached_id}[/dim]")
                return self.agent_id
        
        try:
            # v1.0: Use balanceOf to check if wallet owns any tokens
            balance = self.identity_registry.functions.balanceOf(self.address).call()
            
            if balance == 0:
                return None
            
            # If wallet has tokens, try to get the first one using tokenOfOwnerByIndex
            try:
                # ERC-721 Enumerable extension
                agent_id = self.identity_registry.functions.tokenOfOwnerByIndex(self.address, 0).call()
                self.agent_id = agent_id
                self._save_agent_id_to_cache(agent_id)  # Cache it!
                return self.agent_id
            except:
                # If enumerable not available, try totalSupply and iterate
                try:
                    total_supply = self.identity_registry.functions.totalSupply().call()
                    
                    # Check recent tokens first (more efficient)
                    for potential_id in range(total_supply, max(0, total_supply - 100), -1):
                        try:
                            owner = self.identity_registry.functions.ownerOf(potential_id).call()
                            if owner.lower() == self.address.lower():
                                self.agent_id = potential_id
                                self._save_agent_id_to_cache(potential_id)  # Cache it!
                                return self.agent_id
                        except:
                            continue
                    
                    # Check older tokens
                    for potential_id in range(1, min(101, total_supply + 1)):
                        try:
                            owner = self.identity_registry.functions.ownerOf(potential_id).call()
                            if owner.lower() == self.address.lower():
                                self.agent_id = potential_id
                                self._save_agent_id_to_cache(potential_id)  # Cache it!
                                return self.agent_id
                        except:
                            continue
                except:
                    pass
                    
        except Exception as e:
            rprint(f"[yellow]⚠️  Could not check agent ownership: {e}[/yellow]")
        
        return None
    
    def _get_cache_file_path(self) -> str:
        """Get the path to the agent ID cache file."""
        import os
        return os.path.join(os.getcwd(), "chaoschain_agent_ids.json")
    
    def _load_agent_id_from_cache(self) -> Optional[int]:
        """Load agent ID from local cache file.
        
        Cache format: {
            "network_chainId": {
                "wallet_address": {
                    "agent_id": 1234,
                    "timestamp": "2025-12-19T12:00:00",
                    "domain": "agent.example.com"
                }
            }
        }
        """
        import os
        import json
        
        cache_file = self._get_cache_file_path()
        if not os.path.exists(cache_file):
            return None
        
        try:
            with open(cache_file, 'r') as f:
                cache = json.load(f)
            
            chain_key = str(self.w3.eth.chain_id)
            wallet_key = self.address.lower()
            
            if chain_key in cache and wallet_key in cache[chain_key]:
                return cache[chain_key][wallet_key].get("agent_id")
            
        except Exception as e:
            rprint(f"[dim]⚠️ Cache read error: {e}[/dim]")
        
        return None
    
    def _save_agent_id_to_cache(self, agent_id: int) -> None:
        """Save agent ID to local cache file."""
        import os
        import json
        from datetime import datetime
        
        cache_file = self._get_cache_file_path()
        
        # Load existing cache or create new
        cache = {}
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r') as f:
                    cache = json.load(f)
            except:
                cache = {}
        
        chain_key = str(self.w3.eth.chain_id)
        wallet_key = self.address.lower()
        
        if chain_key not in cache:
            cache[chain_key] = {}
        
        cache[chain_key][wallet_key] = {
            "agent_id": agent_id,
            "timestamp": datetime.now().isoformat(),
            "domain": self.agent_domain if hasattr(self, 'agent_domain') else ""
        }
        
        try:
            with open(cache_file, 'w') as f:
                json.dump(cache, f, indent=2)
            rprint(f"[dim]📦 Cached agent ID {agent_id} for {wallet_key[:10]}...[/dim]")
        except Exception as e:
            rprint(f"[yellow]⚠️  Could not cache agent ID: {e}[/yellow]")
    
    def set_cached_agent_id(self, agent_id: int) -> None:
        """Manually set the agent ID (useful when known from external source).
        
        This sets both the in-memory agent_id AND saves to cache.
        
        Args:
            agent_id: The ERC-8004 agent ID to cache
            
        Example:
            ```python
            # If you already know your agent ID from previous registration
            agent.set_cached_agent_id(1234)
            ```
        """
        self.agent_id = agent_id
        self._save_agent_id_to_cache(agent_id)
        rprint(f"[green]✅ Agent ID set: {agent_id}[/green]")
    
    def get_reputation_score(self, agent_id: Optional[int] = None) -> float:
        """
        Get reputation score from ERC-8004 Reputation Registry.
        
        Fetches all feedback for the agent and computes an average score.
        
        Args:
            agent_id: Agent ID (defaults to self.agent_id)
        
        Returns:
            Average reputation score (0-100)
        
        Example:
            ```python
            my_reputation = agent.get_reputation_score()
            print(f"My reputation: {my_reputation}/100")
            ```
        """
        if agent_id is None:
            agent_id = self.agent_id
        
        if not agent_id:
            rprint("[yellow]⚠️  Agent not registered, cannot fetch reputation[/yellow]")
            return 0.0
        
        try:
            # Get Reputation Registry address
            reputation_registry_address = self.registry.functions.getReputationRegistry().call()
            
            if reputation_registry_address == "0x0000000000000000000000000000000000000000":
                rprint("[yellow]⚠️  Reputation Registry not set[/yellow]")
                return 0.0
            
            # Check if it's a deployed contract
            code = self.w3.eth.get_code(reputation_registry_address)
            if code == b'' or code == b'0x':
                rprint("[yellow]⚠️  Reputation Registry not deployed[/yellow]")
                return 0.0
            
            # Load Reputation Registry ABI
            reputation_abi = self._load_abi("IERC8004Reputation")
            reputation_registry = self.w3.eth.contract(
                address=reputation_registry_address,
                abi=reputation_abi
            )
            
            # Get feedback count for this agent
            # Note: ERC-8004 Reputation doesn't have a direct "getFeedbackCount" method
            # We'll need to query events or use a helper method
            # For now, return a default score (in production, query feedback events)
            
            # TODO: Query FeedbackGiven events and compute average
            # For MVP, return a placeholder
            rprint(f"[yellow]⚠️  Reputation fetching not fully implemented (agent_id: {agent_id})[/yellow]")
            return 75.0  # Placeholder score
            
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to fetch reputation: {e}[/yellow]")
            return 0.0
    
    def set_agent_metadata(self, key: str, value: bytes) -> TransactionHash:
        """
        Set on-chain metadata for this agent (ERC-8004 v1.0).
        
        Per ERC-8004 spec: "The registry extends ERC-721 by adding getMetadata() 
        and setMetadata() functions for optional extra on-chain agent metadata."
        
        Examples of keys: "agentWallet", "agentName", custom application keys.
        
        Args:
            key: Metadata key (string)
            value: Metadata value as bytes
            
        Returns:
            Transaction hash
            
        Raises:
            AgentRegistrationError: If agent is not registered
            ContractError: If transaction fails
        """
        if not self.agent_id:
            raise AgentRegistrationError("Agent must be registered before setting metadata")
        
        try:
            rprint(f"[yellow]📝 Setting metadata '{key}' for agent #{self.agent_id}[/yellow]")
            
            # v1.0: setMetadata(uint256 agentId, string key, bytes value)
            contract_call = self.identity_registry.functions.setMetadata(
                self.agent_id,
                key,
                value
            )
            
            # Build and send transaction
            gas_estimate = contract_call.estimate_gas({'from': self.address})
            gas_limit = int(gas_estimate * 1.2)
            
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': gas_limit,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            # Sign and send
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                rprint(f"[green]✅ Metadata '{key}' set successfully[/green]")
                return tx_hash.hex()
            else:
                raise ContractError("Metadata update transaction failed")
                
        except Exception as e:
            error_msg = str(e)
            rprint(f"[red]❌ Failed to set metadata: {error_msg}[/red]")
            raise ContractError(f"Failed to set metadata '{key}': {error_msg}")
    
    def get_agent_metadata(self, key: str, agent_id: Optional[int] = None) -> bytes:
        """
        Get on-chain metadata for an agent (ERC-8004 v1.0).
        
        Per ERC-8004 spec: "The registry extends ERC-721 by adding getMetadata() 
        and setMetadata() functions for optional extra on-chain agent metadata."
        
        Args:
            key: Metadata key to retrieve
            agent_id: Agent ID to query. If None, uses this agent's ID.
        
        Returns:
            Metadata value as bytes
            
        Raises:
            AgentRegistrationError: If querying own agent and not registered
            ContractError: If metadata retrieval fails
        """
        target_agent_id = agent_id if agent_id is not None else self.agent_id
        
        if target_agent_id is None:
            raise AgentRegistrationError("Agent ID required (either register or provide agent_id parameter)")
        
        try:
            # v1.0: getMetadata(uint256 agentId, string key) returns (bytes value)
            metadata_value = self.identity_registry.functions.getMetadata(
                target_agent_id,
                key
            ).call()
            
            rprint(f"[green]✅ Retrieved metadata '{key}' for agent #{target_agent_id}[/green]")
            return metadata_value
            
        except Exception as e:
            error_msg = str(e)
            rprint(f"[yellow]⚠️  Could not retrieve metadata '{key}': {error_msg}[/yellow]")
            raise ContractError(f"Failed to get metadata '{key}' for agent #{target_agent_id}: {error_msg}")
    
    def request_validation(
        self, 
        validator_address: str, 
        request_uri: str, 
        request_hash: Optional[str] = None
    ) -> TransactionHash:
        """
        Request validation from another agent (ERC-8004 v1.0).
        
        v1.0: Uses validator addresses and URI-based evidence storage.
        
        Args:
            validator_address: Ethereum address of the validator (not agent ID)
            request_uri: URI pointing to validation request data (IPFS, HTTP, etc.)
            request_hash: Optional KECCAK-256 hash of request data (auto-generated if not provided)
            
        Returns:
            Transaction hash
        """
        try:
            if not self.agent_id:
                raise ContractError("Agent must be registered before requesting validation")
            
            # Generate request hash if not provided
            if request_hash is None:
                import hashlib
                # Generate unique hash from validator, agent, URI, and timestamp
                hash_input = f"{validator_address}{self.agent_id}{request_uri}{self.w3.eth.block_number}"
                request_hash_bytes = hashlib.sha256(hash_input.encode()).digest()
                request_hash = '0x' + request_hash_bytes.hex()
            
            # Convert hash to bytes32 if needed
            if isinstance(request_hash, str):
                if request_hash.startswith('0x'):
                    request_hash_bytes = bytes.fromhex(request_hash[2:])
                else:
                    request_hash_bytes = bytes.fromhex(request_hash)
            else:
                request_hash_bytes = request_hash
            
            # Ensure 32 bytes
            if len(request_hash_bytes) != 32:
                raise ValueError("Request hash must be 32 bytes")
            
            rprint(f"[yellow]📋 Requesting validation from {validator_address[:10]}...[/yellow]")
            
            # v1.0: validationRequest(validatorAddress, agentId, requestUri, requestHash)
            contract_call = self.validation_registry.functions.validationRequest(
                validator_address,
                self.agent_id,
                request_uri,
                request_hash_bytes
            )
            
            # Build and send transaction
            gas_estimate = contract_call.estimate_gas({'from': self.address})
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': int(gas_estimate * 1.2),
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                rprint(f"[green]✅ Validation request submitted: {tx_hash.hex()[:10]}...[/green]")
                return tx_hash.hex()
            else:
                raise ContractError("Validation request transaction failed")
                
        except Exception as e:
            raise ContractError(f"Failed to request validation: {str(e)}")
    
    def submit_validation_response(
        self,
        request_hash: str,
        response: int,
        response_uri: str = "",
        response_hash: Optional[str] = None,
        tag: str = ""
    ) -> TransactionHash:
        """
        Submit a validation response (ERC-8004 v1.0).
        
        v1.0: Uses requestHash from the validation request and supports URIs for evidence.
        
        Args:
            request_hash: Hash of the validation request
            response: Validation response (0-100, where 0=failed, 100=passed)
            response_uri: Optional URI pointing to validation evidence
            response_hash: Optional KECCAK-256 hash of response data
            tag: Optional tag for categorization
            
        Returns:
            Transaction hash
        """
        try:
            # Validate response range
            response = min(100, max(0, int(response)))
            
            # Convert request hash to bytes32
            if isinstance(request_hash, str):
                if request_hash.startswith('0x'):
                    request_hash_bytes = bytes.fromhex(request_hash[2:])
                else:
                    request_hash_bytes = bytes.fromhex(request_hash)
            else:
                request_hash_bytes = request_hash
            
            # Ensure 32 bytes
            if len(request_hash_bytes) != 32:
                raise ValueError("Request hash must be 32 bytes")
            
            # Convert response hash to bytes32 if provided
            response_hash_bytes = b'\x00' * 32  # Default empty hash
            if response_hash:
                if isinstance(response_hash, str):
                    if response_hash.startswith('0x'):
                        response_hash_bytes = bytes.fromhex(response_hash[2:])
                    else:
                        response_hash_bytes = bytes.fromhex(response_hash)
                else:
                    response_hash_bytes = response_hash
            
            # Convert tag to bytes32
            tag_bytes = b'\x00' * 32  # Default empty tag
            if tag:
                tag_encoded = tag.encode()[:32]  # Truncate to 32 bytes if needed
                tag_bytes = tag_encoded + b'\x00' * (32 - len(tag_encoded))  # Pad with zeros
            
            rprint(f"[yellow]✍️  Submitting validation response: {response}/100[/yellow]")
            
            # v1.0: validationResponse(requestHash, response, responseUri, responseHash, tag)
            contract_call = self.validation_registry.functions.validationResponse(
                request_hash_bytes,
                response,
                response_uri,
                response_hash_bytes,
                tag_bytes
            )
            
            # Build and send transaction
            gas_estimate = contract_call.estimate_gas({'from': self.address})
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': int(gas_estimate * 1.2),
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                rprint(f"[green]✅ Validation response submitted: {tx_hash.hex()[:10]}...[/green]")
                return tx_hash.hex()
            else:
                raise ContractError("Validation response transaction failed")
            
        except Exception as e:
            raise ContractError(f"Failed to submit validation response: {str(e)}")

    def generate_feedback_authorization(
        self,
        agent_id: AgentID,
        client_address: str,
        index_limit: int,
        expiry: int
    ) -> bytes:
        """
        DEPRECATED: Generate EIP-191 signed feedback authorization.
        
        ERC-8004 Jan 2026 REMOVED the feedbackAuth requirement.
        Feedback submission is now permissionless - any clientAddress can submit directly.
        
        This method is kept for backward compatibility only.
        New code should call give_feedback() directly without authorization.
        
        Args:
            agent_id: Target agent ID receiving feedback
            client_address: Address of the client giving feedback
            index_limit: Maximum feedback index this authorization permits
            expiry: Unix timestamp when authorization expires
            
        Returns:
            Signed feedbackAuth bytes (DEPRECATED - not used by Jan 2026 spec)
        """
        import warnings
        warnings.warn(
            "generate_feedback_authorization is DEPRECATED. "
            "ERC-8004 Jan 2026 removed feedbackAuth - feedback is now permissionless. "
            "Call give_feedback() directly without authorization.",
            DeprecationWarning,
            stacklevel=2
        )
        
        try:
            # Pack the FeedbackAuth struct (7 fields) - DEPRECATED
            feedback_auth_data = self.w3.solidity_keccak(
                ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
                [
                    agent_id,
                    client_address,
                    index_limit,
                    expiry,
                    self.chain_id,
                    self.contract_addresses.identity_registry,
                    self.address  # signer address (agent owner)
                ]
            )
            
            # EIP-191 personal sign format
            message_hash = self.w3.solidity_keccak(
                ['string', 'bytes32'],
                ['\x19Ethereum Signed Message:\n32', feedback_auth_data]
            )
            
            # Sign with agent's private key
            account = self.wallet_manager.wallets[self.agent_name]
            from eth_account.messages import encode_defunct
            signed_message = account.sign_message(encode_defunct(hexstr=message_hash.hex()))
            signature_bytes = bytes(signed_message.signature)
            
            # Pack struct data + signature (224 bytes + 65 bytes = 289 bytes)
            struct_bytes = (
                agent_id.to_bytes(32, 'big') +
                bytes.fromhex(client_address[2:].zfill(40)) +
                index_limit.to_bytes(8, 'big') +
                bytes(24) +
                expiry.to_bytes(32, 'big') +
                self.chain_id.to_bytes(32, 'big') +
                bytes.fromhex(self.contract_addresses.identity_registry[2:].zfill(40)) +
                bytes.fromhex(self.address[2:].zfill(40))
            )
            
            return struct_bytes + signature_bytes
            
        except Exception as e:
            raise ContractError(f"Failed to generate feedback authorization: {str(e)}")
    
    def give_feedback(
        self,
        agent_id: AgentID,
        score: int,
        tag1: str = "",
        tag2: str = "",
        endpoint: str = "",
        feedback_uri: str = "",
        feedback_hash: Optional[str] = None
    ) -> TransactionHash:
        """
        Submit feedback for another agent (ERC-8004 Jan 2026).
        
        Jan 2026 KEY CHANGES:
        - REMOVED feedbackAuth parameter - feedback is now permissionless
        - ADDED endpoint parameter for the endpoint being reviewed
        - tags are now string type (not bytes32)
        
        Any clientAddress can submit feedback directly without pre-authorization.
        Spam mitigation is handled via filtering by reviewer/clientAddress off-chain.
        
        Args:
            agent_id: Target agent ID receiving feedback
            score: Feedback score (0-100)
            tag1: Optional first tag for categorization (string)
            tag2: Optional second tag for categorization (string)
            endpoint: Optional endpoint URI being reviewed
            feedback_uri: Optional URI to detailed feedback data (IPFS, etc.)
            feedback_hash: Optional KECCAK-256 hash of feedback content
            
        Returns:
            Transaction hash
        """
        try:
            # Validate score
            score = min(100, max(0, int(score)))
            
            # Jan 2026: Tags are now string type (no bytes32 conversion needed)
            
            # Convert feedback hash to bytes32 if provided
            feedback_hash_bytes = b'\x00' * 32
            if feedback_hash:
                if isinstance(feedback_hash, str):
                    if feedback_hash.startswith('0x'):
                        feedback_hash_bytes = bytes.fromhex(feedback_hash[2:])
                    else:
                        feedback_hash_bytes = bytes.fromhex(feedback_hash)
            
            rprint(f"[yellow]💬 Submitting feedback: {score}/100 for agent #{agent_id}[/yellow]")
            
            # Jan 2026: giveFeedback(agentId, score, tag1, tag2, endpoint, feedbackURI, feedbackHash)
            # NO feedbackAuth parameter - permissionless feedback
            contract_call = self.reputation_registry.functions.giveFeedback(
                agent_id,
                score,
                tag1,           # string
                tag2,           # string
                endpoint,       # NEW: endpoint parameter
                feedback_uri,   # string
                feedback_hash_bytes
            )
            
            # Build and send transaction
            gas_estimate = contract_call.estimate_gas({'from': self.address})
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': int(gas_estimate * 1.2),
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                rprint(f"[green]✅ Feedback submitted: {tx_hash.hex()[:10]}...[/green]")
                return tx_hash.hex()
            else:
                raise ContractError("Feedback submission failed")
                
        except Exception as e:
            raise ContractError(f"Failed to submit feedback: {str(e)}")
    
    def create_feedback_with_payment(
        self,
        agent_id: AgentID,
        score: int,
        payment_proof: Optional['PaymentProof'] = None,
        tag1: str = "",
        tag2: str = "",
        endpoint: str = "",
        skill: Optional[str] = None,
        task: Optional[str] = None,
        domain: Optional[str] = None,
        capability: Optional[str] = None,
        mcp_tool_name: Optional[str] = None,
        **additional_fields
    ) -> Tuple[str, str]:
        """
        Create ERC-8004 Jan 2026 compliant feedback JSON with optional payment proof.
        
        Jan 2026 KEY CHANGES:
        - REMOVED feedbackAuth from feedback structure (permissionless feedback)
        - ADDED endpoint parameter for endpoint being reviewed
        - ADDED domain field (as-defined-by-OASF)
        - RENAMED proof_of_payment to proofOfPayment
        
        This is a convenience method that:
        1. Generates the feedback JSON structure per ERC-8004 Jan 2026 spec
        2. Optionally includes x402 payment proof
        3. Uploads to storage (IPFS/0G)
        4. Returns (feedback_uri, feedback_hash) ready for give_feedback()
        
        Args:
            agent_id: Target agent ID receiving feedback
            score: Feedback score (0-100)
            payment_proof: Optional PaymentProof from payment execution
            tag1: Optional first tag for categorization
            tag2: Optional second tag for categorization
            endpoint: Optional endpoint URI being reviewed
            skill: Optional A2A/OASF skill identifier
            task: Optional A2A task identifier
            domain: Optional OASF domain identifier
            capability: Optional MCP capability ("prompts", "resources", "tools", "completions")
            mcp_tool_name: Optional MCP tool/prompt/resource name
            **additional_fields: Any additional custom fields
        
        Returns:
            Tuple of (feedback_uri, feedback_hash) ready for give_feedback()
        
        Example:
            # Execute payment
            payment_proof = sdk.x402_manager.execute_agent_payment(
                from_agent="Alice",
                to_agent="Bob",
                amount_usdc=10.0,
                service_description="Data analysis"
            )
            
            # Create feedback with payment proof (Jan 2026 compliant - NO feedbackAuth!)
            uri, hash = agent.create_feedback_with_payment(
                agent_id=server_agent_id,
                score=100,
                payment_proof=payment_proof,
                skill="data-analysis",
                task="market-research",
                endpoint="https://agent.example.com/api"
            )
            
            # Submit feedback (permissionless - no authorization needed!)
            agent.give_feedback(agent_id, score, tag1="quality", endpoint=endpoint, feedback_uri=uri, feedback_hash=hash)
        """
        from datetime import datetime, timezone
        import json
        import hashlib
        
        # Build ERC-8004 Jan 2026 compliant feedback structure
        feedback_data = {
            # MUST fields (per Jan 2026 spec)
            "agentRegistry": f"eip155:{self.network.value.chain_id}:{self.identity_registry.address}",
            "agentId": int(agent_id),
            "clientAddress": f"eip155:{self.network.value.chain_id}:{self.address}",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            # NOTE: feedbackAuth REMOVED in Jan 2026 spec
            "score": min(100, max(0, int(score))),
        }
        
        # ALL OPTIONAL fields (per Jan 2026 spec)
        if tag1:
            feedback_data["tag1"] = tag1
        if tag2:
            feedback_data["tag2"] = tag2
        if endpoint:
            feedback_data["endpoint"] = endpoint  # NEW in Jan 2026
        if skill:
            feedback_data["skill"] = skill  # "as-defined-by-A2A-or-OASF"
        if task:
            feedback_data["task"] = task
        if domain:
            feedback_data["domain"] = domain  # NEW in Jan 2026 (as-defined-by-OASF)
        if capability:
            feedback_data["capability"] = capability
        if mcp_tool_name:
            feedback_data["name"] = mcp_tool_name
        
        # Add payment proof if provided (Jan 2026: renamed to proofOfPayment)
        if payment_proof:
            from_address = self.address  # Client wallet
            
            # Get to_address from payment proof
            to_address = payment_proof.to_agent if hasattr(payment_proof, 'to_agent') else "unknown"
            if hasattr(payment_proof, 'receipt_data') and isinstance(payment_proof.receipt_data, dict):
                to_address = payment_proof.receipt_data.get('to_address', to_address)
            
            # Get network/chain ID
            chain_id = str(self.network.value.chain_id)
            if hasattr(payment_proof, 'network'):
                if isinstance(payment_proof.network, str):
                    if ':' in payment_proof.network:
                        chain_id = payment_proof.network.split(':')[-1]
                elif hasattr(payment_proof.network, 'value') and hasattr(payment_proof.network.value, 'chain_id'):
                    chain_id = str(payment_proof.network.value.chain_id)
            
            # RENAMED: proof_of_payment -> proofOfPayment (Jan 2026 spec)
            feedback_data["proofOfPayment"] = {
                "fromAddress": from_address,
                "toAddress": to_address,
                "chainId": chain_id,
                "txHash": payment_proof.transaction_hash
            }
            
            rprint(f"[cyan]💳 Including payment proof: {payment_proof.transaction_hash[:10]}...[/cyan]")
        
        # Add any additional custom fields
        feedback_data.update(additional_fields)
        
        # Convert to JSON
        feedback_json = json.dumps(feedback_data, indent=2)
        
        rprint(f"[yellow]📝 Creating feedback JSON ({len(feedback_json)} bytes)[/yellow]")
        
        # Upload to storage (IPFS or 0G)
        try:
            from .providers.storage import LocalIPFSStorage
            
            if not hasattr(self, '_feedback_storage'):
                self._feedback_storage = LocalIPFSStorage()
            
            storage_result = self._feedback_storage.put(
                feedback_json.encode('utf-8'),
                mime="application/json"
            )
            
            if not storage_result.success:
                raise Exception(f"Storage failed: {storage_result.error}")
            
            # Compute file hash (KECCAK-256 for ERC-8004 compatibility)
            file_hash = '0x' + hashlib.sha3_256(feedback_json.encode('utf-8')).hexdigest()
            
            rprint(f"[green]✅ Feedback uploaded: {storage_result.uri}[/green]")
            rprint(f"[cyan]   Hash: {file_hash[:20]}...[/cyan]")
            
            return storage_result.uri, file_hash
            
        except Exception as e:
            raise Exception(f"Failed to create feedback with payment: {str(e)}")
    
    def get_reputation(
        self,
        agent_id: Optional[int] = None,
        tag1: Optional[bytes] = None,
        tag2: Optional[bytes] = None
    ) -> List[Dict[str, Any]]:
        """
        Get reputation feedback for an agent from ERC-8004 Reputation Registry.
        
        Args:
            agent_id: Agent ID to query (default: this agent)
            tag1: Optional first tag filter (e.g., dimension name)
            tag2: Optional second tag filter (e.g., studio address)
            
        Returns:
            List of feedback entries
            
        Raises:
            ContractError: If query fails
        """
        try:
            from rich import print as rprint
            
            # Use this agent's ID if not specified
            if agent_id is None:
                agent_id = self.agent_id
                if agent_id is None:
                    raise AgentRegistrationError("Agent not registered")
            
            rprint(f"[cyan]→[/cyan] Querying reputation for agent {agent_id}")
            
            # Query reputation registry
            # Note: This is a simplified version. In production, you'd need to:
            # 1. Query feedback count
            # 2. Iterate through feedback entries
            # 3. Filter by tags if provided
            # 4. Fetch feedbackUri content from IPFS
            
            # Get reputation registry
            reputation_registry = self.w3.eth.contract(
                address=self.contract_addresses.reputation_registry,
                abi=self._get_reputation_registry_abi()
            )
            
            # Get all clients who gave feedback
            clients = reputation_registry.functions.getClients(agent_id).call()
            
            if not clients:
                rprint(f"[dim]No reputation feedback found for agent {agent_id}[/dim]")
                return []
            
            rprint(f"[dim]Found feedback from {len(clients)} client(s)[/dim]")
            
            # Collect all feedback
            all_feedback = []
            
            for client in clients:
                # Get last index for this client
                last_index = reputation_registry.functions.getLastIndex(agent_id, client).call()
                
                # Read all feedback from this client
                for idx in range(last_index):
                    try:
                        # readFeedback returns (score, tag1, tag2, isRevoked)
                        score, feedback_tag1, feedback_tag2, is_revoked = reputation_registry.functions.readFeedback(
                            agent_id,
                            client,
                            idx
                        ).call()
                        
                        # Filter by tags if provided
                        if tag1 and feedback_tag1 != tag1:
                            continue
                        if tag2 and feedback_tag2 != tag2:
                            continue
                        
                        if not is_revoked:
                            all_feedback.append({
                                'client': client,
                                'score': score,
                                'tag1': feedback_tag1.hex() if isinstance(feedback_tag1, bytes) else str(feedback_tag1),
                                'tag2': feedback_tag2.hex() if isinstance(feedback_tag2, bytes) else str(feedback_tag2),
                                'index': idx
                            })
                    except Exception as e:
                        rprint(f"[dim]Error reading feedback {idx}: {e}[/dim]")
            
            if all_feedback:
                rprint(f"[green]✓[/green] Found {len(all_feedback)} reputation entries")
            else:
                rprint(f"[dim]No matching reputation feedback found[/dim]")
            
            return all_feedback
            
        except Exception as e:
            raise ContractError(f"Failed to get reputation: {str(e)}")
    
    def get_reputation_summary(
        self,
        agent_id: Optional[int] = None,
        client_addresses: Optional[List[str]] = None,
        tag1: Optional[bytes] = None,
        tag2: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """
        Get reputation summary for an agent (count and average score).
        
        Args:
            agent_id: Agent ID to query (default: this agent)
            client_addresses: Optional list of client addresses to filter by
            tag1: Optional first tag filter (e.g., dimension name)
            tag2: Optional second tag filter (e.g., studio address)
            
        Returns:
            Dictionary with count and averageScore
            
        Raises:
            ContractError: If query fails
        """
        try:
            from rich import print as rprint
            
            # Use this agent's ID if not specified
            if agent_id is None:
                agent_id = self.agent_id
                if agent_id is None:
                    raise AgentRegistrationError("Agent not registered")
            
            # Get reputation registry
            reputation_registry = self.w3.eth.contract(
                address=self.contract_addresses.reputation_registry,
                abi=self._get_reputation_registry_abi()
            )
            
            # Convert client addresses to checksummed format
            clients = []
            if client_addresses:
                clients = [self.w3.to_checksum_address(addr) for addr in client_addresses]
            
            # Convert tags to bytes32 if needed
            tag1_bytes = tag1 if isinstance(tag1, bytes) else b'\x00' * 32
            tag2_bytes = tag2 if isinstance(tag2, bytes) else b'\x00' * 32
            
            # Call getSummary
            count, avg_score = reputation_registry.functions.getSummary(
                agent_id,
                clients,
                tag1_bytes,
                tag2_bytes
            ).call()
            
            rprint(f"[green]✓[/green] Reputation summary: {count} entries, avg {avg_score}/100")
            
            return {
                'count': count,
                'averageScore': avg_score
            }
            
        except Exception as e:
            raise ContractError(f"Failed to get reputation summary: {str(e)}")
    
    def submit_score_vector(
        self,
        studio_address: str,
        data_hash: bytes,
        score_vector: List[int]
    ) -> TransactionHash:
        """
        Submit score vector directly to StudioProxy (simpler alternative to commit-reveal).
        
        This is the simpler method for verifiers to submit scores without the commit-reveal
        protocol. Use this when commit-reveal deadlines are not set.
        
        Per ChaosChain_Implementation_Plan.md:
        - Verifier Agent monitors StudioProxy for new work submissions
        - VA fetches full EvidencePackage and performs causal audit
        - VA generates ScoreVector and submits to StudioProxy
        
        Args:
            studio_address: The StudioProxy contract address
            data_hash: The work hash (bytes32) being scored
            score_vector: Multi-dimensional score vector (list of uint8 scores 0-100)
                         e.g., [initiative, collaboration, reasoning_depth, compliance, efficiency]
        
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If score submission fails
            
        Example:
            ```python
            # Verifier submits scores after causal audit
            scores = [85, 90, 88, 95, 82]  # Initiative, Collab, Reasoning, Compliance, Efficiency
            tx_hash = agent.submit_score_vector(
                studio_address="0x123...",
                data_hash=work_data_hash,
                score_vector=scores
            )
            ```
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.w3.to_checksum_address(studio_address)
            
            # StudioProxy ABI for submitScoreVector
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "scoreVector", "type": "bytes"}
                    ],
                    "name": "submitScoreVector",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            studio_proxy = self.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Encode score vector as ABI-encoded bytes
            # Contract expects: abi.encode(uint8, uint8, uint8, uint8, uint8) = 160 bytes
            # Each uint8 is padded to 32 bytes in ABI encoding
            from eth_abi import encode
            
            # Ensure we have exactly 5 scores (pad with 0 if needed)
            scores_padded = (score_vector + [0, 0, 0, 0, 0])[:5]
            
            # ABI encode as 5 uint8s - this produces 160 bytes
            score_bytes = encode(['uint8', 'uint8', 'uint8', 'uint8', 'uint8'], scores_padded)
            
            rprint(f"[cyan]📊 Submitting score vector to Studio {studio_address[:10]}...[/cyan]")
            rprint(f"   Data Hash: {data_hash.hex()[:16]}...")
            rprint(f"   Scores: {score_vector}")
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            # Build transaction
            tx = studio_proxy.functions.submitScoreVector(
                data_hash,
                score_bytes
            ).build_transaction({
                'from': account.address,
                'nonce': self.w3.eth.get_transaction_count(account.address),
                'gas': 200000,
                'gasPrice': self.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.w3.eth.account.sign_transaction(tx, account.key)
            raw_transaction = getattr(signed_tx, 'raw_transaction', getattr(signed_tx, 'rawTransaction', None))
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt['status'] != 1:
                raise ContractError("Score submission transaction failed")
            
            tx_hash_hex = tx_hash.hex()
            rprint(f"[green]✅ Score vector submitted: {tx_hash_hex[:10]}...[/green]")
            
            return tx_hash_hex
            
        except Exception as e:
            raise ContractError(f"Failed to submit score vector: {str(e)}")
    
    def submit_score_vector_for_worker(
        self,
        studio_address: str,
        data_hash: bytes,
        worker_address: str,
        score_vector: List[int]
    ) -> TransactionHash:
        """
        Submit score vector for a SPECIFIC WORKER in multi-agent tasks (§3.1, §4.2).
        
        This is the CORRECT method for multi-agent work:
        - Each verifier evaluates EACH WORKER from DKG causal analysis
        - Submits separate score vector for each worker
        - Contract calculates per-worker consensus
        - Each worker gets THEIR OWN reputation scores
        
        Args:
            studio_address: The StudioProxy contract address
            data_hash: The work hash (bytes32) being scored
            worker_address: The worker being scored
            score_vector: Multi-dimensional score vector for THIS worker (list of uint8 scores 0-100)
                         e.g., [initiative, collaboration, reasoning_depth, compliance, efficiency]
        
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If score submission fails
            
        Example:
            ```python
            # Verifier submits scores for Alice FROM DKG analysis
            scores_alice = [85, 60, 70, 95, 80]  # High initiative (root node)
            tx_hash = agent.submit_score_vector_for_worker(
                studio_address="0x123...",
                data_hash=work_data_hash,
                worker_address="0xAlice...",
                score_vector=scores_alice
            )
            
            # Verifier submits scores for Bob FROM DKG analysis
            scores_bob = [65, 90, 75, 95, 85]  # High collaboration (central node)
            tx_hash = agent.submit_score_vector_for_worker(
                studio_address="0x123...",
                data_hash=work_data_hash,
                worker_address="0xBob...",
                score_vector=scores_bob
            )
            ```
        """
        try:
            from rich import print as rprint
            
            # Checksum addresses
            studio_address = self.w3.to_checksum_address(studio_address)
            worker_address = self.w3.to_checksum_address(worker_address)
            
            # StudioProxy ABI for submitScoreVectorForWorker
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "worker", "type": "address"},
                        {"name": "scoreVector", "type": "bytes"}
                    ],
                    "name": "submitScoreVectorForWorker",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            studio_proxy = self.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Encode score vector as ABI-encoded bytes
            from eth_abi import encode
            
            # Ensure we have exactly 5 scores (pad with 0 if needed)
            scores_padded = (score_vector + [0, 0, 0, 0, 0])[:5]
            
            # ABI encode as 5 uint8s - this produces 160 bytes
            score_bytes = encode(['uint8', 'uint8', 'uint8', 'uint8', 'uint8'], scores_padded)
            
            rprint(f"[cyan]📊 Submitting per-worker score vector to Studio {studio_address[:10]}...[/cyan]")
            rprint(f"   Worker: {worker_address[:10]}...")
            rprint(f"   Data Hash: {data_hash.hex()[:16]}...")
            rprint(f"   Scores: {score_vector}")
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            # Build transaction
            tx = studio_proxy.functions.submitScoreVectorForWorker(
                data_hash,
                worker_address,
                score_bytes
            ).build_transaction({
                'from': account.address,
                'nonce': self.w3.eth.get_transaction_count(account.address),
                'gas': 250000,  # Slightly more gas for per-worker submission
                'gasPrice': self.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.w3.eth.account.sign_transaction(tx, account.key)
            raw_transaction = getattr(signed_tx, 'raw_transaction', getattr(signed_tx, 'rawTransaction', None))
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt['status'] != 1:
                raise ContractError("Per-worker score submission transaction failed")
            
            tx_hash_hex = tx_hash.hex()
            rprint(f"[green]✅ Per-worker score vector submitted for {worker_address[:10]}...: {tx_hash_hex[:10]}...[/green]")
            
            return tx_hash_hex
            
        except Exception as e:
            raise ContractError(f"Failed to submit per-worker score vector: {str(e)}")
    
    def _generate_feedback_auth(
        self,
        agent_id: int,
        rewards_distributor: str
    ) -> bytes:
        """
        DEPRECATED: Generate EIP-712 signed feedbackAuth for reputation publishing.
        
        ERC-8004 Jan 2026 REMOVED the feedbackAuth requirement.
        Feedback submission is now permissionless - any clientAddress can submit directly.
        
        This method is kept for backward compatibility with existing contracts
        but will be removed in a future version.
        
        Args:
            agent_id: The agent's ERC-8004 identity ID
            rewards_distributor: Address of RewardsDistributor contract
            
        Returns:
            bytes: Full feedbackAuth (289 bytes) - DEPRECATED, not needed by Jan 2026 spec
            
        Raises:
            ContractError: If signature generation fails
        """
        import warnings
        warnings.warn(
            "_generate_feedback_auth is DEPRECATED. "
            "ERC-8004 Jan 2026 removed feedbackAuth - feedback is now permissionless.",
            DeprecationWarning,
            stacklevel=2
        )
        
        try:
            # Get account
            account = self.wallet_manager.wallets[self.agent_name]
            
            # FeedbackAuth parameters (DEPRECATED)
            agent_id_param = agent_id
            client_address_param = self.w3.to_checksum_address(rewards_distributor)
            index_limit = 1000
            expiry = int(time.time()) + (365 * 24 * 60 * 60)
            chain_id = self.w3.eth.chain_id
            identity_registry_param = self.contract_addresses.identity_registry
            signer_address = account.address
            
            # Encode the struct (224 bytes)
            encoded_struct = abi_encode(
                ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
                [
                    agent_id_param,
                    client_address_param,
                    index_limit,
                    expiry,
                    chain_id,
                    identity_registry_param,
                    signer_address
                ]
            )
            
            message_hash = self.w3.keccak(encoded_struct)
            
            from eth_account.messages import encode_defunct
            signable_message = encode_defunct(message_hash)
            signed_message = self.w3.eth.account.sign_message(
                signable_message,
                private_key=account.key
            )
            
            full_feedback_auth = encoded_struct + signed_message.signature
            
            return full_feedback_auth
            
        except Exception as e:
            raise ContractError(f"Failed to generate feedbackAuth: {str(e)}")
    
    @property
    def wallet_address(self) -> str:
        """Get the agent's wallet address."""
        return self.address