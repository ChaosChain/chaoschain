"""
Base agent class for ChaosChain with Studio-centric architecture and A2A protocol support.

This implementation ensures that agents are fundamentally shaped by the Studio they operate within,
reflecting our core value proposition of Studio-specific accountability and verification.
"""

import asyncio
import json
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

import httpx
import websockets
from web3 import Web3
from web3.middleware import construct_sign_and_send_raw_middleware
from eth_account import Account
from loguru import logger
from pydantic import BaseModel, Field

from .context import StudioContext
from ..utils.wallet import WalletManager
from ..utils.arn import ARNClient
from .dkg import DKGUtils
from .evidence import EvidencePackage


@dataclass
class AgentConfig:
    """
    Agent-specific configuration that supplements the Studio context.
    
    This contains personal agent settings that don't come from the Studio,
    such as agent identity, private keys, and personal preferences.
    """
    agent_name: str
    agent_description: str = "A ChaosChain AI agent"
    capabilities: List[str] = None
    
    # Wallet configuration
    private_key: Optional[str] = None
    crossmint_api_key: Optional[str] = None
    
    # Personal overrides (optional - Studio context takes precedence)
    custom_arn_relay: Optional[str] = None
    custom_ipfs_gateway: Optional[str] = None
    custom_rpc_url: Optional[str] = None
    
    def __post_init__(self):
        if self.capabilities is None:
            self.capabilities = []


class A2AMessage(BaseModel):
    """A2A-compliant message structure."""
    
    jsonrpc: str = "2.0"
    method: str
    params: Dict[str, Any] = Field(default_factory=dict)
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    
    # A2A-specific fields
    from_agent: Optional[str] = None
    to_agent: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    signature: Optional[str] = None


class A2AAgentCard(BaseModel):
    """A2A-compliant AgentCard structure with ChaosChain Studio extensions."""
    
    version: str = "1.0"
    name: str
    description: str
    capabilities: List[str]
    endpoints: Dict[str, str]
    auth: Dict[str, str]
    
    # ChaosChain-specific extensions
    chaoschain: Dict[str, Any] = Field(default_factory=dict)


