# ChaosChain Architecture Notes & Design Decisions

## ERC-8004 Integration Strategy

### Question: Do we need our own interfaces for ERC-8004 contracts?

**Answer**: Yes, but minimal ones. Here's the best practice approach:

#### For Smart Contracts (Production):
- **Use minimal interfaces** - Only the functions we actually call
- **Reference deployed addresses** - Via environment variables
- **Don't import full implementations** - Keeps bytecode small and deployment gas low

**Why?**
```solidity
// ✅ GOOD: Minimal interface (what we have)
interface IERC8004Identity {
    function agentExists(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 agentId) external view returns (address);
}

// ❌ BAD: Importing full implementation
import {IdentityRegistry} from "erc8004-ri/IdentityRegistry.sol";
```

#### For SDK (Python):
- **Embed full ABIs** - Complete interaction capability
- **Use contract addresses from deployment** - Flexible across networks

#### For Local Testing:
- **Use actual ERC-8004 contracts** - Located in `/test-helpers/` 
- **Deploy mock registries in test setup** - Real behavior testing
- **This is what we should update our tests to do!**

### Recommendation:
Keep current minimal interfaces for production contracts, but update tests to deploy real ERC-8004 contracts from `/test-helpers/`.

---

## Scoring Dimensions Design Issue

### Problem Identified:
The current `RewardsDistributor` hardcodes 5 dimensions:
```solidity
uint256 private constant CRITERIA_COUNT = 5; 
// quality, initiative, collaboration, reasoning, compliance
```

**This is WRONG!** Different Studios need different scoring criteria.

### Correct Architecture:

#### Option 1: Dynamic Dimensions (Recommended)
Make `RewardsDistributor` fully generic:

```solidity
// RewardsDistributor should accept variable-length score vectors
function calculateConsensus(
    bytes32 dataHash,
    ScoreVector[] calldata scoreVectors
) external view returns (uint8[] memory consensusScores) {
    // Infer criteria count from first score vector
    uint256 criteriaCount = scoreVectors[0].scores.length;
    
    // All vectors must have same length
    for (uint256 i = 1; i < scoreVectors.length; i++) {
        require(
            scoreVectors[i].scores.length == criteriaCount,
            "Inconsistent score dimensions"
        );
    }
    
    // Calculate consensus for each dimension dynamically
    consensusScores = new uint8[](criteriaCount);
    for (uint256 d = 0; d < criteriaCount; d++) {
        consensusScores[d] = _calculateDimensionConsensus(scoreVectors, d);
    }
}
```

#### Option 2: Studio-Specific Configuration
Each Studio registers its scoring criteria:

```solidity
struct ScoringConfig {
    uint8 dimensionCount;
    string[] dimensionNames;
    uint8[] dimensionWeights;
}

mapping(address => ScoringConfig) public studioConfigs;

function registerStudioScoring(
    address studio,
    string[] calldata dimensionNames,
    uint8[] calldata weights
) external onlyStudioOwner(studio) {
    // Register studio-specific scoring criteria
}
```

### Example Use Cases:

#### Prediction Market Studio:
```javascript
dimensions = [
    "accuracy",      // Historical prediction accuracy
    "reasoning",     // Quality of justification
    "timeliness",    // Submitted before deadline
    "risk_calibration" // Confidence vs actual outcome
]
```

#### Code Audit Studio:
```javascript
dimensions = [
    "vulnerability_detection",
    "false_positive_rate", 
    "code_coverage",
    "report_clarity",
    "severity_assessment"
]
```

#### Trading Strategy Studio:
```javascript
dimensions = [
    "profitability",
    "risk_management",
    "market_timing",
    "execution_quality"
]
```

### Where Did 5 Dimensions Come From?

The 5 dimensions came from **§3.1 in protocol_spec_v0.1.md**:

> "Examples of dimensions (K≈4–8): quality, initiative, collaboration, reasoning depth, compliance, safety, efficiency."

However, this was meant as an **example**, not a hardcoded requirement. The spec explicitly says "K≈4–8" meaning variable!

### Recommendation:

**Option 1 (Dynamic) is better for MVP** because:
1. ✅ No configuration needed per Studio
2. ✅ Maximum flexibility
3. ✅ Simpler to implement
4. ✅ Works with any Studio type immediately

We should refactor `RewardsDistributor` to remove the hardcoded `CRITERIA_COUNT = 5`.

---

## Proposed Changes

### High Priority:
1. **Update `RewardsDistributor.sol`**: Remove hardcoded `CRITERIA_COUNT`, make dynamic
2. **Update tests**: Deploy real ERC-8004 contracts from `/test-helpers/`
3. **Update `PredictionMarketLogic`**: Define its own scoring criteria (4 dimensions, not 5)

### Medium Priority:
4. Add `getScoringCriteria()` function to LogicModules
5. Add Studio-specific scoring documentation
6. Create examples for different Studio types

### Low Priority:
7. Consider Option 2 (Studio-specific config) for v0.2 if needed
8. Add scoring criteria validation in `RewardsDistributor`

---

## Summary

1. **ERC-8004 Interfaces**: Current approach is correct for production, but we should use real contracts in tests
2. **5-Dimensional Scoring**: This is a bug - should be dynamic per Studio type
3. **Protocol Spec Alignment**: The spec says K≈4-8 (variable), not K=5 (fixed)

These changes will make the protocol truly flexible and production-ready for diverse Studio types.

