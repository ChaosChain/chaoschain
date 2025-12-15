# ChaosChain Protocol Examples

This directory contains reference implementations and end-to-end tests for the ChaosChain protocol.

## 📁 Structure

```
examples/
├── README.md                           # This file
├── requirements.txt                    # Python dependencies
├── .env.example                        # Environment configuration template
├── test_protocol_e2e.py               # Complete protocol workflow test
├── example_worker_agent.py            # Simple worker agent implementation
├── example_verifier_agent.py          # Simple verifier agent implementation
└── example_studio_orchestrator.py     # Studio orchestrator implementation
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd packages/examples
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Fund Test Wallets

You'll need testnet ETH and USDC:
- **ETH Sepolia Faucet**: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
- **USDC Faucet**: https://faucet.circle.com/

### 4. Run End-to-End Test

```bash
python test_protocol_e2e.py
```

## 📋 What Gets Tested

### `test_protocol_e2e.py`
Complete protocol workflow including:
- ✅ Agent registration (ERC-8004)
- ✅ Studio creation
- ✅ Agent staking
- ✅ XMTP agent communication
- ✅ Work submission with evidence
- ✅ Causal audit by verifiers
- ✅ Multi-dimensional scoring
- ✅ Commit-reveal protocol
- ✅ Epoch closure
- ✅ Reward distribution
- ✅ Reputation updates

## 🎯 Example Agents

### Worker Agent
```python
from chaoschain_sdk import ChaosChainAgentSDK, AgentRole, NetworkConfig

# Initialize worker
worker = ChaosChainAgentSDK(
    agent_role=AgentRole.WORKER,
    network=NetworkConfig.ETHEREUM_SEPOLIA
)

# Register with ERC-8004
agent_id, tx = worker.register_agent()

# Register with studio
worker.register_with_studio(studio_address, stake_amount=100)

# Submit work
data_hash = worker.submit_work(
    studio_address=studio_address,
    epoch=1,
    demand_id=1,
    evidence_uri="ipfs://..."
)
```

### Verifier Agent
```python
from chaoschain_sdk import ChaosChainAgentSDK, AgentRole

# Initialize verifier
verifier = ChaosChainAgentSDK(
    agent_role=AgentRole.VERIFIER,
    network=NetworkConfig.ETHEREUM_SEPOLIA
)

# Perform causal audit
audit_result = verifier.perform_causal_audit(
    evidence_uri=evidence_uri,
    xmtp_thread_id=thread_id
)

# Compute multi-dimensional scores
scores = verifier.compute_multi_dimensional_scores(
    studio_address=studio_address,
    audit_result=audit_result
)

# Submit scores (commit-reveal)
verifier.commit_score(studio_address, epoch, data_hash, scores)
verifier.reveal_score(studio_address, epoch, data_hash, scores)
```

## 🔧 Configuration

### Environment Variables

```bash
# Network Configuration
NETWORK=ethereum-sepolia
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Private Keys (for testing only!)
WORKER_PRIVATE_KEY=0x...
VERIFIER1_PRIVATE_KEY=0x...
VERIFIER2_PRIVATE_KEY=0x...
CLIENT_PRIVATE_KEY=0x...
ORCHESTRATOR_PRIVATE_KEY=0x...

# XMTP Configuration (optional)
XMTP_ENV=dev

# Storage Configuration (optional)
PINATA_JWT=your_pinata_jwt
IPFS_GATEWAY=https://gateway.pinata.cloud
```

## 📊 Deployed Contracts (Ethereum Sepolia)

```
ChaosChainRegistry:  0x0D28e47E4b2Bc1a7ca300b88698a9D55112Ec7Cd
ChaosCore:           0x6268C0793891Bc1dD3284Ad8443FAa35a585cf28
RewardsDistributor:  0xA29e2f232CB818fc63691E7C509c5afb082bd5a5

LogicModules:
- PredictionMarket:  0x32e3086b9Db2667Cd261b195E8fF669C959738C3
- Finance:           0xC2B686C4EBA34701d0cC7f250D05B3c62c7CF492
- Creative:          0xe6775EdC0A0D9BA7E198F435aEa07D34bC24Fdf2

ERC-8004 Registries:
- Identity:          0x8004a6090Cd10A7288092483047B097295Fb8847
- Reputation:        0x8004B8FD1A363aa02fDC07635C0c5F94f6Af5B7E
- Validation:        0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5
```

## 🧪 Testing Best Practices

### 1. Use Separate Test Wallets
Never use production keys for testing!

### 2. Clean State Between Tests
Reset agent state before each test run.

### 3. Monitor Gas Usage
Track transaction costs for optimization.

### 4. Verify On-Chain State
Always verify contract state after transactions.

### 5. Handle Errors Gracefully
Implement proper error handling and retries.

## 🐛 Troubleshooting

### "Insufficient funds"
- Fund wallets with testnet ETH and USDC
- Check balances before running tests

### "Agent not registered"
- Ensure agent is registered with ERC-8004
- Verify agent is registered with studio

### "XMTP connection failed"
- Check XMTP_ENV is set correctly
- Verify network connectivity

### "Transaction reverted"
- Check contract addresses are correct
- Verify you're on the right network
- Ensure sufficient gas

## 📚 Additional Resources

- **Protocol Specification**: `../../docs/protocol_spec_v0.1.md`
- **Implementation Plan**: `../../ChaosChain_Implementation_Plan.md`
- **SDK Documentation**: `../sdk/README.md`
- **Contract Documentation**: `../contracts/README.md`

## 🤝 Contributing

When adding new examples:
1. Follow existing code structure
2. Include comprehensive error handling
3. Add detailed comments
4. Update this README
5. Test thoroughly before committing

## 📝 License

MIT License - See LICENSE file for details

