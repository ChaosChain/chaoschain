// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Scoring
 * @notice Pure library for robust consensus calculation with MAD-based outlier filtering
 * @dev See §2.2 in protocol_spec_v0.1.md
 * 
 * This library is pure and unit-testable, making it easy for LogicModules
 * to verify consensus behavior without deploying full protocol.
 * 
 * Algorithm:
 * 1. Calculate weighted median per dimension
 * 2. Calculate MAD (Median Absolute Deviation)
 * 3. Identify inliers using alpha * MAD threshold
 * 4. Return stake-weighted mean of inliers
 * 
 * @author ChaosChain Labs
 */
library Scoring {
    
    // ============ Constants ============
    
    /// @dev Precision for fixed-point math (6 decimals)
    uint256 internal constant PRECISION = 1e6;
    
    /// @dev Minimum epsilon for MAD calculations
    uint256 internal constant EPSILON = 1000; // 0.001 in precision
    
    // ============ Structs ============
    
    /**
     * @dev Consensus parameters
     */
    struct Params {
        uint256 alpha;  // MAD multiplier for outlier detection (e.g., 3 * PRECISION)
        uint256 beta;   // Reward sharpness (unused in consensus, kept for compatibility)
        uint256 kappa;  // Slashing severity (unused in consensus)
        uint256 tau;    // Error tolerance (unused in consensus)
    }
    
    // ============ Main Consensus Function ============
    
    /**
     * @notice Calculate consensus scores using robust MAD-based aggregation
     * @dev Fully dynamic - works with any number of dimensions
     * @param scores Score matrix: scores[validator][dimension]
     * @param stakes Stake vector: stakes[validator]
     * @param params Consensus parameters (mainly alpha)
     * @return consensusScores Consensus score for each dimension (0-100)
     */
    function consensus(
        uint8[][] memory scores,
        uint256[] memory stakes,
        Params memory params
    ) internal pure returns (uint8[] memory consensusScores) {
        uint256 validatorCount = scores.length;
        require(validatorCount > 0, "No scores provided");
        require(validatorCount == stakes.length, "Scores/stakes length mismatch");
        
        // Infer dimension count from first score vector
        uint256 dimensionCount = scores[0].length;
        require(dimensionCount > 0, "No dimensions");
        
        // Validate all vectors have same dimension count
        for (uint256 i = 1; i < validatorCount; i++) {
            require(
                scores[i].length == dimensionCount,
                "Inconsistent score dimensions"
            );
        }
        
        // Calculate total stake
        uint256 totalStake = 0;
        for (uint256 i = 0; i < validatorCount; i++) {
            require(stakes[i] > 0, "Zero stake not allowed");
            totalStake += stakes[i];
        }
        
        // Calculate consensus for each dimension
        consensusScores = new uint8[](dimensionCount);
        for (uint256 d = 0; d < dimensionCount; d++) {
            consensusScores[d] = _calculateDimensionConsensus(
                scores,
                stakes,
                totalStake,
                d,
                params.alpha
            );
        }
        
        return consensusScores;
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Calculate consensus for a single dimension
     * @param scores Full score matrix
     * @param stakes Stake vector
     * @param totalStake Sum of all stakes
     * @param dimension Which dimension to process
     * @param alpha MAD multiplier
     * @return consensusScore The consensus score (0-100)
     */
    function _calculateDimensionConsensus(
        uint8[][] memory scores,
        uint256[] memory stakes,
        uint256 totalStake,
        uint256 dimension,
        uint256 alpha
    ) internal pure returns (uint8 consensusScore) {
        uint256 n = scores.length;
        
        // Step 1: Extract scores for this dimension with precision
        uint256[] memory dimScores = new uint256[](n);
        uint256[] memory dimStakes = new uint256[](n);
        
        for (uint256 i = 0; i < n; i++) {
            dimScores[i] = uint256(scores[i][dimension]) * PRECISION;
            dimStakes[i] = stakes[i];
        }
        
        // Step 2: Calculate weighted median
        uint256 median = _calculateWeightedMedian(dimScores, dimStakes, totalStake);
        
        // Step 3: Calculate MAD
        uint256 mad = _calculateMAD(dimScores, dimStakes, totalStake, median);
        
        // Step 4: Identify inliers
        uint256 threshold = (alpha * _max(mad, EPSILON)) / PRECISION;
        
        uint256 inlierSum = 0;
        uint256 inlierStake = 0;
        
        for (uint256 i = 0; i < n; i++) {
            uint256 deviation = _abs(int256(dimScores[i]) - int256(median));
            if (deviation <= threshold) {
                inlierSum += dimScores[i] * dimStakes[i];
                inlierStake += dimStakes[i];
            }
        }
        
        // Step 5: Stake-weighted average of inliers
        if (inlierStake > 0) {
            consensusScore = uint8((inlierSum / inlierStake) / PRECISION);
        } else {
            // Fallback to median if no inliers (rare with proper alpha)
            consensusScore = uint8(median / PRECISION);
        }
        
        // Ensure score is in valid range
        if (consensusScore > 100) consensusScore = 100;
        
        return consensusScore;
    }
    
    /**
     * @dev Calculate weighted median using bubble sort (ok for small n)
     * @dev TODO: Optimize with quickselect for production if n > 20
     */
    function _calculateWeightedMedian(
        uint256[] memory values,
        uint256[] memory weights,
        uint256 totalWeight
    ) internal pure returns (uint256 median) {
        uint256 n = values.length;
        
        // Bubble sort (simple for MVP, optimize later)
        for (uint256 i = 0; i < n - 1; i++) {
            for (uint256 j = 0; j < n - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    (values[j], values[j + 1]) = (values[j + 1], values[j]);
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
        
        return values[n - 1];
    }
    
    /**
     * @dev Calculate Median Absolute Deviation
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

