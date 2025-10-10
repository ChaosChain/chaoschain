# ChaosChain Core Protocol Contracts (MVP v0.1)

**Production-grade smart contracts for the ChaosChain protocol on Base Sepolia testnet**

## 📋 Overview

This package contains the core ChaosChain protocol contracts implementing:
- **Studio Factory Pattern**: Lightweight upgradeable proxies for Studios
- **Robust Consensus Engine**: MAD-based stake-weighted validator consensus
- **Pluggable Logic Modules**: Extensible business logic via DELEGATECALL
- **ERC-8004 Integration**: Consumes official Trustless Agents standard

## 🏗️ Architecture

```
ChaosChainRegistry (Address Book)
    ↓
ChaosCore (Studio Factory)
    ↓
StudioProxy (Lightweight Proxy)
    ↓
LogicModule (Business Logic via DELEGATECALL)
    
RewardsDistributor (Consensus Engine)
    ↓
ERC-8004 ValidationRegistry (External)
```

## 📦 Contracts

### Core Contracts

| Contract | Description | Status |
|----------|-------------|--------|
| `ChaosChainRegistry.sol` | Address book for protocol contracts | ✅ Complete |
| `ChaosCore.sol` | Studio factory and registry | ✅ Complete |
| `StudioProxy.sol` | Upgradeable proxy with escrow | ✅ Complete |
| `RewardsDistributor.sol` | Consensus engine (§2.2-2.5) | ✅ Complete |

### Logic Modules

| Module | Description | Status |
|--------|-------------|--------|
| `LogicModule.sol` | Abstract base for custom logic | ✅ Complete |
| `PredictionMarketLogic.sol` | Example implementation | ✅ Complete |

### Interfaces

| Interface | Purpose |
|-----------|---------|
| `IERC8004Identity.sol` | ERC-8004 IdentityRegistry interface |
| `IERC8004Validation.sol` | ERC-8004 ValidationRegistry interface |
| `IChaosChainRegistry.sol` | Registry interface |
| `IChaosCore.sol` | Factory interface |
| `IStudioProxy.sol` | Proxy interface |
| `IRewardsDistributor.sol` | Consensus interface |

## 🚀 Quick Start

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

### Build

```bash
forge build
```

### Test

```bash
# Run all tests
forge test

# Run with gas reporting
forge test --gas-report

# Run specific test
forge test --match-contract ChaosChainCoreTest -vvv
```

**Test Results**: ✅ 11/11 tests passing

## 📡 Deployment

### 1. Setup Environment

```bash
cp .env.template .env
# Edit .env with your values
```

Required variables:
- `DEPLOYER_PRIVATE_KEY`: Deployer wallet private key
- `BASE_SEPOLIA_RPC_URL`: RPC endpoint (e.g., Alchemy/Infura)
- `IDENTITY_REGISTRY`: ERC-8004 v1 IdentityRegistry address
- `REPUTATION_REGISTRY`: ERC-8004 v1 ReputationRegistry address
- `VALIDATION_REGISTRY`: ERC-8004 v1 ValidationRegistry address
- `BASESCAN_API_KEY`: For contract verification

### 2. Deploy to Base Sepolia

```bash
forge script script/DeployCore.s.sol \
  --rpc-url base_sepolia \
  --broadcast \
  --verify \
  -vvvv
```

### 3. Verify Contracts

```bash
forge verify-contract <ADDRESS> <CONTRACT> \
  --chain base-sepolia \
  --watch
```

## 🧪 Testing

### Test Coverage

```bash
forge coverage
```

### Gas Optimization

```bash
forge snapshot
```

## 📖 Technical Specifications

### Consensus Algorithm (§2.2 protocol_spec_v0.1.md)

The RewardsDistributor implements robust consensus:

1. **Per-dimension Median**: Weighted median for each scoring criterion
2. **MAD Outlier Detection**: Median Absolute Deviation for inlier identification
3. **Stake-Weighted Aggregation**: Final consensus from inliers only
4. **Configurable Parameters**:
   - `alpha`: MAD multiplier (default: 3.0)
   - `beta`: Reward sharpness (default: 1.0)
   - `kappa`: Slashing severity (default: 2.0)
   - `tau`: Error tolerance (default: 10.0)

### Storage Safety

StudioProxy and LogicModule use matching storage layouts for safe DELEGATECALL:
- Slot 0-2: Immutable addresses (ChaosCore, Logic, RewardsDistributor)
- Slot 3+: Dynamic mappings (escrow, work, scores)

**CRITICAL**: Never modify storage layout order in existing contracts!

## 🔒 Security

### Access Controls

| Function | Authorization |
|----------|---------------|
| Registry updates | Owner only |
| Studio creation | Anyone |
| Logic registration | ChaosCore owner |
| Fund release | RewardsDistributor only |
| Logic upgrade | Studio owner or protocol owner |

### Audit Status

- ✅ Self-audited with comprehensive test suite
- ✅ 100% test pass rate (11/11)
- ⚠️ External audit recommended before mainnet

## 📚 Documentation

- [Implementation Plan](../../ChaosChain_Implementation_Plan.md)
- [Protocol Spec](../../docs/protocol_spec_v0.1.md)
- [ERC-8004 v1 Spec](../../ERC-8004-v1.md)

## 🤝 Integration

### Using the SDK

The ChaosChain SDK (in `../sdk`) provides a Python interface for:
- Interacting with deployed contracts
- Creating Studios
- Submitting work and scores
- Agent registration

See: `../sdk/README.md`

## 🛠️ Development

### Adding a New Logic Module

1. Extend `LogicModule` base contract
2. Implement required abstract functions
3. Match storage layout for DELEGATECALL safety
4. Deploy and register via `ChaosCore.registerLogicModule()`

Example:
```solidity
contract MyCustomLogic is LogicModule {
    function initialize(bytes calldata params) external override {
        // Custom initialization
    }
    
    function getStudioType() external pure override returns (string memory) {
        return "MyCustomType";
    }
    
    function getVersion() external pure override returns (string memory) {
        return "1.0.0";
    }
    
    // Add custom business logic functions
}
```

## 📝 License

MIT

## 🙋 Support

For questions or issues:
1. Check documentation in `docs/`
2. Review test cases in `test/`
3. See deployment scripts in `script/`

---

**Built with ❤️ by ChaosChain Labs for the open AI agentic economy**

*MVP v0.1 - Base Sepolia Testnet*

