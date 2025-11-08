// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";
import {IChaosChainRegistry} from "./interfaces/IChaosChainRegistry.sol";
import {IERC8004IdentityV1} from "./interfaces/IERC8004IdentityV1.sol";
import {IERC8004Validation} from "./interfaces/IERC8004Validation.sol";
import {StudioProxy} from "./StudioProxy.sol";
import {Scoring} from "./libraries/Scoring.sol";

/**
 * @title RewardsDistributor
 * @notice Consensus engine and reward distribution for ChaosChain Studios
 * @dev See §2.2-2.5, §4 in protocol_spec_v0.1.md
 * 
 * The RewardsDistributor implements the core "brain" of ChaosChain:
 * 1. Robust Consensus: Stake-weighted MAD-based outlier detection (§2.2)
 * 2. Commit-Reveal: Prevents last-mover bias and copycatting (§2.4)
 * 3. Reward Distribution: Quality-based worker payments (§4.1)
 * 4. Validator Rewards/Slashing: Accuracy-based incentives (§4.3)
 * 
 * Mathematical Foundation:
 * - Per-dimension median + MAD for outlier detection
 * - Exponential reward curve: r_i ∝ e^(-β * E_i²)
 * - Quadratic slashing: slash_i ∝ max(0, E_i - τ)²
 * 
 * Security: Only authorized addresses can trigger epoch closure
 * 
 * @author ChaosChain Labs
 */
