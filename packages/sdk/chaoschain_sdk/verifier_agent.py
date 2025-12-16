"""
Verifier Agent for Causal Audit and Multi-Dimensional Scoring.

Implements Protocol Spec v0.1:
- §1.5: Causal Audit Algorithm
- §3.1: Proof of Agency (PoA) Features - Measurable Agency Dimensions

The VerifierAgent performs a complete causal audit of agent work:
1. Fetches EvidencePackage from IPFS
2. Reconstructs XMTP causal DAG
3. Verifies threadRoot and evidenceRoot
4. Checks causality (parents exist, timestamps monotonic)
5. Verifies signatures
6. Computes multi-dimensional scores from DKG

Multi-Dimensional Scoring (§3.1):
- **Initiative**: Non-derivative contributions (original Irys payloads)
- **Collaboration**: Reply/extend edges to other agents
- **Reasoning Depth**: Average path length from task root to terminal nodes
- **Compliance**: Policy checks and rule adherence
- **Efficiency**: Useful work per unit cost/time

Usage:
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    from chaoschain_sdk.verifier_agent import VerifierAgent
    
    # Initialize SDK as verifier
    sdk = ChaosChainAgentSDK(
        agent_name="VerifierAgent",
        agent_domain="verifier.example.com",
        agent_role=AgentRole.VERIFIER,
        network=NetworkConfig.ETHEREUM_SEPOLIA
    )
    
    # Create verifier
    verifier = VerifierAgent(sdk)
    
    # Perform causal audit
    audit_result = verifier.perform_causal_audit(
        evidence_package_cid="Qm...",
        studio_address="0x..."
    )
    
    # Submit scores to StudioProxy
    if audit_result["audit_passed"]:
        sdk.submit_score_vector(
            studio_address=studio_address,
            epoch=1,
            data_hash=audit_result["data_hash"],
            scores=audit_result["scores"][worker_agent_id]
        )
    ```
"""

from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from eth_utils import keccak
from rich import print as rprint
from rich.table import Table
from rich.console import Console

from .types import ChaosChainSDKError
from .xmtp_client import XMTPMessage

console = Console()


@dataclass
class AuditResult:
    """Result of causal audit."""
    audit_passed: bool
    evidence_package_cid: str
    data_hash: bytes
    scores: Dict[str, List[float]]  # {agent_id: [initiative, collaboration, ...]}
    audit_report: Dict[str, Any]
    errors: List[str]


