"""
Studio Context for ChaosChain Agents.

This module defines the StudioContext class that encapsulates all the
configuration and rules for a specific Studio that an agent operates within.
This is the core of our Studio-centric agent architecture.
"""

from typing import Any, Dict, Optional, List
from pydantic import BaseModel, Field, validator
from enum import Enum


class StudioType(str, Enum):
    """Enumeration of supported Studio types."""
    VERIFIABLE_INTELLIGENCE = "verifiable_intelligence"
    DESCI_RESEARCH = "desci_research"
    SUPPLY_CHAIN = "supply_chain"
    PREDICTION_MARKET = "prediction_market"
    CUSTOM = "custom"


class StudioContext(BaseModel):
    """
    Represents the configuration and operational context for a specific Studio.
    
    This class encapsulates all the information an agent needs to operate
    within a particular Studio, including on-chain addresses, communication
    settings, and Studio-specific rules and parameters.
    """
    
    # Core Studio Identity
    studio_id: str = Field(..., description="Unique identifier for the Studio")
    studio_name: str = Field(..., description="Human-readable name of the Studio")
    studio_type: StudioType = Field(..., description="Type/category of the Studio")
    
    # On-Chain Configuration
    studio_proxy_address: str = Field(..., description="Address of the Studio's proxy contract")
    studio_logic_address: str = Field(..., description="Address of the Studio's logic module")
    agent_registry_address: str = Field(..., description="Address of the AgentRegistry contract")
    rewards_distributor_address: str = Field(..., description="Address of the RewardsDistributor contract")
    
    # Network Configuration
    chain_id: int = Field(default=84532, description="Chain ID (default: Base Sepolia)")
    rpc_url: str = Field(default="https://sepolia.base.org", description="RPC endpoint URL")
    
    # ARN Configuration
    arn_relay_url: str = Field(..., description="Primary ARN relay URL for this Studio")
    backup_arn_relays: List[str] = Field(default_factory=list, description="Backup ARN relay URLs")
    
    # IPFS Configuration
    ipfs_gateway_url: str = Field(default="https://ipfs.io/ipfs/", description="IPFS gateway URL")
    ipfs_node_url: Optional[str] = Field(default=None, description="Direct IPFS node URL")
    
    # Studio's Mission & Role Definition
    role_prompt: str = Field(
        ...,
        description="The Studio's mission briefing and role definition for agents. "
                   "This prompt defines HOW agents should behave within this Studio's "
                   "specific economic game and will be chained with agent character_prompts."
    )
    
    # Studio-Specific Rules and Parameters
    custom_rules: Dict[str, Any] = Field(default_factory=dict, description="Studio-specific operational rules")
    
    # Economic Configuration
    minimum_stake: Optional[str] = Field(default=None, description="Minimum stake required (in wei)")
    epoch_duration: int = Field(default=3600, description="Epoch duration in seconds")
    
    # Agent Operational Settings
    max_concurrent_tasks: int = Field(default=5, description="Maximum concurrent tasks for agents")
    evidence_retention_days: int = Field(default=30, description="Days to retain evidence packages")
    
    # A2A Protocol Settings
    a2a_protocol_version: str = Field(default="1.0", description="A2A protocol version to use")
    supported_message_types: List[str] = Field(
        default_factory=lambda: ["evidence.submitted", "score.submitted", "task.available", "agent.status"],
        description="Supported A2A message types"
    )
    
    @validator('studio_proxy_address', 'studio_logic_address', 'agent_registry_address', 'rewards_distributor_address')
    def validate_ethereum_address(cls, v):
        """Validate that addresses are proper Ethereum addresses."""
        if not v.startswith('0x') or len(v) != 42:
            raise ValueError(f"Invalid Ethereum address: {v}")
        return v.lower()
    
    @validator('arn_relay_url')
    def validate_arn_url(cls, v):
        """Validate ARN relay URL format."""
        if not (v.startswith('ws://') or v.startswith('wss://')):
            raise ValueError("ARN relay URL must be a WebSocket URL (ws:// or wss://)")
        return v
    
    @validator('chain_id')
    def validate_chain_id(cls, v):
        """Validate chain ID is reasonable."""
        if v <= 0:
            raise ValueError("Chain ID must be positive")
        return v
    
    def get_custom_rule(self, key: str, default: Any = None) -> Any:
        """Get a custom rule value with optional default."""
        return self.custom_rules.get(key, default)
    
    def set_custom_rule(self, key: str, value: Any) -> None:
        """Set a custom rule value."""
        self.custom_rules[key] = value
    
    def get_target_platform(self) -> Optional[str]:
        """Get the target platform for this Studio (e.g., 'polymarket')."""
        return self.get_custom_rule("target_platform")
    
    def get_prediction_categories(self) -> List[str]:
        """Get prediction categories if this is a prediction Studio."""
        return self.get_custom_rule("prediction_categories", [])
    
    def get_confidence_threshold(self) -> float:
        """Get the confidence threshold for predictions."""
        return self.get_custom_rule("confidence_threshold", 0.7)
    
    def is_testnet(self) -> bool:
        """Check if this Studio is running on a testnet."""
        # Common testnet chain IDs
        testnet_chains = [84532, 11155111, 80001, 421614]  # Base Sepolia, Ethereum Sepolia, Polygon Mumbai, Arbitrum Sepolia
        return self.chain_id in testnet_chains
    
    def get_full_studio_info(self) -> Dict[str, Any]:
        """Get complete Studio information as a dictionary."""
        return {
            "studio_id": self.studio_id,
            "studio_name": self.studio_name,
            "studio_type": self.studio_type,
            "contracts": {
                "proxy": self.studio_proxy_address,
                "logic": self.studio_logic_address,
                "registry": self.agent_registry_address,
                "rewards": self.rewards_distributor_address
            },
            "network": {
                "chain_id": self.chain_id,
                "rpc_url": self.rpc_url,
                "is_testnet": self.is_testnet()
            },
            "arn": {
                "primary_relay": self.arn_relay_url,
                "backup_relays": self.backup_arn_relays
            },
            "custom_rules": self.custom_rules
        }
    
    @classmethod
    def create_verifiable_intelligence_studio(
        cls,
        studio_id: str = "vi-studio-001",
        studio_name: str = "Verifiable Intelligence Studio",
        arn_relay_url: str = "wss://arn-relay.chaoschain.xyz",
        target_platform: str = "polymarket",
        role_prompt: Optional[str] = None,
        **kwargs
    ) -> "StudioContext":
        """
        Factory method to create a Verifiable Intelligence Studio context.
        This is our MVP Studio type for prediction market analysis.
        """
        default_role_prompt = """You are an expert financial analyst operating within the Verifiable Intelligence Studio. Your mission:

CORE OBJECTIVE:
Your sole focus is identifying mispriced assets in prediction markets and generating high-confidence predictions that can be verified and monetized.

OPERATIONAL REQUIREMENTS:
- You must be data-driven in all analysis and decisions
- Always state your confidence level (0.0 to 1.0) in your final assessment
- Provide clear, structured reasoning that can be audited
- Focus on markets with sufficient volume and liquidity
- Never make predictions without substantial supporting evidence

QUALITY STANDARDS:
- All predictions must include multiple data sources
- Reasoning must be transparent and reproducible
- Consider both fundamental analysis and market sentiment
- Account for market inefficiencies and behavioral biases
- Flag any limitations or assumptions in your analysis

DELIVERABLE FORMAT:
Structure your output as a formal intelligence report with:
1. Executive Summary with confidence score
2. Data Sources and Methodology
3. Analysis and Reasoning
4. Risk Assessment
5. Final Prediction with rationale

Remember: Your work will be verified by the CVN. Quality and accuracy are paramount."""

        custom_rules = {
            "target_platform": target_platform,
            "prediction_categories": ["politics", "crypto", "sports", "economics"],
            "confidence_threshold": 0.7,
            "max_market_age_days": 30,
            "min_volume_threshold": 1000,
            "evidence_sources_required": ["market_data", "historical_analysis", "sentiment_analysis"]
        }
        custom_rules.update(kwargs.get("custom_rules", {}))
        
        return cls(
            studio_id=studio_id,
            studio_name=studio_name,
            studio_type=StudioType.VERIFIABLE_INTELLIGENCE,
            role_prompt=role_prompt or default_role_prompt,
            studio_proxy_address="0x0000000000000000000000000000000000000001",  # Placeholder
            studio_logic_address="0x0000000000000000000000000000000000000002",  # Placeholder
            agent_registry_address="0x0000000000000000000000000000000000000003",  # Placeholder
            rewards_distributor_address="0x0000000000000000000000000000000000000004",  # Placeholder
            arn_relay_url=arn_relay_url,
            custom_rules=custom_rules,
            **{k: v for k, v in kwargs.items() if k not in ["custom_rules", "role_prompt"]}
        )

    class Config:
        """Pydantic configuration."""
        use_enum_values = True
        validate_assignment = True 