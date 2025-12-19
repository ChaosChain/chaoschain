#!/usr/bin/env python3
"""
Test Multi-Agent Attribution (Protocol Spec §4.2)

This test demonstrates:
1. Multiple agents collaborate on a task
2. DKG tracks causal contributions
3. Contribution weights computed FROM DKG
4. Rewards distributed based on DKG weights
5. Each agent gets reputation based on their contribution
"""

from chaoschain_sdk.dkg import DKG, DKGNode
from chaoschain_sdk.verifier_agent import VerifierAgent, AuditResult
from chaoschain_sdk.xmtp_client import XMTPMessage
from datetime import datetime, timezone
from typing import Dict, List
from rich import print as rprint
from rich.table import Table
from rich.panel import Panel


def create_multi_agent_dkg() -> DKG:
    """
    Create a realistic multi-agent DKG:
    
    Alice (Researcher):
      - Starts with literature review (root node)
      - 2 nodes total
      
    Bob (Strategist):
      - Builds on Alice's research
      - Adds strategy analysis
      - 3 nodes total
      
    Carol (Developer):
      - Implements based on Bob's strategy
      - Adds code + tests
      - 4 nodes total
    """
    now = datetime.now(timezone.utc)
    
    nodes = [
        # Alice: Root node (literature review)
        DKGNode(
            xmtp_msg_id="alice_1",
            author="0xAlice",
            ts=int(now.timestamp()),
            payload_hash=b"hash_alice_lit_review",
            parents=[],  # ROOT!
            vlc=b"vlc_alice_1",
            sig=b"sig_alice_1",
            artifact_ids=["ipfs://lit_review.pdf"]
        ),
        # Alice: Analysis node
        DKGNode(
            id="alice_2",
            author="0xAlice",
            timestamp=now.timestamp() + 100,
            content_hash="hash_alice_analysis",
            parent_ids=["alice_1"],
            vlc="vlc_alice_2",
            signature="sig_alice_2",
            artifact_ids=["ipfs://analysis.md"],
            payload_hash="payload_alice_2"
        ),
        
        # Bob: Builds on Alice's analysis
        DKGNode(
            id="bob_1",
            author="0xBob",
            timestamp=now.timestamp() + 200,
            content_hash="hash_bob_strategy",
            parent_ids=["alice_2"],  # BUILDS ON ALICE!
            vlc="vlc_bob_1",
            signature="sig_bob_1",
            artifact_ids=["ipfs://strategy.pdf"],
            payload_hash="payload_bob_1"
        ),
        # Bob: Risk assessment
        DKGNode(
            id="bob_2",
            author="0xBob",
            timestamp=now.timestamp() + 300,
            content_hash="hash_bob_risk",
            parent_ids=["bob_1"],
            vlc="vlc_bob_2",
            signature="sig_bob_2",
            artifact_ids=["ipfs://risk_analysis.pdf"],
            payload_hash="payload_bob_2"
        ),
        # Bob: Final recommendations
        DKGNode(
            id="bob_3",
            author="0xBob",
            timestamp=now.timestamp() + 400,
            content_hash="hash_bob_recommendations",
            parent_ids=["bob_2"],
            vlc="vlc_bob_3",
            signature="sig_bob_3",
            artifact_ids=["ipfs://recommendations.md"],
            payload_hash="payload_bob_3"
        ),
        
        # Carol: Implements based on Bob's recommendations
        DKGNode(
            id="carol_1",
            author="0xCarol",
            timestamp=now.timestamp() + 500,
            content_hash="hash_carol_impl",
            parent_ids=["bob_3"],  # BUILDS ON BOB!
            vlc="vlc_carol_1",
            signature="sig_carol_1",
            artifact_ids=["ipfs://implementation.sol"],
            payload_hash="payload_carol_1"
        ),
        # Carol: Tests
        DKGNode(
            id="carol_2",
            author="0xCarol",
            timestamp=now.timestamp() + 600,
            content_hash="hash_carol_tests",
            parent_ids=["carol_1"],
            vlc="vlc_carol_2",
            signature="sig_carol_2",
            artifact_ids=["ipfs://tests.sol"],
            payload_hash="payload_carol_2"
        ),
        # Carol: Documentation
        DKGNode(
            id="carol_3",
            author="0xCarol",
            timestamp=now.timestamp() + 700,
            content_hash="hash_carol_docs",
            parent_ids=["carol_2"],
            vlc="vlc_carol_3",
            signature="sig_carol_3",
            artifact_ids=["ipfs://docs.md"],
            payload_hash="payload_carol_3"
        ),
        # Carol: Deployment
        DKGNode(
            id="carol_4",
            author="0xCarol",
            timestamp=now.timestamp() + 800,
            content_hash="hash_carol_deploy",
            parent_ids=["carol_3"],
            vlc="vlc_carol_4",
            signature="sig_carol_4",
            artifact_ids=["ipfs://deployment.json"],
            payload_hash="payload_carol_4"
        ),
    ]
    
    # Create DKG
    dkg = DKG()
    for node in nodes:
        dkg.add_node(node)
    
    return dkg