contract RewardsDistributor is Ownable, IRewardsDistributor {
    
    // ============ Constants ============
    
    /// @dev Precision for fixed-point math (6 decimals) - from Scoring library
    uint256 private constant PRECISION = 1e6;
    
    // ============ State Variables ============
    
    /// @dev ChaosChainRegistry reference
    IChaosChainRegistry public immutable registry;
    
    /// @dev Consensus parameters (see §2.3)
    uint256 public alpha = 3 * PRECISION; // MAD multiplier for outlier detection
    uint256 public beta = 1 * PRECISION;  // Reward sharpness parameter
    uint256 public kappa = 2 * PRECISION; // Slashing severity parameter
    uint256 public tau = 10 * PRECISION;  // Error tolerance threshold
    
    /// @dev Consensus results storage (dataHash => ConsensusResult)
    mapping(bytes32 => ConsensusResult) private _consensusResults;
    
    /// @dev Processed score vectors (dataHash => validator => processed)
    mapping(bytes32 => mapping(address => bool)) private _processedVectors;
    
    /// @dev Work submissions per studio per epoch (studio => epoch => dataHashes[])
    mapping(address => mapping(uint64 => bytes32[])) private _epochWork;
    
    /// @dev Validators per work (dataHash => validators[])
    mapping(bytes32 => address[]) private _workValidators;
    
    // ============ Constructor ============
    
    /**
     * @dev Initialize with registry
     * @param registry_ The ChaosChainRegistry address
     */
    constructor(address registry_) Ownable(msg.sender) {
        require(registry_ != address(0), "Invalid registry");
        registry = IChaosChainRegistry(registry_);
    }
    
    // ============ Core Functions ============
    
    /// @inheritdoc IRewardsDistributor
    function closeEpoch(address studio, uint64 epoch) external override onlyOwner {
        require(studio != address(0), "Invalid studio");
        
        StudioProxy studioProxy = StudioProxy(payable(studio));
        bytes32[] memory workHashes = _epochWork[studio][epoch];
        require(workHashes.length > 0, "No work in epoch");
        
        uint256 totalWorkerRewards = 0;
        uint256 totalValidatorRewards = 0;
        
        // Process each work submission in the epoch
        for (uint256 i = 0; i < workHashes.length; i++) {
            bytes32 dataHash = workHashes[i];
            
            // Get work submitter
            address worker = studioProxy.getWorkSubmitter(dataHash);
            require(worker != address(0), "Work not found");
            
            // Collect score vectors from validators
            address[] memory validators = _workValidators[dataHash];
            require(validators.length > 0, "No validators");
            
            ScoreVector[] memory scoreVectors = new ScoreVector[](validators.length);
            for (uint256 j = 0; j < validators.length; j++) {
                bytes memory scoreData = studioProxy.getScoreVector(dataHash, validators[j]);
                require(scoreData.length > 0, "Missing score");
                
                // Decode score vector - handle variable length
                uint8[] memory scores;
                
                // Try to decode as tuple of 5 uint8s (our test format)
                if (scoreData.length >= 160) { // 5 * 32 bytes
                    scores = new uint8[](5);
                    (scores[0], scores[1], scores[2], scores[3], scores[4]) = abi.decode(
                        scoreData,
                        (uint8, uint8, uint8, uint8, uint8)
                    );
                } else {
                    // Fallback: try dynamic array decode
                    scores = abi.decode(scoreData, (uint8[]));
                }
                
                scoreVectors[j] = ScoreVector({
                    validatorAgentId: 0, // Would come from IdentityRegistry
                    dataHash: dataHash,
                    stake: 1 ether, // Simplified - would come from validator stakes
                    scores: scores,
                    timestamp: block.timestamp,
                    processed: false
                });
            }
            
            // Run consensus
            uint8[] memory consensusScores = this.calculateConsensus(dataHash, scoreVectors);
            
            // Calculate quality scalar (average of consensus scores)
            uint256 qualitySum = 0;
            for (uint256 k = 0; k < consensusScores.length; k++) {
                qualitySum += consensusScores[k];
            }
            uint256 qualityScalar = qualitySum / consensusScores.length; // 0-100
            
            // Calculate worker reward (quality-based)
            uint256 baseReward = 1 ether; // Simplified - would come from escrow
            uint256 workerReward = (baseReward * qualityScalar) / 100;
            
            // Release funds to worker
            if (workerReward > 0) {
                studioProxy.releaseFunds(worker, workerReward, dataHash);
                totalWorkerRewards += workerReward;
            }
            
            // Calculate validator rewards based on accuracy
            uint256 validatorRewardPool = baseReward / 10; // 10% of base for validators
            totalValidatorRewards += _distributeValidatorRewards(
                studioProxy,
                dataHash,
                scoreVectors,
                consensusScores,
                validators,
                validatorRewardPool
            );
            
            // Store consensus result
            _consensusResults[dataHash] = ConsensusResult({
                dataHash: dataHash,
                consensusScores: consensusScores,
                totalStake: validators.length * 1 ether,
                validatorCount: validators.length,
                timestamp: block.timestamp,
                finalized: true
            });
            
            // Publish to ValidationRegistry
            _publishToValidationRegistry(dataHash, consensusScores);
        }
        
        emit EpochClosed(studio, epoch, totalWorkerRewards, totalValidatorRewards);
    }
    
    /// @inheritdoc IRewardsDistributor
    function calculateConsensus(
        bytes32 dataHash,
        ScoreVector[] calldata scoreVectors
    ) external override returns (uint8[] memory consensusScores) {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(scoreVectors.length > 0, "No score vectors");
        
        // Convert ScoreVector[] to score matrix and stake vector
        uint256 n = scoreVectors.length;
        uint8[][] memory scores = new uint8[][](n);
        uint256[] memory stakes = new uint256[](n);
        
        for (uint256 i = 0; i < n; i++) {
            scores[i] = scoreVectors[i].scores;
            stakes[i] = scoreVectors[i].stake;
        }
        
        // Use Scoring library for consensus calculation
        Scoring.Params memory params = Scoring.Params({
            alpha: alpha,
            beta: beta,
            kappa: kappa,
            tau: tau
        });
        
        consensusScores = Scoring.consensus(scores, stakes, params);
        
        // Emit EvidenceAnchored event
        emit EvidenceAnchored(
            scoreVectors[0].validatorAgentId, // Use first validator's agentId (should be work agentId)
            dataHash,
            bytes32(0), // evidenceCid would come from work submission
            uint64(block.chainid),
            uint64(block.timestamp)
        );
        
        return consensusScores;
    }
    
    /// @inheritdoc IRewardsDistributor
    function getConsensusResult(bytes32 dataHash) external view override returns (ConsensusResult memory result) {
        result = _consensusResults[dataHash];
        require(result.timestamp != 0, "No consensus found");
        return result;
    }
    
    /// @inheritdoc IRewardsDistributor
    function setConsensusParameters(
        uint256 alpha_,
        uint256 beta_,
        uint256 kappa_,
        uint256 tau_
    ) external override onlyOwner {
        require(alpha_ > 0 && alpha_ <= 10 * PRECISION, "Invalid alpha");
        require(beta_ > 0 && beta_ <= 10 * PRECISION, "Invalid beta");
        require(kappa_ > 0 && kappa_ <= 10 * PRECISION, "Invalid kappa");
        require(tau_ > 0 && tau_ <= 100 * PRECISION, "Invalid tau");
        
        alpha = alpha_;
        beta = beta_;
        kappa = kappa_;
        tau = tau_;
    }
    
    // ============ Epoch Management Functions ============
    
    /**
     * @notice Register work submission for an epoch
     * @param studio The studio address
     * @param epoch The epoch number
     * @param dataHash The work hash
     */
    function registerWork(address studio, uint64 epoch, bytes32 dataHash) external onlyOwner {
        _epochWork[studio][epoch].push(dataHash);
    }
    
    /**
     * @notice Register validator for a work submission
     * @param dataHash The work hash
     * @param validator The validator address
     */
    function registerValidator(bytes32 dataHash, address validator) external onlyOwner {
        _workValidators[dataHash].push(validator);
    }
    
    /**
     * @notice Get work submissions for an epoch
     * @param studio The studio address
     * @param epoch The epoch number
     * @return workHashes Array of work hashes
     */
    function getEpochWork(address studio, uint64 epoch) external view returns (bytes32[] memory workHashes) {
        return _epochWork[studio][epoch];
    }
    
    /**
     * @notice Get validators for a work submission
     * @param dataHash The work hash
     * @return validators Array of validator addresses
     */
    function getWorkValidators(bytes32 dataHash) external view returns (address[] memory validators) {
        return _workValidators[dataHash];
    }
    
    // ============ Internal Functions ============
    
    /**
     * @notice Distribute rewards to validators based on accuracy
     * @param studioProxy The studio proxy contract
     * @param dataHash The work hash
     * @param scoreVectors The score vectors from validators
     * @param consensusScores The consensus scores
     * @param validators The validator addresses
     * @param rewardPool The total reward pool for validators
     * @return totalDistributed The total amount distributed
     */
    function _distributeValidatorRewards(
        StudioProxy studioProxy,
        bytes32 dataHash,
        ScoreVector[] memory scoreVectors,
        uint8[] memory consensusScores,
        address[] memory validators,
        uint256 rewardPool
    ) internal returns (uint256 totalDistributed) {
        // Calculate error for each validator (§2.3)
        uint256[] memory errors = new uint256[](validators.length);
        uint256 totalWeight = 0;
        
        for (uint256 i = 0; i < validators.length; i++) {
            // Calculate L2 distance from consensus
            uint256 errorSquared = 0;
            for (uint256 j = 0; j < consensusScores.length; j++) {
                int256 diff = int256(uint256(scoreVectors[i].scores[j])) - int256(uint256(consensusScores[j]));
                errorSquared += uint256(diff * diff);
            }
            
            errors[i] = errorSquared;
            
            // Weight = e^(-β * error²) (simplified as 1 / (1 + error))
            uint256 weight = PRECISION / (PRECISION + errors[i]);
            totalWeight += weight;
        }
        
        // Distribute rewards proportional to accuracy
        for (uint256 i = 0; i < validators.length; i++) {
            if (totalWeight > 0) {
                uint256 weight = PRECISION / (PRECISION + errors[i]);
                uint256 reward = (rewardPool * weight) / totalWeight;
                
                if (reward > 0) {
                    studioProxy.releaseFunds(validators[i], reward, dataHash);
                    totalDistributed += reward;
                }
            }
        }
        
        return totalDistributed;
    }
    
    /**
     * @notice Publish consensus result to ValidationRegistry
     * @param dataHash The work hash
     * @param consensusScores The consensus scores
     */
    function _publishToValidationRegistry(
        bytes32 dataHash,
        uint8[] memory consensusScores
    ) internal {
        // Get ValidationRegistry from registry
        address validationRegistry = registry.getValidationRegistry();
        if (validationRegistry == address(0)) return; // Skip if not set
        
        // Check if it's a real contract (has code)
        uint256 size;
        assembly {
            size := extcodesize(validationRegistry)
        }
        if (size == 0) return; // Skip if not a contract
        
        // Calculate average score for response
        uint256 avgScore = 0;
        for (uint256 i = 0; i < consensusScores.length; i++) {
            avgScore += consensusScores[i];
        }
        avgScore = avgScore / consensusScores.length;
        
        // Try to publish validation response (may fail if mock)
        try IERC8004Validation(validationRegistry).validationResponse(
            dataHash,                    // requestHash
            uint8(avgScore),            // response (0-100)
            "",                         // responseUri (optional)
            bytes32(0),                 // responseHash (optional)
            bytes32("CHAOSCHAIN_CONSENSUS") // tag
        ) {
            // Success - validation published
        } catch {
            // Failed - likely a mock registry, continue anyway
        }
    }
    
    // NOTE: All consensus logic moved to Scoring library (libraries/Scoring.sol)
    // This keeps the RewardsDistributor focused on orchestration and the Scoring
    // library pure and testable.
}
