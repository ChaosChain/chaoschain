"""
Agent Configuration for ChaosChain Agents.

This module defines the AgentConfig class that represents an agent's individual
personality, character, and private instructions. This is the agent developer's
"secret sauce" that gets chained with the Studio's role_prompt to create the
final system prompt for LLM calls.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class AgentConfig(BaseModel):
    """
    Configuration for an individual ChaosChain agent's personality and behavior.
    
    This class represents the agent developer's unique configuration for their agent,
    including the core character prompt that defines the agent's personality, skills,
    and private instructions. This is the "secret sauce" that external developers
    bring to the ChaosChain ecosystem.
    
    The character_prompt will be chained with the Studio's role_prompt to create
    the final system prompt for LLM calls, enabling the powerful "Prompt Chaining"
    mechanism described in our architecture.
    """
    
    # Core Agent Identity
    agent_name: str = Field(..., description="Unique name for this agent")
    agent_description: str = Field(
        default="A ChaosChain AI agent",
        description="Brief description of the agent's purpose"
    )
    
    # The Agent's Personality & Character (The Secret Sauce)
    character_prompt: str = Field(
        ...,
        description="The agent's core personality, skills, and private instructions. "
                   "This defines how the agent thinks and behaves, and will be chained "
                   "with the Studio's role_prompt to create the final system prompt."
    )
    
    # Agent Capabilities & Skills
    capabilities: List[str] = Field(
        default_factory=list,
        description="List of capabilities this agent possesses"
    )
    
    # LLM Configuration
    preferred_model: str = Field(
        default="gpt-4",
        description="Preferred LLM model for this agent"
    )
    temperature: float = Field(
        default=0.7,
        ge=0.0,
        le=2.0,
        description="Temperature setting for LLM calls"
    )
    max_tokens: int = Field(
        default=2000,
        gt=0,
        description="Maximum tokens for LLM responses"
    )
    
    # Wallet Configuration
    private_key: Optional[str] = Field(
        default=None,
        description="Private key for agent wallet (optional)"
    )
    crossmint_api_key: Optional[str] = Field(
        default=None,
        description="Crossmint API key for wallet services (optional)"
    )
    
    # Personal Overrides (optional - Studio context takes precedence)
    custom_arn_relay: Optional[str] = Field(
        default=None,
        description="Custom ARN relay URL override"
    )
    custom_ipfs_gateway: Optional[str] = Field(
        default=None,
        description="Custom IPFS gateway URL override"
    )
    custom_rpc_url: Optional[str] = Field(
        default=None,
        description="Custom RPC URL override"
    )
    
    class Config:
        """Pydantic configuration."""
        validate_assignment = True
        
    @classmethod
    def create_scout_agent(
        cls,
        agent_name: str = "ScoutAgent",
        character_prompt: Optional[str] = None,
        **kwargs
    ) -> "AgentConfig":
        """
        Factory method to create a ScoutAgent configuration with a default character.
        
        Args:
            agent_name: Name for this scout agent
            character_prompt: Custom character prompt (uses default if not provided)
            **kwargs: Additional configuration options
            
        Returns:
            AgentConfig configured for a scout agent
        """
        default_character = """You are a seasoned financial analyst with a specialization in prediction markets and behavioral economics. Your core traits:

PERSONALITY:
- Methodical and data-driven in your approach
- Naturally skeptical and always verify sources
- Patient observer who waits for high-confidence opportunities
- Clear and concise in your communication

EXPERTISE:
- Expert in market microstructure and sentiment analysis
- Deep understanding of prediction market mechanics
- Skilled at identifying mispriced assets and arbitrage opportunities
- Strong grasp of statistical analysis and probability theory

DECISION-MAKING PROCESS:
- Always demand multiple data sources before making predictions
- Calculate confidence intervals and express uncertainty clearly
- Consider both fundamental analysis and market sentiment
- Never rush into predictions without thorough analysis

COMMUNICATION STYLE:
- Present findings in structured, logical format
- Always state your confidence level (0.0 to 1.0)
- Explain your reasoning step-by-step
- Flag any limitations or assumptions in your analysis"""

        return cls(
            agent_name=agent_name,
            agent_description="A prediction market analyst specializing in identifying mispriced assets",
            character_prompt=character_prompt or default_character,
            capabilities=[
                "market_analysis",
                "prediction_generation",
                "sentiment_analysis",
                "statistical_modeling",
                "risk_assessment"
            ],
            **kwargs
        )
    
    @classmethod
    def create_auditor_agent(
        cls,
        agent_name: str = "AuditorAgent",
        character_prompt: Optional[str] = None,
        **kwargs
    ) -> "AgentConfig":
        """
        Factory method to create an AuditorAgent configuration.
        
        Args:
            agent_name: Name for this auditor agent
            character_prompt: Custom character prompt (uses default if not provided)
            **kwargs: Additional configuration options
            
        Returns:
            AgentConfig configured for an auditor agent
        """
        default_character = """You are a meticulous verification specialist and fraud investigator with expertise in agent work quality assessment. Your core traits:

PERSONALITY:
- Extremely detail-oriented and thorough in all evaluations
- Impartial and objective in your assessments
- Naturally suspicious and always look for inconsistencies
- Fair but uncompromising when it comes to quality standards

EXPERTISE:
- Expert in evidence validation and source verification
- Deep knowledge of statistical methods and data analysis
- Skilled at identifying logical fallacies and reasoning errors
- Strong understanding of causal inference and methodology

VERIFICATION PROCESS:
- Systematically check all sources and data integrity
- Validate reasoning chains and logical consistency
- Assess the quality and completeness of evidence
- Flag any signs of manipulation or poor methodology

SCORING PHILOSOPHY:
- Base scores on objective criteria and reproducible metrics
- Provide detailed explanations for all score assignments
- Consider both accuracy and quality of reasoning process
- Reward innovation and penalize sloppy work"""

        return cls(
            agent_name=agent_name,
            agent_description="A verification specialist for assessing agent work quality",
            character_prompt=character_prompt or default_character,
            capabilities=[
                "evidence_verification",
                "quality_assessment",
                "fraud_detection",
                "statistical_validation",
                "reasoning_analysis"
            ],
            **kwargs
        )
    
    @classmethod
    def create_custom_agent(
        cls,
        agent_name: str,
        character_prompt: str,
        capabilities: List[str],
        **kwargs
    ) -> "AgentConfig":
        """
        Factory method to create a custom agent configuration.
        
        This is the primary method external developers would use to bring
        their own agents to the ChaosChain ecosystem.
        
        Args:
            agent_name: Unique name for the agent
            character_prompt: The agent's personality and behavior definition
            capabilities: List of the agent's capabilities
            **kwargs: Additional configuration options
            
        Returns:
            AgentConfig configured for the custom agent
        """
        return cls(
            agent_name=agent_name,
            character_prompt=character_prompt,
            capabilities=capabilities,
            **kwargs
        ) 