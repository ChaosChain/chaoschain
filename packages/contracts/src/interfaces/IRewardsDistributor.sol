// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

/**
 * @title IRewardsDistributor
 * @notice Interface for the ChaosChain Rewards Distribution Contract
 * @dev Implements stake-weighted consensus and x402-compatible reward distribution
 */
interface IRewardsDistributor {
    /**
     * @notice Epoch data structure for reward calculation periods
     * @param startBlock Starting block of the epoch
     * @param endBlock Ending block of the epoch
     * @param processed Whether the epoch has been processed
     * @param totalRewards Total rewards distributed in this epoch
     */
    struct EpochData {
        uint256 startBlock;
        uint256 endBlock;
        bool processed;
        uint256 totalRewards;
    }

    /**
     * @notice Score vector submitted by verifier agents
     * @param verifierAgentId The agent ID of the verifier
     * @param submissionId The submission being scored
     * @param scores Array of numerical scores
     * @param reportCID IPFS CID of the detailed verification report
     * @param timestamp When the score was submitted
     */
    struct ScoreVector {
        uint256 verifierAgentId;
        uint256 submissionId;
        uint256[] scores;
        string reportCID;
        uint256 timestamp;
    }

    /**
     * @notice x402-compatible payment structure
     * @param paymentId Unique identifier for the payment
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts for each recipient
     * @param currency Currency identifier (e.g., "USDC", "ETH")
     * @param metadata Additional payment metadata
     */
    struct X402Payment {
        string paymentId;
        address[] recipients;
        uint256[] amounts;
        string currency;
        bytes metadata;
    }

    /**
     * @notice Emitted when an epoch is processed
     * @param studioProxy The studio that was processed
     * @param epochId The epoch identifier
     * @param totalRewards Total rewards distributed
     */
    event EpochProcessed(address indexed studioProxy, uint256 indexed epochId, uint256 totalRewards);

    /**
     * @notice Emitted when rewards are distributed
     * @param studioProxy The studio where rewards were distributed
     * @param agentId The agent receiving rewards
     * @param amount The reward amount
     * @param paymentId x402 payment identifier
     */
    event RewardsDistributed(
        address indexed studioProxy,
        uint256 indexed agentId,
        uint256 amount,
        string paymentId
    );

    /**
     * @notice Emitted when a verifier is slashed for dishonest scoring
     * @param verifierAgentId The slashed verifier
     * @param studioProxy The studio where slashing occurred
     * @param slashAmount Amount slashed from stake
     */
    event VerifierSlashed(
        uint256 indexed verifierAgentId,
        address indexed studioProxy,
        uint256 slashAmount
    );

    /**
     * @notice Emitted when consensus is reached on scores
     * @param studioProxy The studio where consensus was reached
     * @param epochId The epoch identifier
     * @param consensusScores Final consensus scores
     */
    event ConsensusReached(
        address indexed studioProxy,
        uint256 indexed epochId,
        uint256[] consensusScores
    );

    /**
     * @notice Process an epoch for a specific studio
     * @param studioProxy Address of the studio proxy to process
     * @param epochId The epoch identifier to process
     */
    function processEpoch(address studioProxy, uint256 epochId) external;

    /**
     * @notice Calculate consensus scores from submitted score vectors
     * @param submissionIds Array of submission IDs to process
     * @param allScores 2D array of score vectors for each submission
     * @return consensusScores Array of final consensus scores
     */
    function calculateConsensusScores(
        uint256[] memory submissionIds,
        ScoreVector[][] memory allScores
    ) external view returns (uint256[] memory consensusScores);

    /**
     * @notice Distribute x402-compatible rewards based on consensus scores
     * @param studioProxy Studio where rewards are being distributed
     * @param payment x402 payment structure
     * @param proof Cryptographic proof of payment authorization
     */
    function distributeX402Rewards(
        address studioProxy,
        X402Payment calldata payment,
        bytes calldata proof
    ) external;

    /**
     * @notice Slash verifiers whose scores were outliers
     * @param studioProxy Studio where slashing occurs
     * @param outlierVerifiers Array of verifier addresses to slash
     * @param slashAmounts Array of amounts to slash from each verifier
     */
    function slashOutliers(
        address studioProxy,
        address[] memory outlierVerifiers,
        uint256[] memory slashAmounts
    ) external;

    /**
     * @notice Get epoch data for a specific studio and epoch
     * @param studioProxy The studio proxy address
     * @param epochId The epoch identifier
     * @return epoch The epoch data structure
     */
    function getEpochData(address studioProxy, uint256 epochId) 
        external view returns (EpochData memory epoch);

    /**
     * @notice Get the stake weight for a verifier agent
     * @param verifierAgent The verifier agent address
     * @return weight The stake weight
     */
    function getStakeWeight(address verifierAgent) external view returns (uint256 weight);

    /**
     * @notice Set stake weight for a verifier (only authorized callers)
     * @param verifierAgent The verifier agent address
     * @param weight The new stake weight
     */
    function setStakeWeight(address verifierAgent, uint256 weight) external;

    /**
     * @notice Check if an epoch is ready for processing
     * @param studioProxy The studio proxy address
     * @param epochId The epoch identifier
     * @return isReady True if the epoch can be processed
     */
    function isEpochReady(address studioProxy, uint256 epochId) external view returns (bool isReady);

    /**
     * @notice Get consensus threshold percentage (e.g., 70 for 70%)
     * @return threshold The consensus threshold
     */
    function getConsensusThreshold() external view returns (uint256 threshold);
} 