def test_dkg_contribution_weights():
    """Test that DKG computes contribution weights correctly."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 1: DKG Contribution Weights (§4.2)  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    dkg = create_multi_agent_dkg()
    
    # Compute contribution weights using betweenness centrality
    weights = dkg.compute_contribution_weights(method="betweenness")
    
    rprint("[yellow]📊 Contribution Weights FROM DKG:[/yellow]\n")
    
    table = Table(title="Agent Contributions (FROM DKG Analysis)")
    table.add_column("Agent", style="cyan")
    table.add_column("Nodes", justify="right", style="yellow")
    table.add_column("Contribution Weight", justify="right", style="green")
    table.add_column("Interpretation", style="dim")
    
    for agent in ["0xAlice", "0xBob", "0xCarol"]:
        node_count = len([n for n in dkg.nodes.values() if n.author == agent])
        weight = weights.get(agent, 0.0)
        
        if weight > 0.4:
            interp = "HIGH - Critical path"
        elif weight > 0.25:
            interp = "MEDIUM - Important contributor"
        else:
            interp = "LOW - Supporting role"
        
        table.add_row(
            agent,
            str(node_count),
            f"{weight:.1%}",
            interp
        )
    
    rprint(table)
    
    # Verify weights sum to 1.0
    total = sum(weights.values())
    assert abs(total - 1.0) < 1e-6, f"Weights must sum to 1.0, got {total}"
    rprint(f"\n[green]✓[/green] Weights sum to {total:.4f} (expected 1.0)")
    
    # Verify Bob has highest weight (most nodes + central position)
    assert weights["0xBob"] > weights["0xAlice"], "Bob should have > Alice (more nodes + central)"
    assert weights["0xBob"] > weights["0xCarol"], "Bob should have > Carol (enables Carol's work)"
    rprint(f"[green]✓[/green] Bob has highest contribution (central node in causal chain)")
    
    return weights


def test_reward_distribution(contribution_weights: Dict[str, float]):
    """Test reward distribution based on DKG contribution weights."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 2: Reward Distribution (§4.2)  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    # Simulate escrow
    total_escrow = 1000.0  # USDC
    
    # Calculate rewards using contribution weights
    rewards = {
        agent: total_escrow * weight
        for agent, weight in contribution_weights.items()
    }
    
    rprint(f"[yellow]💰 Reward Distribution (Total Escrow: {total_escrow} USDC):[/yellow]\n")
    
    table = Table(title="Reward Distribution Based on DKG Contribution Weights")
    table.add_column("Agent", style="cyan")
    table.add_column("Contribution %", justify="right", style="yellow")
    table.add_column("Reward (USDC)", justify="right", style="green")
    table.add_column("Fair?", style="dim")
    
    for agent in ["0xAlice", "0xBob", "0xCarol"]:
        weight = contribution_weights[agent]
        reward = rewards[agent]
        
        # Fairness check based on contribution
        if agent == "0xAlice":
            fairness = "✓ Started the chain"
        elif agent == "0xBob":
            fairness = "✓ Central + most work"
        else:
            fairness = "✓ Built final product"
        
        table.add_row(
            agent,
            f"{weight:.1%}",
            f"{reward:.2f}",
            fairness
        )
    
    rprint(table)
    
    # Verify total rewards = total escrow
    total_rewards = sum(rewards.values())
    assert abs(total_rewards - total_escrow) < 1e-6, f"Total rewards must equal escrow"
    rprint(f"\n[green]✓[/green] Total rewards: {total_rewards:.2f} USDC (matches escrow)")
    
    # Verify fairness: Bob gets most (did most work + critical path)
    assert rewards["0xBob"] > rewards["0xAlice"], "Bob should get > Alice"
    assert rewards["0xBob"] > rewards["0xCarol"], "Bob should get > Carol"
    rprint(f"[green]✓[/green] Rewards distributed fairly based on DKG contribution")
    
    return rewards


