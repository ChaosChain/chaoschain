"""
Verifier Agent for ChaosChain Causal Audit

Implements:
- Causal audit (§1.5 Protocol Spec)
- Multi-dimensional scoring (§3.1 Protocol Spec)
- Proof of Agency computation
- XMTP DAG verification

Protocol Spec: §1 (Formal DKG & Causal Audit Model), §3 (Multi-Dimensional Quality Assessment)
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import json

logger = logging.getLogger(__name__)


@dataclass
class AuditResult:
    """Result of causal audit."""
    passed: bool
    evidence_package_cid: str
    thread_root_verified: bool
    causality_verified: bool
    signatures_verified: bool
    scores: Dict[str, List[float]]  # {agent_id: [initiative, collaboration, reasoning_depth, compliance, efficiency]}
    errors: List[str]
    timestamp: int = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = int(datetime.now(timezone.utc).timestamp())


class VerifierAgent:
    """
    Verifier Agent for causal audit and multi-dimensional scoring.
    
    Implements:
    - Causal audit (§1.5)
    - Multi-dimensional scoring (§3.1)
    - Proof of Agency computation
    
    This is the core verification logic described in:
    - Protocol Spec v0.1 (§1.5 Causal Audit Algorithm)
    - Protocol Spec v0.1 (§3.1 Multi-Dimensional Quality Assessment)
    - XMTP_CAUSAL_AUDIT_FLOW.md
    """
    
    def __init__(self, sdk):
        """
        Initialize Verifier Agent.
        
        Args:
            sdk: ChaosChainAgentSDK instance
        """
        self.sdk = sdk
        logger.info("✅ Verifier Agent initialized")
    
    def perform_causal_audit(
        self,
        evidence_package_cid: str
    ) -> AuditResult:
        """
        Perform complete causal audit (§1.5).
        
        Steps:
        1. Fetch EvidencePackage from IPFS/Irys
        2. Fetch XMTP thread using xmtp_thread_id
        3. Verify threadRoot matches computed Merkle root
        4. Verify causality (parents exist, timestamps monotonic)
        5. Verify all message signatures
        6. Compute multi-dimensional scores
        
        Args:
            evidence_package_cid: IPFS CID of evidence package
        
        Returns:
            AuditResult with verification status and scores
        
        Example:
            ```python
            verifier = VerifierAgent(sdk)
            result = verifier.perform_causal_audit("QmXyz...")
            
            if result.passed:
                print(f"✅ Audit passed!")
                for agent_id, scores in result.scores.items():
                    print(f"Agent {agent_id}: {scores}")
            else:
                print(f"❌ Audit failed: {result.errors}")
            ```
        """
        errors = []
        
        logger.info(f"🔍 Starting causal audit for evidence package: {evidence_package_cid}")
        
        # Step 1: Fetch EvidencePackage
        try:
            evidence_package = self.sdk.retrieve_evidence(evidence_package_cid)
            logger.info(f"✅ Evidence package retrieved: {evidence_package.get('package_id')}")
        except Exception as e:
            error_msg = f"Failed to fetch evidence package: {e}"
            logger.error(f"❌ {error_msg}")
            return AuditResult(
                passed=False,
                evidence_package_cid=evidence_package_cid,
                thread_root_verified=False,
                causality_verified=False,
                signatures_verified=False,
                scores={},
                errors=[error_msg]
            )
        
        # Step 2: Fetch XMTP thread
        xmtp_thread_id = evidence_package.get("xmtp_thread_id")
        if not xmtp_thread_id:
            error_msg = "No XMTP thread ID in evidence package"
            logger.error(f"❌ {error_msg}")
            errors.append(error_msg)
            return AuditResult(
                passed=False,
                evidence_package_cid=evidence_package_cid,
                thread_root_verified=False,
                causality_verified=False,
                signatures_verified=False,
                scores={},
                errors=errors
            )
        
        try:
            xmtp_messages = self.sdk.get_messages(xmtp_thread_id, force_refresh=True)
            logger.info(f"✅ XMTP thread fetched: {len(xmtp_messages)} messages")
        except Exception as e:
            error_msg = f"Failed to fetch XMTP thread: {e}"
            logger.error(f"❌ {error_msg}")
            errors.append(error_msg)
            return AuditResult(
                passed=False,
                evidence_package_cid=evidence_package_cid,
                thread_root_verified=False,
                causality_verified=False,
                signatures_verified=False,
                scores={},
                errors=errors
            )
        
        # Step 3: Verify threadRoot
        thread_root_verified = False
        try:
            computed_thread_root = self.sdk.compute_thread_root(xmtp_messages)
            expected_thread_root = evidence_package.get("thread_root")
            
            if computed_thread_root == expected_thread_root:
                thread_root_verified = True
                logger.info(f"✅ Thread root verified: {computed_thread_root}")
            else:
                error_msg = f"Thread root mismatch: expected {expected_thread_root}, got {computed_thread_root}"
                logger.error(f"❌ {error_msg}")
                errors.append(error_msg)
        except Exception as e:
            error_msg = f"Failed to verify thread root: {e}"
            logger.error(f"❌ {error_msg}")
            errors.append(error_msg)
        
        # Step 4: Verify causality
        causality_verified = False
        try:
            causality_verified = self.sdk.verify_thread_causality(xmtp_messages)
            if causality_verified:
                logger.info("✅ Causality verified (parents exist, timestamps monotonic)")
            else:
                error_msg = "Causality verification failed"
                logger.error(f"❌ {error_msg}")
                errors.append(error_msg)
        except Exception as e:
            error_msg = f"Failed to verify causality: {e}"
            logger.error(f"❌ {error_msg}")
            errors.append(error_msg)
        
        # Step 5: Verify signatures
        signatures_verified = False
        try:
            signatures_verified = self._verify_signatures(xmtp_messages)
            if signatures_verified:
                logger.info("✅ All signatures verified")
            else:
                error_msg = "Signature verification failed"
                logger.error(f"❌ {error_msg}")
                errors.append(error_msg)
        except Exception as e:
            error_msg = f"Failed to verify signatures: {e}"
            logger.error(f"❌ {error_msg}")
            errors.append(error_msg)
        
        # Step 6: Compute multi-dimensional scores
        scores = {}
        try:
            participants = evidence_package.get("participants", [])
            scores = self.compute_multi_dimensional_scores(xmtp_messages, participants)
            logger.info(f"✅ Multi-dimensional scores computed for {len(scores)} agents")
        except Exception as e:
            error_msg = f"Failed to compute scores: {e}"
            logger.error(f"❌ {error_msg}")
            errors.append(error_msg)
        
        # Determine if audit passed
        passed = (
            thread_root_verified and
            causality_verified and
            signatures_verified and
            len(scores) > 0 and
            len(errors) == 0
        )
        
        result = AuditResult(
            passed=passed,
            evidence_package_cid=evidence_package_cid,
            thread_root_verified=thread_root_verified,
            causality_verified=causality_verified,
            signatures_verified=signatures_verified,
            scores=scores,
            errors=errors
        )
        
        if passed:
            logger.info(f"✅ Causal audit PASSED for {evidence_package_cid}")
        else:
            logger.error(f"❌ Causal audit FAILED for {evidence_package_cid}: {errors}")
        
        return result
    
    def compute_multi_dimensional_scores(
        self,
        xmtp_messages: List[Dict[str, Any]],
        participants: List[Dict[str, Any]]
    ) -> Dict[str, List[float]]:
        """
        Compute multi-dimensional scores from XMTP DAG (§3.1).
        
        Dimensions:
        1. Initiative: Original contributions (non-reply messages)
        2. Collaboration: Reply/extend edges (reply messages)
        3. Reasoning Depth: Average path length from root
        4. Compliance: Policy checks (all pass for now)
        5. Efficiency: Time-based (faster responses = higher score)
        
        Args:
            xmtp_messages: List of XMTP messages
            participants: List of participant info (agent_id, address, role)
        
        Returns:
            {agent_id: [initiative, collaboration, reasoning_depth, compliance, efficiency]}
        
        Example:
            ```python
            scores = verifier.compute_multi_dimensional_scores(messages, participants)
            # scores = {
            #     "agent_123": [0.8, 0.6, 0.7, 1.0, 0.9],
            #     "agent_456": [0.6, 0.8, 0.5, 1.0, 0.7]
            # }
            ```
        """
        scores = {}
        
        # Create address to agent_id mapping
        address_to_agent_id = {
            p["address"]: str(p["agent_id"])
            for p in participants
        }
        
        for participant in participants:
            agent_address = participant["address"]
            agent_id = str(participant["agent_id"])
            
            try:
                scores[agent_id] = [
                    self._compute_initiative(xmtp_messages, agent_address),
                    self._compute_collaboration(xmtp_messages, agent_address),
                    self._compute_reasoning_depth(xmtp_messages, agent_address),
                    self._compute_compliance(xmtp_messages, agent_address),
                    self._compute_efficiency(xmtp_messages, agent_address)
                ]
                
                logger.debug(
                    f"Agent {agent_id} scores: "
                    f"initiative={scores[agent_id][0]:.2f}, "
                    f"collaboration={scores[agent_id][1]:.2f}, "
                    f"reasoning_depth={scores[agent_id][2]:.2f}, "
                    f"compliance={scores[agent_id][3]:.2f}, "
                    f"efficiency={scores[agent_id][4]:.2f}"
                )
            except Exception as e:
                logger.warning(f"⚠️  Failed to compute scores for agent {agent_id}: {e}")
                scores[agent_id] = [0.0, 0.0, 0.0, 0.0, 0.0]
        
        return scores
    
    def _compute_initiative(
        self,
        messages: List[Dict[str, Any]],
        agent_address: str
    ) -> float:
        """
        Compute initiative score (original contributions).
        
        Initiative = (non-reply messages) / (total messages)
        
        Args:
            messages: List of XMTP messages
            agent_address: Agent address
        
        Returns:
            Initiative score (0-1)
        """
        agent_messages = [msg for msg in messages if msg.get("author") == agent_address]
        
        if len(agent_messages) == 0:
            return 0.0
        
        original_messages = [msg for msg in agent_messages if msg.get("parent_id") is None]
        
        return len(original_messages) / len(agent_messages)
    
    def _compute_collaboration(
        self,
        messages: List[Dict[str, Any]],
        agent_address: str
    ) -> float:
        """
        Compute collaboration score (reply/extend edges).
        
        Collaboration = (reply messages) / (total messages)
        
        Args:
            messages: List of XMTP messages
            agent_address: Agent address
        
        Returns:
            Collaboration score (0-1)
        """
        agent_messages = [msg for msg in messages if msg.get("author") == agent_address]
        
        if len(agent_messages) == 0:
            return 0.0
        
        reply_messages = [msg for msg in agent_messages if msg.get("parent_id") is not None]
        
        return len(reply_messages) / len(agent_messages)
    
    def _compute_reasoning_depth(
        self,
        messages: List[Dict[str, Any]],
        agent_address: str
    ) -> float:
        """
        Compute reasoning depth (path length).
        
        Reasoning Depth = max(depth of agent's messages) / 10 (normalized)
        
        Args:
            messages: List of XMTP messages
            agent_address: Agent address
        
        Returns:
            Reasoning depth score (0-1)
        """
        agent_messages = [msg for msg in messages if msg.get("author") == agent_address]
        
        if len(agent_messages) == 0:
            return 0.0
        
        # Compute depth for each message
        max_depth = 0
        for msg in agent_messages:
            depth = self._compute_message_depth(msg, messages)
            max_depth = max(max_depth, depth)
        
        # Normalize (assume max depth of 10)
        return min(max_depth / 10, 1.0)
    
    def _compute_message_depth(
        self,
        message: Dict[str, Any],
        messages: List[Dict[str, Any]]
    ) -> int:
        """
        Compute depth of a message in the DAG.
        
        Args:
            message: Message to compute depth for
            messages: All messages
        
        Returns:
            Depth (1 for root messages)
        """
        parent_id = message.get("parent_id")
        
        if parent_id is None:
            return 1
        
        # Find parent
        parent = next((m for m in messages if m.get("id") == parent_id), None)
        
        if parent is None:
            return 1
        
        return 1 + self._compute_message_depth(parent, messages)
    
    def _compute_compliance(
        self,
        messages: List[Dict[str, Any]],
        agent_address: str
    ) -> float:
        """
        Compute compliance score (policy checks).
        
        For now, returns 1.0 (all compliant).
        In production, this would check message content against policies.
        
        Args:
            messages: List of XMTP messages
            agent_address: Agent address
        
        Returns:
            Compliance score (0-1)
        """
        # TODO: Implement policy checks
        return 1.0
    
    def _compute_efficiency(
        self,
        messages: List[Dict[str, Any]],
        agent_address: str
    ) -> float:
        """
        Compute efficiency score (time-based).
        
        Efficiency = 1 - (avg_response_time / 3600)
        (Faster responses = higher score, normalized to 1 hour)
        
        Args:
            messages: List of XMTP messages
            agent_address: Agent address
        
        Returns:
            Efficiency score (0-1)
        """
        agent_messages = sorted(
            [msg for msg in messages if msg.get("author") == agent_address],
            key=lambda m: m.get("timestamp", 0)
        )
        
        if len(agent_messages) < 2:
            return 1.0  # Default to high efficiency if not enough data
        
        # Compute average response time
        response_times = []
        for i in range(1, len(agent_messages)):
            time_diff = agent_messages[i].get("timestamp", 0) - agent_messages[i-1].get("timestamp", 0)
            response_times.append(time_diff)
        
        if not response_times:
            return 1.0
        
        avg_response_time = sum(response_times) / len(response_times)
        
        # Normalize (1 hour = 3600 seconds)
        # Faster than 1 hour = 1.0, slower = lower score
        return max(0, 1 - (avg_response_time / 3600))
    
    def _verify_signatures(self, messages: List[Dict[str, Any]]) -> bool:
        """
        Verify all message signatures.
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            True if all signatures are valid
        """
        if not self.sdk.xmtp_manager:
            logger.warning("⚠️  XMTP manager not available for signature verification")
            return False
        
        try:
            from .xmtp_client import XMTPMessage
            xmtp_messages = [XMTPMessage.from_dict(msg) for msg in messages]
            return self.sdk.xmtp_manager.verify_signatures(xmtp_messages)
        except Exception as e:
            logger.error(f"❌ Signature verification failed: {e}")
            return False
    
    def submit_score_vector(
        self,
        studio_address: str,
        epoch: int,
        data_hash: str,
        scores: List[float]
    ) -> str:
        """
        Submit score vector to StudioProxy.
        
        Args:
            studio_address: Studio proxy address
            epoch: Epoch number
            data_hash: Data hash (from work submission)
            scores: Score vector [initiative, collaboration, reasoning_depth, compliance, efficiency]
        
        Returns:
            Transaction hash
        
        Example:
            ```python
            # After causal audit
            result = verifier.perform_causal_audit("QmXyz...")
            
            for agent_id, agent_scores in result.scores.items():
                tx_hash = verifier.submit_score_vector(
                    studio_address="0x123...",
                    epoch=1,
                    data_hash="0xabc...",
                    scores=agent_scores
                )
            ```
        """
        # Convert scores to uint8 (0-100 range)
        scores_uint8 = [int(score * 100) for score in scores]
        
        # Submit via ChaosAgent
        tx_hash = self.sdk.chaos_agent.submit_score_vector(
            studio_address=studio_address,
            epoch=epoch,
            data_hash=data_hash,
            scores=scores_uint8
        )
        
        logger.info(f"✅ Score vector submitted: {tx_hash}")
        
        return tx_hash

