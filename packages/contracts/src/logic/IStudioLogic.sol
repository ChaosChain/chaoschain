// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

/**
 * @title IStudioLogic
 * @notice Base interface that all Studio logic modules must implement
 * @dev Provides common functions for Studio initialization and management
 */
interface IStudioLogic {
    /**
     * @notice Submission structure for evidence packages
     * @param agentId The agent that made the submission
     * @param evidenceCID IPFS CID of the DKG-compliant evidence package
     * @param timestamp When the submission was made
     * @param blockNumber Block number of the submission
     */
    struct Submission {
        uint256 agentId;
        string evidenceCID;
        uint256 timestamp;
        uint256 blockNumber;
    }

    /**
     * @notice Emitted when evidence is submitted to the studio
     * @param submissionId Unique identifier for the submission
     * @param agentId The agent that submitted evidence
     * @param evidenceCID IPFS CID of the evidence package
     */
    event EvidenceSubmitted(uint256 indexed submissionId, uint256 indexed agentId, string evidenceCID);

    /**
     * @notice Emitted when a score vector is submitted by a verifier
     * @param submissionId The submission being scored
     * @param verifierAgentId The verifier agent
     * @param scores The score values
     */
    event ScoreSubmitted(
        uint256 indexed submissionId,
        uint256 indexed verifierAgentId,
        uint256[] scores
    );

    /**
     * @notice Emitted when an agent stakes funds
     * @param agentId The agent staking funds
     * @param amount The stake amount
     */
    event AgentStaked(uint256 indexed agentId, uint256 amount);

    /**
     * @notice Emitted when an agent withdraws stake
     * @param agentId The agent withdrawing stake
     * @param amount The withdrawal amount
     */
    event StakeWithdrawn(uint256 indexed agentId, uint256 amount);

    /**
     * @notice Initialize the studio with custom parameters
     * @param initData Encoded initialization parameters specific to each studio type
     */
    function initialize(bytes calldata initData) external;

    /**
     * @notice Submit evidence package for a completed task
     * @param agentId The agent submitting evidence
     * @param evidenceCID IPFS CID of the DKG-compliant evidence package
     * @return submissionId Unique identifier for the submission
     */
    function submitEvidence(uint256 agentId, string calldata evidenceCID) 
        external returns (uint256 submissionId);

    /**
     * @notice Submit score vector for a submission (verifiers only)
     * @param submissionId The submission to score
     * @param scores Array of numerical scores
     * @param reportCID IPFS CID of the detailed verification report
     */
    function submitScore(
        uint256 submissionId,
        uint256[] calldata scores,
        string calldata reportCID
    ) external;

    /**
     * @notice Stake funds for agent participation
     * @param agentId The agent to stake for
     */
    function stakeAgent(uint256 agentId) external payable;

    /**
     * @notice Withdraw staked funds (if eligible)
     * @param agentId The agent to withdraw stake for
     */
    function withdrawStake(uint256 agentId) external;

    /**
     * @notice Get submission details by ID
     * @param submissionId The submission identifier
     * @return submission The submission data structure
     */
    function getSubmission(uint256 submissionId) external view returns (Submission memory submission);

    /**
     * @notice Get agent stake amount
     * @param agentId The agent identifier
     * @return stakeAmount The current stake amount
     */
    function getAgentStake(uint256 agentId) external view returns (uint256 stakeAmount);

    /**
     * @notice Check if an agent is eligible to participate
     * @param agentId The agent identifier
     * @return isEligible True if agent meets participation requirements
     */
    function isAgentEligible(uint256 agentId) external view returns (bool isEligible);

    /**
     * @notice Get the total number of submissions
     * @return count Total submission count
     */
    function getTotalSubmissions() external view returns (uint256 count);

    /**
     * @notice Get studio type identifier
     * @return studioType The type of this studio
     */
    function getStudioType() external pure returns (string memory studioType);

    /**
     * @notice Get minimum stake requirement for participation
     * @return minStake The minimum stake amount
     */
    function getMinimumStake() external view returns (uint256 minStake);
} 