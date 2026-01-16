// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IStudioProxy
 * @notice Interface for Studio proxy contracts
 * @dev See §3.1.7 in ChaosChain_Implementation_Plan.md
 * 
 * StudioProxies are lightweight contracts that hold funds and state for each Studio.
 * They delegate all business logic to LogicModule contracts via DELEGATECALL.
 * 
 * @author ChaosChain Labs
 */
interface IStudioProxy {
    
    // ============ Events ============
    
    /**
     * @dev Emitted when the logic module is upgraded
     */
    event LogicModuleUpgraded(address indexed oldLogic, address indexed newLogic);
    
    /**
     * @dev Emitted when work is submitted
     */
    event WorkSubmitted(
        uint256 indexed agentId,
        bytes32 indexed dataHash,
        bytes32 threadRoot,
        bytes32 evidenceRoot,
        uint256 timestamp
    );
    
    /**
     * @dev Emitted when a score vector is submitted
     */
    event ScoreVectorSubmitted(
        uint256 indexed validatorAgentId,
        bytes32 indexed dataHash,
        bytes scoreVector,
        uint256 timestamp
    );
    
    /**
     * @dev Emitted when funds are released
     */
    event FundsReleased(address indexed recipient, uint256 amount, bytes32 indexed dataHash);
    
    /**
     * @dev Emitted when a validator commits to a score (commit-reveal phase 1)
     */
    event ScoreCommitted(bytes32 indexed dataHash, address indexed validator, bytes32 commitment);
    
    /**
     * @dev Emitted when a validator reveals their score (commit-reveal phase 2)
     */
    event ScoreRevealed(bytes32 indexed dataHash, address indexed validator, bytes scoreVector);

    // ============ Core Functions ============
    
    /**
     * @notice Get the current logic module address
     * @return The address of the logic module
     */
    function getLogicModule() external view returns (address);
    
    /**
     * @notice Upgrade the logic module
     * @dev Can only be called by authorized address (ChaosCore or owner)
     * @param newLogic The new logic module address
     */
    function upgradeLogicModule(address newLogic) external;
    
    /**
     * @notice Submit work evidence (§1.4 protocol spec, ERC-8004 Jan 2026 compatible)
     * @dev feedbackAuth parameter kept for backward compatibility but is now OPTIONAL
     * Per ERC-8004 Jan 2026: feedback submission is permissionless, no pre-authorization needed
     * @param dataHash The EIP-712 DataHash (computed from studio, epoch, demandHash, threadRoot, evidenceRoot, paramsHash)
     * @param threadRoot VLC/Merkle root of XMTP thread
     * @param evidenceRoot Merkle root of Irys payloads
     * @param feedbackAuth DEPRECATED: kept for backward compatibility only
     */
    function submitWork(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, bytes calldata feedbackAuth) external;
    
    /**
     * @notice Submit score vector for validation
     * @param dataHash The hash of the work being validated
     * @param scoreVector The encoded score vector
     */
    function submitScoreVector(bytes32 dataHash, bytes calldata scoreVector) external;
    
    /**
     * @notice Release funds to an address
     * @dev Can only be called by RewardsDistributor
     * @param to The recipient address
     * @param amount The amount to release
     * @param dataHash The associated work hash
     */
    function releaseFunds(address to, uint256 amount, bytes32 dataHash) external;
    
    /**
     * @notice Get escrow balance for an address
     * @param account The account to check
     * @return The escrow balance
     */
    function getEscrowBalance(address account) external view returns (uint256);
    
    /**
     * @notice DEPRECATED: Get feedbackAuth for a work submission
     * @dev ERC-8004 Jan 2026 removed feedbackAuth requirement - feedback is now permissionless
     * This function is kept for backward compatibility but feedbackAuth is no longer required.
     * @param dataHash The work dataHash
     * @param worker The worker address
     * @return The feedbackAuth signature (may be empty under Jan 2026 spec)
     */
    function getFeedbackAuth(bytes32 dataHash, address worker) external view returns (bytes memory);
    
    /**
     * @notice Get work submitter
     * @param dataHash The work dataHash
     * @return The submitter address
     */
    function getWorkSubmitter(bytes32 dataHash) external view returns (address);
    
    /**
     * @notice Deposit funds to escrow
     */
    function deposit() external payable;
}

