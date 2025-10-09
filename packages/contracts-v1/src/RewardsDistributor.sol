// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";
import {IChaosChainRegistry} from "./interfaces/IChaosChainRegistry.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";
import {IERC8004Validation} from "./interfaces/IERC8004Validation.sol";
import {StudioProxy} from "./StudioProxy.sol";

/**
 * @title RewardsDistributor
 * @notice Consensus engine and reward distribution for ChaosChain Studios
 * @dev See §2.2-2.5, §4 in protocol_spec_v0.1.md
 * 
 * The RewardsDistributor implements the core "brain" of ChaosChain:
 * 1. Robust Consensus: Stake-weighted MAD-based outlier detection (§2.2)
 * 2. Commit-Reveal: Prevents last-mover bias and copycatting (§2.4)
 * 3. Reward Distribution: Quality-based worker payments (§4.1)
 * 4. Validator Rewards/Slashing: Accuracy-based incentives (§4.3)
 * 
 * Mathematical Foundation:
 * - Per-dimension median + MAD for outlier detection
 * - Exponential reward curve: r_i ∝ e^(-β * E_i²)
 * - Quadratic slashing: slash_i ∝ max(0, E_i - τ)²
 * 
 * Security: Only authorized addresses can trigger epoch closure
 * 
 * @author ChaosChain Labs
 */
