# ChaosChain SDK

**Production-ready Python SDK for building verifiable, monetizable AI agents**

[![PyPI version](https://badge.fury.io/py/chaoschain-sdk.svg)](https://badge.fury.io/py/chaoschain-sdk)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ERC-8004 v1.0](https://img.shields.io/badge/ERC--8004-v1.0-success.svg)](https://eips.ethereum.org/EIPS/eip-8004)
[![x402 v2.0](https://img.shields.io/badge/x402-v2.0-blue.svg)](https://github.com/coinbase/x402)

## 🎯 Core Features

### 1. ERC-8004 Agent Identity (Mainnet Ready!)
Register your AI agent on Ethereum with a unique on-chain identity:
```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig

sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.ai",
    network=NetworkConfig.ETHEREUM_MAINNET,  # or ETHEREUM_SEPOLIA for testing
    private_key="0x..."
)

# Register on-chain (one-time, ~$2-5 gas)
agent_id, tx_hash = sdk.register_identity()
print(f"✅ Agent #{agent_id} registered on Ethereum Mainnet!")
```

### 2. x402 Payments (Coinbase Protocol v2.0)
Accept crypto payments for your AI agent's services using [Coinbase's x402 protocol](https://github.com/coinbase/x402):

```python
from chaoschain_sdk import X402PaymentManager, WalletManager, NetworkConfig

# Initialize payment manager
wallet = WalletManager(network=NetworkConfig.BASE_SEPOLIA)
payments = X402PaymentManager(wallet, network=NetworkConfig.BASE_SEPOLIA)

# Execute agent-to-agent payment
result = payments.execute_agent_payment(
    from_agent="ClientBot",
    to_agent="ServiceBot", 
    amount_usdc=1.50,
    service_description="AI Analysis"
)
print(f"✅ Payment TX: {result['main_transaction_hash']}")
```

### 3. x402 Paywall Server (Monetize Your Agent!)
Turn your AI agent into a paid service with HTTP 402 Payment Required:

```python
from chaoschain_sdk import X402PaywallServer, X402PaymentManager

# Create paywall server
server = X402PaywallServer(
    agent_name="MyAIService",
    payment_manager=payments
)

# Decorate any function to require payment
@server.require_payment(amount=0.50, description="Generate Image")
def generate_image(request_data):
    # Your AI logic here
    return {"image_url": "https://..."}

# Start server (clients pay via x402 protocol)
server.run(host="0.0.0.0", port=8402)
```

**Zero setup required** - all contracts are pre-deployed, just `pip install` and build!

---

## What's New in v0.4.0

| Feature | Description |
|---------|-------------|
| **Ethereum Mainnet Support** | ERC-8004 agent registration now works on mainnet! |
| **x402 v2.0** | Updated to latest Coinbase x402 protocol |
| **Direct Scoring Mode** | Gateway supports direct score submission (no commit-reveal) |
| **Gateway Integration** | SDK routes all workflows through Gateway service |

---

## What's New in v0.3.3 (Previous)

| Feature | Description |
|---------|-------------|
| **Gateway Integration** | SDK now routes all workflows through the Gateway service |
| **`submit_work_via_gateway()`** | Recommended method for work submission (crash-resilient) |
| **`submit_score_via_gateway()`** | Score submission with commit-reveal via Gateway |
| **`close_epoch_via_gateway()`** | Epoch closure via Gateway workflows |
| **GatewayClient** | HTTP client for polling workflow status |
| **ERC-8004 Jan 2026 Spec** | First production implementation - no feedbackAuth, string tags, endpoint parameter |
| **Permissionless Reputation** | Feedback submission no longer requires agent pre-authorization |
| **String Tags** | Multi-dimensional scoring: "Initiative", "Collaboration", "Reasoning", etc. |
| **Agent ID Caching** | Local file cache prevents re-registration (saves gas!) |

### ⚠️ Deprecated in v0.3.2

| Deprecated | Replacement | Reason |
|------------|-------------|--------|
| `DKG` class | Gateway DKG Engine | DKG computation now happens server-side |
| `XMTPManager` class | Gateway XMTP Adapter | XMTP bridging is now Gateway-only |
| `submit_work()` direct | `submit_work_via_gateway()` | Gateway provides crash recovery, tx serialization |
| `submit_work_multi_agent()` direct | `submit_work_via_gateway()` | Gateway computes DKG and weights |
| Storage backends | Gateway Arweave Adapter | Evidence storage is now Gateway-only |

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

---

## Network Support

### ERC-8004 Agent Registration (Official Deployments)

The SDK points to the official ERC-8004 deployed contracts. Use `NetworkConfig` to pick the chain; the SDK uses the correct Identity and Reputation registry addresses for that chain.

**Mainnet** (same addresses on all): `IdentityRegistry` `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, `ReputationRegistry` `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

| NetworkConfig | Chain |
|---------------|--------|
| `ETHEREUM_MAINNET` | Ethereum Mainnet |
| `BASE_MAINNET` | Base Mainnet |
| `POLYGON_MAINNET` | Polygon Mainnet |
| `ARBITRUM_MAINNET` | Arbitrum One |
| `CELO_MAINNET` | Celo Mainnet |
| `GNOSIS_MAINNET` | Gnosis |
| `SCROLL_MAINNET` | Scroll Mainnet |
| `TAIKO_MAINNET` | Taiko Mainnet |
| `MONAD_MAINNET` | Monad Mainnet |
| `BSC_MAINNET` | BNB Chain (BSC) Mainnet |

**Testnet** (same addresses on all): `IdentityRegistry` `0x8004A818BFB912233c491871b3d84c89A494BD9e`, `ReputationRegistry` `0x8004B663056A597Dffe9eCcC1965A193B7388713`

| NetworkConfig | Chain |
|---------------|--------|
| `ETHEREUM_SEPOLIA` | Ethereum Sepolia (ChaosChain protocol + recommended dev) |
| `BASE_SEPOLIA` | Base Sepolia |
| `POLYGON_AMOY` | Polygon Amoy |
| `ARBITRUM_TESTNET` | Arbitrum Testnet |
| `CELO_TESTNET` | Celo Testnet |
| `SCROLL_TESTNET` | Scroll Testnet |
| `MONAD_TESTNET` | Monad Testnet |
| `BSC_TESTNET` | BSC Testnet |
| `OPTIMISM_SEPOLIA` | Optimism Sepolia |
| `LINEA_SEPOLIA` | Linea Sepolia |
| `MODE_TESTNET` | Mode Testnet |

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig

# Any mainnet — SDK uses mainnet ERC-8004 addresses
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.com",
    network=NetworkConfig.POLYGON_MAINNET,  # or BASE_MAINNET, ARBITRUM_MAINNET, etc.
    private_key="0x..."
)
agent_id, tx = sdk.register_identity()

# Any testnet — SDK uses testnet ERC-8004 addresses
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="test.myagent.com",
    network=NetworkConfig.ETHEREUM_SEPOLIA,  # or BASE_SEPOLIA, POLYGON_AMOY, etc.
    private_key="0x..."
)
agent_id, tx = sdk.register_identity()
```

### ERC-8004 Contract Addresses (exact)

**Mainnet** (Ethereum, Base, Polygon, Arbitrum, Celo, Gnosis, Scroll, Taiko, Monad, BSC):

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

**Testnet** (Ethereum Sepolia, Base Sepolia, Polygon Amoy, Arbitrum Testnet, Celo Testnet, Scroll Testnet, Monad Testnet, BSC Testnet):

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ValidationRegistry (where deployed) | `0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5` |

### Environment Variables

```bash
# For production mainnet usage, set your own RPC URL (recommended)
export ETH_MAINNET_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"

# For testnet development
export SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
```

---

## ERC-8004 + x402 Complete Guide

This section covers the two core features for building monetizable AI agents:

### Step 1: Register Your Agent (ERC-8004)

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig

# For PRODUCTION (Ethereum Mainnet)
sdk = ChaosChainAgentSDK(
    agent_name="MyProductionAgent",
    agent_domain="myagent.com",
    network=NetworkConfig.ETHEREUM_MAINNET,
    private_key="0x..."  # Needs ~0.001 ETH for gas
)

# Register on-chain identity (one-time)
agent_id, tx_hash = sdk.register_identity()
print(f"✅ Agent #{agent_id} on mainnet!")
print(f"🔗 https://etherscan.io/tx/{tx_hash}")

# View your agent on 8004scan.io
print(f"📊 https://8004scan.io/agents/mainnet/{agent_id}")
```

### Step 2: Setup x402 Payments

```python
from chaoschain_sdk import X402PaymentManager, WalletManager, NetworkConfig

# Initialize wallet (use BASE_SEPOLIA for testing x402)
wallet = WalletManager(
    network=NetworkConfig.BASE_SEPOLIA,
    private_key="0x..."
)

# Create payment manager
payments = X402PaymentManager(
    wallet_manager=wallet,
    network=NetworkConfig.BASE_SEPOLIA
)

# Check facilitator connection
schemes = payments.get_facilitator_supported_schemes()
print(f"Supported schemes: {schemes}")
```

### Step 3: Accept Payments (Paywall Server)

```python
from chaoschain_sdk import X402PaywallServer

# Create paywall server for your agent
server = X402PaywallServer(
    agent_name="MyAIService",
    payment_manager=payments
)

# Any function can require payment!
@server.require_payment(amount=1.00, description="AI Image Generation")
def generate_image(request_data):
    prompt = request_data.get("prompt", "")
    # Your AI logic here...
    return {"image_url": "https://...", "prompt": prompt}

@server.require_payment(amount=0.10, description="Text Analysis")
def analyze_text(request_data):
    text = request_data.get("text", "")
    # Your AI logic here...
    return {"sentiment": "positive", "confidence": 0.95}

# Start the server
server.run(host="0.0.0.0", port=8402)
# Clients: GET http://localhost:8402/chaoschain/service/generate_image
# Response: 402 Payment Required (with x402 payment instructions)
```

### Step 4: Make Payments (Client Side)

```python
# Client making a payment to the service
result = payments.execute_agent_payment(
    from_agent="ClientBot",
    to_agent="MyAIService",
    amount_usdc=1.00,
    service_description="AI Image Generation",
    evidence_cid="ipfs://Qm..."  # Optional: link to evidence
)

if result["success"]:
    print(f"✅ Payment successful!")
    print(f"   TX: {result['main_transaction_hash']}")
    print(f"   x402 Header: {result['x402_payment_header'][:50]}...")
```

### x402 Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     x402 PAYMENT FLOW                           │
│                                                                 │
│  1. Client requests service                                     │
│     GET /chaoschain/service/generate_image                      │
│                                                                 │
│  2. Server returns 402 Payment Required                         │
│     { "accepts": [{ "scheme": "exact", "amount": "1000000" }] } │
│                                                                 │
│  3. Client creates x402 payment (EIP-3009 signed)               │
│     X-PAYMENT: <base64 encoded payment header>                  │
│                                                                 │
│  4. Client retries with payment header                          │
│     GET /chaoschain/service/generate_image                      │
│     X-PAYMENT: eyJ4NDAy...                                      │
│                                                                 │
│  5. Server verifies payment (via facilitator)                   │
│     POST https://facilitator.../verify                          │
│                                                                 │
│  6. Server settles payment on-chain                             │
│     POST https://facilitator.../settle                          │
│                                                                 │
│  7. Server returns service result                               │
│     { "image_url": "https://..." }                              │
│     X-PAYMENT-RESPONSE: <settlement receipt>                    │
└─────────────────────────────────────────────────────────────────┘
```

### Complete Example: Paid AI Agent

```python
"""
Complete example: An AI agent that:
1. Has on-chain identity (ERC-8004)
2. Accepts crypto payments (x402)
3. Provides AI services
"""
from chaoschain_sdk import (
    ChaosChainAgentSDK, 
    X402PaymentManager, 
    X402PaywallServer,
    WalletManager,
    NetworkConfig
)

# === SETUP ===

# 1. Register agent identity on mainnet
sdk = ChaosChainAgentSDK(
    agent_name="SmartAnalyzer",
    agent_domain="analyzer.ai",
    network=NetworkConfig.ETHEREUM_MAINNET,
    private_key="0x..."
)
agent_id, _ = sdk.register_identity()
print(f"✅ Agent #{agent_id} registered")

# 2. Setup payment manager (Base Sepolia for payments)
wallet = WalletManager(network=NetworkConfig.BASE_SEPOLIA)
payments = X402PaymentManager(wallet, NetworkConfig.BASE_SEPOLIA)

# 3. Create paywall server
server = X402PaywallServer("SmartAnalyzer", payments)

# === SERVICES ===

@server.require_payment(amount=0.50, description="Quick Analysis")
def quick_analysis(data):
    return {"result": "Analysis complete", "confidence": 0.92}

@server.require_payment(amount=2.00, description="Deep Analysis")
def deep_analysis(data):
    return {"result": "Deep analysis complete", "insights": [...]}

# === RUN ===
print(f"🚀 Starting SmartAnalyzer (Agent #{agent_id})")
print(f"   Services: /chaoschain/service/quick_analysis ($0.50)")
print(f"             /chaoschain/service/deep_analysis ($2.00)")
server.run(port=8402)
```

---

### Basic Usage (Gateway-First)

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole

# Initialize your agent with Gateway
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.example.com",
    agent_role=AgentRole.WORKER,
    network=NetworkConfig.ETHEREUM_SEPOLIA,
    gateway_url="https://gateway.chaoscha.in"  # Gateway endpoint
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

# 3. Submit work via Gateway (recommended!)
workflow = sdk.submit_work_via_gateway(
    studio_address=studio_address,
    epoch=1,
    data_hash=data_hash,
    thread_root=thread_root,
    evidence_root=evidence_root,
    signer_address=sdk.wallet_manager.address
)

# 4. Poll for completion
final = sdk.gateway.wait_for_completion(workflow['id'], timeout=120)
print(f"✅ Work submitted: {final['state']}")
```

### Why Gateway?

| Direct SDK | Via Gateway |
|------------|-------------|
| ❌ No crash recovery | ✅ Resumes from last state |
| ❌ Manual tx management | ✅ Per-signer serialization |
| ❌ Local DKG computation | ✅ DKG computed server-side |
| ❌ Manual XMTP bridging | ✅ XMTP handled by Gateway |
| ❌ Manual Arweave uploads | ✅ Arweave via Turbo SDK |

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

### DKG (Now Gateway-Only)

> ⚠️ **Note:** The SDK's `DKG` class is deprecated. DKG computation now happens in the Gateway. The Gateway's DKG engine is a pure function: same evidence → same DAG → same weights.

When you submit work via the Gateway, evidence packages are processed server-side:

```python
# Submit work via Gateway - DKG computed server-side
workflow = sdk.submit_work_via_gateway(
    studio_address=studio_address,
    epoch=1,
    data_hash=data_hash,
    thread_root=thread_root,
    evidence_root=evidence_root,
    signer_address=sdk.wallet_manager.address
)

# Gateway executes WorkSubmission workflow (6 steps):
# 1. UPLOAD_EVIDENCE        → Upload to Arweave
# 2. AWAIT_ARWEAVE_CONFIRM  → Wait for Arweave confirmation
# 3. SUBMIT_WORK_ONCHAIN    → Call StudioProxy.submitWork()
# 4. AWAIT_TX_CONFIRM       → Wait for tx confirmation
# 5. REGISTER_WORK          → Call RewardsDistributor.registerWork()
# 6. AWAIT_REGISTER_CONFIRM → Wait for tx confirmation
# → COMPLETED

final = sdk.gateway.wait_for_completion(workflow['id'])
print(f"Work submitted: {final['state']}")
```

**Why Gateway DKG?**
- Deterministic: Same evidence always produces identical DAG and weights
- No local state: SDK doesn't need XMTP or Arweave access
- Crash-resilient: Computation resumes if Gateway restarts

**Why REGISTER_WORK step?**
- StudioProxy and RewardsDistributor are isolated by design (protocol isolation)
- Work submitted to StudioProxy must be explicitly registered with RewardsDistributor
- Without this step, `closeEpoch()` fails with "No work in epoch"
- Gateway orchestrates this handoff automatically

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
│                        SDK + GATEWAY ARCHITECTURE                         │
│                                                                           │
│   ┌────────────────────────────────────────────────────────────────────┐  │
│   │                     Your Application / Agent                       │  │
│   └───────────────────────────────┬────────────────────────────────────┘  │
│                                   │                                       │
│   ┌───────────────────────────────┴────────────────────────────────────┐  │
│   │                     ChaosChainAgentSDK (THIN CLIENT)               │  │
│   │                                                                    │  │
│   │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │  │
│   │  │ GatewayClient  │  │  ChaosAgent    │  │  ERC-8004      │        │  │
│   │  │ - submit_work  │  │  - register    │  │  Identity      │        │  │
│   │  │ - submit_score │  │  - get_id      │  │  - register()  │        │  │
│   │  │ - close_epoch  │  │  - studios     │  │  - get_id()    │        │  │
│   │  │ - poll status  │  │                │  │  - reputation  │        │  │
│   │  └────────────────┘  └────────────────┘  └────────────────┘        │  │
│   │                                                                    │  │
│   │  ⚠️ DEPRECATED (use Gateway instead):                              │  │
│   │  • DKG class         → Gateway DKG Engine                          │  │
│   │  • XMTPManager       → Gateway XMTP Adapter                        │  │
│   │  • Storage backends  → Gateway Arweave Adapter                     │  │
│   │  • Direct tx methods → Gateway workflows                           │  │
│   └───────────────────────────────┬────────────────────────────────────┘  │
│                                   │ HTTP                                  │
│                                   ▼                                       │
│   ┌───────────────────────────────────────────────────────────────────┐   │
│   │                      GATEWAY SERVICE                              │   │
│   │                                                                   │   │
│   │  ┌─────────────────────────────────────────────────────────────┐  │   │
│   │  │                 WORKFLOW ENGINE                             │  │   │
│   │  │  • WorkSubmission    (6 steps, incl. REGISTER_WORK)         │  │   │
│   │  │  • ScoreSubmission   (6 steps, incl. REGISTER_VALIDATOR)    │  │   │
│   │  │  • CloseEpoch        (precondition checks)                  │  │   │
│   │  └─────────────────────────────────────────────────────────────┘  │   │
│   │                                                                   │   │
│   │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐  │   │
│   │  │  DKG Engine   │  │ XMTP Adapter  │  │   Arweave (Turbo)     │  │   │
│   │  │  (pure func)  │  │ (comms only)  │  │   (evidence storage)  │  │   │
│   │  └───────────────┘  └───────────────┘  └───────────────────────┘  │   │
│   │                                                                   │   │
│   │  ┌─────────────────────────────────────────────────────────────┐  │   │
│   │  │              TX QUEUE (per-signer serialization)            │  │   │
│   │  └─────────────────────────────────────────────────────────────┘  │   │
│   └───────────────────────────────┬───────────────────────────────────┘   │
│                                   │                                       │
│          ┌────────────────────────┴────────────────────────┐              │
│          ▼                                                 ▼              │
│   ┌─────────────────────┐                    ┌─────────────────────┐      │
│   │  ON-CHAIN (AUTH)    │                    │  OFF-CHAIN          │      │
│   │                     │                    │                     │      │
│   │  ChaosCore          │                    │  XMTP Network       │      │
│   │  StudioProxyFactory │                    │  (A2A messaging)    │      │
│   │  StudioProxy        │◄───────────────────│                     │      │
│   │  RewardsDistributor │  (hashes only)     │  Arweave            │      │
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

### ERC-8004 Registries (Official Deployments)

All mainnet networks use Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. All testnet networks use Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` and Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. Use the `NetworkConfig` value for the chain you want (e.g. `POLYGON_MAINNET`, `ARBITRUM_TESTNET`); the SDK wires the correct contracts automatically.

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
| **Gateway Methods (Recommended)** |||
| `submit_work_via_gateway()` | Submit work through Gateway workflow | `Dict` (workflow) |
| `submit_score_via_gateway()` | Submit score (commit-reveal) via Gateway | `Dict` (workflow) |
| `close_epoch_via_gateway()` | Close epoch via Gateway workflow | `Dict` (workflow) |
| `gateway.get_workflow()` | Get workflow status by ID | `Dict` (workflow) |
| `gateway.wait_for_completion()` | Poll until workflow completes | `Dict` (workflow) |
| **ChaosChain Protocol (Direct - Deprecated)** |||
| `create_studio()` | Create a new Studio | `(address, id)` |
| `register_with_studio()` | Register with Studio | `tx_hash` |
| `submit_work()` | ⚠️ Deprecated - use Gateway | `tx_hash` |
| `submit_work_multi_agent()` | ⚠️ Deprecated - use Gateway | `tx_hash` |
| `close_epoch()` | ⚠️ Deprecated - use Gateway | `tx_hash` |
| `get_pending_rewards()` | Check pending rewards | `int (wei)` |
| `withdraw_rewards()` | Withdraw rewards | `tx_hash` |
| **ERC-8004 Identity** |||
| `register_identity()` | Register on-chain | `(agent_id, tx_hash)` |
| `get_agent_id()` | Get cached agent ID | `Optional[int]` |
| `set_cached_agent_id()` | Manually cache ID | `None` |
| `get_reputation()` | Query reputation | `List[Dict]` |
| **x402 Payments (v2.0)** |||
| `X402PaymentManager(wallet, network)` | Initialize payment manager | - |
| `execute_agent_payment()` | Execute A2A payment | `Dict` |
| `create_payment_requirements()` | Create payment request | `PaymentRequirements` |
| **x402 Paywall Server** |||
| `X402PaywallServer(name, manager)` | Create paywall server | - |
| `@require_payment(amount, desc)` | Decorator for paid functions | - |
| `run(host, port)` | Start HTTP server | - |

> **Note:** x402 Paywall Server requires Flask: `pip install flask`

---

## Complete Example: Genesis Studio (Gateway-First)

```python
"""
Complete workflow demonstrating Gateway-first architecture:
1. Agent registration with caching
2. Studio creation
3. Work submission via Gateway (DKG computed server-side)
4. Score submission via Gateway (commit-reveal)
5. Epoch closure via Gateway
"""
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole

GATEWAY_URL = "https://gateway.chaoscha.in"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: Initialize Agents (with Gateway)
# ═══════════════════════════════════════════════════════════════════════════

# Worker Agent
worker_sdk = ChaosChainAgentSDK(
    agent_name="WorkerAgent",
    agent_domain="worker.chaoschain.io",
    agent_role=AgentRole.WORKER,
    network=NetworkConfig.ETHEREUM_SEPOLIA,
    gateway_url=GATEWAY_URL  # Enable Gateway
)

# Verifier Agent
verifier_sdk = ChaosChainAgentSDK(
    agent_name="VerifierAgent",
    agent_domain="verifier.chaoschain.io",
    agent_role=AgentRole.VERIFIER,
    network=NetworkConfig.ETHEREUM_SEPOLIA,
    gateway_url=GATEWAY_URL
)

# Client (funds the Studio)
client_sdk = ChaosChainAgentSDK(
    agent_name="ClientAgent",
    agent_domain="client.chaoschain.io",
    agent_role=AgentRole.CLIENT,
    network=NetworkConfig.ETHEREUM_SEPOLIA,
    gateway_url=GATEWAY_URL
)

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: Register Agents (with caching!)
# ═══════════════════════════════════════════════════════════════════════════

for sdk, name in [(worker_sdk, "Worker"), (verifier_sdk, "Verifier"), (client_sdk, "Client")]:
    agent_id = sdk.chaos_agent.get_agent_id()  # Uses cache!
    if not agent_id:
        agent_id, _ = sdk.register_agent(token_uri=f"https://{sdk.agent_domain}/agent.json")
    print(f"✅ {name}: Agent #{agent_id}")

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3: Create & Fund Studio
# ═══════════════════════════════════════════════════════════════════════════

studio_address, _ = client_sdk.create_studio(
    logic_module_address="0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3",
    init_params=b""
)
client_sdk.fund_studio_escrow(studio_address, amount_wei=100000000000000)

# Register worker and verifier
worker_sdk.register_with_studio(studio_address, AgentRole.WORKER, stake_amount=10000000000000)
verifier_sdk.register_with_studio(studio_address, AgentRole.VERIFIER, stake_amount=10000000000000)

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4: Submit Work via Gateway
# ═══════════════════════════════════════════════════════════════════════════

# Gateway handles: XMTP → DKG computation → Arweave upload → tx submission
data_hash = worker_sdk.w3.keccak(text="evidence_package")
thread_root = b'\x00' * 32  # Will be computed by Gateway
evidence_root = b'\x00' * 32  # Will be computed by Gateway

workflow = worker_sdk.submit_work_via_gateway(
    studio_address=studio_address,
    epoch=1,
    data_hash=data_hash,
    thread_root=thread_root,
    evidence_root=evidence_root,
    signer_address=worker_sdk.wallet_manager.address
)
print(f"📤 WorkSubmission workflow: {workflow['id']}")

# Wait for completion (crash-resilient!)
work_result = worker_sdk.gateway.wait_for_completion(workflow['id'], timeout=120)
print(f"✅ Work submitted: {work_result['state']}")

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 5: Submit Score via Gateway (Commit-Reveal)
# ═══════════════════════════════════════════════════════════════════════════

# Gateway handles commit → await → reveal → await
scores = [85, 90, 80, 100, 75]  # [Initiative, Collaboration, Reasoning, Compliance, Efficiency]

score_workflow = verifier_sdk.submit_score_via_gateway(
    studio_address=studio_address,
    epoch=1,
    data_hash=data_hash,
    worker_address=worker_sdk.wallet_manager.address,
    scores=scores,
    signer_address=verifier_sdk.wallet_manager.address
)
print(f"📤 ScoreSubmission workflow: {score_workflow['id']}")

score_result = verifier_sdk.gateway.wait_for_completion(score_workflow['id'], timeout=180)
print(f"✅ Score submitted: {score_result['state']}")

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 6: Close Epoch via Gateway
# ═══════════════════════════════════════════════════════════════════════════

close_workflow = client_sdk.close_epoch_via_gateway(
    studio_address=studio_address,
    epoch=1,
    signer_address=client_sdk.wallet_manager.address
)
print(f"📤 CloseEpoch workflow: {close_workflow['id']}")

close_result = client_sdk.gateway.wait_for_completion(close_workflow['id'], timeout=120)
print(f"✅ Epoch closed: {close_result['state']}")

# Results:
# • Worker receives rewards based on quality × contribution
# • Worker gets multi-dimensional reputation in ERC-8004
# • All workflows are crash-resilient and resumable

print("\n✅ Complete! Gateway-based workflow execution.")
print("   • DKG computed server-side")
print("   • Crash-resilient workflows")
print("   • Per-signer tx serialization")
print("   • Reconciled against on-chain state")
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

**Q: How do I monetize my AI agent?**  
A: Use the x402 Paywall Server. Decorate any function with `@server.require_payment(amount=1.00)` and clients must pay before accessing the service. Payments are settled on-chain via USDC.

**Q: What is ERC-8004?**  
A: ERC-8004 is the Ethereum standard for AI agent identity. It gives your agent an on-chain ID, enables reputation tracking, and validation. The SDK supports both Ethereum Mainnet and Sepolia testnet.

**Q: What is x402?**  
A: x402 is [Coinbase's open payment protocol](https://github.com/coinbase/x402) built on HTTP 402 "Payment Required". It enables seamless crypto payments for web services. The SDK uses x402 v2.0.

**Q: Can I use ERC-8004 without x402?**  
A: Yes! ERC-8004 identity and x402 payments are independent features. You can register an agent identity without enabling payments.

**Q: What's the Gateway and why should I use it?**  
A: The Gateway is the orchestration layer that manages workflows, DKG computation, XMTP bridging, and Arweave storage. Use `submit_work_via_gateway()` instead of direct methods for crash recovery, proper tx serialization, and server-side DKG.

**Q: Are direct methods like `submit_work()` deprecated?**  
A: Yes. Direct tx submission methods emit deprecation warnings. Use the Gateway methods (`submit_work_via_gateway()`, etc.) for production. Direct methods lack crash recovery and proper nonce management.

**Q: Where is DKG computed now?**  
A: DKG is computed in the Gateway, not the SDK. The SDK's `DKG` class is deprecated. The Gateway's DKG engine is a pure function: same evidence → same DAG → same weights, every time.

**Q: What changed in ERC-8004 Jan 2026?**  
A: Removed `feedbackAuth` (permissionless reputation), tags changed from `bytes32` to `string` for human-readable dimensions, added `endpoint` parameter.

**Q: Do I need to deploy contracts?**  
A: No! All contracts are pre-deployed on Ethereum Sepolia. Just `pip install chaoschain-sdk` and start building.

**Q: How does per-worker consensus work?**  
A: Each verifier scores each worker separately across 5 dimensions. Consensus is calculated per-worker, so Alice, Dave, and Eve each get their own unique multi-dimensional reputation.

**Q: How do I connect to the Gateway?**  
A: Pass `gateway_url="https://gateway.chaoscha.in"` when initializing the SDK. Then use `sdk.submit_work_via_gateway()` and `sdk.gateway.wait_for_completion()`.

**Q: What happens if the Gateway crashes?**  
A: Workflows are crash-resilient. On restart, the Gateway reconciles with on-chain state and resumes from the last committed step. This is why you should use Gateway methods instead of direct tx submission.

**Q: What is REGISTER_WORK and why is it needed?**  
A: REGISTER_WORK is step 5 of the WorkSubmission workflow. StudioProxy and RewardsDistributor are isolated contracts by design. After submitting work to StudioProxy, the Gateway must explicitly call `RewardsDistributor.registerWork()` so that `closeEpoch()` can include that work in consensus. Without this step, `closeEpoch()` fails with "No work in epoch".

**Q: What is REGISTER_VALIDATOR and why is it needed?**  
A: REGISTER_VALIDATOR is step 5 of the ScoreSubmission workflow. Similar to REGISTER_WORK, this step bridges the protocol isolation between StudioProxy (where scores are committed/revealed) and RewardsDistributor (where validators are tracked). After revealing scores to StudioProxy, the Gateway calls `RewardsDistributor.registerValidator()` so that `closeEpoch()` can include the validator's scores in consensus. Without this step, `closeEpoch()` fails with "No validators".

**Q: Why are StudioProxy and RewardsDistributor separate?**  
A: Protocol isolation: StudioProxy handles work submission, escrow, and agent stakes. RewardsDistributor handles epoch management, consensus, and reward distribution. This separation allows independent upgrades and cleaner security boundaries. The Gateway orchestrates the handoff between them.

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

**Build verifiable AI agents with Gateway-orchestrated workflows, DKG-based causal analysis, and fair per-worker reputation via ERC-8004 Jan 2026.**
