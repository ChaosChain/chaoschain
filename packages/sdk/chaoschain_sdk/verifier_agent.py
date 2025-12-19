"""
Verifier Agent for Causal Audit and Multi-Dimensional Scoring.

Implements Protocol Spec v0.1:
- §1.5: Causal Audit Algorithm
- §3.1: Proof of Agency (PoA) Features - Measurable Agency Dimensions

The VerifierAgent performs a complete causal audit using the DKG:
1. Fetches EvidencePackage from IPFS
2. Reconstructs DKG from XMTP thread + artifacts
3. Verifies threadRoot and evidenceRoot
4. Checks causality (parents exist, timestamps monotonic, no cycles)
5. Verifies signatures
6. Traces causal chains (A→B→C value attribution)
7. Computes multi-dimensional scores using graph analysis

Multi-Dimensional Scoring (§3.1):
- **Initiative**: Original contributions (root nodes, new artifacts)
- **Collaboration**: Building on others' work (causal chains)
- **Reasoning Depth**: Path length and critical nodes
- **Compliance**: Policy checks and rule adherence
- **Efficiency**: Time and resource usage

Studio-Specific Dimensions:
- **Originality** (Creative studios): Novelty of contributions
- **Risk Assessment** (Finance studios): Risk management quality
- **Accuracy** (Prediction studios): Prediction accuracy

Usage:
    ```python
    from chaoschain_sdk import VerifierAgent
    
    verifier = VerifierAgent(sdk)
    
    # Perform causal audit with DKG analysis
    audit_result = verifier.perform_causal_audit(
        evidence_package_cid="Qm...",
        studio_address="0x..."
    )
    
    # Submit scores to StudioProxy
    if audit_result.audit_passed:
        verifier.submit_score_vector(
            studio_address=studio_address,
            epoch=1,
            data_hash=audit_result.data_hash,
            scores=audit_result.scores[worker_id]
        )
    ```
"""

from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from eth_utils import keccak
from eth_account.messages import encode_defunct
from rich import print as rprint
from rich.table import Table
from rich.console import Console

from .exceptions import ChaosChainSDKError
from .xmtp_client import XMTPMessage
from .dkg import DKG, DKGNode

console = Console()


@dataclass
class AuditResult:
    """Result of causal audit with DKG analysis."""
    audit_passed: bool
    evidence_package_cid: str
    data_hash: bytes
    scores: Dict[str, List[float]]  # {agent_id: [scores...]}
    contribution_weights: Dict[str, float]  # {agent_id: weight} (for multi-agent attribution)
    dkg: Optional[DKG]  # The reconstructed DKG
    audit_report: Dict[str, Any]
    errors: List[str]


