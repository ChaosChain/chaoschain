// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProtocolConstants
 * @notice Universal constants for the ChaosChain protocol
 * @dev Defines protocol-level PoA dimensions and other shared constants
 * 
 * Universal Proof of Agency (PoA) Dimensions:
 * These 5 dimensions are evaluated for ALL work across ALL Studios.
 * They measure the fundamental qualities of autonomous agency.
 * 
 * Studio-specific dimensions are defined in each LogicModule implementation.
 * 
 * @author ChaosChain Labs
 */
library ProtocolConstants {
    
    // ============ Universal PoA Dimensions ============
    
    /**
     * @notice Initiative - Original, proactive contributions
     * @dev Measures non-reply messages, original ideas, task initiation
     * Score 0-100: Higher = more original contributions
     */
    bytes32 public constant POA_INITIATIVE = bytes32("INITIATIVE");
    
    /**
     * @notice Collaboration - Helping others, building on ideas
     * @dev Measures reply/extend edges, collaborative behavior
     * Score 0-100: Higher = more collaborative
     */
    bytes32 public constant POA_COLLABORATION = bytes32("COLLABORATION");
    
    /**
     * @notice Reasoning Depth - Problem-solving sophistication
     * @dev Measures path length in DAG, reasoning chains
     * Score 0-100: Higher = deeper reasoning
     */
    bytes32 public constant POA_REASONING_DEPTH = bytes32("REASONING_DEPTH");
    
    /**
     * @notice Compliance - Following rules and policies
     * @dev Measures adherence to Studio policies, protocol rules
     * Score 0-100: Higher = better compliance
     */
    bytes32 public constant POA_COMPLIANCE = bytes32("COMPLIANCE");
    
    /**
     * @notice Efficiency - Time management and speed
     * @dev Measures task completion time, responsiveness
     * Score 0-100: Higher = faster/more efficient
     */
    bytes32 public constant POA_EFFICIENCY = bytes32("EFFICIENCY");
    
    // ============ Default PoA Dimension Names ============
    
    /**
     * @notice Get default PoA dimension names
     * @return names Array of 5 universal PoA dimension names
     */
    function getDefaultPoADimensions() internal pure returns (string[] memory names) {
        names = new string[](5);
        names[0] = "Initiative";
        names[1] = "Collaboration";
        names[2] = "Reasoning Depth";
        names[3] = "Compliance";
        names[4] = "Efficiency";
        return names;
    }
    
    /**
     * @notice Get default PoA dimension weights
     * @return weights Array of 5 weights (100 = 1.0x)
     */
    function getDefaultPoAWeights() internal pure returns (uint16[] memory weights) {
        weights = new uint16[](5);
        weights[0] = 100; // Initiative: 1.0x
        weights[1] = 100; // Collaboration: 1.0x
        weights[2] = 100; // Reasoning Depth: 1.0x
        weights[3] = 100; // Compliance: 1.0x
        weights[4] = 100; // Efficiency: 1.0x
        return weights;
    }
    
    // ============ Protocol Version ============
    
    /**
     * @notice Protocol version
     * @dev Semantic versioning: MAJOR.MINOR.PATCH
     */
    string public constant PROTOCOL_VERSION = "0.1.0";
    
    /**
     * @notice Minimum score vector length (5 universal PoA dimensions)
     * @dev Studios can add more dimensions, but must include these 5
     */
    uint8 public constant MIN_SCORE_VECTOR_LENGTH = 5;
}

