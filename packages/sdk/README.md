# ChaosChain SDK

**Production-ready SDK for building verifiable, monetizable AI agents with on-chain identity**

[![PyPI version](https://badge.fury.io/py/chaoschain-sdk.svg)](https://badge.fury.io/py/chaoschain-sdk)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ERC-8004 v1.0](https://img.shields.io/badge/ERC--8004-v1.0-success.svg)](https://eips.ethereum.org/EIPS/eip-8004)

The ChaosChain SDK is a complete toolkit for building autonomous AI agents with:
- **ERC-8004 v1.0** ✅ **100% compliant** - on-chain identity, validation and reputation (pre-deployed on 5 networks)
- **x402 payments** using Coinbase's HTTP 402 protocol  
- **Google AP2** intent verification
- **Process Integrity** with cryptographic proofs
- **Pluggable architecture** - choose your compute, storage, and payment providers

**Zero setup required** - all ERC-8004 v1.0 contracts are pre-deployed, just `pip install` and build!

## Quick Start

### Installation

#### Basic Installation
```bash
# Minimal core (ERC-8004 v1.0 + x402 + Local IPFS)
pip install chaoschain-sdk
```

#### With Optional Providers

**Storage Providers:**
```bash
pip install chaoschain-sdk[0g-storage]  # 0G Storage (decentralized)
pip install chaoschain-sdk[pinata]      # Pinata (cloud IPFS)
pip install chaoschain-sdk[irys]        # Irys (Arweave permanent storage)
pip install chaoschain-sdk[storage-all] # All storage providers
```

**Compute Providers:**
```bash
pip install chaoschain-sdk[0g-compute]  # 0G Compute (TEE-verified AI)
pip install chaoschain-sdk[compute-all] # All compute providers
```

**Full Stacks:**
```bash
pip install chaoschain-sdk[0g]          # 0G Full Stack (Storage + Compute)
pip install chaoschain-sdk[all]         # Everything (all providers)
```

**Development:**
```bash
pip install chaoschain-sdk[dev]         # With dev tools (pytest, black, mypy)
```

**Google AP2 (requires manual install):**
```bash
pip install git+https://github.com/google-agentic-commerce/AP2.git@main
```

### Basic Usage

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole

# Initialize your agent
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.example.com", 
    agent_role=AgentRole.SERVER,
    network=NetworkConfig.BASE_SEPOLIA,  # or BASE_SEPOLIA, OPTIMISM_SEPOLIA, etc.
    enable_ap2=True,          # Google AP2 intent verification
    enable_process_integrity=True,  # Cryptographic execution proofs
    enable_payments=True      # x402 crypto payments
)

# 1. Register on-chain identity (ERC-8004)
agent_id, tx_hash = sdk.register_identity()
print(f"✅ Agent #{agent_id} registered on-chain")

# 2. Create AP2 intent mandate (user authorization)
intent_result = sdk.create_intent_mandate(
    user_description="Find me AI analysis under $10",
    merchants=["TrustedAI", "AIServices"],
    expiry_minutes=60
)

# 3. Execute work with process integrity
@sdk.process_integrity.register_function
async def analyze_data(data: dict) -> dict:
    # Your agent's work logic
    return {"result": f"Analyzed {data}", "confidence": 0.95}

result, proof = await sdk.execute_with_integrity_proof(
    "analyze_data", 
    {"data": "market_trends"}
)

# 4. Execute x402 payment
payment = sdk.execute_x402_payment(
    to_agent="ServiceProvider",
    amount=5.0,  # USDC
    service_type="analysis"
)

# 5. Store evidence
evidence_cid = sdk.store_evidence({
    "intent": intent_result.intent_mandate,
    "analysis": result,
    "proof": proof,
    "payment": payment
})

print(f"🎉 Complete verifiable workflow with on-chain identity!")
```

## Core Features

### **ERC-8004 v1.0 On-Chain Identity** ✅ **100% Compliant** (Pre-Deployed)

The SDK implements the full [ERC-8004 v1.0 standard](https://eips.ethereum.org/EIPS/eip-8004) with contracts pre-deployed on 5 networks. **All 12 compliance tests pass.**

**Agents are ERC-721 NFTs!** - In v1.0, every agent is an NFT, making them:
- ✅ **Instantly browsable** on OpenSea, Rarible, and all NFT marketplaces
- ✅ **Transferable** like any ERC-721 token
- ✅ **Compatible** with MetaMask, Rainbow, and all NFT wallets
- ✅ **Discoverable** through standard NFT indexers

```python
# Register agent identity
agent_id, tx = sdk.register_identity()

# Update agent metadata (per ERC-8004 spec)
sdk.update_agent_metadata({
    "name": "MyAgent",
    "description": "AI analysis service with verifiable integrity",
    "image": "https://example.com/agent.png",
    "capabilities": ["market_analysis", "sentiment"],
    "contact": "agent@example.com",
    # ERC-8004: Advertise supported trust models
    "supportedTrust": [
        "reputation",        # Uses Reputation Registry
        "tee-attestation",   # Uses Process Integrity (0G Compute TEE)
        "validation"         # Uses Validation Registry
    ]
})

# Submit reputation feedback (with x402 payment proof per ERC-8004)
payment = sdk.execute_x402_payment(to_agent="Provider", amount=10.0)
sdk.submit_feedback(
    agent_id=other_agent_id,
    score=95,
    feedback_uri="ipfs://Qm...",  # Full feedback details
    feedback_data={
        "score": 95,
        "context": "smart_shopping_task",
        # ERC-8004: Link payment proof to reputation
        "proof_of_payment": {
            "fromAddress": payment.from_agent,
            "toAddress": payment.to_agent,
            "chainId": payment.chain_id,
            "txHash": payment.transaction_hash
        }
    }
)

# Request validation (link Process Integrity to Validation Registry)
result, proof = await sdk.execute_with_integrity_proof("analyze", {...})
sdk.request_validation(
    validator_agent_id=validator_id,
    request_uri=f"ipfs://{proof.ipfs_cid}",  # Points to integrity proof
    request_hash=proof.execution_hash
)
```

**Pre-deployed ERC-8004 v1.0 contracts** (no deployment needed):
- ✅ `IdentityRegistry.sol` - Agent registration and discovery (ERC-721 based)
- ✅ `ReputationRegistry.sol` - Feedback and reputation scores (signature-based)
- ✅ `ValidationRegistry.sol` - Peer validation and consensus (URI-based)

**Deployed addresses** (per network):
- **Ethereum Sepolia**: 
  - Identity: `0x8004a6090Cd10A7288092483047B097295Fb8847`
  - Reputation: `0x8004B8FD1A363aa02fDC07635C0c5F94f6Af5B7E`
  - Validation: `0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5`
- **Base Sepolia**: 
  - Identity: `0x8004AA63c570c570eBF15376c0dB199918BFe9Fb`
  - Reputation: `0x8004bd8daB57f14Ed299135749a5CB5c42d341BF`
  - Validation: `0x8004C269D0A5647E51E121FeB226200ECE932d55`
- **Linea Sepolia**: 
  - Identity: `0x8004aa7C931bCE1233973a0C6A667f73F66282e7`
  - Reputation: `0x8004bd8483b99310df121c46ED8858616b2Bba02`
  - Validation: `0x8004c44d1EFdd699B2A26e781eF7F77c56A9a4EB`

### **x402 Crypto Payments** (Coinbase Official)

Native integration with [Coinbase's x402 HTTP 402 protocol](https://www.x402.org/):

```python
# Execute agent-to-agent payment
payment_result = sdk.execute_x402_payment(
    to_agent="ProviderAgent",
    amount=10.0,  # USDC
    service_type="ai_analysis"
)

# Create payment requirements (for receiving payments)
requirements = sdk.create_x402_payment_requirements(
    amount=5.0,
    service_description="Premium AI Analysis"
)

# Create x402 paywall server
server = sdk.create_x402_paywall_server(port=8402)

@server.require_payment(amount=2.0, description="API Access")
def protected_endpoint(data):
    return {"result": f"Processed {data}"}

# server.run()  # Start HTTP 402 server
```

**Features**:
- ✅ Direct USDC transfers (Base, Ethereum, Optimism)
- ✅ Automatic 2.5% protocol fee to ChaosChain treasury
- ✅ Cryptographic payment receipts
- ✅ Paywall server support
- ✅ Payment history and analytics

### **Google AP2 Intent Verification**

Integrate [Google's Agentic Protocol (AP2)](https://github.com/google-agentic-commerce/AP2) for user authorization:

```python
# Create intent mandate (user's general authorization)
intent_result = sdk.create_intent_mandate(
    user_description="Buy me quality analysis services under $50",
    merchants=["TrustedAI", "VerifiedAnalytics"],
    expiry_minutes=120
)

# Create cart mandate with JWT (specific purchase authorization)
cart_result = sdk.create_cart_mandate(
    cart_id="cart_123",
    items=[
        {"name": "Market Analysis", "price": 10.0},
        {"name": "Sentiment Report", "price": 5.0}
    ],
    total_amount=15.0,
    currency="USD"
)

# Verify JWT signature
if cart_result.success:
    print(f"✅ Cart authorized with JWT: {cart_result.jwt[:50]}...")
```

**Benefits**:
- ✅ Cryptographic user authorization (RSA signatures)
- ✅ Intent-based commerce (users pre-authorize categories)
- ✅ W3C Payment Request API compatible
- ✅ JWT-based cart mandates

### **Process Integrity Verification**

Cryptographic proof that your code executed correctly:

```python
# Register functions for integrity checking
@sdk.process_integrity.register_function
async def analyze_sentiment(text: str, model: str) -> dict:
    # Your analysis logic
    result = perform_analysis(text, model)
    return {
        "sentiment": result.sentiment,
        "confidence": result.confidence,
        "timestamp": datetime.now().isoformat()
    }

# Execute with proof generation
result, proof = await sdk.execute_with_integrity_proof(
    "analyze_sentiment",
    {"text": "Market looks bullish", "model": "gpt-4"}
)

# Proof contains:
print(f"Function: {proof.function_name}")
print(f"Code Hash: {proof.code_hash}")
print(f"Execution Hash: {proof.execution_hash}")
print(f"Timestamp: {proof.timestamp}")
print(f"Storage CID: {proof.ipfs_cid}")
```

**Features**:
- ✅ Cryptographic code hashing
- ✅ Execution verification
- ✅ Immutable evidence storage
- ✅ Tamper-proof audit trail

### **Pluggable Architecture**

Choose your infrastructure - no vendor lock-in:

#### **Storage Providers**

```python
from chaoschain_sdk.providers.storage import LocalIPFSStorage, PinataStorage, IrysStorage

# Local IPFS (always available, no setup)
storage = LocalIPFSStorage()

# Or choose specific provider
from chaoschain_sdk.providers.storage import PinataStorage
storage = PinataStorage(jwt_token="your_jwt", gateway_url="https://gateway.pinata.cloud")

from chaoschain_sdk.providers.storage import IrysStorage  
storage = IrysStorage(wallet_key="your_key")

from chaoschain_sdk.providers.storage import ZeroGStorage  # Requires 0G CLI
storage = ZeroGStorage(private_key="your_key")

# Unified API regardless of provider
result = storage.put(b"data", mime="application/json")
data = storage.get(result.cid)
```

**Storage Options**:

| Provider | Cost | Setup | Best For |
|----------|------|-------|----------|
| **Local IPFS** | 🆓 Free | `ipfs daemon` | Development, full control |
| **Pinata** | 💰 Paid | Set env vars | Production, reliability |
| **Irys** | 💰 Paid | Wallet key | Permanent storage (Arweave) |
| **0G Storage** | 💰 Gas | Start sidecar | Decentralized, verifiable |

#### **Compute Providers**

```python
# Built-in: Local execution with integrity proofs
result, proof = await sdk.execute_with_integrity_proof("func_name", args)

# Optional: 0G Compute (TEE-verified AI - requires Node.js SDK)
from chaoschain_sdk.providers.compute import ZeroGInference

compute = ZeroGInference(
    private_key="your_key",
    evm_rpc="https://evmrpc-testnet.0g.ai"
)
result = compute.execute_llm_inference(
    service_name="gpt",
    content="Your prompt here"
)
```

#### **Payment Methods**

```python
# x402 (PRIMARY) - Real crypto payments
payment = sdk.execute_x402_payment(to_agent="Provider", amount=10.0)

# Traditional methods (with API keys)
payment = sdk.execute_traditional_payment(
    payment_method="basic-card",  # Stripe
    # OR "https://google.com/pay"  # Google Pay
    # OR "https://apple.com/apple-pay"  # Apple Pay
    # OR "https://paypal.com"  # PayPal
    amount=25.99,
    currency="USD"
)
```

## Architecture

### **Triple-Verified Stack**

```
╔════════════════════════════════════════════════════════╗
║          ChaosChain Triple-Verified Stack              ║
╠════════════════════════════════════════════════════════╣
║  Layer 3: x402 Crypto Settlement  →  Payment verified ║
║  Layer 2: Process Integrity       →  Code verified    ║
║  Layer 1: Google AP2 Intent       →  User authorized  ║
╚════════════════════════════════════════════════════════╝
```

### **SDK Architecture**

```
┌─────────────────────────────────────────────────────┐
│          Your Application / Agent                    │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────┐
│          ChaosChain SDK (Python)                     │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │  ERC-8004    │  │  x402      │  │  Google AP2 │ │
│  │  Identity    │  │  Payments  │  │  Intent     │ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │  Process     │  │  Pluggable │  │  Pluggable  │ │
│  │  Integrity   │  │  Storage   │  │  Compute    │ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────┐
│     Your Choice of Infrastructure                    │
│  • Storage: IPFS / Pinata / Irys / 0G               │
│  • Compute: Local / 0G / Your provider              │
│  • Network: Base / Ethereum / Optimism / 0G         │
└─────────────────────────────────────────────────────┘
```

## Supported Networks

ERC-8004 v1.0 contracts are **pre-deployed on 6 testnets** (no setup needed):

| Network | Chain ID | Status | Contracts | Features |
|---------|----------|--------|-----------|----------|
| **Ethereum Sepolia** | 11155111 | ✅ Active | Identity, Reputation, Validation | ERC-8004 v1.0 + x402 USDC |
| **Base Sepolia** | 84532 | ✅ Active | Identity, Reputation, Validation | ERC-8004 v1.0 + x402 USDC |
| **Linea Sepolia** | 59141 | ✅ Active | Identity, Reputation, Validation | ERC-8004 v1.0 |
| **Hedera Testnet** | 296 | ✅ Active | Identity, Reputation, Validation | ERC-8004 v1.0 |
| **0G Testnet** | 16602 | ✅ Active | Identity, Reputation, Validation | ERC-8004 v1.0 + A0GI + Compute + Storage |
| **Optimism Sepolia** | 11155420 | ⏳ Coming Soon | - | ERC-8004 v1.0 deployment pending |

**Contract addresses vary by network** (see SDK documentation for specific addresses). Simply change the `network` parameter - no other config needed!

## Advanced Examples

### Complete Agent Workflow with ERC-8004 Integration

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole
import asyncio

# Initialize
sdk = ChaosChainAgentSDK(
    agent_name="AnalysisAgent",
    agent_domain="analysis.example.com",
    agent_role=AgentRole.SERVER,
    network=NetworkConfig.BASE_SEPOLIA,
    enable_ap2=True,
    enable_process_integrity=True,
    enable_payments=True
)

# 1. Register on-chain identity (ERC-8004 Identity Registry)
agent_id, tx = sdk.register_identity()
print(f"✅ On-chain ID: {agent_id}")

# 2. Set metadata with supported trust models (ERC-8004)
sdk.update_agent_metadata({
    "name": "AnalysisAgent",
    "description": "Verifiable AI market analysis",
    "image": "https://example.com/agent.png",
    "supportedTrust": ["reputation", "tee-attestation", "validation"]
})

# 3. Create AP2 intent (user authorization)
intent = sdk.create_intent_mandate(
    user_description="Get market analysis under $20",
    merchants=["AnalysisAgent"],
    expiry_minutes=60
)

# 4. Execute work with TEE-verified integrity (Process Integrity)
@sdk.process_integrity.register_function
async def market_analysis(symbols: list) -> dict:
    return {
        "symbols": symbols,
        "trend": "bullish",
        "confidence": 0.87
    }

result, proof = await sdk.execute_with_integrity_proof(
    "market_analysis",
    {"symbols": ["BTC", "ETH"]}
)

# 5. Store evidence (integrity proof + results)
evidence_cid = sdk.store_evidence({
    "intent": intent.intent_mandate.model_dump() if intent.success else None,
    "analysis": result,
    "integrity_proof": proof.__dict__
})

# 6. Execute x402 payment
payment = sdk.execute_x402_payment(
    to_agent="AnalysisAgent",
    amount=15.0,
    service_type="market_analysis"
)

# 7. Client submits feedback to Reputation Registry (ERC-8004)
sdk.submit_feedback(
    agent_id=agent_id,
    score=95,
    feedback_uri=f"ipfs://{evidence_cid}",
    feedback_data={
        "score": 95,
        "task": "market_analysis",
        "proof_of_payment": {
            "txHash": payment['main_transaction_hash'],
            "amount": 15.0,
            "currency": "USDC"
        }
    }
)

# 8. Request validation via Validation Registry (ERC-8004)
validation_request = sdk.request_validation(
    validator_agent_id=validator_id,
    request_uri=f"ipfs://{proof.ipfs_cid}",
    request_hash=proof.execution_hash
)

print(f"✅ Complete ERC-8004 workflow!")
print(f"   Agent ID: {agent_id}")
print(f"   Evidence: {evidence_cid}")
print(f"   Payment TX: {payment['main_transaction_hash']}")
print(f"   Feedback submitted to Reputation Registry")
print(f"   Validation requested from validator #{validator_id}")
```

### Multi-Storage Strategy

```python
from chaoschain_sdk.providers.storage import LocalIPFSStorage, PinataStorage, IrysStorage
import json

# Use local IPFS for development
dev_storage = LocalIPFSStorage()
result = dev_storage.put(json.dumps({"env": "dev"}).encode(), mime="application/json")
dev_cid = result.cid

# Use Pinata for production
prod_storage = PinataStorage(
    jwt_token=os.getenv("PINATA_JWT"),
    gateway_url="https://gateway.pinata.cloud"
)
result = prod_storage.put(json.dumps({"env": "prod"}).encode(), mime="application/json")
prod_cid = result.cid

# Use Irys for permanent archival
archive_storage = IrysStorage(wallet_key=os.getenv("IRYS_WALLET_KEY"))
result = archive_storage.put(json.dumps({"env": "archive"}).encode(), mime="application/json")
archive_cid = result.cid

# Same API, different backends!
```

### x402 Paywall Server (Complete Example)

**Architecture:**
```
Client Agent → Paywall Server (Port 8402) → Facilitator (Port 8403/Hosted)
                     ↓                              ↓
              Returns 402 or 200              Executes blockchain TX
```

#### **Server Side (Agent A - Service Provider)**

```python
import os
from chaoschain_sdk import ChaosChainAgentSDK

# Initialize agent
server_sdk = ChaosChainAgentSDK(
    agent_name="AgentA",
    agent_domain="agenta.com",
    network="base-sepolia"
)

# Configure facilitator (hosted service that executes blockchain transactions)
os.environ["X402_FACILITATOR_URL"] = "https://facilitator.chaoscha.in"
os.environ["X402_USE_FACILITATOR"] = "true"

# Create paywall server (Port 8402 - serves protected resources)
server = server_sdk.create_x402_paywall_server(port=8402)

@server.require_payment(amount=5.0, description="Premium Analysis")
def premium_analysis(data):
    return {
        "analysis": "Deep market analysis...",
        "confidence": 0.95,
        "timestamp": datetime.now().isoformat()
    }

@server.require_payment(amount=2.0, description="Basic Query")
def basic_query(question):
    return {"answer": f"Response to: {question}"}

# Start paywall server
server.run()  # Listens on port 8402
```

#### **Client Side (Agent B - Service Consumer)**

```python
import requests
from chaoschain_sdk import ChaosChainAgentSDK

# Initialize client agent
client_sdk = ChaosChainAgentSDK(
    agent_name="AgentB",
    agent_domain="agentb.com",
    network="base-sepolia"
)

# Step 1: Try to access service (no payment)
response = requests.get("http://agenta.com:8402/chaoschain/service/premium_analysis")

if response.status_code == 402:
    print("💳 Payment Required!")
    # Response body:
    # {
    #   "x402Version": 1,
    #   "accepts": [{
    #     "scheme": "exact",
    #     "network": "base-sepolia",
    #     "maxAmountRequired": "5000000",  # 5 USDC in wei
    #     "payTo": "0xAgentA...",
    #     "asset": "0xUSDC..."
    #   }]
    # }
    
    # Step 2: Create payment authorization (signed by Agent B)
    payment_requirements = response.json()["accepts"][0]
    x_payment_header = client_sdk.create_x402_payment_header(payment_requirements)
    
    # Step 3: Retry with payment
    response = requests.get(
        "http://agenta.com:8402/chaoschain/service/premium_analysis",
        headers={"X-PAYMENT": x_payment_header}
    )
    
    if response.status_code == 200:
        print("✅ Service delivered!")
        # Response headers include:
        # X-PAYMENT-RESPONSE: <base64 settlement receipt with tx hash>
        
        result = response.json()
        print(result)  # {"analysis": "...", "confidence": 0.95}
```

#### **What Happens Behind the Scenes:**

1. **Client requests** → Paywall Server returns `402 Payment Required`
2. **Client creates** signed payment authorization (no blockchain TX yet)
3. **Client retries** with `X-PAYMENT` header
4. **Paywall Server** → calls Facilitator `/verify` (checks signature)
5. **Facilitator** → verifies Agent B's signature is valid
6. **Paywall Server** → calls Facilitator `/settle` (execute payment)
7. **Facilitator** → executes USDC transfer on blockchain:
   - 0.125 USDC → ChaosChain Treasury (2.5% fee)
   - 4.875 USDC → Agent A (net payment)
8. **Facilitator** → returns transaction hash
9. **Paywall Server** → delivers service + `X-PAYMENT-RESPONSE` header

**Key Points:**
- ✅ **Paywall Server (Port 8402)**: Each agent runs their own for their services
- ✅ **Facilitator (Port 8403/Hosted)**: Shared service that executes blockchain TXs
- ✅ **True x402 Protocol**: HTTP 402, X-PAYMENT headers, cryptographic proofs
- ✅ **Real USDC transfers**: On-chain payments via facilitator

## Configuration

### Environment Variables

```bash
# Network Configuration
NETWORK=base-sepolia
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHEREUM_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
OPTIMISM_SEPOLIA_RPC_URL=https://opt-sepolia.g.alchemy.com/v2/YOUR_KEY

# x402 Configuration (Coinbase Protocol)
CHAOSCHAIN_FEE_PERCENTAGE=2.5  # Protocol fee (default: 2.5%)
X402_USE_FACILITATOR=false

# Storage Providers (auto-detected if not specified)
# Local IPFS (free): Just run `ipfs daemon`
PINATA_JWT=your_jwt_token
PINATA_GATEWAY=https://gateway.pinata.cloud
IRYS_WALLET_KEY=your_wallet_key

# Optional: 0G Network
ZEROG_TESTNET_RPC_URL=https://evmrpc-testnet.0g.ai
ZEROG_TESTNET_PRIVATE_KEY=your_key
ZEROG_GRPC_URL=localhost:50051  # If using 0G sidecar

# Traditional Payment APIs (optional)
STRIPE_SECRET_KEY=sk_live_...
GOOGLE_PAY_MERCHANT_ID=merchant.example.com
APPLE_PAY_MERCHANT_ID=merchant.example.com
PAYPAL_CLIENT_ID=your_client_id
```

### Storage Setup

#### Local IPFS (Free, Recommended for Development)

```bash
# macOS
brew install ipfs
ipfs init
ipfs daemon

# Linux
wget https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz
tar -xvzf kubo_v0.24.0_linux-amd64.tar.gz
sudo bash kubo/install.sh
ipfs init
ipfs daemon
```

#### Pinata (Cloud)

```bash
# Get API keys from https://pinata.cloud
export PINATA_JWT="your_jwt_token"
export PINATA_GATEWAY="https://gateway.pinata.cloud"
```

## API Reference

### ChaosChainAgentSDK

```python
ChaosChainAgentSDK(
    agent_name: str,
    agent_domain: str, 
    agent_role: AgentRole | str,  # "server", "validator", "client"
    network: NetworkConfig | str = "base-sepolia",
    enable_process_integrity: bool = True,
    enable_payments: bool = True,
    enable_storage: bool = True,
    enable_ap2: bool = True,
    wallet_file: str = None
)
```

#### Key Methods

| Method | Description | Returns |
|--------|-------------|---------|
| **ERC-8004 Identity** |
| `register_identity()` | Register on-chain | `(agent_id, tx_hash)` |
| `update_agent_metadata()` | Update profile | `tx_hash` |
| `submit_feedback()` | Submit reputation | `tx_hash` |
| `request_validation()` | Request validation | `tx_hash` |
| **x402 Payments** |
| `execute_x402_payment()` | Execute payment | `Dict[str, Any]` |
| `create_x402_payment_requirements()` | Create requirements | `Dict` |
| `create_x402_paywall_server()` | Create paywall | `X402PaywallServer` |
| `get_x402_payment_history()` | Payment history | `List[Dict]` |
| **Google AP2** |
| `create_intent_mandate()` | Create intent | `GoogleAP2IntegrationResult` |
| `create_cart_mandate()` | Create cart + JWT | `GoogleAP2IntegrationResult` |
| **Process Integrity** |
| `execute_with_integrity_proof()` | Execute with proof | `(result, IntegrityProof)` |
| **Pluggable Storage** |
| `store_evidence()` | Store data | `cid` |

## Testing & Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/

# Run with coverage
pytest --cov=chaoschain_sdk tests/

# Run examples
python examples/basic_agent.py
```

## FAQ

**Q: Do I need to deploy contracts?**  
A: No! All ERC-8004 v1.0 contracts are pre-deployed on 5 testnets with deterministic addresses. Just `pip install` and start building.

**Q: Can I use this in production?**  
A: Yes! The SDK is production-ready and **100% ERC-8004 v1.0 compliant** (12/12 tests pass). Currently on testnets; mainnet deployment coming soon.

**Q: What's the difference between ERC-8004 and the SDK?**  
A: ERC-8004 v1.0 is the **standard** (3 registries: Identity, Reputation, Validation). The SDK **implements** it fully + adds x402 payments, AP2 intent verification, and Process Integrity for a complete agent economy.

**Q: How do I verify v1.0 compliance?**  
A: The SDK passes all 12 ERC-8004 v1.0 compliance tests. Agents are ERC-721 NFTs, making them browsable on OpenSea and compatible with all NFT wallets.

**Q: What storage should I use?**  
A: Start with Local IPFS (free), then 0G or Pinata for production. The SDK auto-detects available providers. ERC-8004 registration files can use any URI scheme (ipfs://, https://).

**Q: Do I need 0G Network?**  
A: No, 0G is optional. The SDK works great with Base/Ethereum/Optimism + IPFS/Pinata. 0G adds TEE-verified compute and decentralized storage.

**Q: How do x402 payments work?**  
A: Real USDC transfers using Coinbase's HTTP 402 protocol. Automatic 2.5% fee to ChaosChain treasury. Payment proofs can enrich ERC-8004 reputation feedback.

**Q: What are "supportedTrust" models in ERC-8004?**  
A: Agents advertise trust mechanisms: `reputation` (Reputation Registry), `validation` (Validation Registry with zkML/TEE), and `tee-attestation` (Process Integrity with 0G Compute). This SDK supports all three!

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE) file.

## Links

- **Homepage**: [https://chaoscha.in](https://chaoscha.in)
- **Documentation**: [https://docs.chaoscha.in](https://docs.chaoscha.in)
- **GitHub**: [https://github.com/ChaosChain/chaoschain-sdk](https://github.com/ChaosChain/chaoschain-sdk)
- **PyPI**: [https://pypi.org/project/chaoschain-sdk/](https://pypi.org/project/chaoschain-sdk/)
- **ERC-8004 Spec**: [https://eips.ethereum.org/EIPS/eip-8004](https://eips.ethereum.org/EIPS/eip-8004)
- **x402 Protocol**: [https://www.x402.org/](https://www.x402.org/)

## Support

- **Issues**: [GitHub Issues](https://github.com/ChaosChain/chaoschain-sdk/issues)
- **Discord**: [ChaosChain Community]
- **Email**: sumeet.chougule@nethermind.io

---

**Build verifiable AI agents with on-chain identity, cryptographic proofs, and crypto payments.**
