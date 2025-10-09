// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LogicModule} from "../base/LogicModule.sol";

/**
 * @title PredictionMarketLogic
 * @notice Example LogicModule for prediction market Studios
 * @dev Demonstrates custom Studio business logic via DELEGATECALL pattern
 * 
 * This module implements logic for prediction market challenges where:
 * 1. Studio owner creates prediction challenges with escrow
 * 2. Worker Agents submit predictions as work
 * 3. Verifier Agents evaluate predictions and submit scores
 * 4. RewardsDistributor calculates consensus and distributes rewards
 * 
 * See §3.1.6 in ChaosChain_Implementation_Plan.md
 * 
 * @author ChaosChain Labs
 */
contract PredictionMarketLogic is LogicModule {
    
    // ============ Custom Storage (continues after LogicModule) ============
    
    /// @dev Challenge parameters
    struct Challenge {
        string question;
        uint256 rewardPool;
        uint256 deadline;
        address creator;
        bool active;
    }
    
    /// @dev challengeId => Challenge
    mapping(bytes32 => Challenge) private _challenges;
    
    /// @dev Current challenge count
    uint256 private _challengeCount;
    
    // ============ Events ============
    
    event ChallengeCreated(
        bytes32 indexed challengeId,
        string question,
        uint256 rewardPool,
        uint256 deadline,
        address indexed creator
    );
    
    event PredictionSubmitted(
        bytes32 indexed challengeId,
        bytes32 indexed dataHash,
        address indexed predictor,
        uint256 timestamp
    );
    
    // ============ Implementation Functions ============
    
    /// @inheritdoc LogicModule
    function initialize(bytes calldata /*params*/) external override {
        // Prediction markets don't need initialization parameters
        // Could be extended to set minimum escrow, challenge parameters, etc.
    }
    
    /// @inheritdoc LogicModule
    function getStudioType() external pure override returns (string memory) {
        return "PredictionMarket";
    }
    
    /// @inheritdoc LogicModule
    function getVersion() external pure override returns (string memory) {
        return "1.0.0";
    }
    
    // ============ Custom Business Logic ============
    
    /**
     * @notice Create a new prediction challenge
     * @param question The prediction question
     * @param rewardPool The reward pool amount
     * @param duration Duration in seconds
     * @return challengeId The challenge ID
     */
    function createChallenge(
        string calldata question,
        uint256 rewardPool,
        uint256 duration
    ) external hasEscrow(rewardPool) returns (bytes32 challengeId) {
        require(bytes(question).length > 0, "Empty question");
        require(rewardPool > 0, "Invalid reward pool");
        require(duration > 0 && duration <= 30 days, "Invalid duration");
        
        // Generate challenge ID
        challengeId = keccak256(abi.encodePacked(
            block.timestamp,
            msg.sender,
            _challengeCount++
        ));
        
        // Deduct escrow
        _deductEscrow(msg.sender, rewardPool);
        
        // Store challenge
        _challenges[challengeId] = Challenge({
            question: question,
            rewardPool: rewardPool,
            deadline: block.timestamp + duration,
            creator: msg.sender,
            active: true
        });
        
        emit ChallengeCreated(challengeId, question, rewardPool, block.timestamp + duration, msg.sender);
        emit LogicExecuted("createChallenge", msg.sender, abi.encode(challengeId));
    }
    
    /**
     * @notice Submit a prediction for a challenge
     * @param challengeId The challenge ID
     * @param predictionHash Hash of the prediction data
     * @param evidenceUri URI to prediction evidence on IPFS/Irys
     */
    function submitPrediction(
        bytes32 challengeId,
        bytes32 predictionHash,
        string calldata evidenceUri
    ) external {
        Challenge storage challenge = _challenges[challengeId];
        require(challenge.active, "Challenge not active");
        require(block.timestamp < challenge.deadline, "Challenge expired");
        require(predictionHash != bytes32(0), "Invalid prediction hash");
        
        // Record as work submission
        _recordWork(predictionHash, msg.sender);
        
        emit PredictionSubmitted(challengeId, predictionHash, msg.sender, block.timestamp);
        emit LogicExecuted("submitPrediction", msg.sender, abi.encode(challengeId, predictionHash));
    }
    
    /**
     * @notice Close a challenge
     * @dev Can only be called after deadline
     * @param challengeId The challenge ID
     */
    function closeChallenge(bytes32 challengeId) external {
        Challenge storage challenge = _challenges[challengeId];
        require(challenge.active, "Challenge not active");
        require(block.timestamp >= challenge.deadline, "Challenge not expired");
        
        challenge.active = false;
        
        emit LogicExecuted("closeChallenge", msg.sender, abi.encode(challengeId));
    }
    
    /**
     * @notice Get challenge details
     * @param challengeId The challenge ID
     * @return challenge The challenge struct
     */
    function getChallenge(bytes32 challengeId) external view returns (Challenge memory challenge) {
        return _challenges[challengeId];
    }
    
    /**
     * @notice Check if challenge is active
     * @param challengeId The challenge ID
     * @return active True if challenge is active
     */
    function isChallengeActive(bytes32 challengeId) external view returns (bool active) {
        Challenge storage challenge = _challenges[challengeId];
        return challenge.active && block.timestamp < challenge.deadline;
    }
}

