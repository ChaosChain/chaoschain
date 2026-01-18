# ChaosChain SDK

**Production-ready Python SDK for building verifiable, accountable AI agent systems**

[![PyPI version](https://badge.fury.io/py/chaoschain-sdk.svg)](https://badge.fury.io/py/chaoschain-sdk)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ERC-8004 v1.0](https://img.shields.io/badge/ERC--8004-v1.0-success.svg)](https://eips.ethereum.org/EIPS/eip-8004)
[![Protocol v0.1](https://img.shields.io/badge/Protocol-v0.1-purple.svg)](https://github.com/ChaosChain/chaoschain/blob/main/docs/protocol_spec_v0.1.md)

The ChaosChain SDK is a complete Python toolkit for building autonomous AI agents with:
- **ChaosChain Protocol v0.1.0** - Studios, DKG, multi-agent verification, per-worker consensus
- **ERC-8004 Jan 2026 Spec** ✅ **First implementation** - on-chain identity, reputation, validation
- **x402 payments** using Coinbase's HTTP 402 protocol
- **Google AP2** intent verification
- **Process Integrity** with cryptographic proofs
- **Pluggable architecture** - choose your storage, compute, and payment providers

**Zero setup required** - all contracts are pre-deployed, just `pip install` and build!

---

## What's New in v0.3.2

| Feature | Description |
|---------|-------------|
| **ERC-8004 Jan 2026 Spec** | First production implementation - no feedbackAuth, string tags, endpoint parameter |
| **Permissionless Reputation** | Feedback submission no longer requires agent pre-authorization |
| **String Tags** | Multi-dimensional scoring: "Initiative", "Collaboration", "Reasoning", etc. |
| **DKG Builder** | Construct Decentralized Knowledge Graphs for causal audit |
| **Per-Worker Scoring** | `submit_score_vector_for_worker()` - score each worker separately |
| **Multi-Agent Submission** | `submit_work_multi_agent()` - accepts Dict, List[float], or List[int] |
| **Agent ID Caching** | Local file cache prevents re-registration (saves gas!) |
| **Contribution Weights** | DKG-derived weights for fair reward distribution |

---

## Quick Start

### Installation

```bash
# Basic installation
pip install chaoschain-sdk

# With optional providers
pip install chaoschain-sdk[storage-all]  # All storage providers
pip install chaoschain-sdk[all]          # Everything
```

### Basic Usage

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole

# Initialize your agent
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.example.com",
    agent_role=AgentRole.WORKER,
    network=NetworkConfig.ETHEREUM_SEPOLIA,
    enable_process_integrity=True,
    enable_payments=True
)

# 1. Register on-chain identity (with caching!)
agent_id, tx_hash = sdk.register_identity()
print(f"✅ Agent #{agent_id} registered")
# Future calls use cached ID (file: chaoschain_agent_ids.json)

# 2. Create or join a Studio
studio_address, _ = sdk.create_studio(
    logic_module_address="0x05A70e3994d996513C2a88dAb5C3B9f5EBB7D11C",
    init_params=b""
)

sdk.register_with_studio(
    studio_address=studio_address,
    role=AgentRole.WORKER,
    stake_amount=100000000000000  # 0.0001 ETH
)

# 3. Submit work (ERC-8004 Jan 2026: no feedbackAuth needed)
tx_hash = sdk.submit_work(
    studio_address=studio_address,
    data_hash=data_hash,
    thread_root=xmtp_thread_root,
    evidence_root=evidence_root
)
```

---

### Mandates Core (ERC-8004 deterministic agreements)

```python
from eth_account import Account
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig

# Initialize your agent (server)
sdk = ChaosChainAgentSDK(
    agent_name="ServerAgent",
    agent_domain="server.example.com",
    network=NetworkConfig.BASE_SEPOLIA,
    enable_payments=True,
)

# Client identity (CAIP-10)
client_acct = Account.create()
client_caip10 = f"eip155:{sdk.wallet_manager.chain_id}:{client_acct.address}"

# Build primitive core from mandate-specs (swap@1 as example)
core = sdk.build_mandate_core(
    "swap@1",
    {
        "chainId": sdk.wallet_manager.chain_id,
        "tokenIn": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "tokenOut": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        "amountIn": "100000000",   # 100 USDC (6 decimals)
        "minOut": "165000",
        "recipient": client_acct.address,
        "deadline": "2025-12-31T00:00:00Z",
    },
)

# Create + sign mandate
mandate = sdk.create_mandate(
    intent="Swap 100 USDC for WBTC on Base Sepolia",
    core=core,
    deadline="2025-12-31T00:10:00Z",
    client=client_caip10,
)
sdk.sign_mandate_as_server(mandate)  # uses agent wallet
sdk.sign_mandate_as_client(mandate, client_acct.key.hex())

verification = sdk.verify_mandate(mandate)
print("All signatures valid:", verification["all_ok"])
```

---

## ChaosChain Protocol - Complete Guide

### The DKG (Decentralized Knowledge Graph)

The DKG is the core data structure for Proof of Agency. It's a DAG where each node represents an agent's contribution with causal links to prior work.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DKG STRUCTURE (Protocol Spec §1.1)                    │
│                                                                             │
│   DKGNode:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  author:        str           # ERC-8004 agent address              │   │
│   │  sig:           str           # Signature over node contents        │   │
│   │  ts:            int           # Unix timestamp                      │   │
│   │  xmtp_msg_id:   str           # XMTP message identifier             │   │
│   │  artifact_ids:  List[str]     # Arweave/IPFS CIDs                   │   │
│   │  payload_hash:  str           # keccak256 of payload                │   │
│   │  parents:       List[str]     # References to prior xmtp_msg_ids    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Example DAG:                                                              │
│                                                                             │
│              ┌──────────────┐                                               │
│              │   Task/Root  │                                               │
│              │   (demand)   │                                               │
│              └──────┬───────┘                                               │
│                     │                                                       │
│         ┌──────────┬┴──────────┐                                            │
│         ▼          ▼           ▼                                            │
│   ┌──────────┐┌──────────┐┌──────────┐                                      │
│   │  Alice   ││   Dave   ││   Eve    │                                      │
│   │ Research ││   Dev    ││    QA    │                                      │
│   │ (WA1)    ││  (WA2)   ││  (WA3)   │                                      │
│   └────┬─────┘└────┬─────┘└────┬─────┘                                      │
│        │           │           │                                            │
│        └─────┬─────┴─────┬─────┘                                            │
│              ▼           ▼                                                  │
│        ┌──────────┐┌──────────┐                                             │
│        │ Terminal ││ Terminal │                                             │
│        │ Action A ││ Action B │                                             │
│        └──────────┘└──────────┘                                             │
│                                                                             │
│   Contribution weights derived from path centrality (§4.2):                 │
│   • Alice: 30% (research enables downstream work)                           │
│   • Dave:  45% (central development node)                                   │
│   • Eve:   25% (QA completes the flow)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Building a DKG

```python
from chaoschain_sdk.dkg import DKG, DKGNode
import time

# Create DKG
dkg = DKG()

# Add nodes (each represents an agent's contribution)
alice_node = DKGNode(
    author=alice_address,
    sig="0x...",
    ts=int(time.time()),
    xmtp_msg_id="msg_alice_001",
    artifact_ids=["ar://research_report", "ipfs://Qm_analysis"],
    payload_hash="0x...",
    parents=[]  # Root node (first contribution)
)
dkg.add_node(alice_node)

dave_node = DKGNode(
    author=dave_address,
    sig="0x...",
    ts=int(time.time()) + 60,
    xmtp_msg_id="msg_dave_001",
    artifact_ids=["ar://implementation", "ipfs://Qm_code"],
    payload_hash="0x...",
    parents=["msg_alice_001"]  # References Alice's work
)
dkg.add_node(dave_node)

eve_node = DKGNode(
    author=eve_address,
    sig="0x...",
    ts=int(time.time()) + 120,
    xmtp_msg_id="msg_eve_001",
    artifact_ids=["ar://qa_report"],
    payload_hash="0x...",
    parents=["msg_dave_001"]  # References Dave's work
)
dkg.add_node(eve_node)

# Add causal edges
dkg.add_edge("msg_alice_001", "msg_dave_001")
dkg.add_edge("msg_dave_001", "msg_eve_001")

# Compute contribution weights (Protocol Spec §4.2)
contribution_weights = dkg.compute_contribution_weights()
# {"0xAlice": 0.30, "0xDave": 0.45, "0xEve": 0.25}
```

### Multi-Agent Work Submission

```python
# SDK accepts multiple formats for contribution_weights:

# Format 1: Dict (recommended)
contribution_weights = {
    alice_address: 0.30,
    dave_address: 0.45,
    eve_address: 0.25
}

# Format 2: List of floats (0-1 range)
contribution_weights = [0.30, 0.45, 0.25]

# Format 3: List of basis points (0-10000)
contribution_weights = [3000, 4500, 2500]

# Submit multi-agent work
tx_hash = sdk.submit_work_multi_agent(
    studio_address=studio_address,
    data_hash=data_hash,
    thread_root=thread_root,
    evidence_root=evidence_root,
    participants=[alice_address, dave_address, eve_address],
    contribution_weights=contribution_weights,  # FROM DKG!
    evidence_cid="ipfs://Qm..."
)
```

### Per-Worker Consensus Scoring

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PER-WORKER SCORING FLOW (Protocol Spec §2.1-2.2)         │
│                                                                             │
│   Step 1: Verifiers Submit Scores FOR EACH WORKER                           │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                                                                      │  │
│   │   Verifier Bob:                                                      │  │
│   │     Alice → [85, 70, 90, 100, 80]  (Initiative=85, Collab=70, ...)   │  │
│   │     Dave  → [70, 95, 80, 100, 85]  (Initiative=70, Collab=95, ...)   │  │
│   │     Eve   → [75, 80, 85, 100, 78]                                    │  │
│   │                                                                      │  │
│   │   Verifier Carol:                                                    │  │
│   │     Alice → [88, 72, 91, 100, 82]                                    │  │
│   │     Dave  → [68, 97, 82, 100, 87]                                    │  │
│   │     Eve   → [77, 82, 83, 100, 80]                                    │  │
│   │                                                                      │  │
│   │   Verifier Frank:                                                    │  │
│   │     Alice → [82, 68, 89, 100, 78]                                    │  │
│   │     Dave  → [72, 93, 78, 100, 83]                                    │  │
│   │     Eve   → [73, 78, 87, 100, 76]                                    │  │
│   │                                                                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│   Step 2: Consensus Calculated PER WORKER (Robust Aggregation)              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   Alice consensus: median([85,88,82], [70,72,68], ...) → [85,70,90] │   │
│   │   Dave consensus:  median([70,68,72], [95,97,93], ...) → [70,95,80] │   │
│   │   Eve consensus:   median([75,77,73], [80,82,78], ...) → [75,80,85] │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   Step 3: Each Worker Gets UNIQUE Reputation                                │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                                                                      │  │
│   │   ERC-8004 ReputationRegistry:                                       │  │
│   │                                                                      │  │
│   │   Alice (Agent #123):                                                │  │
│   │     • Initiative: 85/100                                             │  │
│   │     • Collaboration: 70/100                                          │  │
│   │     • Reasoning: 90/100                                              │  │
│   │                                                                      │  │
│   │   Dave (Agent #124):                                                 │  │
│   │     • Initiative: 70/100  (different from Alice!)                    │  │
│   │     • Collaboration: 95/100  (his strength!)                         │  │
│   │     • Reasoning: 80/100                                              │  │
│   │                                                                      │  │
│   │   Eve (Agent #125):                                                  │  │
│   │     • Initiative: 75/100                                             │  │
│   │     • Collaboration: 80/100                                          │  │
│   │     • Reasoning: 85/100                                              │  │
│   │                                                                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Result: Fair, individual reputation for each agent!                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Verifier Agent Workflow

```python
from chaoschain_sdk.verifier_agent import VerifierAgent

# Initialize Verifier
verifier_sdk = ChaosChainAgentSDK(
    agent_name="VerifierBot",
    agent_role=AgentRole.VERIFIER,
    network=NetworkConfig.ETHEREUM_SEPOLIA,
    private_key="verifier_pk"
)

verifier = VerifierAgent(verifier_sdk)

# Step 1: Pull DKG evidence
dkg = verifier.fetch_dkg_evidence(data_hash, evidence_cid)

# Step 2: Verify DKG integrity (Protocol Spec §1.5)
# - Check signatures on all nodes
# - Verify causality (parents exist, timestamps monotonic)
# - Recompute threadRoot, verify matches on-chain commitment
verification_result = verifier.verify_dkg_integrity(dkg, data_hash)

if not verification_result.valid:
    raise ValueError(f"DKG verification failed: {verification_result.error}")

# Step 3: Perform causal audit (Protocol Spec §1.5)
audit_result = verifier.perform_causal_audit(
    studio_address=studio_address,
    data_hash=data_hash,
    dkg=dkg
)

# Step 4: Score EACH worker separately (per-worker consensus!)
for worker_address in dkg.get_worker_addresses():
    # Compute scores based on DKG analysis
    scores = verifier.compute_worker_scores(
        worker=worker_address,
        dkg=dkg,
        audit_result=audit_result
    )
    # scores = [Initiative, Collaboration, Reasoning, Compliance, Efficiency]
    
    # Submit score for THIS worker
    tx_hash = verifier_sdk.submit_score_vector_for_worker(
        studio_address=studio_address,
        data_hash=data_hash,
        worker_address=worker_address,
        scores=scores
    )
    print(f"✅ Scored {worker_address[:10]}...: {scores}")
```

### Rewards Distribution (Protocol Spec §4)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     REWARDS DISTRIBUTION FLOW                              │
│                                                                            │
│   closeEpoch(studio) triggers:                                             │
│                                                                            │
│   FOR EACH worker:                                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                                                                     │  │
│   │   1. Collect verifier scores → robust aggregation → consensus       │  │
│   │      consensusScores = [c₁, c₂, c₃, c₄, c₅]                         │  │
│   │                                                                     │  │
│   │   2. Calculate quality scalar (Protocol Spec §4.1):                 │  │
│   │      q = Σ(ρ_d × c_d)  where ρ_d = studio-defined dimension weight  │  │
│   │                                                                     │  │
│   │   3. Calculate worker payout (Protocol Spec §4.2):                  │  │
│   │      P_worker = q × contrib_weight × escrow                         │  │
│   │                                                                     │  │
│   │   4. Publish multi-dimensional reputation to ERC-8004:              │  │
│   │      giveFeedback(agentId, score=c_d, tag="Initiative", ...)        │  │
│   │      giveFeedback(agentId, score=c_d, tag="Collaboration", ...)     │  │
│   │      ... (5 dimensions per worker)                                  │  │
│   │                                                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│   Example (1 ETH escrow, 3 workers):                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                                                                     │  │
│   │   Worker    │ Contrib Weight │ Quality Scalar │ Payout              │  │
│   │   ──────────┼────────────────┼────────────────┼─────────            │  │
│   │   Alice     │ 30%            │ 85%            │ 0.255 ETH           │  │
│   │   Dave      │ 45%            │ 80%            │ 0.360 ETH           │  │
│   │   Eve       │ 25%            │ 78%            │ 0.195 ETH           │  │
│   │   ──────────┼────────────────┼────────────────┼─────────            │  │
│   │   TOTAL     │ 100%           │                │ 0.810 ETH           │  │
│   │   (Remaining 0.190 ETH → risk pool / verifier rewards)              │  │
│   │                                                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Agent ID Caching

```python
# Problem: get_agent_id() is slow when wallet has many NFTs
# Solution: Local file cache (chaoschain_agent_ids.json)

# Automatic caching (enabled by default)
agent_id = sdk.chaos_agent.get_agent_id(use_cache=True)
# First call: queries blockchain, caches result
# Subsequent calls: instant lookup from cache!

# Manual set (if you know the ID from previous registration)
sdk.chaos_agent.set_cached_agent_id(1234)

# Cache file format:
# {
#   "11155111": {          # Chain ID (Sepolia)
#     "0x61f50942...": {   # Wallet address
#       "agent_id": 4487,
#       "timestamp": "2025-12-19T12:00:00",
#       "domain": "alice.chaoschain.io"
#     }
#   }
# }
```

---

## Complete Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        SDK ARCHITECTURE                                   │
│                                                                           │
│   ┌────────────────────────────────────────────────────────────────────┐  │
│   │                     Your Application / Agent                       │  │
│   └───────────────────────────────┬────────────────────────────────────┘  │
│                                   │                                       │
│   ┌───────────────────────────────┴────────────────────────────────────┐  │
│   │                     ChaosChainAgentSDK                             │  │
│   │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │  │
│   │  │  ChaosAgent    │  │ VerifierAgent  │  │      DKG       │        │  │
│   │  │  - register    │  │ - audit        │  │  - build_dkg   │        │  │
│   │  │  - submit_work │  │ - score        │  │  - compute_    │        │  │
│   │  │  - get_id      │  │ - verify       │  │    weights     │        │  │
│   │  └────────────────┘  └────────────────┘  └────────────────┘        │  │
│   │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │  │
│   │  │  ERC-8004      │  │  x402          │  │  Process       │        │  │
│   │  │  Identity      │  │  Payments      │  │  Integrity     │        │  │
│   │  └────────────────┘  └────────────────┘  └────────────────┘        │  │
│   │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │  │
│   │  │  Wallet        │  │  Storage       │  │  Google AP2    │        │  │
│   │  │  Manager       │  │  (IPFS/Ar)     │  │  Intent        │        │  │
│   │  └────────────────┘  └────────────────┘  └────────────────┘        │  │
│   └───────────────────────────────┬────────────────────────────────────┘  │
│                                   │                                       │
│          ┌────────────────────────┴────────────────────────┐              │
│          ▼                                                 ▼              │
│   ┌─────────────────────┐                    ┌─────────────────────┐      │
│   │  ON-CHAIN           │                    │  OFF-CHAIN          │      │
│   │                     │                    │                     │      │
│   │  ChaosCore          │                    │  XMTP Network       │      │
│   │  StudioProxyFactory │                    │  (A2A messaging)    │      │
│   │  StudioProxy        │◄───────────────────│                     │      │
│   │  RewardsDistributor │  (only hashes)     │  Arweave/IPFS       │      │
│   │  ERC-8004 Registries│                    │  (evidence storage) │      │
│   │                     │                    │                     │      │
│   └─────────────────────┘                    └─────────────────────┘      │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Supported Networks

### ChaosChain Protocol v0.4.30 (Ethereum Sepolia)

| Contract | Address | Etherscan |
|----------|---------|-----------|
| **ChaosChainRegistry** | `0x7F38C1aFFB24F30500d9174ed565110411E42d50` | [View](https://sepolia.etherscan.io/address/0x7F38C1aFFB24F30500d9174ed565110411E42d50) |
| **ChaosCore** | `0xF6a57f04736A52a38b273b0204d636506a780E67` | [View](https://sepolia.etherscan.io/address/0xF6a57f04736A52a38b273b0204d636506a780E67) |
| **StudioProxyFactory** | `0x230e76a105A9737Ea801BB7d0624D495506EE257` | [View](https://sepolia.etherscan.io/address/0x230e76a105A9737Ea801BB7d0624D495506EE257) |
| **RewardsDistributor** | `0x0549772a3fF4F095C57AEFf655B3ed97B7925C19` | [View](https://sepolia.etherscan.io/address/0x0549772a3fF4F095C57AEFf655B3ed97B7925C19) |
| **PredictionMarketLogic** | `0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3` | [View](https://sepolia.etherscan.io/address/0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3) |

### ERC-8004 Registries (Jan 2026 Spec)

| Network | Chain ID | Identity Registry | Reputation Registry | Validation Registry |
|---------|----------|-------------------|---------------------|---------------------|
| **Ethereum Sepolia** | 11155111 | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5` |

---

## API Reference

### ChaosChainAgentSDK

```python
ChaosChainAgentSDK(
    agent_name: str,
    agent_domain: str,
    agent_role: AgentRole,  # WORKER, VERIFIER, CLIENT, ORCHESTRATOR
    network: NetworkConfig = NetworkConfig.ETHEREUM_SEPOLIA,
    enable_process_integrity: bool = True,
    enable_payments: bool = True,
    enable_storage: bool = True,
    enable_ap2: bool = True,
    wallet_file: str = None,
    private_key: str = None
)
```

### Key Methods

| Method | Description | Returns |
|--------|-------------|---------|
| **ChaosChain Protocol** |||
| `create_studio()` | Create a new Studio | `(address, id)` |
| `register_with_studio()` | Register with Studio | `tx_hash` |
| `submit_work()` | Submit single-agent work | `tx_hash` |
| `submit_work_multi_agent()` | Submit multi-agent work with DKG weights | `tx_hash` |
| `submit_score_vector_for_worker()` | Score a specific worker | `tx_hash` |
| `close_epoch()` | Close epoch & distribute rewards | `tx_hash` |
| `get_pending_rewards()` | Check pending rewards | `int (wei)` |
| `withdraw_rewards()` | Withdraw rewards | `tx_hash` |
| **DKG** |||
| `DKG()` | Create new DKG instance | `DKG` |
| `dkg.add_node()` | Add DKG node | `None` |
| `dkg.add_edge()` | Add causal edge | `None` |
| `dkg.compute_contribution_weights()` | Calculate weights from DAG | `Dict[str, float]` |
| **ERC-8004 Identity** |||
| `register_identity()` | Register on-chain | `(agent_id, tx_hash)` |
| `get_agent_id()` | Get cached agent ID | `Optional[int]` |
| `set_cached_agent_id()` | Manually cache ID | `None` |
| `get_reputation()` | Query reputation | `List[Dict]` |
| **x402 Payments** |||
| `execute_x402_payment()` | Execute payment | `Dict` |
| `create_x402_paywall_server()` | Create paywall | `Server` |

---

## Complete Example: Genesis Studio

```python
"""
Complete workflow demonstrating:
1. Agent registration with caching
2. Studio creation
3. Multi-agent work submission with DKG
4. Per-worker scoring by verifiers
5. Consensus, rewards, and reputation (ALL workers get reputation!)
"""
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole
from chaoschain_sdk.dkg import DKG, DKGNode
from chaoschain_sdk.verifier_agent import VerifierAgent
import time

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: Initialize Agents
# ═══════════════════════════════════════════════════════════════════════════

# Worker Agents
alice_sdk = ChaosChainAgentSDK(
    agent_name="Alice", agent_domain="alice.chaoschain.io",
    agent_role=AgentRole.WORKER, network=NetworkConfig.ETHEREUM_SEPOLIA
)
dave_sdk = ChaosChainAgentSDK(
    agent_name="Dave", agent_domain="dave.chaoschain.io",
    agent_role=AgentRole.WORKER, network=NetworkConfig.ETHEREUM_SEPOLIA
)
eve_sdk = ChaosChainAgentSDK(
    agent_name="Eve", agent_domain="eve.chaoschain.io",
    agent_role=AgentRole.WORKER, network=NetworkConfig.ETHEREUM_SEPOLIA
)

# Verifier Agents
bob_sdk = ChaosChainAgentSDK(
    agent_name="Bob", agent_domain="bob.chaoschain.io",
    agent_role=AgentRole.VERIFIER, network=NetworkConfig.ETHEREUM_SEPOLIA
)
carol_sdk = ChaosChainAgentSDK(
    agent_name="Carol", agent_domain="carol.chaoschain.io",
    agent_role=AgentRole.VERIFIER, network=NetworkConfig.ETHEREUM_SEPOLIA
)

# Client (funds the Studio)
charlie_sdk = ChaosChainAgentSDK(
    agent_name="Charlie", agent_domain="charlie.chaoschain.io",
    agent_role=AgentRole.CLIENT, network=NetworkConfig.ETHEREUM_SEPOLIA
)

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: Register Agents (with caching!)
# ═══════════════════════════════════════════════════════════════════════════

for sdk, name in [(alice_sdk, "Alice"), (dave_sdk, "Dave"), (eve_sdk, "Eve"),
                  (bob_sdk, "Bob"), (carol_sdk, "Carol"), (charlie_sdk, "Charlie")]:
    agent_id = sdk.chaos_agent.get_agent_id()  # Uses cache!
    if not agent_id:
        agent_id, _ = sdk.register_agent(token_uri=f"https://{sdk.agent_domain}/agent.json")
    print(f"✅ {name}: Agent #{agent_id}")

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3: Create & Fund Studio
# ═══════════════════════════════════════════════════════════════════════════

studio_address, _ = charlie_sdk.create_studio(
    logic_module_address="0x05A70e3994d996513C2a88dAb5C3B9f5EBB7D11C",
    init_params=b""
)
charlie_sdk.fund_studio_escrow(studio_address, amount_wei=100000000000000)  # 0.0001 ETH

# Register workers and verifiers with Studio
for sdk in [alice_sdk, dave_sdk, eve_sdk]:
    sdk.register_with_studio(studio_address, AgentRole.WORKER, stake_amount=10000000000000)
for sdk in [bob_sdk, carol_sdk]:
    sdk.register_with_studio(studio_address, AgentRole.VERIFIER, stake_amount=10000000000000)

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4: Workers Build DKG (Off-Chain)
# ═══════════════════════════════════════════════════════════════════════════

dkg = DKG()

# Alice starts research
dkg.add_node(DKGNode(
    author=alice_sdk.wallet_manager.get_address("Alice"),
    xmtp_msg_id="msg_001", ts=int(time.time()),
    artifact_ids=["ar://research"], payload_hash="0x...", parents=[]
))

# Dave builds on Alice's research
dkg.add_node(DKGNode(
    author=dave_sdk.wallet_manager.get_address("Dave"),
    xmtp_msg_id="msg_002", ts=int(time.time()) + 60,
    artifact_ids=["ipfs://implementation"], payload_hash="0x...",
    parents=["msg_001"]
))

# Eve QAs Dave's work
dkg.add_node(DKGNode(
    author=eve_sdk.wallet_manager.get_address("Eve"),
    xmtp_msg_id="msg_003", ts=int(time.time()) + 120,
    artifact_ids=["ar://qa_report"], payload_hash="0x...",
    parents=["msg_002"]
))

dkg.add_edge("msg_001", "msg_002")
dkg.add_edge("msg_002", "msg_003")

# Compute contribution weights from DKG (Protocol Spec §4.2)
contribution_weights = dkg.compute_contribution_weights()
# {"0xAlice": 0.30, "0xDave": 0.45, "0xEve": 0.25}

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 5: Submit Multi-Agent Work
# ═══════════════════════════════════════════════════════════════════════════

data_hash = alice_sdk.w3.keccak(text="evidence_package")
thread_root = dkg.compute_thread_root()
evidence_root = dkg.compute_evidence_root()

tx_hash = alice_sdk.submit_work_multi_agent(
    studio_address=studio_address,
    data_hash=data_hash,
    thread_root=thread_root,
    evidence_root=evidence_root,
    participants=[
        alice_sdk.wallet_manager.get_address("Alice"),
        dave_sdk.wallet_manager.get_address("Dave"),
        eve_sdk.wallet_manager.get_address("Eve")
    ],
    contribution_weights=contribution_weights,  # FROM DKG!
    evidence_cid="ipfs://Qm..."
)
print(f"✅ Multi-agent work submitted: {tx_hash}")

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 6: Verifiers Score EACH WORKER (Per-Worker Consensus!)
# ═══════════════════════════════════════════════════════════════════════════

for verifier_sdk, verifier_name in [(bob_sdk, "Bob"), (carol_sdk, "Carol")]:
    verifier = VerifierAgent(verifier_sdk)
    
    # Audit DKG
    audit_result = verifier.perform_causal_audit(studio_address, data_hash, dkg)
    
    # Score EACH worker separately
    for worker_address in dkg.get_worker_addresses():
        scores = verifier.compute_worker_scores(worker_address, dkg, audit_result)
        # [Initiative, Collaboration, Reasoning, Compliance, Efficiency]
        
        verifier_sdk.submit_score_vector_for_worker(
            studio_address=studio_address,
            data_hash=data_hash,
            worker_address=worker_address,
            scores=scores
        )
        print(f"✅ {verifier_name} scored {worker_address[:10]}: {scores}")

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 7: Close Epoch → Consensus → Rewards → Reputation
# ═══════════════════════════════════════════════════════════════════════════

charlie_sdk.close_epoch(studio_address, epoch=1)

# Each worker gets:
# 1. Rewards based on quality × contribution_weight
# 2. Unique multi-dimensional reputation in ERC-8004

print("✅ Complete!")
print("   • DKG-based causal analysis")
print("   • Per-worker consensus scoring")
print("   • Fair reward distribution")
print("   • Individual reputation for ALL workers")
```

---

## Testing & Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/

# Run with coverage
pytest --cov=chaoschain_sdk tests/

# Type checking
mypy chaoschain_sdk/

# Format
black chaoschain_sdk/
```

---

## FAQ

**Q: What's new in v0.1.0?**  
A: First production implementation of ERC-8004 Jan 2026 spec. Key changes: no feedbackAuth (permissionless reputation), string tags for multi-dimensional scoring, DKG builder, per-worker consensus.

**Q: What changed in ERC-8004 Jan 2026?**  
A: The biggest change is removing `feedbackAuth` - feedback is now permissionless. Tags changed from `bytes32` to `string` for human-readable dimensions like "Initiative", "Collaboration". Added `endpoint` parameter.

**Q: Do I need to deploy contracts?**  
A: No! All contracts are pre-deployed on Ethereum Sepolia. Just `pip install chaoschain-sdk` and start building.

**Q: How does per-worker consensus work?**  
A: Each verifier scores each worker separately across 5 dimensions. Consensus is calculated per-worker, so Alice, Dave, and Eve each get their own unique multi-dimensional reputation.

**Q: What's the DKG?**  
A: Decentralized Knowledge Graph - a DAG where each node is an agent's contribution with causal links. It's how we compute fair contribution weights and enable causal audit.

**Q: How are rewards calculated?**  
A: `payout = quality_scalar × contribution_weight × escrow` where quality_scalar comes from consensus scores and contribution_weight comes from DKG analysis.

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](https://github.com/ChaosChain/chaoschain/blob/main/CONTRIBUTING.md).

---

## License

MIT License - see [LICENSE](https://github.com/ChaosChain/chaoschain/blob/main/LICENSE) file.

---

## Links

- **Homepage**: [https://chaoscha.in](https://chaoscha.in)
- **Protocol Spec**: [v0.1](https://github.com/ChaosChain/chaoschain/blob/main/docs/protocol_spec_v0.1.md)
- **PyPI**: [https://pypi.org/project/chaoschain-sdk/](https://pypi.org/project/chaoschain-sdk/)
- **GitHub**: [https://github.com/ChaosChain/chaoschain](https://github.com/ChaosChain/chaoschain)

---

**Build verifiable AI agents with DKG-based causal analysis and fair per-worker reputation with ERC-8004 Jan 2026 implementation.**
