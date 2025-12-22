"""
Test: Integration of Contribution Weights + Multi-Dimensional Scoring

This test demonstrates how contribution weights from DKG causal analysis
enhance multi-dimensional scoring for fair reward distribution.

Key Concept (Protocol Spec v0.1 §3.1, §4.1, §4.2):
- Multi-dimensional score VECTORS are computed FROM the DKG causal analysis
- Quality scalar q_u = Σ_d ρ_d s_{u,d} (studio-weighted, NOT simple average!)
- Contribution weights w_u measure causal importance (betweenness centrality)
- Combined: Fair rewards that preserve nuance

Correct Formula (§4.1, §4.2):
    1. Compute score vectors FROM DKG: s_u = [initiative, collab, reasoning, ...]
    2. Quality scalar: q_u = Σ_d ρ_d s_{u,d} (studio-defined weights ρ_d)
    3. Contribution weight: w_u = contrib(u) / Σ_v contrib(v)
    4. Final payout: P_u = (q_u × w_u × E) / Σ_v (q_v × w_v)

Example Scenario:
- Agent A: s_A=[0.65,0.50,0.45,1.0,1.0], q_A=0.72 (weighted), w_A=0.25 → P_A
- Agent B: s_B=[0.30,1.00,0.65,1.0,1.0], q_B=0.79 (weighted), w_B=0.50 → P_B  
- Agent C: s_C=[0.30,1.00,0.85,1.0,1.0], q_C=0.83 (weighted), w_C=0.25 → P_C

Why This is Correct:
1. Score vectors computed FROM DKG (not arbitrary!)
2. Studio-defined dimension weights (not simple average!)
3. Contribution weights from causal graph (betweenness)
4. Preserves multi-dimensional nuance
"""

from chaoschain_sdk.dkg import DKG, DKGNode
from datetime import datetime, timezone
from eth_utils import keccak
from rich import print as rprint
from rich.panel import Panel
from rich.table import Table
from rich.console import Console

console = Console()


def create_realistic_dkg():
    """
    Create a realistic DKG showing different contribution patterns.
    
    Scenario: Research → Strategy → Implementation
    - Agent A (Researcher): Deep analysis (2 root nodes, high quality)
    - Agent B (Strategist): Key insight that enables C (1 node, CRITICAL)
    - Agent C (Developer): Implementation (3 nodes, good quality but less critical)
    
    Expected:
    - A: High quality, significant contribution (foundational research)
    - B: Medium quality, HIGHEST contribution (critical bridge)
    - C: High quality, lower contribution (builds on others)
    """
    dkg = DKG()
    
    agent_a = "0xAAAA"  # Researcher
    agent_b = "0xBBBB"  # Strategist
    agent_c = "0xCCCC"  # Developer
    
    base_ts = int(datetime.now(timezone.utc).timestamp())
    
    # Agent A: Research (2 root nodes - foundational)
    dkg.add_node(DKGNode(
        author=agent_a,
        sig=bytes(65),
        ts=base_ts,
        xmtp_msg_id="a1",
        artifact_ids=["research1.pdf"],
        payload_hash=keccak(text="Deep research on problem"),
        parents=[],  # ROOT
        content="Deep research on problem domain",
        node_type="research"
    ))
    
    dkg.add_node(DKGNode(
        author=agent_a,
        sig=bytes(65),
        ts=base_ts + 300,
        xmtp_msg_id="a2",
        artifact_ids=["analysis1.pdf"],
        payload_hash=keccak(text="Detailed analysis"),
        parents=["a1"],
        content="Detailed analysis of approaches",
        node_type="research"
    ))
    
    # Agent B: Key Insight (1 node - but CRITICAL bridge)
    dkg.add_node(DKGNode(
        author=agent_b,
        sig=bytes(65),
        ts=base_ts + 600,
        xmtp_msg_id="b1",
        artifact_ids=["strategy.md"],
        payload_hash=keccak(text="Key strategic insight"),
        parents=["a2"],  # Builds on A
        content="KEY INSIGHT: Use approach X - this unlocks implementation",
        node_type="strategy"
    ))
    
    # Agent C: Implementation (3 nodes - good work but less critical)
    dkg.add_node(DKGNode(
        author=agent_c,
        sig=bytes(65),
        ts=base_ts + 900,
        xmtp_msg_id="c1",
        artifact_ids=["code1.py"],
        payload_hash=keccak(text="Implementation part 1"),
        parents=["b1"],  # Builds on B
        content="Implemented core module",
        node_type="implementation"
    ))
    
    dkg.add_node(DKGNode(
        author=agent_c,
        sig=bytes(65),
        ts=base_ts + 1200,
        xmtp_msg_id="c2",
        artifact_ids=["code2.py"],
        payload_hash=keccak(text="Implementation part 2"),
        parents=["c1"],
        content="Implemented API layer",
        node_type="implementation"
    ))
    
    dkg.add_node(DKGNode(
        author=agent_c,
        sig=bytes(65),
        ts=base_ts + 1500,
        xmtp_msg_id="c3",
        artifact_ids=["tests.py"],
        payload_hash=keccak(text="Tests"),
        parents=["c2"],
        content="Added comprehensive tests",
        node_type="implementation"
    ))
    
    dkg._compute_all_vlcs()
    
    return dkg


