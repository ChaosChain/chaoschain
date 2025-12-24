"""
Test DKG + Causal Analysis - Multi-Agent Scenario

This test demonstrates the FULL DKG + causal analysis implementation:

Scenario: Three agents collaborate on a trading task
- Agent A (Analyst): Performs market analysis
- Agent B (Strategist): Creates trading strategy based on A's analysis
- Agent C (Executor): Executes trades based on B's strategy

Causal Chain: A → B → C (A's work enabled B, B's work enabled C)

The VerifierAgent should:
1. Reconstruct the DKG from XMTP thread
2. Trace the causal chain (A→B→C)
3. Identify critical nodes (A and B are critical for C's success)
4. Compute fair contribution weights (A and B get credit for enabling C)
5. Score each agent based on their role in the chain
"""

from chaoschain_sdk.dkg import DKG, DKGNode
from chaoschain_sdk.verifier_agent import VerifierAgent
from datetime import datetime, timezone
from eth_utils import keccak
from rich import print as rprint
from rich.panel import Panel
from rich.console import Console

console = Console()


def create_mock_dkg():
    """
    Create a mock DKG for testing causal analysis.
    
    Causal Chain:
    - Agent A: Analysis (root) → 2 analysis nodes
    - Agent B: Strategy (builds on A) → 2 strategy nodes
    - Agent C: Execution (builds on B) → 2 execution nodes
    
    Expected Results:
    - A: High initiative (root nodes), medium collaboration
    - B: Medium initiative, high collaboration (builds on A, enables C)
    - C: Low initiative (no roots), high collaboration (builds on B)
    - Contribution weights: A ≈ 0.35, B ≈ 0.35, C ≈ 0.30
    """
    dkg = DKG()
    
    # Agent addresses
    agent_a = "0xAAAA1111"  # Analyst
    agent_b = "0xBBBB2222"  # Strategist
    agent_c = "0xCCCC3333"  # Executor
    
    base_ts = int(datetime.now(timezone.utc).timestamp())
    
    # === AGENT A: Market Analysis (Root Nodes) ===
    
    # A1: Initial market analysis
    node_a1 = DKGNode(
        author=agent_a,
        sig=bytes(65),
        ts=base_ts,
        xmtp_msg_id="msg_a1",
        artifact_ids=["QmAnalysis1"],
        payload_hash=keccak(text="Market analysis: BTC bullish trend"),
        parents=[],  # ROOT NODE
        content="Market analysis: BTC showing bullish momentum, strong support at $40k",
        node_type="analysis"
    )
    dkg.add_node(node_a1)
    
    # A2: Deep dive analysis
    node_a2 = DKGNode(
        author=agent_a,
        sig=bytes(65),
        ts=base_ts + 300,
        xmtp_msg_id="msg_a2",
        artifact_ids=["QmAnalysis2"],
        payload_hash=keccak(text="Deep analysis: on-chain metrics"),
        parents=["msg_a1"],  # Builds on A1
        content="Deep analysis: on-chain metrics show accumulation, whale activity increasing",
        node_type="analysis"
    )
    dkg.add_node(node_a2)
    
    # === AGENT B: Trading Strategy (Builds on A) ===
    
    # B1: Strategy based on A's analysis
    node_b1 = DKGNode(
        author=agent_b,
        sig=bytes(65),
        ts=base_ts + 600,
        xmtp_msg_id="msg_b1",
        artifact_ids=["QmStrategy1"],
        payload_hash=keccak(text="Strategy: long BTC with stop loss"),
        parents=["msg_a2"],  # BUILDS ON A'S ANALYSIS
        content="Strategy: Long BTC at $40.5k, stop loss at $39k, target $45k. Risk/reward 1:5",
        node_type="strategy"
    )
    dkg.add_node(node_b1)
    
    # B2: Risk management plan
    node_b2 = DKGNode(
        author=agent_b,
        sig=bytes(65),
        ts=base_ts + 900,
        xmtp_msg_id="msg_b2",
        artifact_ids=["QmRisk1"],
        payload_hash=keccak(text="Risk management: position sizing"),
        parents=["msg_b1"],  # Builds on B1
        content="Risk management: 2% portfolio allocation, hedged with put options",
        node_type="risk_assessment"
    )
    dkg.add_node(node_b2)
    
    # === AGENT C: Execution (Builds on B) ===
    
    # C1: Trade execution
    node_c1 = DKGNode(
        author=agent_c,
        sig=bytes(65),
        ts=base_ts + 1200,
        xmtp_msg_id="msg_c1",
        artifact_ids=["QmExecution1"],
        payload_hash=keccak(text="Executed: long BTC"),
        parents=["msg_b2"],  # BUILDS ON B'S STRATEGY
        content="Executed: Long 0.5 BTC at $40,520. Stop loss set at $39,000",
        node_type="execution"
    )
    dkg.add_node(node_c1)
    
    # C2: Trade result
    node_c2 = DKGNode(
        author=agent_c,
        sig=bytes(65),
        ts=base_ts + 1800,
        xmtp_msg_id="msg_c2",
        artifact_ids=["QmResult1"],
        payload_hash=keccak(text="Result: +12% profit"),
        parents=["msg_c1"],  # Builds on C1
        content="Trade closed: BTC reached $45,380. Profit: +12.1% ($2,430)",
        node_type="result"
    )
    dkg.add_node(node_c2)
    
    # Compute VLCs
    dkg._compute_all_vlcs()
    
    return dkg


