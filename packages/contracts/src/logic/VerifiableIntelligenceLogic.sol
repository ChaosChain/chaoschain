// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

import "./IStudioLogic.sol";

/**
 * @title VerifiableIntelligenceLogic
 * @notice Business logic for the MVP prediction and intelligence Studio
 * @dev Implements challenge-based prediction markets with PoA verification
 */
contract VerifiableIntelligenceLogic is IStudioLogic {
    /// @notice Challenge data structure
    struct Challenge {
        string question;
        string[] options;
        uint256 deadline;
        uint256 bounty;
        bool resolved;
        uint256 correctOption;
        address creator;
        uint256 creationBlock;
    }

    /// @notice Mapping from challenge ID to challenge data
    mapping(uint256 => Challenge) public challenges;
    
    /// @notice Mapping from challenge ID to agent ID to prediction
    mapping(uint256 => mapping(uint256 => uint256)) public predictions;
    
    /// @notice Mapping to track if agent has submitted prediction for challenge
    mapping(uint256 => mapping(uint256 => bool)) public hasSubmittedPrediction;
    
    /// @notice Counter for generating challenge IDs
    uint256 public nextChallengeId = 1;
    
    /// @notice Minimum stake required for participation
    uint256 public minimumStake = 0.01 ether;
    
    /// @notice Challenge creation fee
    uint256 public challengeCreationFee = 0.001 ether;

    /**
     * @notice Emitted when a new challenge is created
     * @param challengeId The unique challenge identifier
     * @param creator The address that created the challenge
     * @param question The challenge question
     * @param deadline The deadline for submissions
     * @param bounty The total bounty for correct predictions
     */
    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed creator,
        string question,
        uint256 deadline,
        uint256 bounty
    );

    /**
     * @notice Emitted when a prediction is submitted
     * @param challengeId The challenge identifier
     * @param agentId The agent that submitted the prediction
     * @param prediction The prediction value
     */
    event PredictionSubmitted(
        uint256 indexed challengeId,
        uint256 indexed agentId,
        uint256 prediction
    );

    /**
     * @notice Emitted when a challenge is resolved
     * @param challengeId The challenge identifier
     * @param correctOption The correct answer
     */
    event ChallengeResolved(uint256 indexed challengeId, uint256 correctOption);

    /**
     * @inheritdoc IStudioLogic
     */
    function initialize(bytes calldata initData) external override {
        // Decode initialization parameters if any
        if (initData.length > 0) {
            (uint256 minStake, uint256 creationFee) = abi.decode(initData, (uint256, uint256));
            minimumStake = minStake;
            challengeCreationFee = creationFee;
        }
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function submitEvidence(uint256 agentId, string calldata evidenceCID) 
        external 
        override 
        returns (uint256 submissionId) 
    {
        // For VerifiableIntelligence, evidence submission is tied to predictions
        // This is called after a prediction is made to submit the evidence package
        // The actual submission ID generation happens in the proxy
        
        // Validation would happen here
        require(bytes(evidenceCID).length > 0, "VerifiableIntelligenceLogic: Empty evidence CID");
        
        // Return a placeholder - real implementation would coordinate with proxy
        return 0;
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function submitScore(
        uint256 submissionId,
        uint256[] calldata scores,
        string calldata reportCID
    ) external override {
        // Validation for score submission
        require(scores.length > 0, "VerifiableIntelligenceLogic: Empty scores");
        require(bytes(reportCID).length > 0, "VerifiableIntelligenceLogic: Empty report CID");
        
        // Additional business logic for score validation
        for (uint256 i = 0; i < scores.length; i++) {
            require(scores[i] <= 100, "VerifiableIntelligenceLogic: Score too high");
        }
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function stakeAgent(uint256 agentId) external payable override {
        require(msg.value >= minimumStake, "VerifiableIntelligenceLogic: Insufficient stake");
        // Additional staking logic would be implemented here
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function withdrawStake(uint256 agentId) external override {
        // Withdrawal validation logic
        // In practice, would check if agent has pending challenges, etc.
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function getSubmission(uint256 submissionId) 
        external 
        view 
        override 
        returns (Submission memory submission) 
    {
        // This would be delegated to the proxy in practice
        // Placeholder implementation
        submission = Submission({
            agentId: 0,
            evidenceCID: "",
            timestamp: 0,
            blockNumber: 0
        });
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function getAgentStake(uint256 agentId) external view override returns (uint256 stakeAmount) {
        // This would be delegated to the proxy in practice
        return 0;
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function isAgentEligible(uint256 agentId) external view override returns (bool isEligible) {
        // Check if agent has sufficient stake and is active
        // This would be delegated to the proxy in practice
        return true; // Placeholder - would check actual stake
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function getTotalSubmissions() external view override returns (uint256 count) {
        // This would be delegated to the proxy in practice
        return 0;
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function getStudioType() external pure override returns (string memory studioType) {
        return "VerifiableIntelligence";
    }

    /**
     * @inheritdoc IStudioLogic
     */
    function getMinimumStake() external view override returns (uint256 minStake) {
        return minimumStake;
    }

    /**
     * @notice Create a new prediction challenge
     * @param question The challenge question
     * @param options Array of possible answers
     * @param deadline When submissions close (timestamp)
     * @return challengeId The unique challenge identifier
     */
    function createChallenge(
        string calldata question,
        string[] calldata options,
        uint256 deadline
    ) external payable returns (uint256 challengeId) {
        require(bytes(question).length > 0, "VerifiableIntelligenceLogic: Empty question");
        require(options.length >= 2, "VerifiableIntelligenceLogic: Need at least 2 options");
        require(deadline > block.timestamp, "VerifiableIntelligenceLogic: Invalid deadline");
        require(msg.value >= challengeCreationFee, "VerifiableIntelligenceLogic: Insufficient fee");
        
        challengeId = nextChallengeId++;
        
        challenges[challengeId] = Challenge({
            question: question,
            options: options,
            deadline: deadline,
            bounty: msg.value - challengeCreationFee,
            resolved: false,
            correctOption: 0,
            creator: msg.sender,
            creationBlock: block.number
        });
        
        emit ChallengeCreated(challengeId, msg.sender, question, deadline, msg.value - challengeCreationFee);
    }

    /**
     * @notice Submit a prediction for a challenge
     * @param challengeId The challenge to predict on
     * @param prediction The predicted option index
     */
    function submitPrediction(uint256 challengeId, uint256 prediction) external {
        require(challengeId < nextChallengeId, "VerifiableIntelligenceLogic: Invalid challenge ID");
        
        Challenge storage challenge = challenges[challengeId];
        require(block.timestamp < challenge.deadline, "VerifiableIntelligenceLogic: Challenge expired");
        require(!challenge.resolved, "VerifiableIntelligenceLogic: Challenge already resolved");
        require(prediction < challenge.options.length, "VerifiableIntelligenceLogic: Invalid prediction");
        
        // Note: In practice, we would get agentId from the caller's agent registry lookup
        uint256 agentId = 1; // Placeholder
        
        require(!hasSubmittedPrediction[challengeId][agentId], "VerifiableIntelligenceLogic: Already submitted");
        // Note: Agent eligibility check would be performed by the proxy in practice
        
        predictions[challengeId][agentId] = prediction;
        hasSubmittedPrediction[challengeId][agentId] = true;
        
        emit PredictionSubmitted(challengeId, agentId, prediction);
    }

    /**
     * @notice Resolve a challenge with the correct answer
     * @param challengeId The challenge to resolve
     * @param correctOption The index of the correct option
     */
    function resolveChallenge(uint256 challengeId, uint256 correctOption) external {
        require(challengeId < nextChallengeId, "VerifiableIntelligenceLogic: Invalid challenge ID");
        
        Challenge storage challenge = challenges[challengeId];
        require(challenge.creator == msg.sender, "VerifiableIntelligenceLogic: Not challenge creator");
        require(block.timestamp >= challenge.deadline, "VerifiableIntelligenceLogic: Challenge not expired");
        require(!challenge.resolved, "VerifiableIntelligenceLogic: Already resolved");
        require(correctOption < challenge.options.length, "VerifiableIntelligenceLogic: Invalid option");
        
        challenge.resolved = true;
        challenge.correctOption = correctOption;
        
        emit ChallengeResolved(challengeId, correctOption);
        
        // TODO: Trigger reward distribution for correct predictions
    }

    /**
     * @notice Calculate score for an agent's prediction
     * @param challengeId The challenge identifier
     * @param agentId The agent identifier
     * @return score The calculated score (0-100)
     */
    function calculateScore(uint256 challengeId, uint256 agentId) 
        external 
        view 
        returns (uint256 score) 
    {
        require(challengeId < nextChallengeId, "VerifiableIntelligenceLogic: Invalid challenge ID");
        require(challenges[challengeId].resolved, "VerifiableIntelligenceLogic: Challenge not resolved");
        require(hasSubmittedPrediction[challengeId][agentId], "VerifiableIntelligenceLogic: No prediction");
        
        if (predictions[challengeId][agentId] == challenges[challengeId].correctOption) {
            return 100; // Perfect score for correct prediction
        } else {
            return 0; // Zero score for incorrect prediction
        }
    }

    /**
     * @notice Get challenge details
     * @param challengeId The challenge identifier
     * @return challenge The challenge data structure
     */
    function getChallenge(uint256 challengeId) external view returns (Challenge memory challenge) {
        require(challengeId < nextChallengeId, "VerifiableIntelligenceLogic: Invalid challenge ID");
        return challenges[challengeId];
    }

    /**
     * @notice Get prediction for an agent and challenge
     * @param challengeId The challenge identifier
     * @param agentId The agent identifier
     * @return prediction The prediction value
     */
    function getPrediction(uint256 challengeId, uint256 agentId) 
        external 
        view 
        returns (uint256 prediction) 
    {
        require(hasSubmittedPrediction[challengeId][agentId], "VerifiableIntelligenceLogic: No prediction");
        return predictions[challengeId][agentId];
    }

    /**
     * @notice Get total number of challenges
     * @return count Total challenge count
     */
    function getTotalChallenges() external view returns (uint256 count) {
        return nextChallengeId - 1;
    }

    /**
     * @notice Update minimum stake requirement (only via governance)
     * @param newMinStake New minimum stake amount
     */
    function updateMinimumStake(uint256 newMinStake) external {
        // Note: In practice, this would have proper access control
        minimumStake = newMinStake;
    }

    /**
     * @notice Update challenge creation fee (only via governance)
     * @param newFee New creation fee amount
     */
    function updateChallengeCreationFee(uint256 newFee) external {
        // Note: In practice, this would have proper access control
        challengeCreationFee = newFee;
    }
} 