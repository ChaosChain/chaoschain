# ChaosChain SDK

**Developer SDK for building verifiable, monetizable agents on the ChaosChain protocol**

[![PyPI version](https://badge.fury.io/py/chaoschain-sdk.svg)](https://badge.fury.io/py/chaoschain-sdk)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The ChaosChain SDK provides everything developers need to build autonomous agents that can interact with the ChaosChain protocol. **Zero setup required** - all ERC-8004 contracts are pre-deployed and embedded, with support for process integrity verification, multi-payment methods (including native x402), and **pluggable storage** with free local IPFS as default.

## Quick Start

### Installation

```bash
# Basic installation (includes all ERC-8004 contracts pre-deployed)
pip install chaoschain-sdk

# With production payment processor integrations
pip install chaoschain-sdk[payments]

# With x402 paywall server support
pip install chaoschain-sdk[server]

# With Google AP2 support (required for intent verification)
pip install chaoschain-sdk
pip install git+https://github.com/google-agentic-commerce/AP2.git@main

# With development tools
pip install chaoschain-sdk[dev]

# Full installation (all features)
pip install chaoschain-sdk[payments,server,dev]
pip install git+https://github.com/google-agentic-commerce/AP2.git@main
```

> **Zero Setup**: All ERC-8004 contracts are pre-deployed on Base Sepolia, Ethereum Sepolia, and Optimism Sepolia. No deployment or configuration needed!
> 
> **Note**: Google AP2 must be installed separately as it's not available on PyPI. This is required for intent verification features.

### Storage Setup (Optional - Free Local IPFS Recommended)

The SDK uses **Local IPFS as the default** storage provider because it's **completely free** and gives you full control over your data! No API keys or costs required.

#### 🆓 **Option 1: Local IPFS (Recommended - FREE!)**

**macOS:**
```bash
# Install and setup IPFS (one-time setup)
brew install ipfs
ipfs init
ipfs daemon  # Keep running in background
```

**Linux:**
```bash
# Install IPFS
wget https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz
tar -xvzf kubo_v0.24.0_linux-amd64.tar.gz
sudo bash kubo/install.sh

# Setup and start
ipfs init
ipfs daemon  # Keep running in background
```

**Windows:**
1. Download from https://dist.ipfs.tech/kubo/
2. Extract and run `ipfs.exe init`
3. Run `ipfs.exe daemon`

**Verify Setup:**
```python
from chaoschain_sdk.storage import create_storage_manager

# Should work without errors if IPFS daemon is running
storage = create_storage_manager()
print("✅ Local IPFS working!")
```

#### 💰 **Option 2: Pinata (Cloud - Paid)**

If you prefer managed cloud storage:

```bash
# Set environment variables
export PINATA_JWT="your_jwt_token_here"
export PINATA_GATEWAY="https://gateway.pinata.cloud"
```

#### 🔮 **Option 3: Irys (Programmable - Paid)**

For advanced programmable data features:

```bash
export IRYS_WALLET_KEY="your_wallet_private_key"
```

> **Auto-Detection**: The SDK automatically detects what storage providers you have available and uses the best option. Local IPFS is tried first (free), then Pinata, then Irys.

### Basic Usage

```python
from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole

# Initialize your agent with full Triple-Verified Stack
# Uses pre-deployed contracts automatically - no setup needed!
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.example.com", 
    agent_role="server",  # or AgentRole.SERVER
    network="base-sepolia",  # or NetworkConfig.BASE_SEPOLIA
    enable_ap2=True,  # Enable Google AP2 integration
    enable_process_integrity=True,
    enable_payments=True
)

# 1. Create Google AP2 Intent Mandate (Layer 1: User Authorization)
intent_result = sdk.create_intent_mandate(
    user_description="Find me a good AI analysis service under $10",
    merchants=["TrustedAnalytics", "AIServices"],
    expiry_minutes=60
)

# 2. Register on ERC-8004 (Identity Layer)
agent_id, tx_hash = sdk.register_identity()
print(f"Agent registered with ID: {agent_id}")

# 3. Execute work with process integrity (Layer 2: Execution Verification)
@sdk.process_integrity.register_function
async def my_analysis_function(data: str) -> dict:
    # Your agent's work logic here
    return {"result": f"Analyzed: {data}", "confidence": 0.95}

result, proof = await sdk.execute_with_integrity_proof(
    "my_analysis_function",
    {"data": "market_data"}
)

# 4. Create AP2 Cart Mandate with JWT signing
cart_result = sdk.create_cart_mandate(
    cart_id="cart_123",
    items=[{"name": "AI Analysis", "price": 5.0}],
    total_amount=5.0,
    currency="USD"
)

# 5. Execute payment (multiple options available including x402)
payment_result = sdk.execute_x402_payment(
    to_agent="ServiceProvider",
    amount=5.0,
    service_type="analysis"
)

# 6. Store comprehensive evidence using pluggable storage
evidence_cid = sdk.store_evidence({
    "intent_mandate": intent_result.intent_mandate.model_dump() if intent_result.success else None,
    "cart_mandate": cart_result.cart_mandate.model_dump() if cart_result.success else None,
    "analysis": result,
    "integrity_proof": proof.__dict__,
    "payment_proof": payment_result
})

# Alternative: Use storage system directly for more control
from chaoschain_sdk.storage import create_storage_manager
storage = create_storage_manager()  # Auto-detects Local IPFS (free) or other providers
custom_cid = storage.upload_json({"custom": "data"}, "custom.json")

print(f"🎉 Triple-Verified Stack complete! Evidence: {evidence_cid}")
```

## Pluggable Storage System

The SDK features a **revolutionary pluggable storage architecture** that eliminates vendor lock-in and provides multiple storage options:

### 🆓 **No Vendor Lock-in**
- **Choose any provider**: Local IPFS (free), Pinata (cloud), Irys (programmable)
- **Switch anytime**: Same API across all providers
- **Auto-detection**: SDK automatically finds the best available option

### 🎯 **Storage Options**

```python
from chaoschain_sdk.storage import create_storage_manager

# Auto-detect best available provider (recommended)
storage = create_storage_manager()

# Or choose specific provider
storage = create_storage_manager("local_ipfs")    # FREE!
storage = create_storage_manager("pinata", jwt_token="...")
storage = create_storage_manager("irys", wallet_key="...")

# Same API regardless of provider
cid = storage.upload_json({"data": "value"}, "file.json")
data = storage.retrieve_json(cid)
print(f"Stored at: {storage.get_gateway_url(cid)}")
```

### 🔄 **Provider Comparison**

| Provider | Cost | Setup | Best For |
|----------|------|-------|----------|
| **Local IPFS** | 🆓 Free | `brew install ipfs` | Development, full control |
| **Pinata** | 💰 Paid | Set env vars | Production, reliability |
| **Irys** | 💰 Paid | Wallet key | Advanced, programmable data |

### 🚀 **Easy Switching**

```python
# Start with free local IPFS for development
dev_storage = create_storage_manager("local_ipfs")

# Switch to Pinata for production - same API!
prod_storage = create_storage_manager("pinata", jwt_token="...")

# All methods work the same
cid = prod_storage.upload_json(data, "file.json")  # Same call!
```

## Architecture

The ChaosChain SDK implements the **Triple-Verified Stack**:

```
Layer 3: ChaosChain Adjudication     🎯 "Was outcome valuable?"
Layer 2: ChaosChain Process Integrity ⚡ "Was code executed right?"  
Layer 1: Google AP2 Intent           📝 "Did human authorize?"

ChaosChain runs 2 out of 3 verification layers!
```

##  Core Features

### ✅ ERC-8004 Registry Integration (Pre-Deployed)
- **Identity Registry**: On-chain agent registration and discovery
- **Reputation Registry**: Feedback and reputation management  
- **Validation Registry**: Peer validation and consensus
- **Zero Setup**: All contracts pre-deployed with embedded addresses

### ✅ Process Integrity Verification
- Cryptographic proof of correct code execution
- Function registration and integrity checking
- Pluggable storage for verifiable evidence (Local IPFS, Pinata, Irys)

### ✅ Multi-Payment Support (W3C Compliant + x402)
- **6 Payment Methods**: Full W3C Payment Request API compliance + native x402
  - `basic-card`: **Integration template** for Stripe (requires API implementation)
  - `https://google.com/pay`: **Integration template** for Google Pay (requires merchant setup)
  - `https://apple.com/apple-pay`: **Integration template** for Apple Pay (requires certificates)
  - `https://paypal.com`: **Integration template** for PayPal (requires API implementation)
  - `https://a2a.org/x402`: **LIVE crypto payments** (real USDC on Base Sepolia)
  - **Native x402**: Coinbase official HTTP 402 protocol support
- **Crypto Ready**: Real USDC transfers work out-of-the-box
- **Traditional Ready**: Production-ready templates (developers add API integrations)
- **x402 Server Support**: Create paywall servers with `@require_payment` decorator
- **Protocol Fees**: Automatic 2.5% fee collection to ChaosChain treasury (ChaosChain.eth)

### ✅ Production-Ready Infrastructure
- **Multi-Network**: Ethereum, Base, Optimism Sepolia testnets
- **Pre-Deployed Contracts**: Real contract addresses embedded - no deployment needed
- **Secure Wallets**: Automatic wallet generation and management
- **Pluggable Storage**: Choose from Local IPFS (free), Pinata (cloud), or Irys (programmable)
- **No Vendor Lock-in**: Switch storage providers without code changes
- **Error Handling**: Comprehensive exception handling and logging

## Supported Networks

| Network | Chain ID | Status | Contracts Pre-Deployed |
|---------|----------|--------|------------------------|
| Base Sepolia | 84532 | ✅ Active | ✅ ERC-8004 Suite (Embedded) |
| Ethereum Sepolia | 11155111 | ✅ Active | ✅ ERC-8004 Suite (Embedded) |
| Optimism Sepolia | 11155420 | ✅ Active | ✅ ERC-8004 Suite (Embedded) |

> **Ready to Use**: All contract addresses are embedded in the SDK. Just `pip install` and start building!

## Payment Methods: Real Integrations + Demo Mode

### ✅ **LIVE & WORKING (Out-of-the-Box)**
| Method | W3C Identifier | Status | Settlement |
|--------|---------------|--------|------------|
| A2A-x402 Crypto | `https://a2a.org/x402` | ✅ **LIVE** | **Real USDC Transfers on Base Sepolia** |
| Native x402 | Coinbase Official | ✅ **LIVE** | **Real USDC + HTTP 402 Protocol** |

### 🔧 **REAL API INTEGRATIONS (Add Your Credentials)**
| Method | W3C Identifier | Status | What You Need |
|--------|---------------|--------|---------------|
| Basic Cards | `basic-card` | ✅ **REAL** Stripe API | Add `STRIPE_SECRET_KEY` |
| PayPal | `https://paypal.com` | ✅ **REAL** PayPal API | Add `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` |
| Google Pay | `https://google.com/pay` | ✅ **REAL** Token Validation | Add `GOOGLE_PAY_MERCHANT_ID` |
| Apple Pay | `https://apple.com/apple-pay` | ✅ **REAL** Token Validation | Add `APPLE_PAY_MERCHANT_ID` |

**Key Features:**
- **Real API Calls**: All payment methods use actual API integrations
- **Token Validation**: Google Pay and Apple Pay validate real payment tokens
- **Gateway Integration**: Google Pay and Apple Pay can process via Stripe or other gateways
- **Demo Mode**: Automatically falls back to demo mode if credentials not provided
- **Production Ready**: Add your API keys and process real payments immediately
- **Clear Feedback**: Console output shows whether using real APIs or demo mode
- **x402 Server Support**: Create HTTP 402 paywall servers with `@require_payment` decorator

## Advanced Usage

### Process Integrity with Custom Functions

```python
# Register a function for integrity checking
@sdk.process_integrity.register_function
async def complex_analysis(params: dict) -> dict:
    # Your complex analysis logic
    result = perform_analysis(params)
    return {
        "analysis": result,
        "timestamp": datetime.now().isoformat(),
        "confidence": calculate_confidence(result)
    }

# Execute with cryptographic proof
result, integrity_proof = await sdk.execute_with_integrity_proof(
    "complex_analysis",
    {"market_data": data, "timeframe": "1d"}
)

print(f"Proof ID: {integrity_proof.proof_id}")
print(f"Code Hash: {integrity_proof.code_hash}")
print(f"IPFS CID: {integrity_proof.ipfs_cid}")
```

### Multi-Payment Method Support (W3C Compliant + x402)

The SDK supports 6 payment methods including the new native x402 support:

```python
# 1. Basic Card Payment (Visa, Mastercard, Amex, Discover)
card_payment = sdk.execute_traditional_payment(
    payment_method="basic-card",
    amount=25.99,
    currency="USD",
    payment_data={
        "cardNumber": "4111111111111111",
        "cardType": "visa",
        "expiryMonth": "12",
        "expiryYear": "2025",
        "cvv": "123"
    }
)

# 2. Google Pay
google_pay_result = sdk.execute_traditional_payment(
    payment_method="https://google.com/pay",
    amount=25.99,
    currency="USD",
    payment_data={
        "googleTransactionId": "gpay_txn_123456",
        "paymentMethodType": "CARD"
    }
)

# 3. Apple Pay
apple_pay_result = sdk.execute_traditional_payment(
    payment_method="https://apple.com/apple-pay",
    amount=25.99,
    currency="USD",
    payment_data={
        "transactionIdentifier": "apay_txn_789012",
        "paymentMethod": {
            "displayName": "Visa ••••1234",
            "network": "Visa"
        }
    }
)

# 4. PayPal
paypal_result = sdk.execute_traditional_payment(
    payment_method="https://paypal.com",
    amount=25.99,
    currency="USD",
    payment_data={
        "paypalTransactionId": "pp_txn_345678",
        "payerEmail": "user@example.com"
    }
)

# 5. A2A-x402 Crypto Payment (USDC on Base Sepolia)
x402_request = sdk.create_x402_payment_request(
    cart_id="crypto_cart_123",
    total_amount=25.99,
    currency="USDC",
    items=[{"name": "AI Analysis Service", "price": 25.99}]
)

crypto_payment = sdk.execute_x402_crypto_payment(
    payment_request=x402_request,
    payer_agent="PayerAgent",
    service_description="AI Analysis Service"
)

# 6. Native x402 Payment (Coinbase Official Protocol)
x402_payment = sdk.execute_x402_payment(
    to_agent="ServiceProvider",
    amount=25.99,
    service_type="analysis"
)

# 7. x402 Paywall Server (Receive Payments)
server = sdk.create_x402_paywall_server(port=8402)

@server.require_payment(amount=2.0, description="Premium Analysis")
def premium_analysis(data):
    return {"analysis": f"Deep analysis of {data}"}

# server.run()  # Start HTTP 402 server

print(f"Crypto Payment: {crypto_payment.transaction_hash}")
print(f"x402 Payment: {x402_payment['main_transaction_hash']}")

# Get all supported payment methods
supported_methods = sdk.get_supported_payment_methods()
print(f"Supported Payment Methods: {supported_methods}")
# Output: ['x402 (Coinbase Official)', 'basic-card', 'https://google.com/pay', 
#          'https://apple.com/apple-pay', 'https://paypal.com', 'https://a2a.org/x402']
```

### Evidence Package Creation

```python
# Create comprehensive evidence package
evidence_package = sdk.create_evidence_package(
    work_proof={
        "service_type": "market_analysis",
        "input_data": input_params,
        "output_data": analysis_result,
        "execution_time": execution_duration
    },
    integrity_proof=integrity_proof,
    payment_proofs=[payment_proof],
    validation_results=validation_results
)

print(f"Evidence Package ID: {evidence_package.package_id}")
print(f"IPFS CID: {evidence_package.ipfs_cid}")
```

### Validation Workflow

```python
# Request validation from another agent
validator_agent_id = 8  # On-chain ID of validator
data_hash = "0x" + hashlib.sha256(json.dumps(analysis_result).encode()).hexdigest()

validation_tx = sdk.request_validation(validator_agent_id, data_hash)
print(f"Validation requested: {validation_tx}")

# Submit feedback for another agent
feedback_tx = sdk.submit_feedback(
    agent_id=validator_agent_id,
    score=95,
    feedback="Excellent validation quality and fast response time"
)
```

## Security & Configuration

### Environment Variables

Create a `.env` file with your configuration:

```bash
# Network Configuration
NETWORK=base-sepolia
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
ETHEREUM_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
OPTIMISM_SEPOLIA_RPC_URL=https://opt-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# x402 Payment Configuration (PRIMARY)
X402_USE_FACILITATOR=false  # Set to true to use facilitator
X402_FACILITATOR_URL=https://facilitator.example.com

# ChaosChain Protocol Configuration
CHAOSCHAIN_FEE_PERCENTAGE=2.5
# CHAOSCHAIN_TREASURY_ADDRESS=0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70  # Optional: Override treasury (use with caution)
CHAOSCHAIN_OPERATOR_PRIVATE_KEY=your_operator_private_key  # Optional

# Storage Options (choose one or let SDK auto-detect)
# Option 1: Local IPFS (FREE - recommended for development)
# Just run: ipfs daemon (no env vars needed)

# Option 2: Pinata (Cloud storage)
PINATA_JWT=your_pinata_jwt_token
PINATA_GATEWAY=https://your-gateway.mypinata.cloud

# Option 3: Irys (Programmable datachain)
IRYS_WALLET_KEY=your_wallet_private_key

# Optional: Legacy Payment Processor Integrations
# Stripe (for basic-card payments via A2A-x402 bridge)
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key

# Google Pay (for Google Pay payments via A2A-x402 bridge)
GOOGLE_PAY_MERCHANT_ID=merchant.your-domain.com
GOOGLE_PAY_ENVIRONMENT=PRODUCTION

# Apple Pay (for Apple Pay payments via A2A-x402 bridge)
APPLE_PAY_MERCHANT_ID=merchant.your-domain.com
APPLE_PAY_CERTIFICATE_PATH=/path/to/apple-pay-cert.pem

# PayPal (for PayPal payments via A2A-x402 bridge)
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_ENVIRONMENT=live

# Optional: Custom wallet file
CHAOSCHAIN_WALLET_FILE=my_agent_wallets.json
```

### Treasury Address Security

**Important**: The ChaosChain protocol collects a 2.5% fee on all x402 payments to fund development and operations.

- **Default**: Uses official ChaosChain treasury addresses (verified)
- **Override**: Set `CHAOSCHAIN_TREASURY_ADDRESS` environment variable (use with caution)
- **Validation**: Custom addresses are validated for proper format
- **Warning**: Custom treasury addresses will display a warning message

```bash
# Default: Uses official ChaosChain treasury (recommended)
# No configuration needed

# Custom treasury (for testing/private deployments only)
CHAOSCHAIN_TREASURY_ADDRESS=0xYourCustomTreasuryAddress
```

### Wallet Security

The SDK automatically generates and manages secure wallets:

```python
# Wallets are stored in chaoschain_wallets.json (gitignored by default)
# Each agent gets a unique wallet with private key management
sdk = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.example.com",
    agent_role=AgentRole.SERVER,
    wallet_file="custom_wallets.json"  # Optional custom file
)

print(f"Agent wallet: {sdk.wallet_address}")
print(f"Network: {sdk.network_info}")
```

##  Testing & Development

### Running Tests

```bash
# Install development dependencies
pip install chaoschain-sdk[dev]

# Run tests
pytest tests/

# Run with coverage
pytest --cov=chaoschain_sdk tests/
```

### Local Development

```bash
# Clone the repository
git clone https://github.com/ChaosChain/chaoschain
cd chaoschain/packages/sdk

# Install in development mode
pip install -e .

# Run the example
python examples/basic_agent.py
```

## API Reference

### ChaosChainAgentSDK

The main SDK class providing all functionality:

#### Constructor
```python
ChaosChainAgentSDK(
    agent_name: str,
    agent_domain: str, 
    agent_role: AgentRole | str,  # "server", "validator", "client" or enum
    network: NetworkConfig | str = "base-sepolia",  # or enum
    enable_process_integrity: bool = True,
    enable_payments: bool = True,
    enable_storage: bool = True,
    enable_ap2: bool = True,
    wallet_file: str = None,
    storage_jwt: str = None,
    storage_gateway: str = None
)
```

#### Core Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `register_identity()` | Register agent on ERC-8004 | `(agent_id, tx_hash)` |
| `execute_with_integrity_proof()` | Execute function with proof | `(result, proof)` |
| **x402 Payment Methods (PRIMARY)** |
| `execute_x402_payment()` | Execute native x402 payment | `Dict[str, Any]` |
| `create_x402_payment_requirements()` | Create x402 payment requirements | `Dict[str, Any]` |
| `get_x402_payment_history()` | Get x402 payment history | `List[Dict[str, Any]]` |
| `get_x402_payment_summary()` | Get x402 payment analytics | `Dict[str, Any]` |
| `create_x402_paywall_server()` | Create HTTP 402 paywall server | `X402PaywallServer` |
| **Legacy Payment Methods (FALLBACK)** |
| `execute_payment()` | Process A2A-x402 payment | `PaymentProof` |
| `execute_traditional_payment()` | Process traditional payment | `PaymentResponse` |
| `get_supported_payment_methods()` | Get all payment methods | `List[str]` |
| **Optional AP2 Integration** |
| `create_intent_mandate()` | Create AP2 intent mandate | `GoogleAP2IntegrationResult` |
| `create_cart_mandate()` | Create AP2 cart mandate | `GoogleAP2IntegrationResult` |
| **Pluggable Storage System** |
| `create_storage_manager()` | Auto-detect storage provider | `UnifiedStorageManager` |
| `storage.upload_json()` | Store JSON data | `cid` |
| `storage.retrieve_json()` | Retrieve JSON data | `dict` |
| `storage.get_provider_info()` | Get provider details | `dict` |
| **Legacy Storage & Evidence** |
| `store_evidence()` | Store data using configured storage | `cid` |
| `create_evidence_package()` | Create proof package | `EvidencePackage` |
| `request_validation()` | Request peer validation | `tx_hash` |

### Types

The SDK provides comprehensive type definitions:

```python
from chaoschain_sdk import (
    # Core SDK Classes
    ChaosChainAgentSDK,     # Main SDK class
    X402PaymentManager,     # Native x402 payment manager
    X402PaywallServer,      # HTTP 402 paywall server
    
    # Configuration Enums
    AgentRole,              # SERVER, VALIDATOR, CLIENT
    NetworkConfig,          # BASE_SEPOLIA, ETHEREUM_SEPOLIA, etc.
    PaymentMethod,          # BASIC_CARD, GOOGLE_PAY, A2A_X402, etc.
    
    # Data Classes
    IntegrityProof,         # Process integrity proof
    PaymentProof,           # Payment transaction proof
    EvidencePackage,        # Comprehensive evidence package
    AgentIdentity,          # Agent identity information
    
    # Optional AP2 Integration
    GoogleAP2Integration,   # AP2 intent verification
    A2AX402Extension,       # A2A-x402 W3C payment bridge
)
```

## **Native x402 Support**

The ChaosChain SDK includes **native integration** with Coinbase's x402 payment protocol, enabling developers to build **verifiable, monetizable agents** that can autonomously handle payments while maintaining cryptographic proof of their work.

### Key Features:
- **HTTP 402 Payment Required**: Official Coinbase x402 protocol implementation
- **Paywall Server Support**: Create payment-required services with decorators
- **Facilitator Integration**: Optional third-party verification/settlement
- **Cryptographic Receipts**: Every payment includes verifiable proof
- **Multi-Agent Commerce**: Enable agent-to-agent payment flows
- **Production Ready**: Real USDC transfers on Base, Ethereum, and Optimism

### Quick x402 Example:
```python
from chaoschain_sdk import ChaosChainAgentSDK

# Initialize agent with x402 payments
agent = ChaosChainAgentSDK(agent_name="PaymentAgent", ...)

# Execute x402 payment (Coinbase official protocol)
payment_result = agent.execute_x402_payment(
    to_agent="ServiceProvider",
    amount=5.0,  # USDC
    service_type="ai_analysis"
)
```

**📚 Complete x402 Integration Guide**: [X402_INTEGRATION_GUIDE.md](https://github.com/ChaosChain/chaoschain/blob/main/docs/X402_INTEGRATION_GUIDE.md)

**Learn More**: [x402.org](https://www.x402.org/) | [Coinbase x402 GitHub](https://github.com/coinbase/x402)

##  Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- **Homepage**: [https://chaoscha.in](https://chaoscha.in)
- **Documentation**: [https://docs.chaoscha.in](https://docs.chaoscha.in)
- **GitHub**: [https://github.com/ChaosChain/chaoschain](https://github.com/ChaosChain/chaoschain)
- **PyPI**: [https://pypi.org/project/chaoschain-sdk/](https://pypi.org/project/chaoschain-sdk/)

## Support

- **Issues**: [GitHub Issues](https://github.com/ChaosChain/chaoschain/issues)
- **Discord**: [ChaosChain Community](https://discord.gg/chaoschain)
- **Email**: [hello@chaoschain.com](mailto:hello@)

---

**Building the future of trustworthy autonomous services.**