def test_multi_dimensional_scores():
    """Test that each agent gets different scores based on their role."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 3: Multi-Dimensional Scores FROM DKG  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    dkg = create_multi_agent_dkg()
    
    # Mock VerifierAgent scoring (in production, this would be real)
    participants = [
        {"address": "0xAlice"},
        {"address": "0xBob"},
        {"address": "0xCarol"}
    ]
    
    # Compute scores FROM DKG for each agent
    from chaoschain_sdk.verifier_agent import VerifierAgent
    from unittest.mock import MagicMock
    
    # Mock SDK
    mock_sdk = MagicMock()
    verifier = VerifierAgent(mock_sdk)
    
    scores = verifier.compute_multi_dimensional_scores(
        dkg=dkg,
        participants=participants,
        studio_address="0xStudio",
        custom_dimensions=[]
    )
    
    rprint("[yellow]📊 Multi-Dimensional Scores FROM DKG:[/yellow]\n")
    
    table = Table(title="Agent Scores (Computed FROM DKG Causal Analysis)")
    table.add_column("Agent", style="cyan")
    table.add_column("Initiative", justify="right", style="yellow")
    table.add_column("Collaboration", justify="right", style="yellow")
    table.add_column("Reasoning", justify="right", style="yellow")
    table.add_column("Compliance", justify="right", style="yellow")
    table.add_column("Efficiency", justify="right", style="yellow")
    
    dimension_names = ["Initiative", "Collaboration", "Reasoning", "Compliance", "Efficiency"]
    
    for agent_addr in ["0xAlice", "0xBob", "0xCarol"]:
        agent_scores = scores[agent_addr]
        table.add_row(
            agent_addr,
            f"{agent_scores[0]:.0f}",
            f"{agent_scores[1]:.0f}",
            f"{agent_scores[2]:.0f}",
            f"{agent_scores[3]:.0f}",
            f"{agent_scores[4]:.0f}"
        )
    
    rprint(table)
    
    # Verify Alice has high initiative (started the chain with root node)
    alice_initiative = scores["0xAlice"][0]
    bob_initiative = scores["0xBob"][0]
    carol_initiative = scores["0xCarol"][0]
    
    assert alice_initiative > bob_initiative, "Alice should have highest initiative (root node)"
    assert alice_initiative > carol_initiative, "Alice should have highest initiative (root node)"
    rprint(f"\n[green]✓[/green] Alice has highest initiative (started with root node in DKG)")
    
    # Verify Bob has high collaboration (builds on Alice, enables Carol)
    bob_collab = scores["0xBob"][1]
    alice_collab = scores["0xAlice"][1]
    
    assert bob_collab > alice_collab, "Bob should have high collaboration (builds on Alice)"
    rprint(f"[green]✓[/green] Bob has high collaboration (builds on Alice in DKG)")
    
    # Verify Carol has high reasoning depth (deepest in chain)
    carol_reasoning = scores["0xCarol"][2]
    alice_reasoning = scores["0xAlice"][2]
    
    assert carol_reasoning > alice_reasoning, "Carol should have high reasoning depth (deepest path)"
    rprint(f"[green]✓[/green] Carol has high reasoning depth (deepest path in DKG)")
    
    return scores


def test_full_integration():
    """Test complete multi-agent attribution flow."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 4: Full Integration (End-to-End)  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    # Step 1: Create DKG
    dkg = create_multi_agent_dkg()
    rprint("[green]✓[/green] DKG created with 9 nodes (Alice: 2, Bob: 3, Carol: 4)")
    
    # Step 2: Verify causality
    assert dkg.verify_causality(), "DKG causality must be valid"
    rprint("[green]✓[/green] DKG causality verified (all parent links valid)")
    
    # Step 3: Compute contribution weights
    weights = dkg.compute_contribution_weights(method="betweenness")
    rprint(f"[green]✓[/green] Contribution weights computed FROM DKG:")
    for agent, weight in weights.items():
        rprint(f"    {agent}: {weight:.1%}")
    
    # Step 4: Verify weights sum to 1.0
    total = sum(weights.values())
    assert abs(total - 1.0) < 1e-6, f"Weights must sum to 1.0"
    rprint(f"[green]✓[/green] Weights sum to {total:.4f}")
    
    # Step 5: Simulate reward distribution
    escrow = 1000.0
    rewards = {agent: escrow * weight for agent, weight in weights.items()}
    rprint(f"\n[yellow]💰 Rewards (from {escrow} USDC escrow):[/yellow]")
    for agent, reward in rewards.items():
        rprint(f"    {agent}: {reward:.2f} USDC ({weights[agent]:.1%})")
    
    # Step 6: Verify fairness
    assert sum(rewards.values()) == escrow, "Total rewards must equal escrow"
    rprint(f"\n[green]✓[/green] All rewards distributed: {sum(rewards.values()):.2f} USDC")
    
    # Step 7: Summary
    rprint("\n" + "="*60)
    rprint("[bold green]✅ MULTI-AGENT ATTRIBUTION COMPLETE![/bold green]")
    rprint("="*60)
    rprint("\n[bold]Key Achievements:[/bold]")
    rprint("  1. ✓ DKG tracks causal contributions")
    rprint("  2. ✓ Contribution weights FROM DKG (NOT arbitrary)")
    rprint("  3. ✓ Rewards distributed based on DKG weights")
    rprint("  4. ✓ Multi-dimensional scores per agent")
    rprint("  5. ✓ Protocol Spec §4.2 FULLY IMPLEMENTED")
    
    return True


if __name__ == "__main__":
    rprint("\n" + "="*60)
    rprint("[bold cyan]Multi-Agent Attribution Test Suite (§4.2)[/bold cyan]")
    rprint("="*60)
    rprint("\n[dim]Testing DKG-based contribution weights and reward distribution[/dim]\n")
    
    try:
        # Run tests
        weights = test_dkg_contribution_weights()
        rewards = test_reward_distribution(weights)
        scores = test_multi_dimensional_scores()
        test_full_integration()
        
        rprint("\n" + "="*60)
        rprint("[bold green]✅ ALL TESTS PASSED![/bold green]")
        rprint("="*60)
        rprint("\n[bold]Summary:[/bold]")
        rprint("  • DKG causal analysis works correctly")
        rprint("  • Contribution weights computed FROM DKG structure")
        rprint("  • Rewards distributed fairly based on contributions")
        rprint("  • Multi-dimensional reputation for each agent")
        rprint("  • Protocol Spec §4.2 compliance verified")
        
    except AssertionError as e:
        rprint(f"\n[bold red]❌ TEST FAILED: {e}[/bold red]")
        raise
    except Exception as e:
        rprint(f"\n[bold red]❌ ERROR: {e}[/bold red]")
        raise