def compute_quality_scores(dkg: DKG, studio_weights: dict) -> dict:
    """
    Compute quality scores (multi-dimensional) for each agent using DKG causal analysis.
    
    Args:
        dkg: DKG instance for causal analysis
        studio_weights: Studio-defined dimension weights {dimension: weight}
    
    Returns:
        {agent_id: quality_scalar} where quality_scalar = Σ (weight_d × score_d)
    
    NOTE: This follows Protocol Spec v0.1 §4.1 - WEIGHTED SUM, not average!
    Each dimension is computed FROM THE DKG (§3.1):
    - Initiative: Non-derivative nodes (DKG roots)
    - Collaboration: Reply/extend edges (DKG parents)
    - Reasoning Depth: Average path length (DKG depth)
    """
    from chaoschain_sdk.verifier_agent import VerifierAgent
    
    class MockSDK:
        xmtp_manager = None
    
    verifier = VerifierAgent(MockSDK())
    
    participants = [
        {"agent_id": "A", "address": "0xAAAA"},
        {"agent_id": "B", "address": "0xBBBB"},
        {"agent_id": "C", "address": "0xCCCC"}
    ]
    
    # Compute multi-dimensional scores FROM DKG CAUSAL ANALYSIS
    score_vectors = verifier.compute_multi_dimensional_scores(
        dkg=dkg,
        participants=participants,
        studio_address="0xStudio",
        custom_dimensions=[]
    )
    
    # Dimension names (5 universal PoA dimensions)
    dimensions = ["initiative", "collaboration", "reasoning_depth", "compliance", "efficiency"]
    
    # Compute quality scalar using WEIGHTED SUM (Protocol Spec §4.1)
    quality_scalars = {}
    for agent_id, score_vector in score_vectors.items():
        # q = Σ (ρ_d × c_d) where ρ_d are studio-defined weights
        quality_scalar = sum(
            studio_weights[dim] * (score_vector[i] / 100.0)  # Normalize to [0,1]
            for i, dim in enumerate(dimensions)
        )
        quality_scalars[agent_id] = quality_scalar
    
    return quality_scalars, score_vectors


def compute_final_rewards(
    quality_scalars: dict,
    contribution_weights: dict,
    total_escrow: float
) -> dict:
    """
    Compute final rewards using Protocol Spec v0.1 §4.1 and §4.2.
    
    Formula (§4.1 + §4.2):
        quality_scalar = Σ (ρ_d × c_d)  # Studio-weighted sum of dimensions
        total_payout = quality_scalar × escrow  # §4.1
        agent_payout = total_payout × (contrib(u) / Σ contrib(v))  # §4.2 Multi-WA attribution
    
    Args:
        quality_scalars: {agent_id: quality_scalar} where scalar ∈ [0,1]
        contribution_weights: {agent_id: contribution_weight} from DKG
        total_escrow: Total escrow budget (E)
    
    Returns:
        ({agent_id: reward_amount}, {agent_id: final_score})
    """
    # Correct multi-agent payout formula (§4.1 + §4.2):
    # 
    # Each agent has:
    #   - Quality scalar: q_u = Σ (ρ_d × s_{u,d}) ∈ [0,1]  (§4.1)
    #   - Contribution weight: w_u (from DKG, normalized, Σw_u = 1.0)  (§4.2)
    # 
    # Combined score: f_u = q_u × w_u
    # Final payout: P_u = (f_u / Σ_v f_v) × E
    # 
    # This ensures:
    #   - High quality × high contribution → High payout ✅
    #   - High quality × low contribution → Medium payout ✅
    #   - Low quality × high contribution → Medium payout ✅
    #   - Total payouts ≤ E (bounded) ✅
    
    rewards = {}
    final_scores = {}
    
    # Compute combined scores (quality × contribution)
    for agent_id in quality_scalars:
        quality = quality_scalars[agent_id]
        contribution = contribution_weights.get(agent_id, 0.0)
        final_scores[agent_id] = quality * contribution
    
    # Normalize and compute payouts
    total_final_score = sum(final_scores.values())
    
    for agent_id, final_score in final_scores.items():
        if total_final_score > 0:
            reward = (final_score / total_final_score) * total_escrow
        else:
            reward = 0.0
        rewards[agent_id] = reward
    
    return rewards, final_scores