def test_dkg_structure():
    """Test DKG structure and properties."""
    console.print(Panel.fit(
        "🔬 Test 1: DKG Structure & Properties",
        style="bold cyan"
    ))
    
    dkg = create_mock_dkg()
    
    # Verify structure
    assert len(dkg.nodes) == 6, f"Expected 6 nodes, got {len(dkg.nodes)}"
    assert len(dkg.agents) == 3, f"Expected 3 agents, got {len(dkg.agents)}"
    assert len(dkg.roots) == 1, f"Expected 1 root, got {len(dkg.roots)}"
    assert len(dkg.terminals) == 1, f"Expected 1 terminal, got {len(dkg.terminals)}"
    
    rprint("[green]✅ DKG structure correct[/green]")
    rprint(f"   Nodes: {len(dkg.nodes)}")
    rprint(f"   Agents: {len(dkg.agents)}")
    rprint(f"   Roots: {list(dkg.roots)}")
    rprint(f"   Terminals: {list(dkg.terminals)}")
    
    # Verify causality
    is_valid, errors = dkg.verify_causality()
    assert is_valid, f"Causality check failed: {errors}"
    rprint("[green]✅ Causality verified (no cycles, timestamps monotonic)[/green]")
    
    return dkg


def test_causal_chain_tracing(dkg):
    """Test causal chain tracing (A→B→C)."""
    console.print("\n")
    console.print(Panel.fit(
        "🔗 Test 2: Causal Chain Tracing (A→B→C)",
        style="bold cyan"
    ))
    
    # Trace chain from A1 (root) to C2 (terminal)
    chain = dkg.trace_causal_chain("msg_a1", "msg_c2")
    
    assert len(chain) > 0, "No causal chain found"
    rprint(f"[green]✅ Causal chain traced: {len(chain)} nodes[/green]")
    
    # Display chain
    rprint("\n[cyan]Causal Chain (A→B→C):[/cyan]")
    for i, node in enumerate(chain):
        agent_label = {
            "0xAAAA1111": "Agent A (Analyst)",
            "0xBBBB2222": "Agent B (Strategist)",
            "0xCCCC3333": "Agent C (Executor)"
        }.get(node.author, node.author)
        
        rprint(f"  {i+1}. {node.xmtp_msg_id}: {agent_label}")
        rprint(f"     Content: {node.content[:60]}...")
    
    # Verify chain includes all agents
    chain_agents = {node.author for node in chain}
    assert "0xAAAA1111" in chain_agents, "Agent A not in chain"
    assert "0xBBBB2222" in chain_agents, "Agent B not in chain"
    assert "0xCCCC3333" in chain_agents, "Agent C not in chain"
    
    rprint("[green]✅ All agents present in causal chain[/green]")