contract RewardsDistributor is Ownable, IRewardsDistributor {
    
    // ============ Constants ============
    
    /// @dev Precision for fixed-point math (6 decimals)
    uint256 private constant PRECISION = 1e6;
    
    /// @dev Maximum score value (100 with precision)
    uint256 private constant MAX_SCORE = 100 * PRECISION;
    
    /// @dev Number of scoring criteria (K dimensions)
    uint256 private constant CRITERIA_COUNT = 5; // quality, initiative, collaboration, reasoning, compliance
    
    // ============ State Variables ============
    
    /// @dev ChaosChainRegistry reference
    IChaosChainRegistry public immutable registry;
    
    /// @dev Consensus parameters (see §2.3)
    uint256 public alpha = 3 * PRECISION; // MAD multiplier for outlier detection
    uint256 public beta = 1 * PRECISION;  // Reward sharpness parameter
    uint256 public kappa = 2 * PRECISION; // Slashing severity parameter
    uint256 public tau = 10 * PRECISION;  // Error tolerance threshold
    
    /// @dev Consensus results storage (dataHash => ConsensusResult)
    mapping(bytes32 => ConsensusResult) private _consensusResults;
    
    /// @dev Processed score vectors (dataHash => validator => processed)
    mapping(bytes32 => mapping(address => bool)) private _processedVectors;
    
    // ============ Constructor ============
    
    /**
     * @dev Initialize with registry
     * @param registry_ The ChaosChainRegistry address
     */
    constructor(address registry_) Ownable(msg.sender) {
        require(registry_ != address(0), "Invalid registry");
        registry = IChaosChainRegistry(registry_);
    }
    
    // ============ Core Functions ============
    
    /// @inheritdoc IRewardsDistributor
    function closeEpoch(address studio, uint64 epoch) external override onlyOwner {
        require(studio != address(0), "Invalid studio");
        
        // TODO: Implement full epoch closure logic
        // This would:
        // 1. Collect all score vectors from Studio
        // 2. Run consensus calculation
        // 3. Distribute rewards to workers
        // 4. Distribute rewards/slashing to validators
        // 5. Publish to ERC-8004 ValidationRegistry
        
        emit EpochClosed(studio, epoch, 0, 0);
    }
    
    /// @inheritdoc IRewardsDistributor
    function calculateConsensus(
        bytes32 dataHash,
        ScoreVector[] calldata scoreVectors
    ) external view override returns (uint8[] memory consensusScores) {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(scoreVectors.length > 0, "No score vectors");
        
        // Initialize consensus scores array
        consensusScores = new uint8[](CRITERIA_COUNT);
        
        // Calculate consensus for each dimension
        for (uint256 d = 0; d < CRITERIA_COUNT; d++) {
            consensusScores[d] = _calculateDimensionConsensus(scoreVectors, d);
        }
        
        return consensusScores;
    }
    
    /// @inheritdoc IRewardsDistributor
    function getConsensusResult(bytes32 dataHash) external view override returns (ConsensusResult memory result) {
        result = _consensusResults[dataHash];
        require(result.timestamp != 0, "No consensus found");
        return result;
    }
    
    /// @inheritdoc IRewardsDistributor
    function setConsensusParameters(
        uint256 alpha_,
        uint256 beta_,
        uint256 kappa_,
        uint256 tau_
    ) external override onlyOwner {
        require(alpha_ > 0 && alpha_ <= 10 * PRECISION, "Invalid alpha");
        require(beta_ > 0 && beta_ <= 10 * PRECISION, "Invalid beta");
        require(kappa_ > 0 && kappa_ <= 10 * PRECISION, "Invalid kappa");
        require(tau_ > 0 && tau_ <= 100 * PRECISION, "Invalid tau");
        
        alpha = alpha_;
        beta = beta_;
        kappa = kappa_;
        tau = tau_;
    }
    
    // ============ Internal Consensus Logic ============
    
    /**
     * @dev Calculate consensus for a single dimension using robust aggregation
     * @dev See §2.2 in protocol_spec_v0.1.md
     * @param scoreVectors All submitted score vectors
     * @param dimension The dimension index (0 to K-1)
     * @return consensusScore The consensus score for this dimension
     */
    function _calculateDimensionConsensus(
        ScoreVector[] calldata scoreVectors,
        uint256 dimension
    ) internal view returns (uint8 consensusScore) {
        uint256 n = scoreVectors.length;
        require(n > 0, "No scores");
        
        // Step 1: Extract scores for this dimension
        uint256[] memory scores = new uint256[](n);
        uint256[] memory stakes = new uint256[](n);
        uint256 totalStake = 0;
        
        for (uint256 i = 0; i < n; i++) {
            require(scoreVectors[i].scores.length == CRITERIA_COUNT, "Invalid score count");
            scores[i] = uint256(scoreVectors[i].scores[dimension]) * PRECISION;
            stakes[i] = scoreVectors[i].stake;
            totalStake += stakes[i];
        }
        
        // Step 2: Calculate median (weighted by stake)
        uint256 median = _calculateWeightedMedian(scores, stakes, totalStake);
        
        // Step 3: Calculate MAD (Median Absolute Deviation)
        uint256 mad = _calculateMAD(scores, stakes, totalStake, median);
        
        // Step 4: Identify inliers using MAD-based threshold
        // inlier if: |score - median| <= alpha * max(MAD, epsilon)
        uint256 threshold = (alpha * _max(mad, 1000)) / PRECISION; // epsilon = 1000 (0.001 in precision)
        
        uint256 inlierSum = 0;
        uint256 inlierStake = 0;
        
        for (uint256 i = 0; i < n; i++) {
            uint256 deviation = _abs(int256(scores[i]) - int256(median));
            if (deviation <= threshold) {
                inlierSum += scores[i] * stakes[i];
                inlierStake += stakes[i];
            }
        }
        
        // Step 5: Stake-weighted average of inliers
        if (inlierStake > 0) {
            consensusScore = uint8((inlierSum / inlierStake) / PRECISION);
        } else {
            // Fallback to median if no inliers (shouldn't happen with proper alpha)
            consensusScore = uint8(median / PRECISION);
        }
        
        // Ensure score is in valid range [0, 100]
        if (consensusScore > 100) consensusScore = 100;
        
        return consensusScore;
    }
    
    /**
     * @dev Calculate weighted median
     * @param values The values array
     * @param weights The weights array
     * @param totalWeight Sum of all weights
     * @return median The weighted median
     */
    function _calculateWeightedMedian(
        uint256[] memory values,
        uint256[] memory weights,
        uint256 totalWeight
    ) internal pure returns (uint256 median) {
        uint256 n = values.length;
        
        // Simple bubble sort (ok for small n in MVP)
        // TODO: Optimize with quickselect for production
        for (uint256 i = 0; i < n - 1; i++) {
            for (uint256 j = 0; j < n - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    // Swap values
                    (values[j], values[j + 1]) = (values[j + 1], values[j]);
                    // Swap corresponding weights
                    (weights[j], weights[j + 1]) = (weights[j + 1], weights[j]);
                }
            }
        }
        
        // Find weighted median
        uint256 cumWeight = 0;
        uint256 targetWeight = totalWeight / 2;
        
        for (uint256 i = 0; i < n; i++) {
            cumWeight += weights[i];
            if (cumWeight >= targetWeight) {
                return values[i];
            }
        }
        
        return values[n - 1]; // Fallback
    }
    
    /**
     * @dev Calculate Median Absolute Deviation (MAD)
     * @param values The values array
     * @param weights The weights array
     * @param totalWeight Sum of all weights
     * @param median The median value
     * @return mad The MAD value
     */
    function _calculateMAD(
        uint256[] memory values,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 median
    ) internal pure returns (uint256 mad) {
        uint256 n = values.length;
        
        // Calculate absolute deviations
        uint256[] memory deviations = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            deviations[i] = _abs(int256(values[i]) - int256(median));
        }
        
        // Return weighted median of deviations
        return _calculateWeightedMedian(deviations, weights, totalWeight);
    }
    
    // ============ Helper Functions ============
    
    /**
     * @dev Absolute value for signed integers
     */
    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
    
    /**
     * @dev Maximum of two values
     */
    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}

