// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LogicModule} from "../base/LogicModule.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/**
 * @title CreativeStudioLogic
 * @notice Example LogicModule for Creative/Design Studios
 * @dev Demonstrates domain-specific scoring for creative work
 * 
 * This Studio type is designed for creative tasks: design, content creation, art, etc.
 * 
 * Scoring Dimensions (8 total):
 * - 5 Universal PoA: Initiative, Collaboration, Reasoning Depth, Compliance, Efficiency
 * - 3 Creative-Specific: Originality, Aesthetic Quality, Brand Alignment
 * 
 * Key Features:
 * - Emphasizes Originality (2.0x) for creative uniqueness
 * - Prioritizes Aesthetic Quality (1.8x) for visual/artistic excellence
 * - Values Initiative (1.5x) for proactive creativity
 * 
 * @author ChaosChain Labs
 */
contract CreativeStudioLogic is LogicModule {
    
    // ============ Studio Configuration ============
    
    /// @dev Studio type identifier
    string private constant STUDIO_TYPE = "Creative";
    
    /// @dev Logic module version
    string private constant VERSION = "1.0.0";
    
    // ============ Initialization ============
    
    /**
     * @notice Initialize Creative Studio with custom parameters
     * @param params ABI-encoded initialization parameters
     * 
     * Expected params structure:
     * - minStake: Minimum stake required for agents
     * - brandGuidelinesUri: IPFS CID of brand guidelines
     * - qualityThreshold: Minimum quality score (0-100)
     */
    function initialize(bytes calldata params) external override {
        // Decode params
        (uint256 minStake, string memory brandGuidelinesUri, uint8 qualityThreshold) = abi.decode(
            params,
            (uint256, string, uint8)
        );
        
        // Validate params
        require(minStake > 0, "Invalid minStake");
        require(bytes(brandGuidelinesUri).length > 0, "Empty brandGuidelines");
        require(qualityThreshold <= 100, "Invalid qualityThreshold");
        
        // Store configuration (would be stored in proxy storage)
        emit LogicExecuted("initialize", msg.sender, params);
    }
    
    // ============ Studio Metadata ============
    
    /**
     * @notice Get Studio type identifier
     * @return studioType "Creative"
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
     * @notice Get scoring criteria for Creative Studio
     * @dev Combines 5 universal PoA dimensions + 3 creative-specific dimensions
     * 
     * Dimension Breakdown:
     * 1-5: Universal PoA (Initiative, Collaboration, Reasoning Depth, Compliance, Efficiency)
     * 6: Originality - Creative uniqueness and innovation
     * 7: Aesthetic Quality - Visual/artistic excellence
     * 8: Brand Alignment - Consistency with brand guidelines
     * 
     * Weight Strategy:
     * - Originality (2.0x): Most critical for creative work
     * - Aesthetic Quality (1.8x): Very important for visual appeal
     * - Initiative (1.5x): Important for proactive creativity
     * - Brand Alignment (1.2x): Important for client satisfaction
     * - Compliance (0.8x): Less critical than creativity
     * 
     * @return names Array of 8 dimension names
     * @return weights Array of 8 weights (100 = 1.0x)
     */
    function getScoringCriteria() external pure override returns (
        string[] memory names,
        uint16[] memory weights
    ) {
        // Total: 5 universal + 3 creative-specific = 8 dimensions
        names = new string[](8);
        weights = new uint16[](8);
        
        // Universal PoA dimensions (REQUIRED)
        names[0] = "Initiative";
        names[1] = "Collaboration";
        names[2] = "Reasoning Depth";
        names[3] = "Compliance";
        names[4] = "Efficiency";
        
        // Creative-specific dimensions
        names[5] = "Originality";
        names[6] = "Aesthetic Quality";
        names[7] = "Brand Alignment";
        
        // Weights (100 = 1.0x)
        weights[0] = 150; // Initiative: 1.5x (important for creativity!)
        weights[1] = 100; // Collaboration: 1.0x (standard)
        weights[2] = 100; // Reasoning Depth: 1.0x (standard)
        weights[3] = 80;  // Compliance: 0.8x (less critical than creativity)
        weights[4] = 100; // Efficiency: 1.0x (standard)
        weights[5] = 200; // Originality: 2.0x (MOST CRITICAL!)
        weights[6] = 180; // Aesthetic Quality: 1.8x (very important!)
        weights[7] = 120; // Brand Alignment: 1.2x (important)
        
        return (names, weights);
    }
    
    // ============ Creative-Specific Business Logic ============
    
    /**
     * @notice Submit creative work
     * @dev Example of domain-specific function
     * @param dataHash Hash of the creative work evidence
     * @param assetUri IPFS CID of the creative asset
     * @param description Brief description of the work
     */
    function submitCreativeWork(
        bytes32 dataHash,
        string calldata assetUri,
        string calldata description
    ) external hasEscrow(0.001 ether) {
        require(bytes(assetUri).length > 0, "Empty assetUri");
        require(bytes(description).length > 0, "Empty description");
        
        // Record work
        _recordWork(dataHash, msg.sender);
        
        // Emit event with creative work details
        bytes memory workData = abi.encode(assetUri, description);
        emit LogicExecuted("submitCreativeWork", msg.sender, workData);
    }
    
    /**
     * @notice Submit design iteration
     * @dev Example of domain-specific function for iterative design
     * @param dataHash Hash of the iteration evidence
     * @param previousVersion Hash of previous version (or bytes32(0) for first)
     * @param iterationNotes Notes on changes made
     */
    function submitIteration(
        bytes32 dataHash,
        bytes32 previousVersion,
        string calldata iterationNotes
    ) external hasEscrow(0.5 ether) {
        require(bytes(iterationNotes).length > 0, "Empty notes");
        
        // Record work
        _recordWork(dataHash, msg.sender);
        
        // Emit event with iteration details
        bytes memory iterationData = abi.encode(previousVersion, iterationNotes);
        emit LogicExecuted("submitIteration", msg.sender, iterationData);
    }
}

