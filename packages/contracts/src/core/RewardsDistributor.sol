// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IRewardsDistributor.sol";

/**
 * @title RewardsDistributor
 * @notice Implements stake-weighted consensus and x402-compatible reward distribution
 * @dev Core engine for Proof of Agency verification and economic incentives
 */
contract RewardsDistributor is IRewardsDistributor, Ownable, ReentrancyGuard {
    /// @notice Mapping from studio proxy to epoch data
    mapping(address => mapping(uint256 => EpochData)) public epochs;
    
    /// @notice Mapping from verifier agent to stake weight
    mapping(address => uint256) public stakeWeights;
    
    /// @notice Consensus threshold percentage (e.g., 70 for 70%)
    uint256 public constant CONSENSUS_THRESHOLD = 70;
    
    /// @notice Maximum score value for normalization
    uint256 public constant MAX_SCORE = 100;
    
    /// @notice Minimum stake weight required for participation
    uint256 public constant MIN_STAKE_WEIGHT = 1000; // 1000 tokens minimum
    
    /// @notice Protocol fee percentage (e.g., 250 for 2.5%)
    uint256 public protocolFeeRate = 250; // 2.5%
    
    /// @notice Protocol fee recipient
    address public protocolFeeRecipient;

    /**
     * @notice Contract constructor
     * @param initialOwner The initial owner of the contract
     * @param feeRecipient Address to receive protocol fees
     */
    constructor(address initialOwner, address feeRecipient) Ownable(initialOwner) {
        require(feeRecipient != address(0), "RewardsDistributor: Invalid fee recipient");
        protocolFeeRecipient = feeRecipient;
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function processEpoch(address studioProxy, uint256 epochId) external nonReentrant {
        require(studioProxy != address(0), "RewardsDistributor: Invalid studio proxy");
        
        EpochData storage epoch = epochs[studioProxy][epochId];
        require(!epoch.processed, "RewardsDistributor: Epoch already processed");
        require(isEpochReady(studioProxy, epochId), "RewardsDistributor: Epoch not ready");
        
        // Mark epoch as processed
        epoch.processed = true;
        epoch.endBlock = block.number;
        
        // TODO: Implement actual consensus calculation
        // This is a placeholder implementation
        uint256 totalRewards = address(studioProxy).balance;
        epoch.totalRewards = totalRewards;
        
        emit EpochProcessed(studioProxy, epochId, totalRewards);
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function calculateConsensusScores(
        uint256[] memory submissionIds,
        ScoreVector[][] memory allScores
    ) external view returns (uint256[] memory consensusScores) {
        require(submissionIds.length == allScores.length, "RewardsDistributor: Array length mismatch");
        
        consensusScores = new uint256[](submissionIds.length);
        
        for (uint256 i = 0; i < submissionIds.length; i++) {
            consensusScores[i] = _calculateWeightedConsensus(allScores[i]);
        }
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function distributeX402Rewards(
        address studioProxy,
        X402Payment calldata payment,
        bytes calldata proof
    ) external nonReentrant {
        require(studioProxy != address(0), "RewardsDistributor: Invalid studio proxy");
        require(payment.recipients.length == payment.amounts.length, "RewardsDistributor: Array length mismatch");
        require(_verifyX402Proof(payment, proof), "RewardsDistributor: Invalid proof");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < payment.amounts.length; i++) {
            totalAmount += payment.amounts[i];
        }
        
        require(address(studioProxy).balance >= totalAmount, "RewardsDistributor: Insufficient balance");
        
        // Calculate protocol fee
        uint256 protocolFee = (totalAmount * protocolFeeRate) / 10000;
        uint256 netRewards = totalAmount - protocolFee;
        
        // Distribute rewards
        for (uint256 i = 0; i < payment.recipients.length; i++) {
            uint256 adjustedAmount = (payment.amounts[i] * netRewards) / totalAmount;
            
            (bool success, ) = payment.recipients[i].call{value: adjustedAmount}("");
            require(success, "RewardsDistributor: Transfer failed");
            
            // Emit with agent ID (placeholder - would need to resolve from address)
            emit RewardsDistributed(studioProxy, 0, adjustedAmount, payment.paymentId);
        }
        
        // Transfer protocol fee
        if (protocolFee > 0) {
            (bool feeSuccess, ) = protocolFeeRecipient.call{value: protocolFee}("");
            require(feeSuccess, "RewardsDistributor: Fee transfer failed");
        }
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function slashOutliers(
        address studioProxy,
        address[] memory outlierVerifiers,
        uint256[] memory slashAmounts
    ) external onlyOwner {
        require(outlierVerifiers.length == slashAmounts.length, "RewardsDistributor: Array length mismatch");
        
        for (uint256 i = 0; i < outlierVerifiers.length; i++) {
            uint256 currentStake = stakeWeights[outlierVerifiers[i]];
            uint256 slashAmount = slashAmounts[i];
            
            if (slashAmount > currentStake) {
                slashAmount = currentStake;
            }
            
            stakeWeights[outlierVerifiers[i]] -= slashAmount;
            
            // TODO: Transfer slashed tokens to protocol treasury
            
            emit VerifierSlashed(0, studioProxy, slashAmount); // placeholder agent ID
        }
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function getEpochData(address studioProxy, uint256 epochId) 
        external 
        view 
        returns (EpochData memory epoch) 
    {
        return epochs[studioProxy][epochId];
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function getStakeWeight(address verifierAgent) external view returns (uint256 weight) {
        return stakeWeights[verifierAgent];
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function setStakeWeight(address verifierAgent, uint256 weight) external onlyOwner {
        require(verifierAgent != address(0), "RewardsDistributor: Invalid verifier address");
        stakeWeights[verifierAgent] = weight;
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function isEpochReady(address studioProxy, uint256 epochId) public view returns (bool isReady) {
        EpochData memory epoch = epochs[studioProxy][epochId];
        
        // Simple readiness check - in practice this would be more sophisticated
        return epoch.startBlock > 0 && 
               !epoch.processed && 
               block.number >= epoch.startBlock + 100; // Example: 100 blocks minimum
    }

    /**
     * @inheritdoc IRewardsDistributor
     */
    function getConsensusThreshold() external pure returns (uint256 threshold) {
        return CONSENSUS_THRESHOLD;
    }

    /**
     * @notice Calculate weighted consensus score from multiple score vectors
     * @param scores Array of score vectors for a submission
     * @return consensusScore The calculated consensus score
     */
    function _calculateWeightedConsensus(ScoreVector[] memory scores) 
        internal 
        view 
        returns (uint256 consensusScore) 
    {
        if (scores.length == 0) return 0;
        
        uint256 totalWeightedScore = 0;
        uint256 totalWeight = 0;
        
        for (uint256 i = 0; i < scores.length; i++) {
            uint256 verifierWeight = stakeWeights[address(uint160(scores[i].verifierAgentId))]; // placeholder
            if (verifierWeight < MIN_STAKE_WEIGHT) continue;
            
            // Average the scores array for this verifier
            uint256 avgScore = 0;
            for (uint256 j = 0; j < scores[i].scores.length; j++) {
                avgScore += scores[i].scores[j];
            }
            if (scores[i].scores.length > 0) {
                avgScore = avgScore / scores[i].scores.length;
            }
            
            totalWeightedScore += avgScore * verifierWeight;
            totalWeight += verifierWeight;
        }
        
        if (totalWeight == 0) return 0;
        
        consensusScore = totalWeightedScore / totalWeight;
        
        // Ensure score is within valid range
        if (consensusScore > MAX_SCORE) {
            consensusScore = MAX_SCORE;
        }
    }

    /**
     * @notice Verify x402 payment proof
     * @param payment The x402 payment structure
     * @param proof The cryptographic proof
     * @return isValid True if proof is valid
     */
    function _verifyX402Proof(X402Payment calldata payment, bytes calldata proof) 
        internal 
        pure 
        returns (bool isValid) 
    {
        // Placeholder implementation - real x402 proof verification would go here
        return proof.length > 0 && bytes(payment.paymentId).length > 0;
    }

    /**
     * @notice Initialize epoch data
     * @param studioProxy The studio proxy address
     * @param epochId The epoch identifier
     */
    function initializeEpoch(address studioProxy, uint256 epochId) external onlyOwner {
        require(epochs[studioProxy][epochId].startBlock == 0, "RewardsDistributor: Epoch already initialized");
        
        epochs[studioProxy][epochId] = EpochData({
            startBlock: block.number,
            endBlock: 0,
            processed: false,
            totalRewards: 0
        });
    }

    /**
     * @notice Update protocol fee rate
     * @param newFeeRate New fee rate in basis points (e.g., 250 for 2.5%)
     */
    function updateProtocolFeeRate(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= 1000, "RewardsDistributor: Fee rate too high"); // Max 10%
        protocolFeeRate = newFeeRate;
    }

    /**
     * @notice Update protocol fee recipient
     * @param newRecipient New fee recipient address
     */
    function updateProtocolFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "RewardsDistributor: Invalid recipient");
        protocolFeeRecipient = newRecipient;
    }
} 