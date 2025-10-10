// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
 * @author ChaosChain Labs
 */
abstract contract LogicModule {
    
    // ============ Storage Matching StudioProxy ============
    // CRITICAL: Must match StudioProxy storage layout exactly
    
    /// @dev Slot 0: ChaosCore (immutable in proxy, not accessible here)
    /// @dev Slot 1: Logic module address (immutable in proxy, not accessible here)
    /// @dev Slot 2: RewardsDistributor address
    address internal _rewardsDistributor;
    
    /// @dev Slot 3+: Escrow balances
    mapping(address => uint256) internal _escrowBalances;
    
    /// @dev Work submissions
    mapping(bytes32 => address) internal _workSubmissions;
    
    /// @dev Score vectors
    mapping(bytes32 => mapping(address => bytes)) internal _scoreVectors;
    
    /// @dev Total escrow
    uint256 internal _totalEscrow;
    
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
     * @dev REQUIRED: Override in derived contracts to expose criteria for Explorer UI
     * @return names Array of criterion names (e.g., ["Quality", "Initiative", "Collaboration"])
     * @return weights Array of weights per criterion (e.g., [100, 80, 120] where 100 = 1.0x)
     * 
     * Example for a prediction market:
     *   names: ["Accuracy", "Timeliness", "Reasoning"]
     *   weights: [150, 100, 50] // 1.5x, 1.0x, 0.5x
     */
    function getScoringCriteria() external virtual view returns (
        string[] memory names,
        uint16[] memory weights
    ) {
        // Default: empty (override required)
        names = new string[](0);
        weights = new uint16[](0);
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

