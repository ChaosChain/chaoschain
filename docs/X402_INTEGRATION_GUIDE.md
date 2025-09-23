# ChaosChain x402 Integration Guide

**Building Verifiable, Monetizable Agents with Coinbase's x402 Protocol**

[![x402 Protocol](https://img.shields.io/badge/x402-Official%20Coinbase-blue)](https://www.x402.org/)
[![ChaosChain SDK](https://img.shields.io/badge/ChaosChain%20SDK-v0.1.2-green)](https://pypi.org/project/chaoschain-sdk/)

---

## Overview

ChaosChain SDK provides **native integration** with [Coinbase's x402 protocol](https://github.com/coinbase/x402), enabling developers to build **verifiable, monetizable agents** that can autonomously handle payments while maintaining cryptographic proof of their work.

This integration demonstrates the future of **Agent Commerce** - where AI agents can:
- 🔐 **Verify their identity** on-chain via ERC-8004 registries
- 💰 **Execute payments** using HTTP 402 Payment Required protocol
- 🛡️ **Prove their work** with cryptographic integrity verification
- 📊 **Build reputation** through peer validation networks

## Architecture: The Triple-Verified Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    CHAOSCHAIN AGENT                        │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: ChaosChain Adjudication     🎯 "Was outcome valuable?" │
│ Layer 2: ChaosChain Process Integrity ⚡ "Was code executed right?" │
│ Layer 1: Coinbase x402 Payments      💰 "Did payment succeed?"    │
└─────────────────────────────────────────────────────────────┘
```

**ChaosChain runs 2 out of 3 verification layers, with x402 as the payment foundation!**

## Quick Start

### Installation

```bash
# Install ChaosChain SDK with native x402 support
pip install chaoschain-sdk

# x402 is included as a core dependency - no extra setup needed!
```

### Basic x402 Payment Example

```python
from chaoschain_sdk import ChaosChainAgentSDK

# Initialize agent with x402 payments enabled
agent = ChaosChainAgentSDK(
    agent_name="PaymentAgent",
    agent_domain="payments.example.com",
    agent_role="server",
    network="base-sepolia"
)

# Register agent identity on ERC-8004
agent_id, tx_hash = agent.register_identity()
print(f"Agent registered: {agent_id}")

# Execute x402 payment (native Coinbase protocol)
payment_result = agent.execute_x402_payment(
    to_agent="ServiceProvider",
    amount=5.0,  # USDC
    service_type="ai_analysis"
)

print(f"Payment successful: {payment_result['main_transaction_hash']}")
```

## x402 Protocol Integration Details

### 1. Native x402 Payment Manager

ChaosChain SDK uses Coinbase's official x402 Python library:

```python
from chaoschain_sdk import X402PaymentManager

# Direct access to x402 payment manager
payment_manager = X402PaymentManager(
    wallet_manager=agent.wallet_manager,
    network=agent.network
)

# Create payment requirements (HTTP 402 standard)
requirements = payment_manager.create_payment_requirements(
    to_agent="ai-service.com",
    amount_usdc=2.5,
    service_description="Market Analysis Service"
)

# Execute payment with cryptographic proof
payment_proof = payment_manager.execute_x402_payment(
    from_agent="client-agent",
    to_agent="ai-service.com", 
    amount_usdc=2.5,
    service_description="Market Analysis Service"
)
```

### 2. HTTP 402 Paywall Server

Create payment-required services using the x402 decorator:

```python
from chaoschain_sdk import X402PaywallServer

# Create x402 paywall server
server = agent.create_x402_paywall_server(port=8402)

@server.require_payment(amount=1.0, description="Premium AI Analysis")
def premium_analysis(data):
    """This endpoint requires x402 payment before access."""
    return {
        "analysis": f"Deep AI analysis of {data}",
        "confidence": 0.95,
        "timestamp": datetime.now().isoformat()
    }

# Start HTTP 402 server
# server.run()  # Responds with 402 Payment Required until paid
```

### 3. Payment Requirements & Verification

```python
# Create detailed payment requirements
payment_requirements = agent.create_x402_payment_requirements(
    cart_id="analysis_001",
    total_amount=3.5,
    currency="USDC",
    items=[
        {"name": "AI Market Analysis", "price": 2.5},
        {"name": "Risk Assessment", "price": 1.0}
    ],
    max_timeout_seconds=300,
    pay_to="0x742d35Cc6634C0532925a3b8D4C2C4C4C4C4C4C4"
)

# Execute payment with full verification
payment_result = agent.execute_x402_crypto_payment(
    payment_request=payment_requirements,
    payer_agent="ClientAgent",
    service_description="Comprehensive Market Analysis"
)

# Payment includes:
# - Cryptographic signatures
# - On-chain transaction proof  
# - x402 protocol compliance
# - ChaosChain fee collection (2.5% to protocol treasury)
```

## Advanced Features

### 1. Multi-Agent Payment Flows

```python
# Agent A requests service from Agent B
client_agent = ChaosChainAgentSDK(agent_name="ClientAgent", ...)
service_agent = ChaosChainAgentSDK(agent_name="ServiceAgent", ...)

# Service agent creates payment requirements
requirements = service_agent.create_x402_payment_requirements(
    cart_id="service_123",
    total_amount=5.0,
    service_description="AI-powered market prediction"
)

# Client agent pays and receives service
payment_proof = client_agent.execute_x402_payment(
    to_agent="ServiceAgent",
    amount=5.0,
    service_type="prediction"
)

# Both agents get cryptographic receipts
print(f"Client receipt: {payment_proof['client_receipt']}")
print(f"Service receipt: {payment_proof['service_receipt']}")
```

### 2. Payment History & Analytics

```python
# Get comprehensive payment history
payment_history = agent.get_x402_payment_history()

for payment in payment_history:
    print(f"Payment: {payment['amount']} USDC to {payment['to_agent']}")
    print(f"Service: {payment['service_description']}")
    print(f"Status: {payment['status']}")
    print(f"x402 Proof: {payment['x402_proof']}")

# Get payment analytics
analytics = agent.get_x402_payment_summary()
print(f"Total payments: {analytics['total_payments']}")
print(f"Total volume: {analytics['total_volume_usdc']} USDC")
print(f"Success rate: {analytics['success_rate']}%")
```

### 3. Integration with Process Integrity

```python
# Combine x402 payments with work verification
@agent.process_integrity.register_function
async def paid_analysis_service(market_data: dict) -> dict:
    """AI analysis service that requires payment."""
    # Perform complex analysis
    analysis_result = await perform_market_analysis(market_data)
    
    return {
        "prediction": analysis_result["prediction"],
        "confidence": analysis_result["confidence"],
        "reasoning": analysis_result["reasoning"],
        "timestamp": datetime.now().isoformat()
    }

# Execute with both payment and integrity proof
result, integrity_proof = await agent.execute_with_integrity_proof(
    "paid_analysis_service",
    {"market_data": market_data}
)

# Store evidence with payment proof
evidence_cid = agent.store_evidence({
    "service_result": result,
    "integrity_proof": integrity_proof.__dict__,
    "payment_proof": payment_proof,
    "x402_compliance": True
})
```

## Protocol Fees & Treasury

ChaosChain automatically collects a **2.5% protocol fee** on all x402 payments:

```python
# Example: $10 USDC payment
# - Service provider receives: $9.75 USDC
# - ChaosChain treasury receives: $0.25 USDC
# - Transaction fees: Paid by sender

payment_result = agent.execute_x402_payment(
    to_agent="ServiceProvider",
    amount=10.0,  # $10 USDC total
    service_type="analysis"
)

print(f"Main payment: {payment_result['main_transaction_hash']}")
print(f"Fee payment: {payment_result['fee_transaction_hash']}")
print(f"Net to service: $9.75 USDC")
print(f"Protocol fee: $0.25 USDC")
```

## Network Support

| Network | Chain ID | Status | USDC Contract |
|---------|----------|--------|---------------|
| Base Sepolia | 84532 | ✅ Live | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Ethereum Sepolia | 11155111 | ✅ Live | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Optimism Sepolia | 11155420 | ✅ Live | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` |

All networks support real USDC transfers with x402 protocol compliance.

## Configuration

### Environment Variables

```bash
# x402 Configuration
X402_USE_FACILITATOR=false  # Set to true for facilitator mode
X402_FACILITATOR_URL=https://facilitator.example.com

# Network Configuration  
NETWORK=base-sepolia
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# ChaosChain Protocol
CHAOSCHAIN_FEE_PERCENTAGE=2.5
CHAOSCHAIN_TREASURY_ADDRESS=0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70

# IPFS Storage (for evidence)
PINATA_JWT=your_pinata_jwt_token
```

### Wallet Management

```python
# Automatic wallet generation and management
agent = ChaosChainAgentSDK(
    agent_name="MyAgent",
    agent_domain="myagent.example.com",
    wallet_file="custom_wallets.json"  # Optional
)

# Wallets are automatically funded for testnet
print(f"Agent wallet: {agent.wallet_address}")
print(f"Fund this wallet at: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet")
```

## Error Handling & Resilience

```python
from chaoschain_sdk.exceptions import PaymentError, X402Error

try:
    payment_result = agent.execute_x402_payment(
        to_agent="ServiceProvider",
        amount=5.0,
        service_type="analysis"
    )
except PaymentError as e:
    print(f"Payment failed: {e}")
    # Handle insufficient funds, network issues, etc.
    
except X402Error as e:
    print(f"x402 protocol error: {e}")
    # Handle x402-specific issues
    
except Exception as e:
    print(f"Unexpected error: {e}")
```

## Testing & Development

### Local Testing

```python
# Test x402 integration without real payments
agent = ChaosChainAgentSDK(
    agent_name="TestAgent",
    agent_domain="test.example.com",
    network="base-sepolia"  # Use testnet
)

# All payments use testnet USDC - no real money involved
payment_result = agent.execute_x402_payment(
    to_agent="TestService",
    amount=1.0,  # Test USDC
    service_type="test"
)
```

### Integration Tests

```python
import pytest
from chaoschain_sdk import ChaosChainAgentSDK

@pytest.mark.asyncio
async def test_x402_payment_flow():
    """Test complete x402 payment flow."""
    
    # Setup agents
    payer = ChaosChainAgentSDK(agent_name="Payer", ...)
    payee = ChaosChainAgentSDK(agent_name="Payee", ...)
    
    # Register both agents
    payer_id, _ = payer.register_identity()
    payee_id, _ = payee.register_identity()
    
    # Execute payment
    result = payer.execute_x402_payment(
        to_agent="Payee",
        amount=2.5,
        service_type="test_service"
    )
    
    assert result["success"] == True
    assert "main_transaction_hash" in result
    assert "x402_proof" in result
```

## Production Deployment

### Security Considerations

1. **Wallet Security**: Private keys are encrypted and stored locally
2. **Payment Verification**: All x402 payments include cryptographic proofs
3. **Network Security**: Multi-network support with fallback options
4. **Rate Limiting**: Built-in protection against payment spam

### Monitoring & Observability

```python
# Built-in payment monitoring
payment_summary = agent.get_x402_payment_summary()

print(f"Payment success rate: {payment_summary['success_rate']}%")
print(f"Average payment time: {payment_summary['avg_payment_time']}s")
print(f"Total volume processed: ${payment_summary['total_volume_usdc']}")

# Integration with external monitoring
import logging
logging.basicConfig(level=logging.INFO)

# All x402 operations are automatically logged
```

## Why ChaosChain + x402?

### For Developers
- **Zero Setup**: Pre-deployed contracts, automatic wallet management
- **Production Ready**: Real USDC payments, comprehensive error handling
- **Verifiable**: Every payment includes cryptographic proof
- **Scalable**: Multi-network support, efficient fee structure

### For Agents
- **Monetizable**: Direct payment integration for AI services
- **Trustworthy**: On-chain identity and reputation systems
- **Autonomous**: Self-executing payment flows
- **Accountable**: Complete audit trail of all transactions

### For the Ecosystem
- **Standardized**: Built on Coinbase's official x402 protocol
- **Interoperable**: Works with any x402-compliant system
- **Sustainable**: Protocol fees fund continued development
- **Open**: MIT licensed, community-driven development

## Resources

- **ChaosChain SDK**: [PyPI](https://pypi.org/project/chaoschain-sdk/) | [GitHub](https://github.com/ChaosChain/chaoschain)
- **x402 Protocol**: [Official Site](https://www.x402.org/) | [Coinbase GitHub](https://github.com/coinbase/x402)
- **Documentation**: [ChaosChain Docs](https://docs.chaoscha.in)

## Contributing

We welcome contributions to improve x402 integration:

1. Fork the repository
2. Create a feature branch
3. Add tests for x402 functionality
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Building the future of verifiable, monetizable AI agents with Coinbase x402 protocol.**

*For questions about x402 integration, reach out to the ChaosChain team or join our Discord community.*
