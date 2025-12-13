// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LogicModule} from "../base/LogicModule.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/**
 * @title FinanceStudioLogic
 * @notice Example LogicModule for Finance/Trading Studios
 * @dev Demonstrates how to extend universal PoA dimensions with domain-specific criteria
 * 
 * This Studio type is designed for financial analysis, trading, and risk assessment tasks.
 * 
 * Scoring Dimensions (8 total):
 * - 5 Universal PoA: Initiative, Collaboration, Reasoning Depth, Compliance, Efficiency
 * - 3 Finance-Specific: Accuracy, Risk Assessment, Documentation
 * 
 * Key Features:
 * - Emphasizes Compliance (1.5x) for regulatory requirements
 * - Prioritizes Accuracy (2.0x) for financial correctness
 * - Values Risk Assessment (1.5x) for safe trading
 * 
 * @author ChaosChain Labs
 */
contract FinanceStudioLogic is LogicModule {
    
    // ============ Studio Configuration ============
    
    /// @dev Studio type identifier
    string private constant STUDIO_TYPE = "Finance";
    
    /// @dev Logic module version
    string private constant VERSION = "1.0.0";
    
    // ============ Initialization ============
    
    /**
     * @notice Initialize Finance Studio with custom parameters
     * @param params ABI-encoded initialization parameters
     * 
     * Expected params structure:
     * - minStake: Minimum stake required for agents
     * - riskTolerance: Risk tolerance level (0-100)
     * - complianceLevel: Required compliance level (0-100)
     */
    function initialize(bytes calldata params) external override {
        // Decode params
        (uint256 minStake, uint8 riskTolerance, uint8 complianceLevel) = abi.decode(
            params,
            (uint256, uint8, uint8)
        );
        
        // Validate params
        require(minStake > 0, "Invalid minStake");
        require(riskTolerance <= 100, "Invalid riskTolerance");
        require(complianceLevel <= 100, "Invalid complianceLevel");
        
        // Store configuration (would be stored in proxy storage)
        // For this example, we just emit an event
        emit LogicExecuted("initialize", msg.sender, params);
    }
    
    // ============ Studio Metadata ============
    
    /**
     * @notice Get Studio type identifier
     * @return studioType "Finance"
     */
    function getStudioType() external pure override returns (string memory studioType) {
        return STUDIO_TYPE;
    }
    
    /**
     * @notice Get Studio version
     * @return version "1.0.0"
     */
    function getVersion() external pure override returns (string memory version) {
        return VERSION;
    }
    
    /**
     * @notice Get scoring criteria for Finance Studio
     * @dev Combines 5 universal PoA dimensions + 3 finance-specific dimensions
     * 
     * Dimension Breakdown:
     * 1-5: Universal PoA (Initiative, Collaboration, Reasoning Depth, Compliance, Efficiency)
     * 6: Accuracy - Correctness of financial analysis/predictions
     * 7: Risk Assessment - Quality of risk evaluation
     * 8: Documentation - Clarity and completeness of reports
     * 
     * Weight Strategy:
     * - Accuracy (2.0x): Most critical for financial correctness
     * - Compliance (1.5x): Critical for regulatory requirements
     * - Risk Assessment (1.5x): Important for safe trading
     * - Documentation (1.2x): Important for audit trails
     * - Efficiency (0.8x): Less critical than accuracy
     * 
     * @return names Array of 8 dimension names
     * @return weights Array of 8 weights (100 = 1.0x)
     */
    function getScoringCriteria() external pure override returns (
        string[] memory names,
        uint16[] memory weights
    ) {
        // Total: 5 universal + 3 finance-specific = 8 dimensions
        names = new string[](8);
        weights = new uint16[](8);
        
        // Universal PoA dimensions (REQUIRED)
        names[0] = "Initiative";
        names[1] = "Collaboration";
        names[2] = "Reasoning Depth";
        names[3] = "Compliance";
        names[4] = "Efficiency";
        
        // Finance-specific dimensions
        names[5] = "Accuracy";
        names[6] = "Risk Assessment";
        names[7] = "Documentation";
        
        // Weights (100 = 1.0x)
        weights[0] = 100; // Initiative: 1.0x (standard)
        weights[1] = 100; // Collaboration: 1.0x (standard)
        weights[2] = 100; // Reasoning Depth: 1.0x (standard)
        weights[3] = 150; // Compliance: 1.5x (CRITICAL for finance!)
        weights[4] = 80;  // Efficiency: 0.8x (less critical than accuracy)
        weights[5] = 200; // Accuracy: 2.0x (MOST CRITICAL!)
        weights[6] = 150; // Risk Assessment: 1.5x (very important)
        weights[7] = 120; // Documentation: 1.2x (important for audit)
        
        return (names, weights);
    }
    
    // ============ Finance-Specific Business Logic ============
    
    /**
     * @notice Submit a financial analysis
     * @dev Example of domain-specific function
     * @param dataHash Hash of the analysis evidence
     * @param prediction Predicted outcome (e.g., price, trend)
     * @param confidence Confidence level (0-100)
     */
    function submitAnalysis(
        bytes32 dataHash,
        int256 prediction,
        uint8 confidence
    ) external hasEscrow(0.001 ether) {
        require(confidence <= 100, "Invalid confidence");
        
        // Record work
        _recordWork(dataHash, msg.sender);
        
        // Emit event with analysis details
        bytes memory analysisData = abi.encode(prediction, confidence);
        emit LogicExecuted("submitAnalysis", msg.sender, analysisData);
    }
    
    /**
     * @notice Submit a risk assessment
     * @dev Example of domain-specific function
     * @param dataHash Hash of the risk assessment evidence
     * @param riskScore Risk score (0-100, higher = riskier)
     * @param mitigationStrategy IPFS CID of mitigation strategy
     */
    function submitRiskAssessment(
        bytes32 dataHash,
        uint8 riskScore,
        string calldata mitigationStrategy
    ) external hasEscrow(0.001 ether) {
        require(riskScore <= 100, "Invalid riskScore");
        require(bytes(mitigationStrategy).length > 0, "Empty mitigation");
        
        // Record work
        _recordWork(dataHash, msg.sender);
        
        // Emit event with risk assessment details
        bytes memory riskData = abi.encode(riskScore, mitigationStrategy);
        emit LogicExecuted("submitRiskAssessment", msg.sender, riskData);
    }
}

