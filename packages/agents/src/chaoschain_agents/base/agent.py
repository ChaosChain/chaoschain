"""Base agent class for ChaosChain with A2A protocol support."""

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

from ..utils.wallet import WalletManager
from ..utils.arn import ARNClient
from .dkg import DKGUtils
from .evidence import EvidencePackage


@dataclass
class AgentConfig:
    """Configuration for ChaosChain agents."""
    
    agent_id: Optional[int] = None
    agent_name: str = "ChaosChain Agent"
    agent_description: str = "A ChaosChain AI agent"
    capabilities: List[str] = None
    
    # Network configuration
    rpc_url: str = "https://sepolia.base.org"
    chain_id: int = 84532  # Base Sepolia
    
    # Contract addresses
    agent_registry_address: str = ""
    chaos_core_address: str = ""
    rewards_distributor_address: str = ""
    
    # ARN configuration
    arn_ws_url: str = "wss://arn.chaoschain.io"
    arn_http_url: str = "https://arn.chaoschain.io"
    
    # IPFS configuration
    ipfs_api_url: str = "https://ipfs.infura.io:5001"
    ipfs_gateway_url: str = "https://ipfs.infura.io/ipfs/"
    
    # Wallet configuration
    private_key: Optional[str] = None
    crossmint_api_key: Optional[str] = None
    
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
    """A2A-compliant AgentCard structure."""
    
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
    Base class for all ChaosChain agents with A2A protocol support.
    
    Provides core functionality for:
    - A2A-compliant communication
    - Blockchain interaction
    - Wallet management
    - Evidence creation and verification
    - ARN connectivity
    """
    
    def __init__(self, config: AgentConfig):
        """Initialize the base agent."""
        self.config = config
        self.agent_id = config.agent_id
        
        # Initialize core components
        self.wallet_manager = WalletManager(
            private_key=config.private_key,
            crossmint_api_key=config.crossmint_api_key
        )
        
        self.w3 = Web3(Web3.HTTPProvider(config.rpc_url))
        self.arn_client = ARNClient(
            ws_url=config.arn_ws_url,
            http_url=config.arn_http_url
        )
        
        self.dkg_utils = DKGUtils()
        
        # Agent state
        self._running = False
        self._websocket = None
        self._agent_card: Optional[A2AAgentCard] = None
        
        logger.info(f"Initialized {self.__class__.__name__} with config: {config.agent_name}")
    
    @property
    def address(self) -> str:
        """Get the agent's Ethereum address."""
        return self.wallet_manager.address
    
    @property
    def agent_card(self) -> A2AAgentCard:
        """Get the A2A-compliant agent card."""
        if not self._agent_card:
            self._agent_card = self._create_agent_card()
        return self._agent_card
    
    def _create_agent_card(self) -> A2AAgentCard:
        """Create A2A-compliant agent card."""
        return A2AAgentCard(
            name=self.config.agent_name,
            description=self.config.agent_description,
            capabilities=self.config.capabilities,
            endpoints={
                "primary": f"{self.config.arn_http_url}/agent/{self.agent_id}",
                "websocket": f"{self.config.arn_ws_url}"
            },
            auth={
                "type": "signature",
                "publicKey": self.wallet_manager.public_key
            },
            chaoschain={
                "agentId": self.agent_id,
                "address": self.address,
                "version": "0.1.0",
                "studioParticipation": [],
                "verificationCapable": False
            }
        )
    
    async def register_on_chain(self) -> int:
        """Register the agent on-chain and get agent ID."""
        if not self.config.agent_registry_address:
            raise ValueError("Agent registry address not configured")
        
        # Upload agent card to IPFS
        agent_card_cid = await self._upload_to_ipfs(self.agent_card.model_dump_json())
        
        # Call agent registry contract
        # TODO: Implement contract interaction
        logger.info(f"Registering agent with card CID: {agent_card_cid}")
        
        # For now, return a placeholder ID
        self.agent_id = 1
        self.config.agent_id = self.agent_id
        return self.agent_id
    
    async def start(self) -> None:
        """Start the agent."""
        logger.info(f"Starting {self.__class__.__name__}")
        
        if not self.agent_id:
            await self.register_on_chain()
        
        self._running = True
        
        # Connect to ARN
        await self.arn_client.connect()
        
        # Subscribe to relevant channels
        await self._setup_subscriptions()
        
        # Start main agent loop
        await self._run()
    
    async def stop(self) -> None:
        """Stop the agent."""
        logger.info(f"Stopping {self.__class__.__name__}")
        self._running = False
        
        if self.arn_client:
            await self.arn_client.disconnect()
    
    async def send_a2a_message(
        self, 
        method: str, 
        params: Dict[str, Any],
        to_agent: Optional[str] = None
    ) -> str:
        """Send an A2A-compliant message."""
        message = A2AMessage(
            method=method,
            params=params,
            from_agent=str(self.agent_id),
            to_agent=to_agent
        )
        
        # Sign the message
        message_data = message.model_dump_json()
        signature = self.wallet_manager.sign_message(message_data)
        message.signature = signature
        
        # Send via ARN
        message_id = await self.arn_client.send_message(message.model_dump())
        
        logger.debug(f"Sent A2A message {method} with ID: {message_id}")
        return message_id
    
    async def create_evidence_package(
        self,
        task_type: str,
        input_data: Dict[str, Any],
        output_data: Dict[str, Any],
        reasoning: str,
        sources: List[str] = None,
        causal_links: List[str] = None
    ) -> EvidencePackage:
        """Create a DKG-compliant evidence package."""
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
        
        # Sign the evidence package
        evidence_data = evidence.to_dict()
        signature = self.wallet_manager.sign_message(json.dumps(evidence_data))
        evidence.signature = signature
        
        return evidence
    
    async def submit_evidence_to_studio(
        self,
        studio_address: str,
        evidence: EvidencePackage
    ) -> str:
        """Submit evidence package to a studio."""
        # Upload evidence to IPFS
        evidence_cid = await self._upload_to_ipfs(evidence.to_json())
        
        # Submit CID to studio contract
        # TODO: Implement contract interaction
        logger.info(f"Submitting evidence {evidence_cid} to studio {studio_address}")
        
        return evidence_cid
    
    async def _upload_to_ipfs(self, content: str) -> str:
        """Upload content to IPFS and return CID."""
        # TODO: Implement IPFS upload
        # For now, return a placeholder CID
        import hashlib
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        cid = f"Qm{content_hash[:44]}"
        
        logger.debug(f"Uploaded to IPFS: {cid}")
        return cid
    
    async def _setup_subscriptions(self) -> None:
        """Set up ARN subscriptions for relevant channels."""
        # Subscribe to agent-specific channel
        await self.arn_client.subscribe(f"agent.{self.agent_id}")
        
        # Subscribe to broadcast channel
        await self.arn_client.subscribe("broadcast")
        
        # Subscribe to studio channels if participating
        # TODO: Implement studio participation tracking
    
    async def _handle_a2a_message(self, message: Dict[str, Any]) -> None:
        """Handle incoming A2A message."""
        try:
            a2a_msg = A2AMessage(**message)
            
            # Verify signature
            if not self._verify_message_signature(a2a_msg):
                logger.warning(f"Invalid signature for message {a2a_msg.id}")
                return
            
            # Route to appropriate handler
            await self._route_message(a2a_msg)
            
        except Exception as e:
            logger.error(f"Error handling A2A message: {e}")
    
    def _verify_message_signature(self, message: A2AMessage) -> bool:
        """Verify the signature of an A2A message."""
        # TODO: Implement signature verification
        return True
    
    async def _route_message(self, message: A2AMessage) -> None:
        """Route A2A message to appropriate handler."""
        method = message.method
        
        if method == "ping":
            await self._handle_ping(message)
        elif method == "task.offer":
            await self._handle_task_offer(message)
        elif method == "verification.request":
            await self._handle_verification_request(message)
        else:
            await self.handle_custom_message(message)
    
    async def _handle_ping(self, message: A2AMessage) -> None:
        """Handle ping message."""
        await self.send_a2a_message(
            method="pong",
            params={"original_id": message.id},
            to_agent=message.from_agent
        )
    
    async def _handle_task_offer(self, message: A2AMessage) -> None:
        """Handle task offer message."""
        # Default implementation - override in subclasses
        logger.info(f"Received task offer: {message.params}")
    
    async def _handle_verification_request(self, message: A2AMessage) -> None:
        """Handle verification request message."""
        # Default implementation - override in subclasses  
        logger.info(f"Received verification request: {message.params}")
    
    @abstractmethod
    async def handle_custom_message(self, message: A2AMessage) -> None:
        """Handle custom A2A messages specific to agent type."""
        pass
    
    @abstractmethod
    async def _run(self) -> None:
        """Main agent execution loop."""
        pass
    
    async def get_reputation_score(self) -> float:
        """Get the agent's current reputation score."""
        # TODO: Implement reputation tracking
        return 0.0
    
    def is_running(self) -> bool:
        """Check if the agent is currently running."""
        return self._running 