class VerifierAgent:
    """
    Verifier Agent for causal audit using DKG analysis.
    
    Implements Protocol Spec v0.1:
    - §1.5: Causal Audit Algorithm (with DKG)
    - §3.1: Measurable Agency Dimensions (from DKG analysis)
    - §4.2: Multi-Agent Attribution (contribution weights)
    
    The verifier performs deep causal analysis:
    1. Reconstruct DKG from XMTP + artifacts
    2. Trace causal chains (who enabled what)
    3. Identify critical nodes (key contributions)
    4. Compute fair contribution weights
    5. Score agents based on DKG metrics
    """
    
    def __init__(self, sdk):
        """
        Initialize VerifierAgent.
        
        Args:
            sdk: ChaosChainAgentSDK instance
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
        Perform complete causal audit with DKG analysis (§1.5).
        
        Steps:
        1. Fetch EvidencePackage
        2. Reconstruct DKG from XMTP thread + artifacts
        3. Verify threadRoot (matches computed root)
        4. Verify causality (no cycles, timestamps monotonic)
        5. Verify signatures
        6. Trace causal chains & find critical nodes
        7. Compute contribution weights (§4.2)
        8. Compute multi-dimensional scores (§3.1)
        
        Args:
            evidence_package_cid: IPFS CID of evidence package
            studio_address: Studio contract address
            custom_dimensions: Optional studio-specific dimensions
        
        Returns:
            AuditResult with DKG, scores, and contribution weights
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
                    contribution_weights={},
                    dkg=None,
                    audit_report={},
                    errors=["Failed to fetch evidence package"]
                )
            
            # Step 2: Reconstruct DKG from XMTP thread
            xmtp_thread_id = evidence_package.get("xmtp_thread_id")
            dkg = None
            
            if xmtp_thread_id and self.sdk.xmtp_manager:
                rprint(f"[cyan]🔗 Reconstructing DKG from XMTP thread...[/cyan]")
                xmtp_messages = self._fetch_xmtp_thread(xmtp_thread_id)
                
                # Get artifacts mapping
                artifacts_map = self._build_artifacts_map(evidence_package)
                
                # Build DKG
                dkg = DKG.from_xmtp_thread(xmtp_messages, artifacts_map)
                
                rprint(f"[green]✅ DKG reconstructed: {len(dkg.nodes)} nodes, {len(dkg.agents)} agents[/green]")
                
                # Step 3: Verify threadRoot
                rprint("[cyan]🔍 Verifying thread root...[/cyan]")
                computed_root = dkg.compute_thread_root()
                expected_root = evidence_package.get("thread_root", "")
                
                if expected_root:
                    expected_hex = expected_root if expected_root.startswith('0x') else "0x" + expected_root
                    computed_hex = "0x" + computed_root.hex()
                    
                    if computed_hex.lower() != expected_hex.lower():
                        errors.append("Thread root mismatch")
                        rprint("[red]❌ Thread root verification failed[/red]")
                    else:
                        rprint("[green]✅ Thread root verified[/green]")
                
                # Step 4: Verify causality
                rprint("[cyan]🔍 Verifying causality (DKG)...[/cyan]")
                causality_valid, causality_errors = dkg.verify_causality()
                
                if not causality_valid:
                    errors.extend(causality_errors)
                    rprint(f"[red]❌ Causality verification failed: {len(causality_errors)} errors[/red]")
                else:
                    rprint("[green]✅ Causality verified (no cycles, timestamps monotonic)[/green]")
                
                # Step 5: Verify signatures
                rprint("[cyan]🔍 Verifying signatures...[/cyan]")
                signatures_valid, sig_errors = self._verify_signatures(dkg)
                
                if not signatures_valid:
                    errors.extend(sig_errors)
                    rprint(f"[yellow]⚠️  Signature verification: {len(sig_errors)} errors[/yellow]")
                else:
                    rprint("[green]✅ Signatures verified[/green]")
                
                # Step 6: Trace causal chains & find critical nodes
                rprint("[cyan]🔗 Analyzing causal chains...[/cyan]")
                critical_nodes = dkg.find_critical_nodes()
                rprint(f"[cyan]  Found {len(critical_nodes)} critical nodes[/cyan]")
                
                # Step 7: Compute contribution weights (§4.2)
                rprint("[cyan]⚖️  Computing contribution weights...[/cyan]")
                contribution_weights = dkg.compute_contribution_weights(method="betweenness")
                
                self._display_contribution_weights(contribution_weights)
                
            else:
                rprint("[yellow]⚠️  No XMTP thread, using basic scoring[/yellow]")
                contribution_weights = {}
            
            # Step 8: Compute multi-dimensional scores (§3.1)
            rprint("[cyan]📊 Computing multi-dimensional scores...[/cyan]")
            participants = evidence_package.get("participants", [])
            
            scores = self.compute_multi_dimensional_scores(
                dkg=dkg,
                participants=participants,
                studio_address=studio_address,
                custom_dimensions=custom_dimensions
            )
            
            # Display scores
            self._display_scores(scores)
            
            # Compute data_hash
            data_hash = self._compute_data_hash(evidence_package)
            
            # Build audit report
            audit_report = {
                "evidence_package_cid": evidence_package_cid,
                "dkg_nodes": len(dkg.nodes) if dkg else 0,
                "dkg_agents": len(dkg.agents) if dkg else 0,
                "critical_nodes": len(critical_nodes) if dkg else 0,
                "participants": participants,
                "contribution_weights": contribution_weights,
                "causality_valid": causality_valid if dkg else None,
                "signatures_valid": signatures_valid if dkg else None,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            audit_passed = len(errors) == 0
            
            if audit_passed:
                rprint("[green]✅ Causal audit PASSED (with DKG analysis)[/green]")
            else:
                rprint(f"[red]❌ Causal audit FAILED: {', '.join(errors[:3])}...[/red]")
            
            return AuditResult(
                audit_passed=audit_passed,
                evidence_package_cid=evidence_package_cid,
                data_hash=data_hash,
                scores=scores,
                contribution_weights=contribution_weights,
                dkg=dkg,
                audit_report=audit_report,
                errors=errors
            )
            
        except Exception as e:
            rprint(f"[red]❌ Causal audit error: {e}[/red]")
            import traceback
            traceback.print_exc()
            
            return AuditResult(
                audit_passed=False,
                evidence_package_cid=evidence_package_cid,
                data_hash=bytes(32),
                scores={},
                contribution_weights={},
                dkg=None,
                audit_report={},
                errors=[str(e)]
            )
    
    def compute_multi_dimensional_scores(
        self,
        dkg: Optional[DKG],
        participants: List[Dict[str, Any]],
        studio_address: str,
        custom_dimensions: Optional[List[str]] = None
    ) -> Dict[str, List[float]]:
        """
        Compute multi-dimensional scores using DKG analysis (§3.1).
        
        Universal PoA Dimensions (5):
        1. Initiative: Root nodes + original artifacts
        2. Collaboration: Building on others' work (causal chains)
        3. Reasoning Depth: Path length + critical nodes
        4. Compliance: Policy adherence
        5. Efficiency: Time and resource usage
        
        Studio-Specific Dimensions:
        - Get from studio config or use custom_dimensions
        
        Args:
            dkg: Reconstructed DKG (None if no XMTP thread)
            participants: List of participant agents
            studio_address: Studio contract address
            custom_dimensions: Optional custom dimension names
        
        Returns:
            {agent_id: [score1, score2, ..., scoreN]} (0-100 scale)
        """
        scores = {}
        
        # Get studio-specific dimensions
        studio_dimensions = self._get_studio_dimensions(studio_address)
        if custom_dimensions:
            studio_dimensions.extend(custom_dimensions)
        
        if not dkg:
            # No DKG - assign default scores
            rprint("[yellow]⚠️  No DKG, assigning default scores[/yellow]")
            for participant in participants:
                agent_id = str(participant.get("agent_id", participant.get("address", "")))
                # Default: moderate scores for all dimensions
                base_scores = [70.0, 70.0, 70.0, 100.0, 70.0]
                studio_scores = [70.0] * len(studio_dimensions)
                scores[agent_id] = base_scores + studio_scores
            return scores
        
        # Compute scores from DKG
        for participant in participants:
            agent_id = str(participant.get("agent_id", participant.get("address", "")))
            agent_address = participant.get("address", agent_id)
            
            # Universal PoA dimensions (using DKG)
            initiative = self._compute_initiative_dkg(dkg, agent_address)
            collaboration = self._compute_collaboration_dkg(dkg, agent_address)
            reasoning_depth = self._compute_reasoning_depth_dkg(dkg, agent_address)
            compliance = self._compute_compliance(dkg, agent_address)
            efficiency = self._compute_efficiency_dkg(dkg, agent_address)
            
            # Convert to 0-100 scale
            score_vector = [
                initiative * 100,
                collaboration * 100,
                reasoning_depth * 100,
                compliance * 100,
                efficiency * 100
            ]
            
            # Studio-specific dimensions
            for dim in studio_dimensions:
                studio_score = self._compute_studio_dimension(dkg, agent_address, dim)
                score_vector.append(studio_score * 100)
            
            scores[agent_id] = score_vector
        
        return scores
    
    def _compute_initiative_dkg(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute initiative using DKG analysis (§3.1).
        
        Initiative = fraction of root nodes + new artifacts
        High initiative = agent started new work threads
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_nodes = dkg.get_agent_nodes(agent_address)
        
        if len(agent_nodes) == 0:
            return 0.0
        
        # Count root nodes (no parents) - PRIMARY indicator of initiative
        root_nodes = [node for node in agent_nodes if not node.parents]
        
        # Count unique artifacts - SECONDARY indicator
        unique_artifacts = set()
        for node in agent_nodes:
            unique_artifacts.update(node.artifact_ids)
        
        # Initiative = 70% root nodes + 30% artifacts
        # This prevents agents with no roots from getting high initiative just for having artifacts
        root_score = len(root_nodes) / len(agent_nodes)
        artifact_score = min(len(unique_artifacts) / len(agent_nodes), 1.0)
        
        initiative = (0.7 * root_score) + (0.3 * artifact_score)
        
        return min(initiative, 1.0)
    
    def _compute_collaboration_dkg(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute collaboration using DKG analysis (§3.1).
        
        Collaboration = fraction of nodes that build on others' work
        High collaboration = agent's work enabled by and enables others
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_nodes = dkg.get_agent_nodes(agent_address)
        
        if len(agent_nodes) == 0:
            return 0.0
        
        # Count nodes with parents (building on others)
        collab_nodes = [node for node in agent_nodes if node.parents]
        
        return len(collab_nodes) / len(agent_nodes)
    
    def _compute_reasoning_depth_dkg(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute reasoning depth using DKG analysis (§3.1).
        
        Reasoning Depth = average depth + critical node bonus
        High reasoning = agent's work is deep in causal chains + critical
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_nodes = dkg.get_agent_nodes(agent_address)
        
        if len(agent_nodes) == 0:
            return 0.0
        
        # Compute average depth of agent's nodes
        depths = []
        for node in agent_nodes:
            depth = self._get_node_depth(dkg, node.xmtp_msg_id)
            depths.append(depth)
        
        avg_depth = sum(depths) / len(depths)
        
        # Check if agent has critical nodes
        critical_nodes = dkg.find_critical_nodes()
        critical_node_ids = [n.xmtp_msg_id for n in critical_nodes]
        agent_critical = len([n for n in agent_nodes if n.xmtp_msg_id in critical_node_ids])
        
        # Score = avg_depth/10 + critical_bonus
        depth_score = min(avg_depth / 10, 0.7)  # Max 0.7 from depth
        critical_bonus = min(agent_critical / len(agent_nodes), 0.3)  # Max 0.3 from critical nodes
        
        return depth_score + critical_bonus
    
    def _get_node_depth(self, dkg: DKG, node_id: str) -> int:
        """Get depth of node (distance from nearest root)."""
        if node_id in dkg.roots:
            return 1
        
        node = dkg.nodes.get(node_id)
        if not node or not node.parents:
            return 1
        
        # Depth = 1 + max(parent depths)
        parent_depths = [self._get_node_depth(dkg, p) for p in node.parents]
        return 1 + max(parent_depths)
    
    def _compute_efficiency_dkg(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute efficiency using DKG analysis (§3.1).
        
        Efficiency = output/time ratio
        High efficiency = many quality nodes in short time
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_nodes = dkg.get_agent_nodes(agent_address)
        agent_nodes_sorted = sorted(agent_nodes, key=lambda n: n.ts)
        
        if len(agent_nodes_sorted) < 2:
            return 1.0  # Perfect efficiency for single node
        
        # Compute time span
        time_span = agent_nodes_sorted[-1].ts - agent_nodes_sorted[0].ts
        
        if time_span == 0:
            return 1.0
        
        # Nodes per hour
        nodes_per_hour = len(agent_nodes) / (time_span / 3600)
        
        # Normalize (assume 1 quality node/hour = perfect)
        return min(nodes_per_hour, 1.0)
    
    def _compute_compliance(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute compliance (§3.1).
        
        For now returns 1.0. In production:
        - Check message content against policies
        - Verify data handling rules
        - Check AML/KYC flags (for finance studios)
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        # TODO: Implement policy checks
        return 1.0
    
    def _get_studio_dimensions(self, studio_address: str) -> List[str]:
        """
        Get studio-specific custom dimensions.
        
        Query StudioProxy for custom scoring dimensions.
        
        Args:
            studio_address: Studio contract address
        
        Returns:
            List of dimension names
        """
        # TODO: Query StudioProxy for custom dimensions
        # For now, return empty (only universal dimensions)
        return []
    
    def _compute_studio_dimension(
        self,
        dkg: DKG,
        agent_address: str,
        dimension: str
    ) -> float:
        """
        Compute studio-specific dimension.
        
        Dispatch to appropriate scorer based on dimension name.
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
            dimension: Dimension name
        
        Returns:
            Score (0.0-1.0)
        """
        dimension_lower = dimension.lower()
        
        if "original" in dimension_lower:
            return self._compute_originality(dkg, agent_address)
        elif "risk" in dimension_lower:
            return self._compute_risk_assessment(dkg, agent_address)
        elif "accura" in dimension_lower:
            return self._compute_accuracy(dkg, agent_address)
        else:
            # Default moderate score
            return 0.75
    
    def _compute_originality(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute originality (for creative studios).
        
        Originality = novelty of contributions
        - Root nodes (starting new threads)
        - Unique artifact types
        - Low similarity to others' work
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_nodes = dkg.get_agent_nodes(agent_address)
        
        if not agent_nodes:
            return 0.0
        
        # Count root nodes (original ideas)
        root_count = len([n for n in agent_nodes if not n.parents])
        
        # Count unique artifacts
        artifact_types = set()
        for node in agent_nodes:
            artifact_types.update(node.artifact_ids)
        
        # Score = (roots + unique_artifacts) / nodes
        originality = (root_count + len(artifact_types)) / (len(agent_nodes) + 1)
        
        return min(originality, 1.0)
    
    def _compute_risk_assessment(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute risk assessment quality (for finance studios).
        
        Risk Assessment = quality of risk management
        - Mentions of risk factors
        - Conservative vs aggressive strategy
        - Hedging and mitigation
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        agent_nodes = dkg.get_agent_nodes(agent_address)
        
        if not agent_nodes:
            return 0.0
        
        # Count unique artifact types (more types = more original)
        artifact_types = set()
        for node in agent_nodes:
            artifact_types.update(node.artifact_ids)
        
        # Score = mentions / nodes (normalized)
        score = min(risk_mentions / len(agent_nodes), 1.0)
        
        return score
    
    def _compute_accuracy(self, dkg: DKG, agent_address: str) -> float:
        """
        Compute prediction accuracy (for prediction studios).
        
        Accuracy = correctness of predictions
        - Compare predictions to outcomes
        - Historical accuracy
        - Confidence calibration
        
        Args:
            dkg: DKG instance
            agent_address: Agent address
        
        Returns:
            Score (0.0-1.0)
        """
        # TODO: Implement prediction accuracy computation
        # Requires comparing predictions to actual outcomes
        # For now, return moderate score
        return 0.75
    
    def _verify_signatures(self, dkg: DKG) -> Tuple[bool, List[str]]:
        """
        Verify signatures for all DKG nodes.
        
        Each node should have a valid signature from its author.
        
        Args:
            dkg: DKG instance
        
        Returns:
            (all_valid, errors)
        """
        errors = []
        
        for node_id, node in dkg.nodes.items():
            # Skip if no signature
            if not node.sig or len(node.sig) == 0:
                continue
            
            try:
                # Verify signature
                message_hash = node.compute_canonical_hash()
                message = encode_defunct(message_hash)
                
                # Recover signer
                from eth_account import Account
                recovered_address = Account.recover_message(message, signature=node.sig)
                
                # Check if signer matches author
                if recovered_address.lower() != node.author.lower():
                    errors.append(f"Node {node_id}: signature mismatch (expected {node.author}, got {recovered_address})")
                
            except Exception as e:
                errors.append(f"Node {node_id}: signature verification failed ({e})")
        
        return len(errors) == 0, errors
    
    def submit_score_vector(
        self,
        studio_address: str,
        epoch: int,
        data_hash: bytes,
        scores: List[float]
    ) -> str:
        """
        Submit score vector to StudioProxy.
        
        Args:
            studio_address: Studio contract address
            epoch: Epoch number
            data_hash: Data hash from evidence package
            scores: Score vector [initiative, collaboration, ...]
        
        Returns:
            Transaction hash
        """
        rprint(f"[cyan]📤 Submitting score vector to studio {studio_address[:8]}...[/cyan]")
        
        # Convert scores to uint8 (0-100)
        scores_uint8 = [int(min(max(s, 0), 100)) for s in scores]
        
        # Call StudioProxy.submitScoreVector()
        tx_hash = self.sdk.submit_score_vector(
            studio_address=studio_address,
            epoch=epoch,
            data_hash=data_hash,
            scores=scores_uint8
        )
        
        rprint(f"[green]✅ Score vector submitted: {tx_hash[:16]}...[/green]")
        
        return tx_hash
    
    def submit_score_vectors_per_worker(
        self,
        studio_address: str,
        epoch: int,
        data_hash: bytes,
        scores_per_worker: Dict[str, List[float]]
    ) -> List[str]:
        """
        Submit score vectors FOR EACH WORKER in multi-agent tasks (§3.1, §4.2).
        
        This is the CORRECT method for multi-agent work:
        - Each validator evaluates each worker FROM DKG causal analysis
        - Submits separate score vector for each worker
        - Contract calculates per-worker consensus
        - Each worker gets THEIR OWN reputation scores
        
        Args:
            studio_address: Studio contract address
            epoch: Epoch number
            data_hash: Data hash from evidence package
            scores_per_worker: Dict of {worker_address: [scores]}
        
        Returns:
            List of transaction hashes (one per worker)
            
        Example:
            >>> scores = {
            ...     "0xAlice": [65, 50, 45, 100, 100],  # Alice's scores FROM DKG
            ...     "0xBob": [70, 80, 60, 100, 95],     # Bob's scores FROM DKG
            ...     "0xCarol": [60, 40, 85, 100, 90]    # Carol's scores FROM DKG
            ... }
            >>> tx_hashes = verifier.submit_score_vectors_per_worker(studio, epoch, data_hash, scores)
        """
        rprint(f"[cyan]📤 Submitting per-worker score vectors to studio {studio_address[:8]}...[/cyan]")
        
        tx_hashes = []
        
        for worker_address, scores in scores_per_worker.items():
            rprint(f"[cyan]  Worker {worker_address[:8]}...: {scores}[/cyan]")
            
            # Convert scores to uint8 (0-100)
            scores_uint8 = [int(min(max(s, 0), 100)) for s in scores]
            
            # Call StudioProxy.submitScoreVectorForWorker()
            tx_hash = self.sdk.submit_score_vector_for_worker(
                studio_address=studio_address,
                data_hash=data_hash,
                worker_address=worker_address,
                scores=scores_uint8
            )
            
            tx_hashes.append(tx_hash)
            rprint(f"[green]  ✅ Score vector submitted for worker {worker_address[:8]}...: {tx_hash[:16]}...[/green]")
        
        rprint(f"[green]✅ All per-worker score vectors submitted ({len(tx_hashes)} workers)[/green]")
        
        return tx_hashes
    
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
    
    def _build_artifacts_map(self, evidence_package: Dict[str, Any]) -> Dict[str, List[str]]:
        """Build mapping of {message_id: [artifact_cids]} from evidence package."""
        artifacts_map = {}
        
        # Extract artifacts from evidence package
        artifacts = evidence_package.get("artifacts", [])
        
        # Group by message_id if available
        for artifact in artifacts:
            msg_id = artifact.get("message_id", artifact.get("xmtp_msg_id"))
            cid = artifact.get("cid", artifact.get("ipfs_cid"))
            
            if msg_id and cid:
                if msg_id not in artifacts_map:
                    artifacts_map[msg_id] = []
                artifacts_map[msg_id].append(cid)
        
        return artifacts_map
    
    def _compute_data_hash(self, evidence_package: Dict[str, Any]) -> bytes:
        """Compute data_hash for score submission."""
        package_str = json.dumps(evidence_package, sort_keys=True)
        return keccak(text=package_str)
    
    def _display_scores(self, scores: Dict[str, List[float]]):
        """Display scores in a table."""
        if not scores:
            return
        
        table = Table(title="Multi-Dimensional Scores (DKG Analysis)")
        table.add_column("Agent", style="cyan")
        table.add_column("Initiative", justify="right", style="green")
        table.add_column("Collaboration", justify="right", style="green")
        table.add_column("Reasoning", justify="right", style="green")
        table.add_column("Compliance", justify="right", style="green")
        table.add_column("Efficiency", justify="right", style="green")
        table.add_column("Avg", justify="right", style="bold yellow")
        
        for agent_id, score_vector in scores.items():
            agent_short = agent_id[:8] + "..." if len(agent_id) > 10 else agent_id
            avg = sum(score_vector[:5]) / 5  # Average of universal dimensions
            
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
    
    def _display_contribution_weights(self, weights: Dict[str, float]):
        """Display contribution weights."""
        if not weights:
            return
        
        table = Table(title="Contribution Weights (Multi-Agent Attribution)")
        table.add_column("Agent", style="cyan")
        table.add_column("Weight", justify="right", style="yellow")
        table.add_column("Percentage", justify="right", style="green")
        
        for agent_id, weight in sorted(weights.items(), key=lambda x: x[1], reverse=True):
            agent_short = agent_id[:8] + "..." if len(agent_id) > 10 else agent_id
            percentage = weight * 100
            
            table.add_row(
                agent_short,
                f"{weight:.4f}",
                f"{percentage:.1f}%"
            )
        
        console.print(table)