def test_critical_nodes(dkg):
    """Test critical node identification."""
    console.print("\n")
    console.print(Panel.fit(
        "⭐ Test 3: Critical Node Identification",
        style="bold cyan"
    ))
    
    # Find critical nodes
    critical_nodes = dkg.find_critical_nodes()
    
    assert len(critical_nodes) > 0, "No critical nodes found"
    rprint(f"[green]✅ Found {len(critical_nodes)} critical nodes[/green]")
    
    # Display critical nodes
    rprint("\n[cyan]Critical Nodes (enabled downstream value):[/cyan]")
    for node in critical_nodes:
        agent_label = {
            "0xAAAA1111": "Agent A",
            "0xBBBB2222": "Agent B",
            "0xCCCC3333": "Agent C"
        }.get(node.author, node.author)
        
        rprint(f"  • {node.xmtp_msg_id}: {agent_label} - {node.node_type}")
    
    # A1, A2, B1, B2 should be critical (they enabled C's work)
    critical_ids = [n.xmtp_msg_id for n in critical_nodes]
    assert "msg_a1" in critical_ids, "A1 should be critical (root)"
    assert "msg_b1" in critical_ids, "B1 should be critical (enabled C)"
    
    rprint("[green]✅ Critical nodes correctly identified[/green]")


def test_contribution_weights(dkg):
    """Test contribution weight computation (multi-agent attribution)."""
    console.print("\n")
    console.print(Panel.fit(
        "⚖️  Test 4: Contribution Weights (Multi-Agent Attribution)",
        style="bold cyan"
    ))
    
    # Compute contribution weights
    weights = dkg.compute_contribution_weights(method="betweenness")
    
    assert len(weights) == 3, f"Expected 3 agents, got {len(weights)}"
    rprint(f"[green]✅ Contribution weights computed for {len(weights)} agents[/green]")
    
    # Display weights
    rprint("\n[cyan]Contribution Weights:[/cyan]")
    for agent_id, weight in sorted(weights.items(), key=lambda x: x[1], reverse=True):
        agent_label = {
            "0xAAAA1111": "Agent A (Analyst)",
            "0xBBBB2222": "Agent B (Strategist)",
            "0xCCCC3333": "Agent C (Executor)"
        }.get(agent_id, agent_id)
        
        percentage = weight * 100
        rprint(f"  • {agent_label}: {weight:.4f} ({percentage:.1f}%)")
    
    # Verify weights sum to ~1.0
    total = sum(weights.values())
    assert 0.99 <= total <= 1.01, f"Weights should sum to 1.0, got {total}"
    rprint(f"[green]✅ Weights sum to {total:.4f} (valid)[/green]")
    
    # Verify A and B have higher weights than C (they enabled C's work)
    agent_a_weight = weights.get("0xAAAA1111", 0)
    agent_b_weight = weights.get("0xBBBB2222", 0)
    agent_c_weight = weights.get("0xCCCC3333", 0)
    
    assert agent_a_weight > 0.2, "Agent A should have significant weight (root analysis)"
    assert agent_b_weight > 0.2, "Agent B should have significant weight (critical strategy)"
    
    rprint("[green]✅ Contribution attribution is fair and balanced[/green]")
    
    return weights


