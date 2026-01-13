// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";
import {IChaosChainRegistry} from "./interfaces/IChaosChainRegistry.sol";
import {IERC8004IdentityV1} from "./interfaces/IERC8004IdentityV1.sol";
import {IERC8004Reputation} from "./interfaces/IERC8004Reputation.sol";
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
 * @author ChaosChain
 */
contract RewardsDistributor is Ownable, IRewardsDistributor {
    
    // ============ Debug Events ============
    /// @dev Temporary debug event - remove after fixing
    event DebugTrace(string location, uint256 index, uint256 length);
    event DebugScores(string location, uint256 validCount, uint256 totalValidators);
    
    // ============ Debug Functions ============
    /// @dev Simple ping to verify contract can emit events
    function debugPing() external {
        emit DebugTrace("PING_SUCCESS", block.number, block.timestamp);
    }
    
    /// @dev Check owner without modifier
    function debugOwnerCheck() external view returns (address ownerAddr, address caller, bool isOwner) {
        ownerAddr = owner();
        caller = msg.sender;
        isOwner = (ownerAddr == caller);
    }
    
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
    /// @dev TEMPORARY: Removed onlyOwner modifier for debugging
    function closeEpoch(address studio, uint64 epoch) external override {
        // FIRST THING - emit before ANY other code
        emit DebugTrace("closeEpoch_FIRST_LINE", uint256(uint160(msg.sender)), block.number);
        
        // Manual owner check (was in modifier)
        emit DebugTrace("before_owner_check", 0, 0);
        address ownerAddr = owner();
        emit DebugTrace("owner_loaded", uint256(uint160(ownerAddr)), 0);
        require(msg.sender == ownerAddr, "Not owner");
        emit DebugTrace("after_owner_check", 1, 0);
        
        emit DebugTrace("closeEpoch_ENTRY", uint256(uint160(studio)), epoch);
        
        require(studio != address(0), "Invalid studio");
        emit DebugTrace("after_studio_require", 1, 0);
        
        StudioProxy studioProxy = StudioProxy(payable(studio));
        emit DebugTrace("after_studioProxy_cast", 2, 0);
        
        bytes32[] memory workHashes = _epochWork[studio][epoch];
        emit DebugTrace("workHashes_loaded", workHashes.length, epoch);
        
        require(workHashes.length > 0, "No work in epoch");
        emit DebugTrace("after_workHashes_require", workHashes.length, 0);
        
        uint256 totalWorkerRewards = 0;
        uint256 totalValidatorRewards = 0;
        
        // Process each work submission in the epoch
        for (uint256 i = 0; i < workHashes.length; i++) {
            emit DebugTrace("work_loop_iteration", i, workHashes.length);
            
            bytes32 dataHash = workHashes[i];
            emit DebugTrace("dataHash_loaded", uint256(dataHash), 0);
            
            // Get all participants (multi-agent support, Protocol Spec §4.2)
            emit DebugTrace("before_getWorkParticipants", 0, 0);
            address[] memory participants = studioProxy.getWorkParticipants(dataHash);
            emit DebugTrace("participants_loaded", participants.length, 0);
            
            require(participants.length > 0, "No participants");
            emit DebugTrace("after_participants_require", participants.length, 0);
            
            // Get validators who scored this work - USE STUDIOPROXY'S ARRAY (single source of truth!)
            // StudioProxy._validators is populated automatically when validators submit scores
            emit DebugTrace("before_getValidators", 0, 0);
            address[] memory validators = studioProxy.getValidators(dataHash);
            emit DebugTrace("validators_loaded", validators.length, 0);
            
            // Fallback to owner-registered validators if StudioProxy has none
            if (validators.length == 0) {
                emit DebugTrace("fallback_to_workValidators", 0, 0);
                validators = _workValidators[dataHash];
                emit DebugTrace("workValidators_loaded", validators.length, 0);
            }
            require(validators.length > 0, "No validators");
            
            // Get total budget for this work
            uint256 totalBudget = studioProxy.getTotalEscrow();
            if (totalBudget == 0) {
                emit EpochClosed(studio, epoch, 0, 0);
                continue;
            }
            
            // Budget allocation (Protocol Spec §4)
            uint256 orchestratorFee = (totalBudget * 5) / 100;
            uint256 validatorPool = (totalBudget * 10) / 100;
            uint256 workerPool = totalBudget - orchestratorFee - validatorPool;
            
            // ═══════════════════════════════════════════════════════════════════
            // PER-WORKER CONSENSUS (Protocol Spec §2.1-2.2, §4.2)
            // Each worker gets individual consensus scores and reputation!
            // ═══════════════════════════════════════════════════════════════════
            
            ScoreVector[] memory allValidatorScores = new ScoreVector[](validators.length);
            uint8[] memory overallConsensusScores;  // For validator accuracy calc
            
            emit DebugTrace("participants_loop_start", participants.length, validators.length);
            
            for (uint256 p = 0; p < participants.length; p++) {
                address worker = participants[p];
                emit DebugTrace("participant", p, participants.length);
                
                // Get contribution weight for this worker (from DKG analysis)
                uint16 contributionWeight = studioProxy.getContributionWeight(dataHash, worker);
                
                // Collect per-worker scores from all validators
                ScoreVector[] memory workerScoreVectors = new ScoreVector[](validators.length);
                uint256 validScores = 0;
                
                for (uint256 j = 0; j < validators.length; j++) {
                    emit DebugTrace("validator_loop", j, validators.length);
                    
                    // NEW: Get PER-WORKER scores (not per-dataHash)
                    (address[] memory scoreValidators, bytes[] memory scoreData) = 
                        studioProxy.getScoreVectorsForWorker(dataHash, worker);
                    
                    emit DebugTrace("scoreValidators_len", scoreValidators.length, scoreData.length);
                    
                    // Find this validator's score for this worker
                    bytes memory validatorScore;
                    for (uint256 k = 0; k < scoreValidators.length; k++) {
                        if (scoreValidators[k] == validators[j]) {
                            validatorScore = scoreData[k];
                            break;
                        }
                    }
                    
                    // Skip if no score from this validator for this worker
                    if (validatorScore.length == 0) continue;
                    
                    emit DebugTrace("validatorScore_len", validatorScore.length, 0);
                    
                    // Decode score vector
                    uint8[] memory scores = _decodeScoreVector(validatorScore);
                    
                    emit DebugTrace("decoded_scores_len", scores.length, 0);
                    
                    // Skip if decode returned empty (malformed or missing data)
                    if (scores.length == 0) continue;
                    
                    emit DebugTrace("before_workerScoreVectors", validScores, workerScoreVectors.length);
                    
                    workerScoreVectors[validScores] = ScoreVector({
                        validatorAgentId: 0,
                        dataHash: dataHash,
                        stake: 1 ether,
                        scores: scores,
                        timestamp: block.timestamp,
                        processed: false
                    });
                    validScores++;
                    
                    // Track for validator accuracy - use FIRST score found for each validator
                    // (not just first worker, in case validator didn't score first worker)
                    emit DebugTrace("before_allValidatorScores", j, allValidatorScores.length);
                    if (allValidatorScores[j].scores.length == 0) {
                        allValidatorScores[j] = workerScoreVectors[validScores - 1];
                    }
                }
                
                // Require at least 1 validator scored this worker
                emit DebugScores("before_require", validScores, validators.length);
                require(validScores > 0, "No scores for worker");
                
                // Resize array to actual count
                ScoreVector[] memory finalWorkerScores = new ScoreVector[](validScores);
                for (uint256 vs = 0; vs < validScores; vs++) {
                    finalWorkerScores[vs] = workerScoreVectors[vs];
                }
                
                // Calculate consensus for THIS worker (Protocol Spec §2.2)
                emit DebugScores("before_calculateConsensus", finalWorkerScores.length, validScores);
                uint8[] memory workerConsensus = this.calculateConsensus(dataHash, finalWorkerScores);
                emit DebugTrace("after_calculateConsensus", workerConsensus.length, 0);
                
                // Save for validator accuracy (use first worker's consensus)
                if (p == 0) {
                    overallConsensusScores = workerConsensus;
                }
                
                // Calculate quality scalar for this worker (Protocol Spec §4.1)
                emit DebugTrace("before_calculateQualityScalar", workerConsensus.length, 0);
                uint256 workerQuality = _calculateQualityScalar(studio, workerConsensus);
                emit DebugTrace("after_calculateQualityScalar", workerQuality, 0);
                
                // Calculate this worker's share of rewards (Protocol Spec §4.2)
                // payout = quality × contribution_weight × worker_pool
                uint256 workerShare = (workerPool * contributionWeight * workerQuality) / (10000 * 100);
                
                // Transfer reward to worker (using agentWallet if configured)
                if (workerShare > 0) {
                    address recipient = _getPaymentRecipient(studioProxy, worker);
                    studioProxy.releaseFunds(recipient, workerShare, dataHash);
                    totalWorkerRewards += workerShare;
                }
                
                // Publish PER-WORKER reputation to ERC-8004 (Protocol Spec §5)
                _publishWorkerReputation(
                    studio,
                    studioProxy,
                    dataHash,
                    worker,
                    workerConsensus
                );
                
                // Store per-worker consensus
                bytes32 workerDataHash = keccak256(abi.encodePacked(dataHash, worker));
                _consensusResults[workerDataHash] = ConsensusResult({
                    dataHash: workerDataHash,
                    consensusScores: workerConsensus,
                    totalStake: validators.length * 1 ether,
                    validatorCount: validators.length,
                    timestamp: block.timestamp,
                    finalized: true
                });
            }
            
            // Distribute validator rewards based on accuracy (Protocol Spec §4.3)
            if (overallConsensusScores.length > 0) {
                totalValidatorRewards += _distributeValidatorRewards(
                    studioProxy,
                    dataHash,
                    allValidatorScores,
                    overallConsensusScores,
                    validators,
                    validatorPool
                );
            }
            
            // Publish work-level validation to ValidationRegistry
            if (overallConsensusScores.length > 0) {
                _publishToValidationRegistry(dataHash, overallConsensusScores);
            }
        }
        
        emit EpochClosed(studio, epoch, totalWorkerRewards, totalValidatorRewards);
    }
    
    /**
     * @dev Decode score vector from bytes
     * @param scoreData Raw score data
     * @return scores Decoded uint8 array
     */
    function _decodeScoreVector(bytes memory scoreData) private pure returns (uint8[] memory scores) {
        // Handle empty bytes - return empty array (validator didn't score this worker)
        if (scoreData.length == 0) {
            return new uint8[](0);
        }
        
        // SAFE DECODE: Always return 5 elements (universal PoA dimensions)
        scores = new uint8[](5);
        
        // Try to decode as tuple of 5 uint8s (standard ABI format: 5 * 32 bytes = 160)
        if (scoreData.length >= 160) {
            // Standard ABI format - each uint8 is at byte 31 of its 32-byte slot
            scores[0] = uint8(scoreData[31]);
            scores[1] = uint8(scoreData[63]);
            scores[2] = uint8(scoreData[95]);
            scores[3] = uint8(scoreData[127]);
            scores[4] = uint8(scoreData[159]);
        } else if (scoreData.length >= 5) {
            // Fallback: Raw bytes format (5 bytes minimum)
            scores[0] = uint8(scoreData[0]);
            scores[1] = uint8(scoreData[1]);
            scores[2] = uint8(scoreData[2]);
            scores[3] = uint8(scoreData[3]);
            scores[4] = uint8(scoreData[4]);
        } else {
            // Not enough data - return defaults (50 for each dimension)
            scores[0] = 50;
            scores[1] = 50;
            scores[2] = 50;
            scores[3] = 50;
            scores[4] = 50;
        }
        
        // Clamp scores to valid range (0-100)
        for (uint256 i = 0; i < 5; i++) {
            if (scores[i] > 100) scores[i] = 100;
        }
        
        return scores;
    }
    
    /**
     * @dev Publish per-worker reputation to ERC-8004 ReputationRegistry
     * @dev Jan 2026 Update: feedbackAuth removed, using string tags, added endpoint
     * @param studio StudioProxy address
     * @param studioProxy StudioProxy contract
     * @param dataHash Work hash
     * @param worker Worker address
     * @param consensusScores Per-worker consensus scores
     */
    function _publishWorkerReputation(
        address studio,
        StudioProxy studioProxy,
        bytes32 dataHash,
        address worker,
        uint8[] memory consensusScores
    ) private {
        emit DebugTrace("_pubWorkerRep_ENTRY", consensusScores.length, 0);
        
        // Get worker's agent ID from StudioProxy (registered when they joined)
        uint256 agentId = studioProxy.getAgentId(worker);
        emit DebugTrace("_pubWorkerRep_agentId", agentId, 0);
        if (agentId == 0) return;
        
        // Get reputation registry
        address reputationRegistryAddr = registry.getReputationRegistry();
        emit DebugTrace("_pubWorkerRep_gotRegistry", uint256(uint160(reputationRegistryAddr)), 0);
        if (reputationRegistryAddr == address(0)) return;
        
        // Check if it's a real contract (has code)
        uint256 size;
        assembly {
            size := extcodesize(reputationRegistryAddr)
        }
        emit DebugTrace("_pubWorkerRep_codeSize", size, 0);
        if (size == 0) return; // Skip if not a contract
        
        emit DebugTrace("_pubWorkerRep_beforeCast", 1, 0);
        IERC8004Reputation reputationRegistry = IERC8004Reputation(reputationRegistryAddr);
        
        emit DebugTrace("_pubWorkerRep_beforeStudioTag", 2, 0);
        // Studio address as tag2 (converted to string)
        string memory studioTag = _addressToString(studio);
        
        emit DebugTrace("_pubWorkerRep_beforeLoop", consensusScores.length, 5);
        
        // Publish each dimension (use inline strings to avoid string[5] allocation issue)
        // Only publish if we have scores
        if (consensusScores.length == 0) {
            emit DebugTrace("_pubWorkerRep_noScores", 0, 0);
            return;
        }
        
        string memory feedbackUri = string(abi.encodePacked("chaoschain://", _toHexString(dataHash)));
        
        // Dimension 0: Initiative
        if (consensusScores.length > 0) {
            emit DebugTrace("_pubWorkerRep_dim0", 0, consensusScores[0]);
            bytes32 feedbackHash = keccak256(abi.encodePacked(dataHash, worker, "Initiative", consensusScores[0]));
            try reputationRegistry.giveFeedback(agentId, consensusScores[0], "Initiative", studioTag, "", feedbackUri, feedbackHash) {} catch {}
        }
        
        // Dimension 1: Collaboration
        if (consensusScores.length > 1) {
            emit DebugTrace("_pubWorkerRep_dim1", 1, consensusScores[1]);
            bytes32 feedbackHash = keccak256(abi.encodePacked(dataHash, worker, "Collaboration", consensusScores[1]));
            try reputationRegistry.giveFeedback(agentId, consensusScores[1], "Collaboration", studioTag, "", feedbackUri, feedbackHash) {} catch {}
        }
        
        // Dimension 2: Reasoning Depth (path length in DKG - Protocol Spec §3.1)
        if (consensusScores.length > 2) {
            emit DebugTrace("_pubWorkerRep_dim2", 2, consensusScores[2]);
            bytes32 feedbackHash = keccak256(abi.encodePacked(dataHash, worker, "Reasoning Depth", consensusScores[2]));
            try reputationRegistry.giveFeedback(agentId, consensusScores[2], "Reasoning Depth", studioTag, "", feedbackUri, feedbackHash) {} catch {}
        }
        
        // Dimension 3: Compliance
        if (consensusScores.length > 3) {
            emit DebugTrace("_pubWorkerRep_dim3", 3, consensusScores[3]);
            bytes32 feedbackHash = keccak256(abi.encodePacked(dataHash, worker, "Compliance", consensusScores[3]));
            try reputationRegistry.giveFeedback(agentId, consensusScores[3], "Compliance", studioTag, "", feedbackUri, feedbackHash) {} catch {}
        }
        
        // Dimension 4: Efficiency
        if (consensusScores.length > 4) {
            emit DebugTrace("_pubWorkerRep_dim4", 4, consensusScores[4]);
            bytes32 feedbackHash = keccak256(abi.encodePacked(dataHash, worker, "Efficiency", consensusScores[4]));
            try reputationRegistry.giveFeedback(agentId, consensusScores[4], "Efficiency", studioTag, "", feedbackUri, feedbackHash) {} catch {}
        }
        
        emit DebugTrace("_pubWorkerRep_done", 5, 0);
    }
    
    /**
     * @dev Convert bytes32 to hex string
     */
    function _toHexString(bytes32 data) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            str[i * 2] = alphabet[uint8(data[i] >> 4)];
            str[1 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
    
    /**
     * @notice Calculate quality scalar per Protocol Spec §4.1
     * @dev Combines universal PoA dimensions (FROM DKG) + custom studio dimensions
     * 
     * Formula:
     *   q = w_u × (Σ universal_scores / 5) + w_c × (Σ ρ_d × custom_scores_d)
     * 
     * Where:
     *   - w_u: Universal weight (e.g., 70%) - for DKG-based dimensions
     *   - w_c: Custom weight (e.g., 30%) - for studio-specific dimensions
     *   - ρ_d: Studio-defined weights for custom dimensions (sum to 1.0)
     * 
     * Universal PoA Dimensions (ALWAYS from DKG causal analysis, §3.1):
     *   1. Initiative: Root nodes in DKG
     *   2. Collaboration: Parent references in DKG
     *   3. Reasoning Depth: Path length in DKG
     *   4. Compliance: Policy checks
     *   5. Efficiency: Time/cost metrics
     * 
     * @param studio StudioProxy address
     * @param consensusScores Array of consensus scores (universal + custom)
     * @return qualityScalar Final quality scalar (0-100)
     */
    function _calculateQualityScalar(
        address studio,
        uint8[] memory consensusScores
    ) private view returns (uint256) {
        // CRITICAL: Return default if empty scores
        if (consensusScores.length == 0) {
            return 50; // Default quality
        }
        
        StudioProxy studioProxy = StudioProxy(payable(studio));
        
        // Get studio configuration
        (
            string[] memory customDimNames,
            uint256[] memory customDimWeights,
            uint256 universalWeight,
            uint256 customWeight
        ) = studioProxy.getCustomDimensionConfig();
        
        // Get expected length
        uint8 universalDims = studioProxy.UNIVERSAL_DIMENSIONS();
        uint8 expectedLength = universalDims + uint8(customDimNames.length);
        
        // CRITICAL: If consensus doesn't have enough scores for universal dimensions, return default
        if (consensusScores.length < universalDims) {
            return 50; // Default quality - not enough scores
        }
        
        // 1. Compute universal PoA component (§3.1)
        // These 5 dimensions are ALWAYS computed from DKG causal analysis
        uint256 universalSum = 0;
        for (uint256 i = 0; i < universalDims; i++) {
            universalSum += consensusScores[i];
        }
        uint256 universalAvg = universalSum / universalDims;
        
        // 2. Compute custom studio component (§3.1 studio-specific)
        // These are weighted according to studio preferences
        // CRITICAL FIX: Only process custom dims if consensus has enough scores!
        uint256 customWeightedSum = 0;
        if (customDimNames.length > 0) {
            // Check if consensus has ALL required dimensions (universal + custom)
            uint256 totalExpected = uint256(universalDims) + customDimNames.length;
            
            if (consensusScores.length >= totalExpected) {
                // We have full scores - compute weighted custom component
                for (uint256 i = 0; i < customDimNames.length; i++) {
                    uint256 customIndex = uint256(universalDims) + i;
                    uint8 customScore = consensusScores[customIndex];
                    uint256 weight = customDimWeights[i];
                    customWeightedSum += (weight * customScore);
                }
                customWeightedSum = customWeightedSum / PRECISION;
            } else {
                // Not enough scores for custom dimensions - use default (50)
                customWeightedSum = 50;
            }
        }
        
        // 3. Combine components (§4.1)
        // q = w_u × universal_avg + w_c × custom_component
        uint256 qualityScalar = (universalWeight * universalAvg + customWeight * customWeightedSum) / PRECISION;
        
        return qualityScalar; // Returns 0-100
    }
    
    /// @inheritdoc IRewardsDistributor
    /**
     * @notice Calculate consensus for a specific worker
     * @dev Extracts scores for one worker from all validators
     * @param scoreVectors Array of score vectors from validators
     * @param workerIndex Index of the worker in the participants array
     * @return consensusScores Consensus scores for this worker
     */
    function _calculateConsensusForWorker(
        ScoreVector[] memory scoreVectors,
        uint256 workerIndex
    ) internal view returns (uint8[] memory consensusScores) {
        // Filter out vectors with empty scores
        uint256 validCount = 0;
        for (uint256 i = 0; i < scoreVectors.length; i++) {
            if (scoreVectors[i].scores.length > 0) {
                validCount++;
            }
        }
        
        // If no valid scores, return default
        if (validCount == 0) {
            consensusScores = new uint8[](5);
            for (uint256 i = 0; i < 5; i++) {
                consensusScores[i] = 50;
            }
            return consensusScores;
        }
        
        // Collect valid scores for this worker from all validators
        uint8[][] memory scoresForWorker = new uint8[][](validCount);
        uint256[] memory stakes = new uint256[](validCount);
        
        uint256 idx = 0;
        for (uint256 v = 0; v < scoreVectors.length; v++) {
            if (scoreVectors[v].scores.length > 0) {
                scoresForWorker[idx] = scoreVectors[v].scores;
                stakes[idx] = scoreVectors[v].stake > 0 ? scoreVectors[v].stake : 1 ether;
                idx++;
            }
        }
        
        // Calculate consensus
        Scoring.Params memory params = Scoring.Params({
            alpha: alpha,
            beta: beta,
            kappa: kappa,
            tau: tau
        });
        
        consensusScores = Scoring.consensus(scoresForWorker, stakes, params);
        
        return consensusScores;
    }
    
    function calculateConsensus(
        bytes32 dataHash,
        ScoreVector[] calldata scoreVectors
    ) external override returns (uint8[] memory consensusScores) {
        emit DebugTrace("calculateConsensus_entry", scoreVectors.length, 0);
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(scoreVectors.length > 0, "No score vectors");
        
        // Filter out empty score vectors
        uint256 validCount = 0;
        for (uint256 i = 0; i < scoreVectors.length; i++) {
            emit DebugTrace("filter_loop", i, scoreVectors[i].scores.length);
            if (scoreVectors[i].scores.length > 0) {
                validCount++;
            }
        }
        
        emit DebugScores("after_filter", validCount, scoreVectors.length);
        
        // If no valid scores, return default scores
        if (validCount == 0) {
            emit DebugTrace("returning_defaults", 0, 0);
            consensusScores = new uint8[](5);
            for (uint256 i = 0; i < 5; i++) {
                consensusScores[i] = 50; // Default score
            }
            return consensusScores;
        }
        
        // Convert ScoreVector[] to score matrix and stake vector (only valid ones)
        uint8[][] memory scores = new uint8[][](validCount);
        uint256[] memory stakes = new uint256[](validCount);
        
        uint256 idx = 0;
        for (uint256 i = 0; i < scoreVectors.length; i++) {
            if (scoreVectors[i].scores.length > 0) {
                scores[idx] = scoreVectors[i].scores;
                stakes[idx] = scoreVectors[i].stake > 0 ? scoreVectors[i].stake : 1 ether; // Default stake if 0
                idx++;
            }
        }
        
        // Use Scoring library for consensus calculation
        emit DebugScores("before_Scoring_consensus", scores.length, stakes.length);
        // Log first score vector dimensions
        if (scores.length > 0) {
            emit DebugTrace("first_score_dims", scores[0].length, 0);
        }
        
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
        bool[] memory hasValidScores = new bool[](validators.length);
        uint256 totalWeight = 0;
        uint256 validValidatorCount = 0;
        
        for (uint256 i = 0; i < validators.length; i++) {
            // CRITICAL FIX: Skip validators with empty/missing scores
            // This can happen if validator didn't score the first worker
            if (i >= scoreVectors.length || scoreVectors[i].scores.length == 0) {
                hasValidScores[i] = false;
                continue;
            }
            hasValidScores[i] = true;
            validValidatorCount++;
            
            // Calculate L2 distance from consensus
            uint256 errorSquared = 0;
            uint256 scoresToCompare = scoreVectors[i].scores.length < consensusScores.length 
                ? scoreVectors[i].scores.length 
                : consensusScores.length;
            
            for (uint256 j = 0; j < scoresToCompare; j++) {
                int256 diff = int256(uint256(scoreVectors[i].scores[j])) - int256(uint256(consensusScores[j]));
                errorSquared += uint256(diff * diff);
            }
            
            errors[i] = errorSquared;
            
            // Weight = e^(-β * error²) (simplified as 1 / (1 + error))
            uint256 weight = PRECISION / (PRECISION + errors[i]);
            totalWeight += weight;
        }
        
        // If no valid validators, return early
        if (validValidatorCount == 0) {
            return 0;
        }
        
        // Distribute rewards proportional to accuracy
        for (uint256 i = 0; i < validators.length; i++) {
            // Skip validators without valid scores
            if (!hasValidScores[i]) {
                continue;
            }
            
            if (totalWeight > 0) {
                uint256 weight = PRECISION / (PRECISION + errors[i]);
                uint256 reward = (rewardPool * weight) / totalWeight;
                
                if (reward > 0) {
                    // Route to validator's agentWallet if configured
                    address recipient = _getPaymentRecipient(studioProxy, validators[i]);
                    studioProxy.releaseFunds(recipient, reward, dataHash);
                    totalDistributed += reward;
                }
                
                // Calculate performance score (0-100) based on accuracy
                // Performance = e^(-β * error²) scaled to 0-100
                uint256 performanceScore = (weight * 100) / PRECISION;
                if (performanceScore > 100) performanceScore = 100;
                
                // Publish VA reputation to Reputation Registry (§4.3 protocol_spec_v0.1.md)
                if (i < scoreVectors.length && scoreVectors[i].validatorAgentId != 0) {
                    // Note: In production, feedbackUri would be fetched from validation evidence
                    // For MVP, we pass empty strings (SDK handles feedback creation)
                    _publishValidatorReputation(
                        scoreVectors[i].validatorAgentId,
                        uint8(performanceScore),
                        dataHash,
                        "",           // feedbackUri (would come from SDK/validation evidence)
                        bytes32(0)    // feedbackHash
                    );
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
        // Jan 2026 Update: tag is now string
        try IERC8004Validation(validationRegistry).validationResponse(
            dataHash,                    // requestHash
            uint8(avgScore),            // response (0-100)
            "",                         // responseURI (optional)
            bytes32(0),                 // responseHash (optional)
            "CHAOSCHAIN_CONSENSUS"      // tag (string)
        ) {
            // Success - validation published
        } catch {
            // Failed - likely a mock registry, continue anyway
        }
    }
    
    /**
     * @notice Publish WA multi-dimensional scores to Reputation Registry
     * @dev Called after consensus to build reputation for workers (§4.1 protocol_spec_v0.1.md)
     * 
     * Multi-Dimensional Scoring Architecture:
     * - Publishes ONE feedback per dimension (e.g., Initiative, Accuracy, etc.)
     * - tag1 = dimension name (e.g., "INITIATIVE", "ACCURACY")
     * - tag2 = studio address (for studio-specific filtering)
     * - Allows querying reputation by dimension and studio
     * 
     * Triple-Verified Stack Integration:
     * - feedbackUri contains IntegrityProof (Layer 2: Process Integrity)
     * - feedbackUri contains PaymentProof (Layer 3: x402 payments)
     * - feedbackUri contains XMTP thread for causal audit
     * - SDK creates this automatically via create_feedback_with_payment()
     * 
     * @param studioProxy The Studio proxy address
     * @param workerAgentId The worker's agent ID
     * @param scores Array of scores (one per dimension, 0-100)
     * @param feedbackUri IPFS/Irys URI containing IntegrityProof + PaymentProof + XMTP thread
     * @param feedbackHash Hash of feedback content
     */
    /**
     * @dev Distribute worker rewards (single or multi-agent)
     * @return totalDistributed Total amount distributed
     */
    /**
     * @notice Calculate consensus scores for a specific worker (multi-agent tasks)
     * @dev Retrieves per-worker scores from all validators and calculates consensus
     * @param studioProxy The StudioProxy contract
     * @param dataHash The work hash
     * @param worker The worker address
     * @return consensusScores Consensus scores for this worker (empty if no per-worker scores)
     */
    function _calculateConsensusForWorker(
        StudioProxy studioProxy,
        bytes32 dataHash,
        address worker
    ) internal returns (uint8[] memory consensusScores) {
        // Get validators and their scores for this worker
        (address[] memory validators, bytes[] memory scoreVectors) = 
            studioProxy.getScoreVectorsForWorker(dataHash, worker);
        
        // If no per-worker scores submitted, return empty array (fallback to shared consensus)
        if (validators.length == 0) {
            return new uint8[](0);
        }
        
        // Check if any validator submitted scores for this worker
        bool hasScores = false;
        for (uint256 i = 0; i < scoreVectors.length; i++) {
            if (scoreVectors[i].length > 0) {
                hasScores = true;
                break;
            }
        }
        
        if (!hasScores) {
            return new uint8[](0);
        }
        
        // Build ScoreVector array for consensus calculation
        ScoreVector[] memory scoreVectorStructs = new ScoreVector[](validators.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < validators.length; i++) {
            if (scoreVectors[i].length > 0) {
                // Decode score vector using safe decoder
                uint8[] memory scores = _decodeScoreVector(scoreVectors[i]);
                
                // Skip if decode returned empty (malformed data)
                if (scores.length == 0) continue;
                
                scoreVectorStructs[validCount] = ScoreVector({
                    validatorAgentId: 0, // Would come from IdentityRegistry
                    dataHash: dataHash,
                    stake: 1 ether, // Simplified
                    scores: scores,
                    timestamp: block.timestamp,
                    processed: false
                });
                validCount++;
            }
        }
        
        // If we have valid scores, calculate consensus
        if (validCount > 0) {
            // Resize array to actual count
            ScoreVector[] memory validScoreVectors = new ScoreVector[](validCount);
            for (uint256 i = 0; i < validCount; i++) {
                validScoreVectors[i] = scoreVectorStructs[i];
            }
            
            // Calculate consensus for this worker
            consensusScores = this.calculateConsensus(dataHash, validScoreVectors);
        } else {
            consensusScores = new uint8[](0);
        }
        
        return consensusScores;
    }
    
    function _distributeWorkerRewards(
        address studio,
        StudioProxy studioProxy,
        bytes32 dataHash,
        address fallbackWorker,
        uint256 totalReward,
        uint8[] memory consensusScores
    ) internal returns (uint256 totalDistributed) {
        // Check if multi-agent work (Protocol Spec §4.2)
        address[] memory participants = studioProxy.getWorkParticipants(dataHash);
        
        if (participants.length > 1) {
            // Multi-agent work: Distribute using contribution weights FROM DKG
            uint16[] memory weights = studioProxy.getContributionWeights(dataHash);
            string memory evidenceCID = studioProxy.getEvidenceCID(dataHash);
            
            // Distribute rewards and reputation per worker
            for (uint256 i = 0; i < participants.length; i++) {
                address worker = participants[i];
                
                // 🚨 CRITICAL: Get per-worker consensus scores
                // Each validator submits scores FOR THIS WORKER via submitScoreVectorForWorker()
                uint8[] memory workerConsensus = _calculateConsensusForWorker(
                    studioProxy,
                    dataHash,
                    worker
                );
                
                // If per-worker scores exist, use them; otherwise fallback to shared consensus
                uint8[] memory scoresToUse = workerConsensus.length > 0 ? workerConsensus : consensusScores;
                
                // Calculate quality scalar for THIS worker's consensus
                uint256 workerQuality = _calculateQualityScalar(studio, scoresToUse);
                
                // Reward = contribution weight × quality × totalReward
                // This combines DKG attribution (weights[i]) with verification quality (workerQuality)
                uint256 participantReward = (totalReward * weights[i] * workerQuality) / (10000 * 100);
                
                if (participantReward > 0) {
                    // Route to worker's agentWallet if configured
                    address recipient = _getPaymentRecipient(studioProxy, worker);
                    studioProxy.releaseFunds(recipient, participantReward, dataHash);
                    totalDistributed += participantReward;
                }
                
                // Publish reputation with WORKER-SPECIFIC consensus scores
                uint256 agentId = studioProxy.getAgentId(worker);
                if (agentId != 0) {
                    string memory feedbackUri = bytes(evidenceCID).length > 0 
                        ? string(abi.encodePacked("ipfs://", evidenceCID))
                        : "";
                    bytes32 feedbackHash = bytes(evidenceCID).length > 0
                        ? keccak256(abi.encodePacked(evidenceCID))
                        : bytes32(0);
                    
                    _publishWorkerReputation(
                        studio,
                        agentId,
                        scoresToUse,  // ← WORKER-SPECIFIC CONSENSUS!
                        dataHash,
                        feedbackUri,
                        feedbackHash
                    );
                }
            }
        } else if (participants.length == 1) {
            // Single-agent work - route to agentWallet if configured
            if (totalReward > 0) {
                address recipient = _getPaymentRecipient(studioProxy, participants[0]);
                studioProxy.releaseFunds(recipient, totalReward, dataHash);
                totalDistributed += totalReward;
            }
            
            uint256 agentId = studioProxy.getAgentId(participants[0]);
            if (agentId != 0) {
                string memory evidenceCID = studioProxy.getEvidenceCID(dataHash);
                string memory feedbackUri = bytes(evidenceCID).length > 0 
                    ? string(abi.encodePacked("ipfs://", evidenceCID))
                    : "";
                bytes32 feedbackHash = bytes(evidenceCID).length > 0
                    ? keccak256(abi.encodePacked(evidenceCID))
                    : bytes32(0);
                
                _publishWorkerReputation(
                    studio,
                    agentId,
                    consensusScores,
                    dataHash,
                    feedbackUri,
                    feedbackHash
                );
            }
        } else {
            // Fallback: Use original worker address (backward compatibility)
            if (totalReward > 0) {
                address recipient = _getPaymentRecipient(studioProxy, fallbackWorker);
                studioProxy.releaseFunds(recipient, totalReward, dataHash);
                totalDistributed += totalReward;
            }
            
            uint256 agentId = studioProxy.getAgentId(fallbackWorker);
            if (agentId != 0) {
                _publishWorkerReputation(
                    studio,
                    agentId,
                    consensusScores,
                    dataHash,
                    "",
                    bytes32(0)
                );
            }
        }
        
        return totalDistributed;
    }
    
    /**
     * @dev Publish worker reputation with detailed feedback
     * @dev Jan 2026 Update: feedbackAuth removed, using string tags
     */
    function _publishWorkerReputation(
        address studioProxy,
        uint256 workerAgentId,
        uint8[] memory scores,
        bytes32 dataHash,
        string memory feedbackUri,
        bytes32 feedbackHash
    ) internal {
        // Get ReputationRegistry from registry
        address reputationRegistry = registry.getReputationRegistry();
        if (reputationRegistry == address(0)) return; // Skip if not set
        
        // Check if it's a real contract (has code)
        uint256 size;
        assembly {
            size := extcodesize(reputationRegistry)
        }
        if (size == 0) return; // Skip if not a contract
        
        // Get dimension names from Studio's LogicModule
        (string[] memory dimensionNames, ) = _getStudioDimensions(studioProxy);
        
        // Validate scores match dimensions
        if (scores.length != dimensionNames.length) {
            // Mismatch - skip reputation publishing
            return;
        }
        
        // Studio address as tag2 for filtering (now string per Jan 2026 spec)
        string memory studioTag = _addressToString(studioProxy);
        
        // Publish one feedback per dimension
        for (uint256 i = 0; i < dimensionNames.length; i++) {
            // Jan 2026 Update: No feedbackAuth required, string tags, endpoint added
            try IERC8004Reputation(reputationRegistry).giveFeedback(
                workerAgentId,
                scores[i],           // Score for this dimension (0-100)
                dimensionNames[i],   // tag1: Dimension name (string)
                studioTag,           // tag2: Studio address (string)
                "",                  // endpoint (optional)
                feedbackUri,         // Contains full PoA analysis + proofs
                feedbackHash
            ) {
                // Success - reputation published for this dimension
            } catch {
                // Failed - likely a mock registry or invalid dimension, continue
            }
        }
    }
    
    /**
     * @notice Publish VA performance scores to Reputation Registry
     * @dev Called after consensus to build global verifiable reputation (§4.3 protocol_spec_v0.1.md)
     * @dev Jan 2026 Update: feedbackAuth removed, using string tags
     * 
     * Triple-Verified Stack Integration:
     * - feedbackUri contains IntegrityProof (Layer 2: Process Integrity)
     * - SDK creates this automatically for validators
     * 
     * @param validatorAgentId The validator's agent ID
     * @param performanceScore The performance score (0-100, based on accuracy to consensus)
     * @param feedbackUri IPFS/Irys URI containing IntegrityProof (from SDK)
     * @param feedbackHash Hash of feedback content
     */
    function _publishValidatorReputation(
        uint256 validatorAgentId,
        uint8 performanceScore,
        bytes32 /* dataHash */,
        string memory feedbackUri,
        bytes32 feedbackHash
    ) internal {
        // Get ReputationRegistry from registry
        address reputationRegistry = registry.getReputationRegistry();
        if (reputationRegistry == address(0)) return; // Skip if not set
        
        // Check if it's a real contract (has code)
        uint256 size;
        assembly {
            size := extcodesize(reputationRegistry)
        }
        if (size == 0) return; // Skip if not a contract
        
        // Jan 2026 Update: Tags are now strings, no feedbackAuth required
        try IERC8004Reputation(reputationRegistry).giveFeedback(
            validatorAgentId,
            performanceScore,
            "VALIDATOR_ACCURACY",  // tag1 (string)
            "CONSENSUS_MATCH",     // tag2 (string)
            "",                    // endpoint (optional)
            feedbackUri,           // ✅ Contains IntegrityProof
            feedbackHash           // ✅ Hash of feedback content
        ) {
            // Success - reputation published with Triple-Verified Stack proofs
        } catch {
            // Failed - likely a mock registry or contract issue
        }
    }
    
    /**
     * @notice Calculate Proof of Agency (PoA) based rewards
     * @dev In production, this would analyze XMTP DAG to compute contribution weights
     * 
     * PoA Reward Algorithm (COMPLETE_WORKFLOW_WITH_STUDIOS.md Phase 5):
     * 1. Fetch XMTP thread from evidence package
     * 2. Analyze causal DAG for each participant
     * 3. Compute contribution metrics:
     *    - Initiative: Original contributions (non-reply messages)
     *    - Collaboration: Reply/extend edges
     *    - Reasoning Depth: Path length in DAG
     *    - Leadership: Orchestration of collaboration
     * 4. Calculate contribution weight for each participant
     * 5. Distribute rewards proportionally
     * 
     * For MVP, we use simplified calculation based on quality scores.
     * Full PoA implementation requires off-chain XMTP DAG analysis by VAs.
     * 
     * @param baseReward Total reward pool
     * @param qualityScalar Quality score (0-100)
     * @return poaReward PoA-based reward component
     */
    function _calculatePoAReward(
        uint256 baseReward,
        uint256 qualityScalar
    ) internal pure returns (uint256 poaReward) {
        // Simplified PoA calculation for MVP
        // In production, this would use:
        // - XMTP DAG analysis results from VAs
        // - Multi-dimensional scores (initiative, collaboration, reasoning_depth, etc.)
        // - Shapley-style contribution attribution
        
        // For now: 30% of base reward, weighted by quality
        poaReward = (baseReward * qualityScalar * 30) / 10000;
        
        return poaReward;
    }
    
    /**
     * @notice Distribute rewards based on Proof of Agency
     * @dev Full implementation for multi-agent collaboration scenarios
     * 
     * This function would be called when multiple workers collaborate on a task.
     * It analyzes the XMTP DAG to determine each worker's actual contribution.
     * 
     * Algorithm:
     * 1. For each worker in participants[]:
     *    a. Compute initiative score (original contributions)
     *    b. Compute collaboration score (replies/extensions)
     *    c. Compute reasoning depth (path length)
     *    d. Compute leadership score (orchestration)
     * 2. Calculate contribution weight:
     *    weight_i = (initiative_i + collaboration_i + reasoning_depth_i + leadership_i) / 4
     * 3. Normalize weights: norm_weight_i = weight_i / sum(weights)
     * 4. Distribute rewards: reward_i = totalReward * norm_weight_i
     * 
     * @param studioProxy Studio proxy contract
     * @param dataHash Work submission hash
     * @param participants Array of participant addresses
     * @param poaScores Array of PoA scores for each participant (from VA analysis)
     * @param totalReward Total reward pool to distribute
     * @return totalDistributed Total amount distributed
     */
    function _distributePoARewards(
        StudioProxy studioProxy,
        bytes32 dataHash,
        address[] memory participants,
        uint8[] memory poaScores,
        uint256 totalReward
    ) internal returns (uint256 totalDistributed) {
        require(participants.length == poaScores.length, "Length mismatch");
        require(participants.length > 0, "No participants");
        
        // Calculate total PoA score
        uint256 totalPoAScore = 0;
        for (uint256 i = 0; i < poaScores.length; i++) {
            totalPoAScore += poaScores[i];
        }
        
        require(totalPoAScore > 0, "Invalid PoA scores");
        
        // Distribute rewards proportionally (using agentWallet routing)
        for (uint256 i = 0; i < participants.length; i++) {
            uint256 participantReward = (totalReward * poaScores[i]) / totalPoAScore;
            
            if (participantReward > 0) {
                address recipient = _getPaymentRecipient(studioProxy, participants[i]);
                studioProxy.releaseFunds(recipient, participantReward, dataHash);
                totalDistributed += participantReward;
            }
        }
        
        return totalDistributed;
    }
    
    // ============ Helper Functions ============
    
    /**
     * @notice Get scoring dimensions from Studio's LogicModule
     * @param studioProxy The Studio proxy address
     * @return names Array of dimension names
     * @return weights Array of dimension weights
     */
    function _getStudioDimensions(address studioProxy) internal view returns (
        string[] memory names,
        uint16[] memory weights
    ) {
        // Get LogicModule address from StudioProxy
        address logicModule = StudioProxy(payable(studioProxy)).getLogicModule();
        
        // Call getScoringCriteria() on LogicModule
        // Use low-level call to handle potential failures gracefully
        (bool success, bytes memory data) = logicModule.staticcall(
            abi.encodeWithSignature("getScoringCriteria()")
        );
        
        if (success) {
            (names, weights) = abi.decode(data, (string[], uint16[]));
        } else {
            // Fallback to empty arrays if call fails
            names = new string[](0);
            weights = new uint16[](0);
        }
    }
    
    /**
     * @notice Get the payment recipient for ANY agent (agentWallet routing)
     * @dev ERC-8004 Jan 2026: ALL agents (workers, validators, clients) can set a separate 
     *      wallet for receiving payments via setAgentWallet()
     * 
     * Use cases:
     * - Team of agents (workers + verifiers) sharing a treasury
     * - Company routing ALL agent rewards to corporate wallet  
     * - DAO-controlled agent fleets
     * - Security: operational key separate from reward wallet
     * - Validator pools sharing rewards
     * 
     * @param studioProxy The StudioProxy contract
     * @param agentAddress The agent's registered address (worker, validator, or client)
     * @return recipient The address to send payments to (agentWallet if set, otherwise original)
     */
    function _getPaymentRecipient(
        StudioProxy studioProxy,
        address agentAddress
    ) internal view returns (address recipient) {
        // Get agent ID from studio registration (works for ALL agent types)
        uint256 agentId = studioProxy.getAgentId(agentAddress);
        if (agentId == 0) {
            return agentAddress; // Not registered, use original address
        }
        
        // Try to get agentWallet from Identity Registry
        address identityRegistryAddr = registry.getIdentityRegistry();
        if (identityRegistryAddr == address(0)) {
            return agentAddress; // No registry, use original address
        }
        
        // Check if registry has code
        uint256 size;
        assembly {
            size := extcodesize(identityRegistryAddr)
        }
        if (size == 0) {
            return agentAddress; // Mock/test registry, use original address
        }
        
        // Get agentWallet - if set, use it; otherwise use agent's registered address
        try IERC8004IdentityV1(identityRegistryAddr).getAgentWallet(agentId) returns (address agentWallet) {
            if (agentWallet != address(0)) {
                return agentWallet; // Agent has a configured wallet!
            }
        } catch {
            // getAgentWallet not implemented or failed, use original
        }
        
        return agentAddress; // Fallback to agent's registered address
    }
    
    /**
     * @notice Convert address to hex string (for ERC-8004 tags)
     * @dev Jan 2026 Update: Tags are now strings, not bytes32
     * @param addr The address to convert
     * @return str The hex string representation (e.g., "0x1234...")
     */
    function _addressToString(address addr) internal pure returns (string memory str) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory data = new bytes(42);
        data[0] = '0';
        data[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            data[2 + i * 2] = alphabet[uint8(uint160(addr) >> (8 * (19 - i)) >> 4)];
            data[3 + i * 2] = alphabet[uint8(uint160(addr) >> (8 * (19 - i))) & 0x0f];
        }
        return string(data);
    }
    
    // NOTE: All consensus logic moved to Scoring library (libraries/Scoring.sol)
    // This keeps the RewardsDistributor focused on orchestration and the Scoring
    // library pure and testable.
}
