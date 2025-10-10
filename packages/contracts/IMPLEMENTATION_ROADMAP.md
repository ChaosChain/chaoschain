# ChaosChain MVP v0.1 - Implementation Roadmap

**Status**: Implementing critical fixes based on architecture review

## ✅ Completed

1. **ERC-8004 v1 Interface** - Created `IERC8004IdentityV1.sol` with ERC-721 alignment
2. **EvidenceAnchored Event** - Added to `IRewardsDistributor.sol` 
3. **Scoring Library** - Created pure `Scoring.sol` library with dynamic dimensions

## 🚧 In Progress

### High Priority (MVP Blockers)

#### 4. EIP-712 Score Submission
**Status**: Next
**Files**: `RewardsDistributor.sol`, `StudioProxy.sol`
**Changes**:
- Add EIP-712 domain separator
- Add nonce tracking per validator
- Require signatures for `submitScoreVector()`
- Add replay protection

#### 5. ReentrancyGuard + Pull Payments
**Status**: Next
**Files**: `StudioProxy.sol`
**Changes**:
- Import OpenZeppelin `ReentrancyGuard`
- Add `nonReentrant` to `releaseFunds()`
- Implement `withdraw()` pull pattern
- Remove push payments in callbacks

#### 6. Refactor RewardsDistributor
**Status**: Next  
**Files**: `RewardsDistributor.sol`
**Changes**:
- Remove hardcoded `CRITERIA_COUNT = 5`
- Use `Scoring` library
- Make fully dynamic
- Emit `EvidenceAnchored` on consensus

### Medium Priority (High Leverage)

#### 7. Governance Wiring (UUPS + Timelock)
**Files**: New contracts + existing
**Changes**:
- Create `ChaosChainTimelock.sol`
- Add UUPS upgradeability to core contracts
- Add `VersionChanged` event
- Wire Safe multisig roles

#### 8. getScoringCriteria() 
**Files**: `LogicModule.sol`, `PredictionMarketLogic.sol`
**Changes**:
- Add abstract `getScoringCriteria()` to LogicModule
- Implement in PredictionMarketLogic
- Return names + weights for Explorer UI

### Low Priority (Nice to Have)

#### 9. Enhanced Test Suite
**Files**: `test/` directory
**Changes**:
- Deploy real ERC-8004 contracts from `/test-helpers/`
- Add invariant tests
- Add fuzz tests  
- Add upgrade simulation tests

#### 10. 0g Chain Configuration
**Files**: `foundry.toml`, `.env.template`, deployment scripts
**Changes**:
- Add 0g testnet RPC endpoints
- Add chain IDs
- Stub deployment configuration

## 📋 Implementation Order (Next 3 Hours)

### Batch 1: Security Critical (45 min)
1. EIP-712 score submission with nonces
2. ReentrancyGuard + pull payments
3. Refactor to use Scoring library

### Batch 2: Core Functionality (30 min)
4. Update RewardsDistributor to emit EvidenceAnchored
5. Remove CRITERIA_COUNT hardcoding
6. Add getScoringCriteria() to LogicModule

### Batch 3: Testing & Config (45 min)
7. Update tests to use real ERC-8004 contracts
8. Add basic invariant tests
9. Add 0g chain config

### Batch 4: Governance (Optional, 60 min)
10. UUPS upgradeability
11. Timelock integration
12. VersionChanged events

## 🎯 MVP Definition

**Minimum for testnet deployment:**
- ✅ All security fixes (Batch 1)
- ✅ Core functionality complete (Batch 2)
- ✅ Basic test coverage (Batch 3)
- ⚠️ Governance can be added in v0.2

## 📝 Notes

- **EIP-712**: Use `@openzeppelin/utils/cryptography/EIP712.sol`
- **ReentrancyGuard**: Use `@openzeppelin/utils/ReentrancyGuard.sol`
- **UUPS**: Use `@openzeppelin/proxy/utils/UUPSUpgradeable.sol`
- **Timelock**: Use `@openzeppelin/governance/TimelockController.sol`

## 🔗 References

- [ERC-8004 v1 Spec](../../ERC-8004-v1.md)
- [Protocol Spec](../../docs/protocol_spec_v0.1.md)
- [Architecture Notes](./ARCHITECTURE_NOTES.md)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/5.x/)