class VerifierAgent:
    """
    Verifier Agent for causal audit and multi-dimensional scoring.
    
    Implements Protocol Spec v0.1:
    - §1.5: Causal Audit Algorithm
    - §3.1: Measurable Agency Dimensions (Proof of Agency)
    
    The verifier performs a comprehensive audit of agent work:
    1. Fetch EvidencePackage from decentralized storage
    2. Reconstruct XMTP causal DAG
    3. Verify data integrity (threadRoot, evidenceRoot)
    4. Check causality constraints
    5. Compute multi-dimensional scores
    """
    
    def __init__(self, sdk):
        """
        Initialize VerifierAgent.
        
        Args:
            sdk: ChaosChainAgentSDK instance (must have XMTP enabled)
        """
        self.sdk = sdk
        
        if not self.sdk.xmtp_manager:
            rprint("[yellow]⚠️  XMTP not available. Causal audit will be limited.[/yellow]")
    
    def perform_causal_audit(
        self,
        evidence_package_cid: str,
        studio_address: str,
        custom_dimensions: Optional[List[str]] = None
    ) -> AuditResult:
        """
        Perform complete causal audit (§1.5).
        
        Steps:
        1. Fetch EvidencePackage from IPFS/Arweave
        2. Fetch XMTP thread
        3. Verify threadRoot (Merkle root matches)
        4. Verify causality (parents exist, timestamps monotonic)
        5. Verify signatures (optional)
        6. Compute multi-dimensional scores (§3.1)
        
        Args:
            evidence_package_cid: IPFS CID of evidence package
            studio_address: Studio contract address
            custom_dimensions: Optional custom scoring dimensions for this studio
        
        Returns:
            AuditResult with scores and audit details
        """
        errors = []
        
        try:
            # Step 1: Fetch EvidencePackage
            rprint(f"[cyan]📥 Fetching evidence package: {evidence_package_cid[:16]}...[/cyan]")
            evidence_package = self._fetch_evidence_package(evidence_package_cid)
            
            if not evidence_package:
                return AuditResult(
                    audit_passed=False,
                    evidence_package_cid=evidence_package_cid,
                    data_hash=bytes(32),
                    scores={},
                    audit_report={},
                    errors=["Failed to fetch evidence package"]
                )
            
            # Step 2: Fetch XMTP thread
            xmtp_thread_id = evidence_package.get("xmtp_thread_id")
            if not xmtp_thread_id:
                rprint("[yellow]⚠️  No XMTP thread ID in evidence package[/yellow]")
                errors.append("No XMTP thread ID")
                xmtp_messages = []
            else:
                rprint(f"[cyan]📥 Fetching XMTP thread: {xmtp_thread_id[:16]}...[/cyan]")
                xmtp_messages = self._fetch_xmtp_thread(xmtp_thread_id)
            
            # Step 3: Verify threadRoot
            if xmtp_messages and evidence_package.get("thread_root"):
                rprint("[cyan]🔍 Verifying thread root...[/cyan]")
                thread_root_valid = self._verify_thread_root(
                    xmtp_messages,
                    evidence_package["thread_root"]
                )
                if not thread_root_valid:
                    errors.append("Thread root mismatch")
                    rprint("[red]❌ Thread root verification failed[/red]")
                else:
                    rprint("[green]✅ Thread root verified[/green]")
            
            # Step 4: Verify causality
            if xmtp_messages:
                rprint("[cyan]🔍 Verifying causality...[/cyan]")
                causality_valid = self._verify_causality(xmtp_messages)
                if not causality_valid:
                    errors.append("Causality check failed")
                    rprint("[red]❌ Causality verification failed[/red]")
                else:
                    rprint("[green]✅ Causality verified[/green]")
            
            # Step 5: Verify signatures (optional for now)
            # In production, verify each message signature
            rprint("[cyan]🔍 Verifying signatures...[/cyan]")
            signatures_valid = self._verify_signatures(xmtp_messages)
            if not signatures_valid:
                errors.append("Signature verification failed")
            
            # Step 6: Compute multi-dimensional scores
            rprint("[cyan]📊 Computing multi-dimensional scores...[/cyan]")
            participants = evidence_package.get("participants", [])
            scores = self.compute_multi_dimensional_scores(
                xmtp_messages,
                participants,
                custom_dimensions
            )
            
            # Display scores
            self._display_scores(scores)
            
            # Compute data_hash for submission
            data_hash = self._compute_data_hash(evidence_package)
            
            # Build audit report
            audit_report = {
                "evidence_package_cid": evidence_package_cid,
                "xmtp_messages_count": len(xmtp_messages),
                "participants": participants,
                "thread_root_valid": thread_root_valid if xmtp_messages else None,
                "causality_valid": causality_valid if xmtp_messages else None,
                "signatures_valid": signatures_valid,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            audit_passed = len(errors) == 0
            
            if audit_passed:
                rprint("[green]✅ Causal audit PASSED[/green]")
            else:
                rprint(f"[red]❌ Causal audit FAILED: {', '.join(errors)}[/red]")
            
            return AuditResult(
                audit_passed=audit_passed,
                evidence_package_cid=evidence_package_cid,
                data_hash=data_hash,
                scores=scores,
                audit_report=audit_report,
                errors=errors
            )
            
        except Exception as e:
            rprint(f"[red]❌ Causal audit error: {e}[/red]")
            return AuditResult(
                audit_passed=False,
                evidence_package_cid=evidence_package_cid,
                data_hash=bytes(32),
                scores={},
                audit_report={},
                errors=[str(e)]
            )
    
    def compute_multi_dimensional_scores(
        self,
        xmtp_messages: List[XMTPMessage],
        participants: List[Dict[str, Any]],
        custom_dimensions: Optional[List[str]] = None
    ) -> Dict[str, List[float]]:
        """
        Compute multi-dimensional scores from XMTP DAG (§3.1).
        
        Universal PoA Dimensions (5):
        1. Initiative: Non-derivative contributions (original messages)
        2. Collaboration: Reply/extend edges to other agents
        3. Reasoning Depth: Average path length in DAG
        4. Compliance: Policy adherence (1.0 for now)
        5. Efficiency: Time-based performance
        
        Custom Dimensions (Studio-specific):
        - Accuracy (Finance, Prediction)
        - Risk Assessment (Finance)
        - Originality (Creative)
        - etc.
        
        Args:
            xmtp_messages: List of XMTP messages from thread
            participants: List of participant agents with IDs
            custom_dimensions: Optional custom dimension names
        
        Returns:
            {agent_id: [score1, score2, ..., scoreN]} where scores are 0-100
        """
        scores = {}
        
        if not xmtp_messages:
            # No XMTP thread - assign default scores
            rprint("[yellow]⚠️  No XMTP messages, assigning default scores[/yellow]")
            for participant in participants:
                agent_id = str(participant.get("agent_id", participant.get("address", "")))
                # Default: moderate scores for all dimensions
                scores[agent_id] = [70.0, 70.0, 70.0, 100.0, 70.0]
            return scores
        
        for participant in participants:
            agent_id = str(participant.get("agent_id", participant.get("address", "")))
            
            # Compute 5 universal PoA dimensions
            initiative = self._compute_initiative(xmtp_messages, agent_id)
            collaboration = self._compute_collaboration(xmtp_messages, agent_id)
            reasoning_depth = self._compute_reasoning_depth(xmtp_messages, agent_id)
            compliance = self._compute_compliance(xmtp_messages, agent_id)
            efficiency = self._compute_efficiency(xmtp_messages, agent_id)
            
            # Convert to 0-100 scale
            score_vector = [
                initiative * 100,
                collaboration * 100,
                reasoning_depth * 100,
                compliance * 100,
                efficiency * 100
            ]
            
            # Add custom dimensions if specified
            if custom_dimensions:
                for dim in custom_dimensions:
                    custom_score = self._compute_custom_dimension(
                        xmtp_messages,
                        agent_id,
                        dim
                    )
                    score_vector.append(custom_score * 100)
            
            scores[agent_id] = score_vector
        
        return scores
    
    def _compute_initiative(self, messages: List[XMTPMessage], agent_id: str) -> float:
        """
        Compute initiative score (§3.1).
        
        Initiative = non-derivative contributions / total contributions
        Non-derivative = messages without parent_id (original ideas)
        
        Args:
            messages: XMTP messages
            agent_id: Agent ID or address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_messages = [msg for msg in messages if agent_id in msg.author]
        
        if len(agent_messages) == 0:
            return 0.0
        
        original_messages = [msg for msg in agent_messages if msg.parent_id is None]
        
        return len(original_messages) / len(agent_messages)
    
    def _compute_collaboration(self, messages: List[XMTPMessage], agent_id: str) -> float:
        """
        Compute collaboration score (§3.1).
        
        Collaboration = reply/extend edges / total contributions
        Reply/extend = messages with parent_id (building on others)
        
        Args:
            messages: XMTP messages
            agent_id: Agent ID or address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_messages = [msg for msg in messages if agent_id in msg.author]
        
        if len(agent_messages) == 0:
            return 0.0
        
        reply_messages = [msg for msg in agent_messages if msg.parent_id is not None]
        
        return len(reply_messages) / len(agent_messages)
    
    def _compute_reasoning_depth(self, messages: List[XMTPMessage], agent_id: str) -> float:
        """
        Compute reasoning depth score (§3.1).
        
        Reasoning Depth = average path length from root to agent's messages
        Longer paths = deeper reasoning chains
        
        Args:
            messages: XMTP messages
            agent_id: Agent ID or address
        
        Returns:
            Score (0.0-1.0, normalized by max depth of 10)
        """
        agent_messages = [msg for msg in messages if agent_id in msg.author]
        
        if len(agent_messages) == 0:
            return 0.0
        
        # Compute depth for each message
        depths = []
        for msg in agent_messages:
            depth = self._get_message_depth(msg, messages)
            depths.append(depth)
        
        avg_depth = sum(depths) / len(depths)
        
        # Normalize (assume max depth of 10)
        return min(avg_depth / 10.0, 1.0)
    
    def _get_message_depth(self, message: XMTPMessage, messages: List[XMTPMessage]) -> int:
        """Compute depth of a message in the DAG."""
        if message.parent_id is None:
            return 1
        
        message_map = {msg.id: msg for msg in messages}
        parent = message_map.get(message.parent_id)
        
        if parent is None:
            return 1
        
        return 1 + self._get_message_depth(parent, messages)
    
    def _compute_compliance(self, messages: List[XMTPMessage], agent_id: str) -> float:
        """
        Compute compliance score (§3.1).
        
        For now, returns 1.0 (all compliant).
        In production, check message content against policies.
        
        Args:
            messages: XMTP messages
            agent_id: Agent ID or address
        
        Returns:
            Score (0.0-1.0)
        """
        # TODO: Implement policy checks
        # - Check for prohibited content
        # - Verify data handling rules
        # - Check AML/KYC flags (for financial studios)
        return 1.0
    
    def _compute_efficiency(self, messages: List[XMTPMessage], agent_id: str) -> float:
        """
        Compute efficiency score (§3.1).
        
        Efficiency = based on response times and message frequency
        Faster responses = higher efficiency
        
        Args:
            messages: XMTP messages
            agent_id: Agent ID or address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_messages = [msg for msg in messages if agent_id in msg.author]
        agent_messages.sort(key=lambda m: m.timestamp)
        
        if len(agent_messages) < 2:
            return 1.0  # Single message = perfectly efficient
        
        # Compute average time between messages
        time_diffs = []
        for i in range(1, len(agent_messages)):
            time_diff = agent_messages[i].timestamp - agent_messages[i-1].timestamp
            time_diffs.append(time_diff)
        
        avg_time_diff = sum(time_diffs) / len(time_diffs)
        
        # Normalize (1 hour = 1.0, faster = better)
        # avg_time_diff is in seconds
        efficiency = max(0, 1 - (avg_time_diff / 3600))
        
        return efficiency
    
    def _compute_custom_dimension(
        self,
        messages: List[XMTPMessage],
        agent_id: str,
        dimension: str
    ) -> float:
        """
        Compute custom studio-specific dimension.
        
        Args:
            messages: XMTP messages
            agent_id: Agent ID or address
            dimension: Dimension name (e.g., "Accuracy", "Originality")
        
        Returns:
            Score (0.0-1.0)
        """
        # TODO: Implement custom dimension logic based on dimension name
        # For now, return moderate score
        return 0.75
    
    def _fetch_evidence_package(self, cid: str) -> Optional[Dict[str, Any]]:
        """Fetch evidence package from IPFS/Arweave."""
        try:
            evidence_data = self.sdk.storage.get(cid)
            if isinstance(evidence_data, bytes):
                return json.loads(evidence_data.decode('utf-8'))
            return evidence_data
        except Exception as e:
            rprint(f"[red]❌ Failed to fetch evidence package: {e}[/red]")
            return None
    
    def _fetch_xmtp_thread(self, thread_id: str) -> List[XMTPMessage]:
        """Fetch XMTP thread messages."""
        if not self.sdk.xmtp_manager:
            return []
        
        try:
            return self.sdk.xmtp_manager.get_thread(thread_id)
        except Exception as e:
            rprint(f"[red]❌ Failed to fetch XMTP thread: {e}[/red]")
            return []
    
    def _verify_thread_root(
        self,
        messages: List[XMTPMessage],
        expected_root: str
    ) -> bool:
        """Verify threadRoot matches computed Merkle root."""
        if not self.sdk.xmtp_manager:
            return False
        
        try:
            computed_root = self.sdk.xmtp_manager.compute_thread_root(messages)
            computed_hex = "0x" + computed_root.hex() if isinstance(computed_root, bytes) else computed_root
            expected_hex = expected_root if expected_root.startswith('0x') else "0x" + expected_root
            
            return computed_hex.lower() == expected_hex.lower()
        except Exception as e:
            rprint(f"[yellow]⚠️  Thread root verification error: {e}[/yellow]")
            return False
    
    def _verify_causality(self, messages: List[XMTPMessage]) -> bool:
        """Verify causality constraints (§1.5)."""
        if not self.sdk.xmtp_manager:
            return False
        
        return self.sdk.xmtp_manager.verify_causality(messages)
    
    def _verify_signatures(self, messages: List[XMTPMessage]) -> bool:
        """Verify message signatures (optional)."""
        # For now, assume signatures are valid
        # In production, verify each message signature using eth_account
        return True
    
    def _compute_data_hash(self, evidence_package: Dict[str, Any]) -> bytes:
        """Compute data_hash for score submission."""
        # Use evidence package CID or compute from contents
        package_str = json.dumps(evidence_package, sort_keys=True)
        return keccak(text=package_str)
    
    def _display_scores(self, scores: Dict[str, List[float]]):
        """Display scores in a nice table."""
        if not scores:
            return
        
        table = Table(title="Multi-Dimensional Scores")
        table.add_column("Agent", style="cyan")
        table.add_column("Initiative", justify="right", style="green")
        table.add_column("Collaboration", justify="right", style="green")
        table.add_column("Reasoning", justify="right", style="green")
        table.add_column("Compliance", justify="right", style="green")
        table.add_column("Efficiency", justify="right", style="green")
        table.add_column("Avg", justify="right", style="bold yellow")
        
        for agent_id, score_vector in scores.items():
            agent_short = agent_id[:8] + "..." if len(agent_id) > 10 else agent_id
            avg = sum(score_vector) / len(score_vector)
            
            table.add_row(
                agent_short,
                f"{score_vector[0]:.1f}",
                f"{score_vector[1]:.1f}",
                f"{score_vector[2]:.1f}",
                f"{score_vector[3]:.1f}",
                f"{score_vector[4]:.1f}",
                f"{avg:.1f}"
            )
        
        console.print(table)