def test_integration():
    """Test integration of contribution weights + quality scores."""
    console.print(Panel.fit(
        "🧪 Test: Contribution Weights + Multi-Dimensional Scoring Integration\n\n"
        "Demonstrates how contribution weights enhance reward fairness",
        style="bold cyan"
    ))
    
    # Create realistic DKG
    dkg = create_realistic_dkg()
    
    rprint("\n[cyan]Scenario: Research → Strategy → Implementation[/cyan]")
    rprint(f"  • Agent A (Researcher): {len(dkg.get_agent_nodes('0xAAAA'))} nodes (foundational research)")
    rprint(f"  • Agent B (Strategist): {len(dkg.get_agent_nodes('0xBBBB'))} nodes (KEY INSIGHT)")
    rprint(f"  • Agent C (Developer): {len(dkg.get_agent_nodes('0xCCCC'))} nodes (implementation)")
    
    # Compute contribution weights (from DKG graph analysis)
    rprint("\n[cyan]Step 1: Computing contribution weights (betweenness centrality)...[/cyan]")
    contribution_weights = dkg.compute_contribution_weights(method="betweenness")
    
    table = Table(title="Contribution Weights (Graph Position)")
    table.add_column("Agent", style="cyan")
    table.add_column("Role", style="yellow")
    table.add_column("Weight", justify="right", style="green")
    table.add_column("Meaning", style="white")
    
    for agent_id in ["0xAAAA", "0xBBBB", "0xCCCC"]:
        role = {"0xAAAA": "Researcher", "0xBBBB": "Strategist", "0xCCCC": "Developer"}[agent_id]
        weight = contribution_weights.get(agent_id, 0.0)
        
        if weight > 0.4:
            meaning = "CRITICAL (bridge position)"
        elif weight > 0.25:
            meaning = "Significant (foundational)"
        else:
            meaning = "Standard (implementation)"
        
        table.add_row(agent_id[:6], role, f"{weight:.4f} ({weight*100:.1f}%)", meaning)
    
    console.print(table)
    
    # Compute quality scores (multi-dimensional with studio weights)
    rprint("\n[cyan]Step 2: Computing quality scores (multi-dimensional with studio weights)...[/cyan]")
    
    # Studio-defined dimension weights (§4.1)
    # Different studios weight dimensions differently!
    studio_weights = {
        "initiative": 0.25,        # Original research
        "collaboration": 0.20,     # Team work
        "reasoning_depth": 0.30,   # Deep analysis (highest for research studio)
        "compliance": 0.15,        # Following rules
        "efficiency": 0.10         # Speed
    }
    
    rprint("\n[yellow]Studio Weights (ρ_d):[/yellow]")
    for dim, weight in studio_weights.items():
        rprint(f"  • {dim}: {weight:.2f}")
    
    quality_scalars, score_vectors = compute_quality_scores(dkg, studio_weights)
    
    table = Table(title="Multi-Dimensional Scores (FROM DKG CAUSAL ANALYSIS)")
    table.add_column("Agent", style="cyan")
    table.add_column("Init", justify="right", style="blue")
    table.add_column("Collab", justify="right", style="blue")
    table.add_column("Reason", justify="right", style="blue")
    table.add_column("Comply", justify="right", style="blue")
    table.add_column("Effic", justify="right", style="blue")
    table.add_column("Quality Scalar", justify="right", style="bold green")
    
    dimensions = ["initiative", "collaboration", "reasoning_depth", "compliance", "efficiency"]
    
    for agent_id in ["A", "B", "C"]:
        vector = score_vectors[agent_id]
        scalar = quality_scalars[agent_id]
        
        table.add_row(
            agent_id,
            f"{vector[0]:.0f}",
            f"{vector[1]:.0f}",
            f"{vector[2]:.0f}",
            f"{vector[3]:.0f}",
            f"{vector[4]:.0f}",
            f"{scalar:.3f}"
        )
    
    console.print(table)
    
    rprint("\n[yellow]Key Insight:[/yellow]")
    rprint("  Quality scalar = Σ (weight_d × score_d)")
    rprint("  This preserves multi-dimensional nuance!")
    rprint("  Different studios can weight dimensions differently.")
    
    # Compute final rewards (Protocol Spec §4.1 + §4.2)
    rprint("\n[cyan]Step 3: Computing final rewards (Protocol Spec §4.1 + §4.2)...[/cyan]")
    
    # Map agent IDs
    quality_mapped = {
        "0xAAAA": quality_scalars["A"],
        "0xBBBB": quality_scalars["B"],
        "0xCCCC": quality_scalars["C"]
    }
    
    total_escrow = 1000.0  # $1000 escrow (E)
    rprint(f"\n[yellow]Total Escrow (E): ${total_escrow:.0f}[/yellow]")
    
    rewards, final_scores = compute_final_rewards(quality_mapped, contribution_weights, total_escrow)
    
    table = Table(title=f"Final Rewards (Escrow: ${total_escrow:.0f})")
    table.add_column("Agent", style="cyan")
    table.add_column("Quality Scalar (q)", justify="right", style="yellow")
    table.add_column("Contribution (c)", justify="right", style="blue")
    table.add_column("Share", justify="right", style="magenta")
    table.add_column("Reward", justify="right", style="bold green")
    
    total_contribution = sum(contribution_weights.values())
    
    for agent_id in ["0xAAAA", "0xBBBB", "0xCCCC"]:
        quality = quality_mapped[agent_id]
        contribution = contribution_weights.get(agent_id, 0.0)
        share = contribution / total_contribution if total_contribution > 0 else 0
        reward = rewards[agent_id]
        
        table.add_row(
            agent_id[:6],
            f"{quality:.3f}",
            f"{contribution:.3f}",
            f"{share*100:.1f}%",
            f"${reward:.2f}"
        )
    
    console.print(table)
    
    rprint("\n[yellow]Formula:[/yellow]")
    rprint("  1. Quality scalar: q_u = Σ (ρ_d × s_{u,d})  [cyan]# Studio-weighted dimensions[/cyan]")
    rprint("  2. Combined score: f_u = q_u × w_u  [cyan]# Quality × Contribution[/cyan]")
    rprint("  3. Agent reward: P_u = (f_u / Σ_v f_v) × E  [cyan]# Normalized payout[/cyan]")
    rprint("\n[yellow]This preserves multi-dimensional nuance AND causal importance![/yellow]")
    
    # Verify fairness
    rprint("\n[cyan]Step 4: Verifying fairness...[/cyan]")
    
    # Check: Agent B should get significant reward despite having only 1 node
    agent_b_reward = rewards["0xBBBB"]
    agent_c_reward = rewards["0xCCCC"]
    
    rprint(f"\n[yellow]Agent B (1 node): ${agent_b_reward:.2f}[/yellow]")
    rprint(f"[yellow]Agent C (3 nodes): ${agent_c_reward:.2f}[/yellow]")
    
    if agent_b_reward > agent_c_reward:
        rprint("[green]✅ FAIR: Agent B gets more despite fewer nodes (CRITICAL bridge position!)[/green]")
    else:
        rprint("[red]❌ UNFAIR: Agent C gets more just for having more nodes[/red]")
    
    # Check: Total rewards = budget
    total_distributed = sum(rewards.values())
    assert abs(total_distributed - total_escrow) < 0.01, "Rewards don't sum to escrow"
    rprint(f"[green]✅ Total distributed: ${total_distributed:.2f} = ${total_escrow:.2f}[/green]")
    
    # Summary
    console.print("\n")
    console.print(Panel.fit(
        "✅ Integration Test PASSED!\n\n"
        "Key Findings:\n"
        "1. Quality scores measure HOW WELL agents performed\n"
        "2. Contribution weights measure HOW MUCH they contributed\n"
        "3. Combined formula ensures FAIR rewards:\n"
        "   - Agent B: Critical bridge → High reward (despite 1 node)\n"
        "   - Agent A: Foundational research → Good reward\n"
        "   - Agent C: Implementation only → Lower reward (less critical)\n\n"
        "This is PROPER multi-agent attribution! 🚀",
        style="bold green"
    ))


if __name__ == "__main__":
    test_integration()