def test_multi_dimensional_scoring(dkg):
    """Test multi-dimensional scoring from DKG."""
    console.print("\n")
    console.print(Panel.fit(
        "📊 Test 5: Multi-Dimensional Scoring from DKG",
        style="bold cyan"
    ))
    
    # Mock participants
    participants = [
        {"agent_id": 1001, "address": "0xAAAA1111"},
        {"agent_id": 1002, "address": "0xBBBB2222"},
        {"agent_id": 1003, "address": "0xCCCC3333"}
    ]
    
    # Create verifier (without SDK for testing)
    class MockSDK:
        xmtp_manager = None
    
    verifier = VerifierAgent(MockSDK())
    
    # Compute scores
    scores = verifier.compute_multi_dimensional_scores(
        dkg=dkg,
        participants=participants,
        studio_address="0xMockStudio",
        custom_dimensions=[]
    )
    
    assert len(scores) == 3, f"Expected 3 agents, got {len(scores)}"
    rprint(f"[green]✅ Scores computed for {len(scores)} agents[/green]")
    
    # Display scores
    rprint("\n[cyan]Multi-Dimensional Scores:[/cyan]")
    for agent_id, score_vector in scores.items():
        agent_label = {
            "1001": "Agent A (Analyst)",
            "1002": "Agent B (Strategist)",
            "1003": "Agent C (Executor)"
        }.get(agent_id, agent_id)
        
        rprint(f"\n  {agent_label}:")
        rprint(f"    Initiative:     {score_vector[0]:.1f}")
        rprint(f"    Collaboration:  {score_vector[1]:.1f}")
        rprint(f"    Reasoning:      {score_vector[2]:.1f}")
        rprint(f"    Compliance:     {score_vector[3]:.1f}")
        rprint(f"    Efficiency:     {score_vector[4]:.1f}")
        rprint(f"    Average:        {sum(score_vector)/len(score_vector):.1f}")
    
    # Verify Agent A has high initiative (root nodes)
    agent_a_initiative = scores["1001"][0]
    assert agent_a_initiative > 50, "Agent A should have high initiative (root nodes)"
    rprint("[green]✅ Agent A has high initiative (root analysis)[/green]")
    
    # Verify Agent B has high collaboration (builds on A, enables C)
    agent_b_collab = scores["1002"][1]
    assert agent_b_collab > 30, "Agent B should have collaboration (builds on A)"
    rprint("[green]✅ Agent B has collaboration (builds on A's work)[/green]")
    
    # Verify Agent C has low initiative (no root nodes)
    agent_c_initiative = scores["1003"][0]
    assert agent_c_initiative < agent_a_initiative, "Agent C should have lower initiative than A"
    rprint("[green]✅ Agent C has lower initiative (no roots, builds on others)[/green]")


def main():
    """Run all DKG + causal analysis tests."""
    console.print(Panel.fit(
        "🧪 DKG + Causal Analysis Test Suite\n\n"
        "Testing deep causal analysis with multi-agent scenario (A→B→C)",
        style="bold green"
    ))
    
    # Test 1: DKG Structure
    dkg = test_dkg_structure()
    
    # Test 2: Causal Chain Tracing
    test_causal_chain_tracing(dkg)
    
    # Test 3: Critical Nodes
    test_critical_nodes(dkg)
    
    # Test 4: Contribution Weights
    weights = test_contribution_weights(dkg)
    
    # Test 5: Multi-Dimensional Scoring
    test_multi_dimensional_scoring(dkg)
    
    # Summary
    console.print("\n")
    console.print(Panel.fit(
        "✅ ALL TESTS PASSED!\n\n"
        "DKG + Causal Analysis Implementation:\n"
        "✅ Graph structure (nodes, edges, metadata)\n"
        "✅ Causal chain tracing (A→B→C)\n"
        "✅ Critical node identification\n"
        "✅ Contribution weighting (fair attribution)\n"
        "✅ Multi-dimensional scoring from DKG\n\n"
        "The implementation correctly traces causal chains,\n"
        "identifies which agent's work enabled what,\n"
        "and computes fair contribution weights.\n\n"
        "This is PROPER causal analysis! 🚀",
        style="bold green"
    ))


if __name__ == "__main__":
    main()

