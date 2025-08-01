"""
ScoutAgent implementation for ChaosChain.

This agent monitors prediction markets, generates predictions, and
submits DKG-compliant evidence packages to the Verifiable Intelligence Studio.
"""

import asyncio
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from loguru import logger

from ..base.agent import BaseAgent, A2AMessage
from ..base.context import StudioContext
from ..base.config import AgentConfig
from ..base.evidence import EvidencePackage
from ..utils.llm import LanguageModelClient
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

    def __init__(self, studio_context: StudioContext, agent_config: AgentConfig, market_slugs: Optional[List[str]] = None):
        """
        Initialize the ScoutAgent with Studio context.
        
        Args:
            studio_context: The Studio configuration that shapes this agent's behavior
            agent_config: Agent-specific settings
            market_slugs: Optional list of specific markets to monitor (if not provided, will use Studio rules)
        """
        super().__init__(studio_context, agent_config)
        
        # Get market configuration from Studio context or use provided list
        self.market_slugs = market_slugs or self._get_markets_from_studio()
        
        # Initialize clients
        self.polymarket_client = PolymarketClient()
        self.llm_client = LanguageModelClient()
        
        # Agent state for market tracking
        self.monitored_markets: Dict[str, Any] = {}
        self.last_checked_timestamp: Optional[datetime] = None
        
        logger.info(
            f"ScoutAgent initialized for Studio '{self.studio_name}' "
            f"targeting platform: {self.target_platform}, monitoring {len(self.market_slugs)} markets"
        )
    
    def _get_markets_from_studio(self) -> List[str]:
        """Get market slugs from Studio configuration."""
        # In a real implementation, this would fetch active markets based on Studio rules
        platform = self.target_platform
        categories = self.context.get_prediction_categories()
        
        logger.info(f"Studio configured for platform: {platform}, categories: {categories}")
        
        # For now, return some example market slugs
        # In production, this would query the target platform's API
        if platform == "polymarket":
            return [
                "will-trump-win-the-2024-us-presidential-election",
                "will-bitcoin-reach-100k-by-end-of-2024",
                "will-a-recession-be-declared-in-the-us-by-eoy-2024"
            ]
        
        return []
        
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
                
                # Analyze market data to generate a prediction using LLM
                prediction, confidence = await self._analyze_market(market_data)
                
                # Use Studio's confidence threshold
                if prediction is not None and confidence > self.confidence_threshold:
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

    async def _analyze_market(self, market_data: Dict[str, Any]) -> (Optional[str], float):
        """
        Analyze market data to generate a prediction using the layered prompting architecture.
        
        This method demonstrates the core "Inner Loop" processing where the agent uses
        its LLM with the chained Studio role_prompt and agent character_prompt to 
        perform sophisticated market analysis.
        """
        outcomes = market_data.get("outcomes", [])
        if not outcomes:
            return None, 0.0
        
        try:
            # Prepare market data for LLM analysis
            market_context = f"""
Market Question: {market_data.get('question', 'Unknown')}
Market Slug: {market_data.get('slug', 'Unknown')}
Active: {market_data.get('active', False)}
Volume: {market_data.get('volume', 'Unknown')}

Available Outcomes:
"""
            for i, outcome in enumerate(outcomes, 1):
                price = outcome.get('price', 0.0)
                name = outcome.get('name', 'Unknown')
                market_context += f"{i}. {name}: {price:.3f} ({price*100:.1f}%)\n"
            
            # Create the chained system prompt (role_prompt + character_prompt)
            system_prompt = self.create_system_prompt()
            
            # Create user prompt with market analysis task
            user_prompt = f"""Analyze this prediction market and provide your assessment:

{market_context}

Please provide:
1. Your predicted outcome (which specific outcome you think will occur)
2. Your confidence level (0.0 to 1.0)
3. Brief reasoning for your prediction

Focus on identifying potential mispricings and market inefficiencies based on your expertise."""

            # Get LLM configuration from agent config
            llm_config = self.get_llm_config()
            
            # Generate response using the layered prompting architecture
            logger.debug("Generating market analysis using chained prompts")
            response = await self.llm_client.generate_response(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                **llm_config
            )
            
            # Parse the response to extract prediction and confidence
            prediction, confidence = self._parse_analysis_response(response, outcomes)
            
            logger.info(
                f"LLM analysis complete - Prediction: {prediction}, "
                f"Confidence: {confidence:.3f}"
            )
            
            return prediction, confidence
            
        except Exception as e:
            logger.error(f"Error in LLM market analysis: {e}")
            # Fallback to simple heuristic
            return self._fallback_analysis(outcomes)
    
    def _parse_analysis_response(self, response: str, outcomes: List[Dict]) -> (Optional[str], float):
        """
        Parse the LLM response to extract prediction and confidence.
        
        Args:
            response: The LLM's analysis response
            outcomes: Available market outcomes
            
        Returns:
            Tuple of (prediction, confidence)
        """
        try:
            # Look for confidence score in the response
            confidence = 0.75  # Default confidence
            
            # Extract confidence if mentioned
            import re
            confidence_match = re.search(r'confidence[:\s]+([0-9.]+)', response.lower())
            if confidence_match:
                confidence = min(1.0, max(0.0, float(confidence_match.group(1))))
            
            # Look for prediction in the response
            prediction = None
            response_lower = response.lower()
            
            # Check if any outcome is mentioned in the response
            for outcome in outcomes:
                outcome_name = outcome.get('name', '').lower()
                if outcome_name and outcome_name in response_lower:
                    prediction = outcome.get('name')
                    break
            
            # If no specific outcome found, default to highest probability
            if not prediction:
                best_outcome = max(outcomes, key=lambda x: float(x.get("price", 0.0)))
                prediction = best_outcome.get("name")
                confidence = min(confidence, 0.6)  # Lower confidence for fallback
            
            return prediction, confidence
            
        except Exception as e:
            logger.error(f"Error parsing LLM response: {e}")
            return self._fallback_analysis(outcomes)
    
    def _fallback_analysis(self, outcomes: List[Dict]) -> (Optional[str], float):
        """
        Fallback analysis method using simple heuristics.
        
        Args:
            outcomes: Available market outcomes
            
        Returns:
            Tuple of (prediction, confidence)
        """
        try:
            best_outcome = max(outcomes, key=lambda x: float(x.get("price", 0.0)))
            prediction = best_outcome.get("name")
            confidence = float(best_outcome.get("price", 0.0))
            return prediction, confidence
        except Exception as e:
            logger.error(f"Error in fallback analysis: {e}")
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
        
        # Submit to this agent's Studio (address comes from context)
        try:
            evidence_cid = await self.submit_evidence_to_studio(evidence)
            logger.success(
                f"Successfully submitted evidence {evidence_cid} for "
                f"market '{market_data.get('slug')}'"
            )
            
            # Announce submission to other agents in this Studio
            await self.send_a2a_message(
                method="evidence.submitted",
                params={
                    "evidence_cid": evidence_cid,
                    "market_slug": market_data.get('slug'),
                    "analysis_type": "prediction_market_analysis"
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