class BaseAgent(ABC):
    """
    Base class for all ChaosChain agents with Studio-centric architecture.
    
    This implementation ensures agents are fundamentally shaped by the Studio
    they operate within, reflecting our core value proposition of Studio-specific
    accountability and verification.
    
    Key Features:
    - Studio-centric configuration and operation
    - A2A-compliant communication
    - Blockchain interaction via Studio contracts
    - DKG-compliant evidence creation
    - ARN connectivity within Studio context
    """
    
    def __init__(self, studio_context: StudioContext, agent_config: AgentConfig):
        """
        Initialize the agent with Studio context as the primary configuration source.
        
        Args:
            studio_context: The Studio configuration that shapes this agent's behavior
            agent_config: Agent-specific settings that supplement the Studio context
        """
        # Core configuration - Studio takes precedence
        self.studio_context = studio_context
        self.agent_config = agent_config
        
        # Agent identity
        self.agent_id: Optional[int] = None
        self.agent_name = agent_config.agent_name
        
        logger.info(
            f"Initializing {self.__class__.__name__} for Studio: {studio_context.studio_name} "
            f"(ID: {studio_context.studio_id})"
        )
        
        # Initialize core components with Studio-aware configuration
        self._initialize_wallet()
        self._initialize_blockchain_connection()
        self._initialize_arn_client()
        self._initialize_utils()
        
        # Agent state
        self._running = False
        self._agent_card: Optional[A2AAgentCard] = None
        
        logger.success(
            f"Agent '{self.agent_name}' initialized for Studio '{studio_context.studio_name}' "
            f"on {'testnet' if studio_context.is_testnet() else 'mainnet'}"
        )
    
    def _initialize_wallet(self) -> None:
        """Initialize wallet manager with agent-specific configuration."""
        self.wallet_manager = WalletManager(
            private_key=self.agent_config.private_key,
            crossmint_api_key=self.agent_config.crossmint_api_key
        )
    
    def _initialize_blockchain_connection(self) -> None:
        """Initialize blockchain connection using Studio context."""
        rpc_url = (
            self.agent_config.custom_rpc_url or 
            self.studio_context.rpc_url
        )
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        logger.debug(f"Connected to blockchain: {rpc_url} (Chain ID: {self.studio_context.chain_id})")
    
    def _initialize_arn_client(self) -> None:
        """Initialize ARN client using Studio context."""
        arn_url = (
            self.agent_config.custom_arn_relay or 
            self.studio_context.arn_relay_url
        )
        
        # Convert WebSocket URL to HTTP URL for ARN client
        http_url = arn_url.replace("wss://", "https://").replace("ws://", "http://")
        
        self.arn_client = ARNClient(
            ws_url=arn_url,
            http_url=http_url
        )
        
        # Store backup relays for future use (will be used in reconnection logic)
        self._backup_arn_relays = self.studio_context.backup_arn_relays
        
        logger.debug(f"ARN client configured for: {arn_url}")
    
    def _initialize_utils(self) -> None:
        """Initialize utility classes."""
        self.dkg_utils = DKGUtils()
    
    @property
    def address(self) -> str:
        """Get the agent's Ethereum address."""
        return self.wallet_manager.address
    
    @property
    def studio_id(self) -> str:
        """Get the Studio ID this agent operates in."""
        return self.studio_context.studio_id
    
    @property
    def studio_name(self) -> str:
        """Get the Studio name this agent operates in."""
        return self.studio_context.studio_name
    
    @property
    def target_platform(self) -> Optional[str]:
        """Get the target platform from Studio context."""
        return self.studio_context.get_target_platform()
    
    @property
    def confidence_threshold(self) -> float:
        """Get the confidence threshold from Studio context."""
        return self.studio_context.get_confidence_threshold()
    
    @property
    def agent_card(self) -> A2AAgentCard:
        """Get the A2A-compliant agent card with Studio context."""
        if not self._agent_card:
            self._agent_card = self._create_agent_card()
        return self._agent_card
    
    def _create_agent_card(self) -> A2AAgentCard:
        """Create A2A-compliant agent card with Studio-specific information."""
        return A2AAgentCard(
            name=self.agent_config.agent_name,
            description=self.agent_config.agent_description,
            capabilities=self.agent_config.capabilities,
            endpoints={
                "primary": f"{self.studio_context.arn_relay_url}/agent/{self.agent_id}",
                "websocket": self.studio_context.arn_relay_url,
                "studio_proxy": self.studio_context.studio_proxy_address
            },
            auth={
                "type": "signature",
                "publicKey": self.wallet_manager.public_key
            },
            chaoschain={
                "agentId": self.agent_id,
                "address": self.address,
                "version": "0.1.0",
                "studioContext": {
                    "studioId": self.studio_context.studio_id,
                    "studioName": self.studio_context.studio_name,
                    "studioType": self.studio_context.studio_type,
                    "proxyAddress": self.studio_context.studio_proxy_address,
                    "logicAddress": self.studio_context.studio_logic_address
                },
                "customRules": self.studio_context.custom_rules,
                "verificationCapable": False
            }
        )
    
    async def connect_to_arn(self) -> None:
        """Connect to the ARN network for this Studio."""
        logger.info(f"Connecting to ARN for Studio: {self.studio_context.studio_name}")
        await self.arn_client.connect()
        
        # Subscribe to Studio-specific channels
        await self._setup_studio_subscriptions()
        
        logger.success(f"Connected to ARN for Studio: {self.studio_id}")
    
    async def load_wallet(self) -> None:
        """Load or create wallet for the agent."""
        if not self.wallet_manager.private_key:
            logger.info("No private key provided, generating new wallet")
            # Generate new wallet if none provided
            self.wallet_manager = WalletManager()
        
        logger.info(f"Agent wallet address: {self.address}")
    
    async def register_on_chain(self) -> int:
        """Register the agent on-chain using Studio's AgentRegistry."""
        if not self.studio_context.agent_registry_address:
            raise ValueError("Agent registry address not configured in Studio context")
        
        # Upload agent card to IPFS
        agent_card_cid = await self._upload_to_ipfs(self.agent_card.model_dump_json())
        
        # Call agent registry contract
        # TODO: Implement contract interaction
        logger.info(
            f"Registering agent with registry: {self.studio_context.agent_registry_address}, "
            f"Card CID: {agent_card_cid}"
        )
        
        # For now, return a placeholder ID
        self.agent_id = 1
        return self.agent_id
    
    async def start(self) -> None:
        """Start the agent within its Studio context."""
        logger.info(f"Starting {self.__class__.__name__} in Studio: {self.studio_context.studio_name}")
        
        # Load wallet
        await self.load_wallet()
        
        # Register on-chain if not already done
        if not self.agent_id:
            await self.register_on_chain()
        
        # Connect to ARN
        await self.connect_to_arn()
        
        self._running = True
        
        # Start Studio-aware agent loop
        await self._run()
    
    async def stop(self) -> None:
        """Stop the agent."""
        logger.info(f"Stopping {self.__class__.__name__}")
        self._running = False
        
        if self.arn_client:
            await self.arn_client.disconnect()
    
    async def create_evidence_package(
        self,
        task_type: str,
        input_data: Dict[str, Any],
        output_data: Dict[str, Any],
        reasoning: str,
        sources: List[str] = None,
        causal_links: List[str] = None
    ) -> EvidencePackage:
        """Create a DKG-compliant evidence package with Studio context."""
        evidence = EvidencePackage(
            agent_id=self.agent_id,
            task_type=task_type,
            input_data=input_data,
            output_data=output_data,
            reasoning=reasoning,
            sources=sources or [],
            causal_links=causal_links or [],
            timestamp=datetime.now(timezone.utc),
            signature=""
        )
        
        # Add Studio context to evidence
        evidence.metadata.update({
            "studio_id": self.studio_context.studio_id,
            "studio_type": self.studio_context.studio_type,
            "chain_id": self.studio_context.chain_id,
            "epoch_duration": self.studio_context.epoch_duration
        })
        
        # Sign the evidence package
        evidence_data = evidence.to_dict()
        signature = self.wallet_manager.sign_message(json.dumps(evidence_data))
        evidence.signature = signature
        
        logger.debug(f"Created evidence package for Studio: {self.studio_id}")
        return evidence
    
    async def submit_evidence_to_studio(
        self,
        evidence: EvidencePackage
    ) -> str:
        """Submit evidence package to this agent's Studio."""
        # Upload evidence to IPFS
        evidence_cid = await self._upload_to_ipfs(evidence.to_json())
        
        # Submit CID to studio proxy contract
        studio_address = self.studio_context.studio_proxy_address
        
        # TODO: Implement contract interaction
        logger.info(f"Submitting evidence {evidence_cid} to Studio proxy: {studio_address}")
        
        return evidence_cid
    
    async def send_a2a_message(
        self, 
        method: str, 
        params: Dict[str, Any],
        to_agent: Optional[str] = None,
        channel: Optional[str] = None
    ) -> str:
        """Send an A2A-compliant message within Studio context."""
        message = A2AMessage(
            method=method,
            params=params,
            from_agent=str(self.agent_id),
            to_agent=to_agent
        )
        
        # Add Studio context to message params
        message.params["studio_id"] = self.studio_context.studio_id
        message.params["studio_type"] = self.studio_context.studio_type
        
        # Sign the message
        message_data = message.model_dump_json()
        signature = self.wallet_manager.sign_message(message_data)
        message.signature = signature
        
        # Send via ARN (use Studio-specific channel if not specified)
        target_channel = channel or f"studio.{self.studio_context.studio_id}"
        message_id = await self.arn_client.send_message(message.model_dump(), target_channel)
        
        logger.debug(f"Sent A2A message {method} to Studio channel: {target_channel}")
        return message_id
    
    async def _upload_to_ipfs(self, content: str) -> str:
        """Upload content to IPFS using Studio-configured gateway."""
        # TODO: Implement actual IPFS upload using studio_context.ipfs_node_url
        # For now, return a placeholder CID
        import hashlib
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        cid = f"Qm{content_hash[:44]}"
        
        logger.debug(f"Uploaded to IPFS (placeholder): {cid}")
        return cid
    
    async def _setup_studio_subscriptions(self) -> None:
        """Set up ARN subscriptions for Studio-specific channels."""
        # Subscribe to Studio-wide channel
        await self.arn_client.subscribe(f"studio.{self.studio_context.studio_id}")
        
        # Subscribe to agent-specific channel
        if self.agent_id:
            await self.arn_client.subscribe(f"agent.{self.agent_id}")
        
        # Subscribe to Studio type-specific channels
        await self.arn_client.subscribe(f"studio_type.{self.studio_context.studio_type}")
        
        # Subscribe to broadcast channel
        await self.arn_client.subscribe("broadcast")
        
        logger.debug(f"Set up ARN subscriptions for Studio: {self.studio_context.studio_id}")
    
    def get_studio_rule(self, key: str, default: Any = None) -> Any:
        """Get a Studio-specific rule value."""
        return self.studio_context.get_custom_rule(key, default)
    
    def is_running(self) -> bool:
        """Check if the agent is currently running."""
        return self._running
    
    # Abstract methods that subclasses must implement
    @abstractmethod
    async def handle_custom_message(self, message: A2AMessage) -> None:
        """Handle custom A2A messages specific to agent type."""
        pass
    
    @abstractmethod
    async def _run(self) -> None:
        """Main agent execution loop - must be Studio-aware."""
        pass 