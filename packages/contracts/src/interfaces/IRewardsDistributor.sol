// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IRewardsDistributor
 * @notice Consensus engine and reward distribution for Studios
 * @dev See §2.3, §2.4, §4 in protocol_spec_v0.1.md
 * 
 * The RewardsDistributor is the "brain" of the ChaosChain protocol.
 * It executes stake-weighted consensus over Verifier Agent scores
 * and distributes rewards/slashes accordingly.
 * 
 * @author ChaosChain Labs
 */
interface IRewardsDistributor {
    
    // ============ Structs ============
    
    /**
     * @dev Score vector submitted by a Verifier Agent
     */
    struct ScoreVector {
        uint256 validatorAgentId;
        bytes32 dataHash;
        uint256 stake;
        uint8[] scores;  // Scores for K criteria (0-100 each)
        uint256 timestamp;
        bool processed;
    }
    
    /**
     * @dev Consensus result for a work submission
     */
    struct ConsensusResult {
        bytes32 dataHash;
        uint8[] consensusScores;  // Consensus scores for K criteria
        uint256 totalStake;
        uint256 validatorCount;
        uint256 timestamp;
        bool finalized;
    }
    
    // ============ Events ============
    
    /**
     * @dev Emitted when an epoch is closed
     */
    event EpochClosed(
        address indexed studio,
        uint64 indexed epoch,
        uint256 workCount,
        uint256 validatorCount
    );
    
    /**
     * @dev Emitted when consensus is reached
     */
    event ConsensusReached(
        bytes32 indexed dataHash,
        uint8[] consensusScores,
        uint256 totalStake
    );
    
    /**
     * @dev Emitted when a worker is rewarded
     */
    event WorkerRewarded(
        address indexed studio,
        uint256 indexed agentId,
        bytes32 indexed dataHash,
        uint256 amount
    );
    
    /**
     * @dev Emitted when a validator is rewarded
     */
    event ValidatorRewarded(
        uint256 indexed validatorAgentId,
        bytes32 indexed dataHash,
        uint256 reward,
        uint256 performanceScore
    );
    
    /**
     * @dev Emitted when a validator is slashed
     */
    event ValidatorSlashed(
        uint256 indexed validatorAgentId,
        bytes32 indexed dataHash,
        uint256 slashAmount,
        uint256 errorMetric
    );
    
    /**
     * @dev Emitted when evidence is anchored on-chain (canonical event for indexers)
     * @param agentId The worker agent ID
     * @param workId Unique work identifier: keccak(domain|nonce|timestamp)
     * @param evidenceCid IPFS CID as bytes32 (multihash)
     * @param chainId The chain ID where evidence is anchored
     * @param timestamp Block timestamp of anchoring
     */
    event EvidenceAnchored(
        uint256 indexed agentId,
        bytes32 indexed workId,
        bytes32 evidenceCid,
        uint64 chainId,
        uint64 timestamp
    );

    /**
     * @dev Emitted when giveFeedback to the ReputationRegistry fails
     * @param agentId The agent whose feedback failed
     * @param reason The revert reason (may be empty for low-level failures)
     */
    event GiveFeedbackFailed(
        uint256 indexed agentId,
        string reason
    );


    // ============ Core Functions ============
    
    /**
     * @notice Close an epoch and process rewards
     * @param studio The Studio proxy address
     * @param epoch The epoch number
     */
    function closeEpoch(address studio, uint64 epoch) external;
    
    /**
     * @notice Calculate consensus for a specific work submission
     * @dev See §2.2 robust consensus in protocol_spec_v0.1.md
     * @param dataHash The hash of the work
     * @param scoreVectors The submitted score vectors
     * @return consensusScores The consensus score vector
     */
    function calculateConsensus(
        bytes32 dataHash,
        ScoreVector[] calldata scoreVectors
    ) external returns (uint8[] memory consensusScores);
    
    /**
     * @notice Get consensus result for a work submission
     * @param dataHash The hash of the work
     * @return result The consensus result
     */
    function getConsensusResult(bytes32 dataHash) external view returns (ConsensusResult memory result);
    
    /**
     * @notice Set consensus parameters
     * @dev Can only be called by authorized address
     * @param alpha MAD multiplier for outlier detection (e.g., 3)
     * @param beta Reward sharpness parameter
     * @param kappa Slashing severity parameter
     * @param tau Error tolerance threshold
     */
    function setConsensusParameters(
        uint256 alpha,
        uint256 beta,
        uint256 kappa,
        uint256 tau
    ) external;
}

