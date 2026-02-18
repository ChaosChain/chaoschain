// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/**
 * @title LogicModule
 * @notice Base contract for Studio business logic modules
 * @dev See §3.1.6 in ChaosChain_Implementation_Plan.md
 * 
 * LogicModules contain all business logic for a Studio type.
 * They are deployed once and used by multiple StudioProxy instances via DELEGATECALL.
 * 
 * CRITICAL: Since these are called via DELEGATECALL:
 * 1. All state modifications affect the proxy's storage
 * 2. msg.sender and msg.value are preserved from original call
 * 3. Storage layout must match StudioProxy layout
 * 
 * Implement custom Studio logic by extending this base contract.
 * 
 * SCORING ARCHITECTURE:
 * - All Studios MUST score the 5 universal PoA dimensions (Initiative, Collaboration, etc.)
 * - Studios CAN add additional domain-specific dimensions
 * - Override getScoringCriteria() to define your Studio's complete dimension set
 * 
 * @author ChaosChain Labs
 */
abstract contract LogicModule {
    
    // ============ Storage Matching StudioProxy ============
    // CRITICAL: Must match StudioProxy storage layout exactly
    //
    // The proxy inherits EIP712 (2 slots) and ReentrancyGuard (1 slot) before its own declared variables.
    // We reserve those slots plus any StudioProxy variables that LogicModule
    // doesn't need direct access to, using __gap arrays.
    // See StudioProxy.sol for the authoritative layout.

    /// @dev Slots 0-3: Reserved for inherited and proxy-internal storage.
    ///   Slot 0: EIP712._nameFallback (string)
    ///   Slot 1: EIP712._versionFallback (string)
    ///   Slot 2: ReentrancyGuard._status (uint256)
    ///   Slot 3: StudioProxy._logicModule (address)
    ///
    /// NOTE: OpenZeppelin v5.5.0+ makes ReentrancyGuard stateless (transient storage),
    /// removing slot 2. Upgrading will require reducing this preamble to 3 slots
    /// and shifting all subsequent storage layout by -1. See:
    /// https://github.com/OpenZeppelin/openzeppelin-contracts/releases/tag/v5.5.0
    uint256[4] private __proxyPreamble;

    /// @dev Slot 4: RewardsDistributor address
    address internal _rewardsDistributor;

    /// @dev Slot 5: Escrow balances (account => balance)
    mapping(address => uint256) internal _escrowBalances;

    /// @dev Slot 6: Work submissions (dataHash => submitter)
    mapping(bytes32 => address) internal _workSubmissions;

    /// @dev Slots 7-9: Reserved for StudioProxy variables not used by LogicModule.
    ///   Slot 7: StudioProxy._workParticipants (mapping)
    ///   Slot 8: StudioProxy._contributionWeights (mapping)
    ///   Slot 9: StudioProxy._evidenceCIDs (mapping)
    uint256[3] private __gap1;

    /// @dev Slot 10: Score vectors (dataHash => validator => scoreVector)
    mapping(bytes32 => mapping(address => bytes)) internal _scoreVectors;

    /// @dev Slots 11-12: Reserved for StudioProxy variables not used by LogicModule.
    ///   Slot 11: StudioProxy._scoreVectorsPerWorker (mapping)
    ///   Slot 12: StudioProxy._validators (mapping)
    uint256[2] private __gap2;

    /// @dev Slot 13: Total escrow in the Studio
    uint256 internal _totalEscrow;

    /// @dev Slots 14-28: Reserved for remaining StudioProxy storage.
    ///   Slot 14: StudioProxy._scoreNonces (mapping)
    ///   Slot 15: StudioProxy._withdrawable (mapping)
    ///   Slot 16: StudioProxy._scoreCommitments (mapping)
    ///   Slot 17: StudioProxy._commitDeadlines (mapping)
    ///   Slot 18: StudioProxy._revealDeadlines (mapping)
    ///   Slot 19: StudioProxy._agentIds (mapping)
    ///   Slot 20: StudioProxy._agentStakes (mapping)
    ///   Slot 21: StudioProxy._feedbackAuths (mapping, deprecated)
    ///   Slot 22: StudioProxy._customDimensionNames (string[])
    ///   Slot 23: StudioProxy._customDimensionWeights (mapping)
    ///   Slot 24: StudioProxy._universalWeight (uint256)
    ///   Slot 25: StudioProxy._customWeight (uint256)
    ///   Slot 26: StudioProxy._agentRoles (mapping)
    ///   Slot 27: StudioProxy._tasks (mapping)
    ///   Slot 28: StudioProxy._clientTasks (mapping)
    uint256[15] private __gap3;

    // ============ Events ============
    
    /**
     * @dev Emitted when Studio-specific logic executes
     */
    event LogicExecuted(string action, address indexed actor, bytes data);
    
    // ============ Modifiers ============
    
    /**
     * @dev Ensure caller has deposited escrow
     */
    modifier hasEscrow(uint256 required) {
        require(_escrowBalances[msg.sender] >= required, "Insufficient escrow");
        _;
    }
    
    /**
     * @dev Ensure work exists
     */
    modifier workExists(bytes32 dataHash) {
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        _;
    }
    
    // ============ Abstract Functions ============
    
    /**
     * @notice Initialize Studio with custom parameters
     * @dev Called once when Studio is created
     * @param params ABI-encoded initialization parameters
     */
    function initialize(bytes calldata params) external virtual;
    
    /**
     * @notice Get Studio type identifier
     * @return studioType The Studio type name
     */
    function getStudioType() external pure virtual returns (string memory studioType);
    
    /**
     * @notice Get Studio version
     * @return version The logic module version
     */
    function getVersion() external pure virtual returns (string memory version);
    
    /**
     * @notice Get scoring criteria metadata for this Studio type
     * @dev REQUIRED: Override in derived contracts to add studio-specific dimensions
     * 
     * ALL Studios MUST include the 5 universal PoA dimensions:
     * 1. Initiative (original contributions)
     * 2. Collaboration (helping others)
     * 3. Reasoning Depth (problem-solving)
     * 4. Compliance (following rules)
     * 5. Efficiency (time management)
     * 
     * Studios CAN add additional domain-specific dimensions after these 5.
     * 
     * @return names Array of dimension names (MUST start with 5 PoA dimensions)
     * @return weights Array of weights per dimension (100 = 1.0x, 150 = 1.5x, etc.)
     * 
     * Example for Finance Studio:
     *   names: ["Initiative", "Collaboration", "Reasoning Depth", "Compliance", "Efficiency", 
     *           "Accuracy", "Risk Assessment", "Documentation"]
     *   weights: [100, 100, 100, 150, 80, 200, 150, 120]
     *           // Compliance 1.5x, Accuracy 2.0x (critical for finance!)
     * 
     * Example for Creative Studio:
     *   names: ["Initiative", "Collaboration", "Reasoning Depth", "Compliance", "Efficiency",
     *           "Originality", "Aesthetic Quality", "Brand Alignment"]
     *   weights: [150, 100, 100, 80, 100, 200, 180, 120]
     *           // Initiative 1.5x, Originality 2.0x (critical for creativity!)
     */
    function getScoringCriteria() external virtual view returns (
        string[] memory names,
        uint16[] memory weights
    ) {
        // Default: Universal PoA dimensions only
        names = ProtocolConstants.getDefaultPoADimensions();
        weights = ProtocolConstants.getDefaultPoAWeights();
    }
    
    // ============ Internal Helper Functions ============
    
    /**
     * @dev Deduct escrow from an account
     * @param account The account to deduct from
     * @param amount The amount to deduct
     */
    function _deductEscrow(address account, uint256 amount) internal {
        require(_escrowBalances[account] >= amount, "Insufficient escrow");
        unchecked {
            _escrowBalances[account] -= amount;
            _totalEscrow -= amount;
        }
    }
    
    /**
     * @dev Add escrow to an account
     * @param account The account to add to
     * @param amount The amount to add
     */
    function _addEscrow(address account, uint256 amount) internal {
        _escrowBalances[account] += amount;
        _totalEscrow += amount;
    }
    
    /**
     * @dev Record a work submission
     * @param dataHash The work hash
     * @param submitter The submitter address
     */
    function _recordWork(bytes32 dataHash, address submitter) internal {
        require(_workSubmissions[dataHash] == address(0), "Work already exists");
        _workSubmissions[dataHash] = submitter;
    }
    
    /**
     * @dev Record a score vector
     * @param dataHash The work hash
     * @param validator The validator address
     * @param scoreVector The score vector
     */
    function _recordScoreVector(
        bytes32 dataHash,
        address validator,
        bytes memory scoreVector
    ) internal {
        _scoreVectors[dataHash][validator] = scoreVector;
    }
}

