"""
ScoutAgent implementation for ChaosChain.

This agent monitors prediction markets, generates predictions, and
submits DKG-compliant evidence packages to the Verifiable Intelligence Studio.
"""

import asyncio
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from loguru import logger

from ..base.agent import BaseAgent, AgentConfig, A2AMessage
from ..base.evidence import EvidencePackage
from .polymarket import PolymarketClient


class ScoutAgent(BaseAgent):
    """
    A worker agent that monitors Polymarket and submits evidence.
    
    v1 Goals:
    - Connect to Polymarket via py-clob-client
    - Monitor specific prediction markets for opportunities
    - Analyze market data and generate predictions
    - Create DKG-compliant evidence packages
    - Submit evidence to the Verifiable Intelligence Studio
    """

    def __init__(self, config: AgentConfig, market_slugs: List[str]):
        """Initialize the ScoutAgent."""
        super().__init__(config)
        self.market_slugs = market_slugs
        
        # Initialize Polymarket client
        self.polymarket_client = PolymarketClient()
        
        # Agent state for market tracking
        self.monitored_markets: Dict[str, Any] = {}
        self.last_checked_timestamp: Optional[datetime] = None
        
        logger.info(f"ScoutAgent initialized to monitor markets: {market_slugs}")
        
    async def _run(self) -> None:
        """Main execution loop for the ScoutAgent."""
        logger.info("ScoutAgent main loop started.")
        
        while self.is_running():
            try:
                await self.scan_markets()
                
                # Wait for the next scan interval
                await asyncio.sleep(60)  # Scan every 60 seconds
                
            except asyncio.CancelledError:
                logger.info("ScoutAgent main loop cancelled.")
                break
            except Exception as e:
                logger.error(f"Error in ScoutAgent main loop: {e}")
                await asyncio.sleep(30) # Wait before retrying
    
    async def scan_markets(self) -> None:
        """Scan monitored markets for prediction opportunities."""
        logger.info(f"Scanning {len(self.market_slugs)} markets...")
        
        for slug in self.market_slugs:
            try:
                market_data = await self.polymarket_client.get_market_data(slug)
                
                if not market_data:
                    logger.warning(f"No data found for market: {slug}")
                    continue
                
                # Check if market is active and not yet resolved
                if not market_data.get("active", False) or market_data.get("closed", True):
                    logger.debug(f"Market '{slug}' is not active or already closed.")
                    continue
                
                # Analyze market data to generate a prediction
                prediction, confidence = self._analyze_market(market_data)
                
                if prediction is not None and confidence > 0.7:  # Confidence threshold
                    logger.success(
                        f"Found opportunity in '{slug}': "
                        f"Prediction={prediction}, Confidence={confidence:.2f}"
                    )
                    
                    # Create and submit evidence
                    await self.create_and_submit_prediction_evidence(market_data, prediction, confidence)
                    
            except Exception as e:
                logger.error(f"Error scanning market '{slug}': {e}")
        
        self.last_checked_timestamp = datetime.now(timezone.utc)
        logger.info("Market scan complete.")

    def _analyze_market(self, market_data: Dict[str, Any]) -> (Optional[str], float):
        """
        Analyze market data to generate a prediction.
        
        This is a placeholder for a more sophisticated prediction model.
        For now, it will predict based on the highest probability token.
        """
        outcomes = market_data.get("outcomes", [])
        if not outcomes:
            return None, 0.0
        
        try:
            # Find the outcome with the highest price (probability)
            best_outcome = max(outcomes, key=lambda x: float(x.get("price", 0.0)))
            
            prediction = best_outcome.get("name")
            confidence = float(best_outcome.get("price", 0.0))
            
            return prediction, confidence
            
        except Exception as e:
            logger.error(f"Error analyzing market data: {e}")
            return None, 0.0
    
    async def create_and_submit_prediction_evidence(
        self,
        market_data: Dict[str, Any],
        prediction: str,
        confidence: float
    ) -> None:
        """Create and submit a DKG-compliant evidence package for a prediction."""
        
        input_data = {
            "market_question": market_data.get("question"),
            "market_slug": market_data.get("slug"),
            "market_outcomes": [o.get("name") for o in market_data.get("outcomes", [])],
            "market_data_source": "polymarket"
        }
        
        output_data = {
            "prediction": prediction,
            "confidence_score": confidence,
            "analysis_model": "v1_simple_price_maximizer"
        }
        
        reasoning = (
            f"Analyzed Polymarket data for '{market_data.get('slug')}'. "
            f"The outcome '{prediction}' has the highest probability ({confidence:.2f}), "
            "indicating it is the most likely outcome according to the market."
        )
        
        # Create evidence package
        evidence = await self.create_evidence_package(
            task_type="prediction_market_analysis",
            input_data=input_data,
            output_data=output_data,
            reasoning=reasoning,
            sources=[f"https://polymarket.com/event/{market_data.get('slug')}"]
        )
        
        # Submit to Verifiable Intelligence Studio
        studio_address = "0x...VerifiableIntelligenceStudio" # Placeholder
        
        try:
            evidence_cid = await self.submit_evidence_to_studio(studio_address, evidence)
            logger.success(
                f"Successfully submitted evidence {evidence_cid} for "
                f"market '{market_data.get('slug')}'"
            )
            
            # Announce submission to other agents
            await self.send_a2a_message(
                method="evidence.submitted",
                params={
                    "evidence_cid": evidence_cid,
                    "studio": studio_address,
                    "market_slug": market_data.get('slug')
                }
            )
            
        except Exception as e:
            logger.error(f"Error submitting evidence: {e}")
    
    async def handle_custom_message(self, message: A2AMessage) -> None:
        """Handle custom A2A messages for the ScoutAgent."""
        method = message.method
        params = message.params
        
        logger.debug(f"ScoutAgent received custom message: {method}")
        
        if method == "market.add":
            # Add a new market to monitor
            market_slug = params.get("slug")
            if market_slug and market_slug not in self.market_slugs:
                self.market_slugs.append(market_slug)
                logger.info(f"Added new market to monitor: {market_slug}")
        
        elif method == "market.remove":
            # Remove a market from monitoring
            market_slug = params.get("slug")
            if market_slug and market_slug in self.market_slugs:
                self.market_slugs.remove(market_slug)
                logger.info(f"Removed market from monitoring: {market_slug}")
        
        elif method == "status.request":
            # Respond with agent status
            await self.send_a2a_message(
                method="status.response",
                params={
                    "agent_id": self.agent_id,
                    "agent_name": self.config.agent_name,
                    "monitored_markets": self.market_slugs,
                    "last_scan": self.last_checked_timestamp.isoformat() if self.last_checked_timestamp else None,
                    "is_running": self.is_running()
                },
                to_agent=message.from_agent
            )
        
        else:
            logger.warning(f"Unknown custom message method: {method}")

    async def get_agent_status(self) -> Dict[str, Any]:
        """Get the current status of the agent."""
        return {
            "agent_id": self.agent_id,
            "agent_name": self.config.agent_name,
            "monitored_markets": self.market_slugs,
            "is_connected_to_arn": self.arn_client.is_connected,
            "last_scan_timestamp": self.last_checked_timestamp.isoformat() if self.last_checked_timestamp else "N/A"
        } 