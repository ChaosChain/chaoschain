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
        
        // TODO: Implement full epoch closure logic
        // This would:
        // 1. Collect all score vectors from Studio
        // 2. Run consensus calculation
        // 3. Distribute rewards to workers
        // 4. Distribute rewards/slashing to validators
        // 5. Publish to ERC-8004 ValidationRegistry
        
        emit EpochClosed(studio, epoch, 0, 0);
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
    
    // ============ Internal Functions ============
    // NOTE: All consensus logic moved to Scoring library (libraries/Scoring.sol)
    // This keeps the RewardsDistributor focused on orchestration and the Scoring
    // library pure and testable.
}
