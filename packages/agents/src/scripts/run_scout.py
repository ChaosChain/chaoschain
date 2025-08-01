#!/usr/bin/env python3
"""
ScoutAgent Runner Script for ChaosChain.

This script demonstrates the Studio-centric agent architecture by creating
a StudioContext for the "Verifiable Intelligence Studio" and running a
ScoutAgent within that context.

This is a key demonstration of our core value proposition: agents are
fundamentally shaped by the Studio they operate within.
"""

import asyncio
import os
from loguru import logger

from chaoschain_agents.base.context import StudioContext
from chaoschain_agents.base.agent import AgentConfig
from chaoschain_agents.scout.agent import ScoutAgent


async def main():
    """Main execution function."""
    logger.info("Starting ChaosChain ScoutAgent with Studio-centric architecture")
    
    # Create Studio Context for our MVP "Verifiable Intelligence Studio"
    # This is where the agent gets its operational rules and constraints
    studio_context = StudioContext.create_verifiable_intelligence_studio(
        studio_id="vi-studio-mvp-001",
        studio_name="Verifiable Intelligence Studio (MVP)",
        arn_relay_url="wss://arn-relay-testnet.chaoschain.xyz",
        target_platform="polymarket",
        custom_rules={
            "target_platform": "polymarket",
            "prediction_categories": ["politics", "crypto", "economics"],
            "confidence_threshold": 0.75,  # Higher threshold for MVP
            "max_market_age_days": 14,
            "min_volume_threshold": 5000,
            "evidence_sources_required": ["market_data", "price_history"],
            "scan_interval_seconds": 120,  # Scan every 2 minutes
            "max_predictions_per_hour": 10
        }
    )
    
    logger.info(f"Created Studio Context: {studio_context.studio_name}")
    logger.info(f"Studio Type: {studio_context.studio_type}")
    logger.info(f"Target Platform: {studio_context.get_target_platform()}")
    logger.info(f"Confidence Threshold: {studio_context.get_confidence_threshold()}")
    logger.info(f"Prediction Categories: {studio_context.get_prediction_categories()}")
    
    # Create Agent Configuration (personal agent settings)
    agent_config = AgentConfig(
        agent_name="ScoutAgent-001",
        agent_description="A prediction market scout for the Verifiable Intelligence Studio",
        capabilities=[
            "market_analysis",
            "prediction_generation", 
            "evidence_creation",
            "polymarket_integration"
        ],
        private_key=os.environ.get("SCOUT_AGENT_PRIVATE_KEY"),  # Optional
        crossmint_api_key=os.environ.get("CROSSMINT_API_KEY")   # Optional
    )
    
    logger.info(f"Created Agent Config: {agent_config.agent_name}")
    
    # Create ScoutAgent with Studio-centric initialization
    # The agent is now fundamentally shaped by the Studio it operates within
    scout_agent = ScoutAgent(
        studio_context=studio_context,
        agent_config=agent_config,
        # market_slugs=None  # Will be determined by Studio rules
    )
    
    logger.info("ScoutAgent created with Studio-centric configuration")
    
    # Demonstrate Studio-aware properties
    logger.info("=== Studio-Centric Agent Properties ===")
    logger.info(f"Studio ID: {scout_agent.studio_id}")
    logger.info(f"Studio Name: {scout_agent.studio_name}")
    logger.info(f"Target Platform: {scout_agent.target_platform}")
    logger.info(f"Confidence Threshold: {scout_agent.confidence_threshold}")
    logger.info(f"Markets to Monitor: {len(scout_agent.market_slugs)}")
    
    # Demonstrate Studio rule access
    scan_interval = scout_agent.get_studio_rule("scan_interval_seconds", 300)
    max_predictions = scout_agent.get_studio_rule("max_predictions_per_hour", 5)
    
    logger.info(f"Studio Rule - Scan Interval: {scan_interval}s")
    logger.info(f"Studio Rule - Max Predictions/Hour: {max_predictions}")
    
    try:
        # Start the agent within its Studio context
        logger.info("Starting ScoutAgent within Studio context...")
        await scout_agent.start()
        
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, stopping agent...")
        await scout_agent.stop()
        
    except Exception as e:
        logger.error(f"Error running ScoutAgent: {e}")
        await scout_agent.stop()
        raise
    
    logger.info("ScoutAgent execution completed")


def create_development_studio() -> StudioContext:
    """
    Create a development Studio context with relaxed rules for testing.
    """
    return StudioContext.create_verifiable_intelligence_studio(
        studio_id="vi-studio-dev-001",
        studio_name="Verifiable Intelligence Studio (Development)",
        arn_relay_url="ws://localhost:8080",  # Local ARN for development
        custom_rules={
            "target_platform": "polymarket",
            "prediction_categories": ["crypto", "tech"],
            "confidence_threshold": 0.6,  # Lower threshold for development
            "max_market_age_days": 30,
            "min_volume_threshold": 100,
            "evidence_sources_required": ["market_data"],
            "scan_interval_seconds": 60,
            "max_predictions_per_hour": 20
        }
    )


def create_production_studio() -> StudioContext:
    """
    Create a production Studio context with strict rules.
    """
    return StudioContext.create_verifiable_intelligence_studio(
        studio_id="vi-studio-prod-001",
        studio_name="Verifiable Intelligence Studio (Production)",
        arn_relay_url="wss://arn-relay.chaoschain.xyz",
        custom_rules={
            "target_platform": "polymarket",
            "prediction_categories": ["politics", "crypto", "economics", "sports"],
            "confidence_threshold": 0.8,  # High threshold for production
            "max_market_age_days": 7,
            "min_volume_threshold": 10000,
            "evidence_sources_required": [
                "market_data", 
                "price_history", 
                "sentiment_analysis",
                "volume_analysis"
            ],
            "scan_interval_seconds": 300,  # 5 minutes
            "max_predictions_per_hour": 5
        }
    )


if __name__ == "__main__":
    """
    Main entry point demonstrating Studio-centric agent architecture.
    
    Usage:
        python -m scripts.run_scout
        
    Environment Variables:
        SCOUT_AGENT_PRIVATE_KEY: Private key for agent wallet (optional)
        CROSSMINT_API_KEY: Crossmint API key for wallet services (optional)
        STUDIO_MODE: "development" | "production" | "mvp" (default: mvp)
    """
    
    # Configure logging
    logger.add(
        "logs/scout_agent_{time:YYYY-MM-DD}.log",
        rotation="1 day",
        retention="7 days",
        level="INFO"
    )
    
    # Determine which Studio context to use
    studio_mode = os.environ.get("STUDIO_MODE", "mvp").lower()
    
    if studio_mode == "development":
        logger.info("Running in DEVELOPMENT mode with relaxed Studio rules")
    elif studio_mode == "production":
        logger.info("Running in PRODUCTION mode with strict Studio rules")
    else:
        logger.info("Running in MVP mode with standard Studio rules")
    
    # Run the agent
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Application terminated by user")
    except Exception as e:
        logger.error(f"Application failed: {e}")
        raise 