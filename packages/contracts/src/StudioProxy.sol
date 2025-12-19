// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStudioProxy} from "./interfaces/IStudioProxy.sol";
import {IERC8004IdentityV1} from "./interfaces/IERC8004IdentityV1.sol";
import {IERC8004Reputation} from "./interfaces/IERC8004Reputation.sol";
import {IChaosChainRegistry} from "./interfaces/IChaosChainRegistry.sol";
import {EIP712} from "@openzeppelin/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/**
 * @title StudioProxy
 * @notice Lightweight proxy contract for Studios with delegatecall logic
 * @dev See §3.1.7 in ChaosChain_Implementation_Plan.md
 * 
 * StudioProxy is a minimal contract that:
 * 1. Holds all Studio funds in escrow
 * 2. Stores all Studio state
 * 3. Delegates business logic to LogicModule contracts via DELEGATECALL
 * 
 * This pattern allows shared logic across Studios while keeping state isolated.
 * Each Studio can be upgraded by pointing to a new LogicModule without migration.
 * 
 * Security:
 * - Only ChaosCore or authorized addresses can upgrade logic
 * - Only RewardsDistributor can release funds
 * - All state remains in proxy storage during upgrades
 * 
 * @author ChaosChain
 */
contract StudioProxy is IStudioProxy, EIP712, ReentrancyGuard {
    
    // ============ Constants ============
    
    /// @dev EIP-712 typehash for score submission
    bytes32 private constant SCORE_TYPEHASH = keccak256(
        "ScoreSubmission(bytes32 workId,bytes scoreVector,uint256 nonce,uint256 deadline)"
    );
    
    /// @dev EIP-712 typehash for DataHash (§1.4, §5.1 protocol_spec_v0.1.md)
    bytes32 private constant DATAHASH_TYPEHASH = keccak256(
        "DataHash(address studio,uint64 epoch,bytes32 demandHash,bytes32 threadRoot,bytes32 evidenceRoot,bytes32 paramsHash)"
    );
    
    // ============ Storage Layout ============
    // CRITICAL: Storage layout must never change to maintain upgrade safety
    
    /// @dev Slot 0: ChaosCore factory address (immutable after deployment)
    address private immutable _chaosCore;
    
    /// @dev Slot 1: ChaosChainRegistry address (immutable after deployment)
    address private immutable _registry;
    
    /// @dev Slot 2: Current logic module address
    address private _logicModule;
    
    /// @dev Slot 3: RewardsDistributor address (can be updated by ChaosCore)
    address private _rewardsDistributor;
    
    /// @dev Slot 3+: Escrow balances (account => balance)
    mapping(address => uint256) private _escrowBalances;
    
    /// @dev Work submissions (dataHash => submitter)
    mapping(bytes32 => address) private _workSubmissions;
    
    /// @dev Multi-agent participants (dataHash => participant addresses)
    mapping(bytes32 => address[]) private _workParticipants;
    
    /// @dev Contribution weights per participant (dataHash => participant => weight in basis points)
    /// Sum of all weights must equal 10000 (100%)
    mapping(bytes32 => mapping(address => uint16)) private _contributionWeights;
    
    /// @dev Evidence package CID (dataHash => IPFS/Arweave CID)
    mapping(bytes32 => string) private _evidenceCIDs;
    
    /// @dev Score vectors (dataHash => validator => scoreVector)
    /// For backward compatibility (single-agent or legacy multi-agent)
    mapping(bytes32 => mapping(address => bytes)) private _scoreVectors;
    
    /// @dev Per-worker score vectors (dataHash => validator => worker => scoreVector)
    /// For multi-agent tasks: Each validator submits scores for EACH worker
    mapping(bytes32 => mapping(address => mapping(address => bytes))) private _scoreVectorsPerWorker;
    
    /// @dev Track which validators have submitted scores for a work
    mapping(bytes32 => address[]) private _validators;
    
    /// @dev Total escrow in the Studio
    uint256 private _totalEscrow;
    
    /// @dev Nonces for EIP-712 score submission (validator => workId => nonce)
    mapping(address => mapping(bytes32 => uint256)) private _scoreNonces;
    
    /// @dev Withdrawable balances for pull payment pattern (address => amount)
    mapping(address => uint256) private _withdrawable;
    
    /// @dev Commit-reveal: Score commitments (dataHash => validator => commitment)
    mapping(bytes32 => mapping(address => bytes32)) private _scoreCommitments;
    
    /// @dev Commit-reveal: Commit deadline per work (dataHash => deadline)
    mapping(bytes32 => uint256) private _commitDeadlines;
    
    /// @dev Commit-reveal: Reveal deadline per work (dataHash => deadline)
    mapping(bytes32 => uint256) private _revealDeadlines;
    
    /// @dev Agent registration: address => agentId (0 if not registered)
    mapping(address => uint256) private _agentIds;
    
    /// @dev Agent stakes: agentId => stake amount
    mapping(uint256 => uint256) private _agentStakes;
    
    /// @dev FeedbackAuth signatures: dataHash => workerAddress => feedbackAuth
    mapping(bytes32 => mapping(address => bytes)) private _feedbackAuths;
    
    // ============ Custom Dimensions (Protocol Spec §3.1, §4.1) ============
    
    /// @dev Precision for fixed-point math (6 decimals)
    uint256 private constant PRECISION = 1e6;
    
    /// @dev Number of universal PoA dimensions (§3.1 - ALWAYS from DKG)
    /// [Initiative, Collaboration, Reasoning Depth, Compliance, Efficiency]
    uint8 public constant UNIVERSAL_DIMENSIONS = 5;
    
    /// @dev Studio-specific custom dimension names (§3.1 studio-specific)
    string[] private _customDimensionNames;
    
    /// @dev Studio-specific custom dimension weights (ρ_d from §4.1)
    /// Must sum to PRECISION when normalized
    mapping(string => uint256) private _customDimensionWeights;
    
    /// @dev Universal vs Custom weight split (§4.1)
    /// Default: 70% universal (DKG-based), 30% custom (studio-specific)
    uint256 private _universalWeight = 700000;  // 70%
    uint256 private _customWeight = 300000;     // 30%
    
    /// @dev Agent role enum (aligned with SDK: SERVER=WORKER, VALIDATOR=VERIFIER, CLIENT=CLIENT)
    enum AgentRole {
        NONE,               // 0 - Not registered
        WORKER,             // 1 - Performs tasks (SDK: SERVER)
        VERIFIER,           // 2 - Validates work (SDK: VALIDATOR)
        CLIENT,             // 3 - Requests & pays for work (SDK: CLIENT)
        WORKER_VERIFIER,    // 4 - Can do worker + verifier
        WORKER_CLIENT,      // 5 - Can do worker + client
        VERIFIER_CLIENT,    // 6 - Can do verifier + client
        ALL                 // 7 - Can do all three roles
    }
    
    /// @dev Agent roles: agentId => role
    mapping(uint256 => AgentRole) private _agentRoles;
    
    /// @dev Task struct for client reputation tracking
    struct Task {
        uint256 clientAgentId;      // Client who created task
        uint256 workerAgentId;      // Worker assigned to task
        bytes32 dataHash;           // Work submission hash
        uint256 reward;             // Payment amount
        uint256 createdAt;          // Task creation timestamp
        uint256 completedAt;        // Task completion timestamp
        bool completed;             // Task status
        string paymentProofUri;     // IPFS/Irys URI with x402 PaymentProof
        bytes32 paymentProofHash;   // Hash of payment proof
    }
    
    /// @dev Task ID => Task
    mapping(bytes32 => Task) private _tasks;
    
    /// @dev Client agent ID => Task IDs
    mapping(uint256 => bytes32[]) private _clientTasks;
    
    // ============ Events ============
    
    /**
     * @dev Emitted when an agent registers with the Studio
     */
    event AgentRegistered(uint256 indexed agentId, address indexed agentAddress, uint8 role, uint256 stake);
    
    /**
     * @dev Emitted when an agent's stake is updated
     */
    event StakeUpdated(uint256 indexed agentId, uint256 oldStake, uint256 newStake);
    
    /**
     * @dev Emitted when a client creates a task
     */
    event TaskCreated(
        bytes32 indexed taskId,
        uint256 indexed clientAgentId,
        uint256 reward,
        string description
    );
    
    /**
     * @dev Emitted when custom dimensions are configured (Protocol Spec §3.1, §4.1)
     * @param dimensionNames Array of custom dimension names
     * @param dimensionWeights Array of weights (sum to PRECISION)
     */
    event CustomDimensionsSet(string[] dimensionNames, uint256[] dimensionWeights);
    
    /**
     * @dev Emitted when universal/custom weight split is updated (Protocol Spec §4.1)
     * @param universalWeight Weight for universal PoA dimensions (DKG-based)
     * @param customWeight Weight for custom studio dimensions
     */
    event WeightSplitUpdated(uint256 universalWeight, uint256 customWeight);
    
    /**
     * @dev Emitted when a score vector is submitted for a specific worker (multi-agent)
     * @param validatorAgentId ID of the validator agent
     * @param dataHash Work hash
     * @param worker Worker address being scored
     * @param scoreVector Score vector for this worker
     * @param timestamp Submission timestamp
     */
    event ScoreVectorSubmittedForWorker(
        uint256 indexed validatorAgentId,
        bytes32 indexed dataHash,
        address indexed worker,
        bytes scoreVector,
        uint256 timestamp
    );
    
    /**
     * @dev Emitted when a task is completed
     */
    event TaskCompleted(
        bytes32 indexed taskId,
        uint256 indexed workerAgentId,
        bytes32 dataHash,
        uint256 completedAt
    );
    
    /**
     * @dev Emitted when client reputation is published
     */
    event ClientReputationPublished(
        uint256 indexed clientAgentId,
        bytes32 indexed taskId,
        uint8 score,
        string feedbackUri
    );
    
    // ============ Modifiers ============
    
    /**
     * @dev Only ChaosCore can call
     */
    modifier onlyChaosCore() {
        require(msg.sender == _chaosCore, "Only ChaosCore");
        _;
    }
    
    /**
     * @dev Only RewardsDistributor can call
     */
    modifier onlyRewardsDistributor() {
        require(msg.sender == _rewardsDistributor, "Only RewardsDistributor");
        _;
    }
    
    // ============ Constructor ============
    
    /**
     * @dev Initialize the proxy
     * @param chaosCore_ The ChaosCore factory address
     * @param registry_ The ChaosChainRegistry address
     * @param logicModule_ The initial logic module address
     * @param rewardsDistributor_ The RewardsDistributor address
     */
    constructor(
        address chaosCore_,
        address registry_,
        address logicModule_,
        address rewardsDistributor_
    ) EIP712("ChaosChain StudioProxy", "1") {
        require(chaosCore_ != address(0), "Invalid ChaosCore");
        require(registry_ != address(0), "Invalid registry");
        require(logicModule_ != address(0), "Invalid logic module");
        require(rewardsDistributor_ != address(0), "Invalid RewardsDistributor");
        
        _chaosCore = chaosCore_;
        _registry = registry_;
        _logicModule = logicModule_;
        _rewardsDistributor = rewardsDistributor_;
    }
    
    // ============ Core Functions ============
    
    /// @inheritdoc IStudioProxy
    function getLogicModule() external view override returns (address) {
        return _logicModule;
    }
    
    /// @inheritdoc IStudioProxy
    function upgradeLogicModule(address newLogic) external override onlyChaosCore {
        require(newLogic != address(0), "Invalid logic module");
        require(newLogic != _logicModule, "Same logic module");
        
        address oldLogic = _logicModule;
        _logicModule = newLogic;
        
        emit LogicModuleUpgraded(oldLogic, newLogic);
    }
    
    /// @inheritdoc IStudioProxy
    function submitWork(
        bytes32 dataHash,
        bytes32 threadRoot,
        bytes32 evidenceRoot,
        bytes calldata feedbackAuth
    ) external override {
        // Call internal multi-agent version with single participant
        address[] memory participants = new address[](1);
        participants[0] = msg.sender;
        
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10000; // 100% contribution
        
        _submitWorkInternal(dataHash, threadRoot, evidenceRoot, feedbackAuth, participants, weights, "");
    }
    
    /**
     * @notice Submit work with multi-agent attribution (Protocol Spec §4.2)
     * @param dataHash The work data hash
     * @param threadRoot The XMTP thread root
     * @param evidenceRoot The evidence Merkle root
     * @param feedbackAuth The feedback authorization signature
     * @param participants Array of participant addresses (from DKG analysis)
     * @param contributionWeights Array of contribution weights in basis points (sum = 10000)
     * @param evidenceCID IPFS/Arweave CID of evidence package
     */
    function submitWorkMultiAgent(
        bytes32 dataHash,
        bytes32 threadRoot,
        bytes32 evidenceRoot,
        bytes calldata feedbackAuth,
        address[] calldata participants,
        uint16[] calldata contributionWeights,
        string calldata evidenceCID
    ) external {
        _submitWorkInternal(dataHash, threadRoot, evidenceRoot, feedbackAuth, participants, contributionWeights, evidenceCID);
    }
    
    /**
     * @dev Internal work submission with multi-agent support
     */
    function _submitWorkInternal(
        bytes32 dataHash,
        bytes32 threadRoot,
        bytes32 evidenceRoot,
        bytes calldata feedbackAuth,
        address[] memory participants,
        uint16[] memory contributionWeights,
        string memory evidenceCID
    ) internal {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(threadRoot != bytes32(0), "Invalid threadRoot");
        require(evidenceRoot != bytes32(0), "Invalid evidenceRoot");
        require(_workSubmissions[dataHash] == address(0), "Work already submitted");
        require(feedbackAuth.length >= 65, "Invalid feedbackAuth"); // ECDSA signature is 65 bytes
        require(participants.length > 0, "No participants");
        require(participants.length == contributionWeights.length, "Length mismatch");
        
        // Verify submitter is in participants list
        bool isParticipant = false;
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i] == msg.sender) {
                isParticipant = true;
                break;
            }
        }
        require(isParticipant, "Submitter not in participants");
        
        // Verify all participants are registered workers
        uint256 submitterAgentId = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            uint256 agentId = _agentIds[participants[i]];
            require(agentId != 0, "Participant not registered");
            require(hasWorkerRole(_agentRoles[agentId]), "Participant not a worker");
            
            if (participants[i] == msg.sender) {
                submitterAgentId = agentId;
            }
        }
        
        // Verify contribution weights sum to 10000 (100%)
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < contributionWeights.length; i++) {
            totalWeight += contributionWeights[i];
        }
        require(totalWeight == 10000, "Weights must sum to 10000");
        
        // Store work submission
        _workSubmissions[dataHash] = msg.sender;
        _feedbackAuths[dataHash][msg.sender] = feedbackAuth;
        
        // Store participants and weights
        _workParticipants[dataHash] = participants;
        for (uint256 i = 0; i < participants.length; i++) {
            _contributionWeights[dataHash][participants[i]] = contributionWeights[i];
        }
        
        // Store evidence CID if provided
        if (bytes(evidenceCID).length > 0) {
            _evidenceCIDs[dataHash] = evidenceCID;
        }
        
        emit WorkSubmitted(submitterAgentId, dataHash, threadRoot, evidenceRoot, block.timestamp);
    }
    
    /// @inheritdoc IStudioProxy
    function submitScoreVector(bytes32 dataHash, bytes calldata scoreVector) external override {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(scoreVector.length > 0, "Empty score vector");
        
        // Verify agent is registered with verifier role
        uint256 agentId = _agentIds[msg.sender];
        require(agentId != 0, "Agent not registered with Studio");
        require(hasVerifierRole(_agentRoles[agentId]), "Not a verifier agent");
        
        _scoreVectors[dataHash][msg.sender] = scoreVector;
        _scoreNonces[msg.sender][dataHash]++;
        
        // Track validator
        _addValidator(dataHash, msg.sender);
        
        emit ScoreVectorSubmitted(agentId, dataHash, scoreVector, block.timestamp);
    }
    
    /**
     * @notice Submit score vector for a specific worker (multi-agent tasks)
     * @dev For multi-agent tasks, verifiers submit scores FOR EACH WORKER separately
     * @param dataHash The work hash
     * @param worker The worker address being scored
     * @param scoreVector The score vector for this worker
     */
    function submitScoreVectorForWorker(
        bytes32 dataHash,
        address worker,
        bytes calldata scoreVector
    ) external {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(worker != address(0), "Invalid worker");
        require(scoreVector.length > 0, "Empty score vector");
        
        // Verify agent is registered with verifier role
        uint256 agentId = _agentIds[msg.sender];
        require(agentId != 0, "Agent not registered with Studio");
        require(hasVerifierRole(_agentRoles[agentId]), "Not a verifier agent");
        
        // Verify worker is a participant
        address[] memory participants = _workParticipants[dataHash];
        bool isParticipant = false;
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i] == worker) {
                isParticipant = true;
                break;
            }
        }
        require(isParticipant, "Worker not a participant");
        
        // Store score vector for this worker
        _scoreVectorsPerWorker[dataHash][msg.sender][worker] = scoreVector;
        _scoreNonces[msg.sender][dataHash]++;
        
        // Track validator
        _addValidator(dataHash, msg.sender);
        
        emit ScoreVectorSubmittedForWorker(agentId, dataHash, worker, scoreVector, block.timestamp);
    }
    
    /**
     * @dev Add validator to tracking list (avoid duplicates)
     */
    function _addValidator(bytes32 dataHash, address validator) internal {
        address[] storage validators = _validators[dataHash];
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == validator) {
                return; // Already tracked
            }
        }
        validators.push(validator);
    }
    
    /**
     * @notice Submit score vector with EIP-712 signature (anti-replay protection)
     * @param dataHash The work hash
     * @param scoreVector The score vector
     * @param deadline Signature expiration timestamp
     * @param signature EIP-712 signature from validator
     */
    function submitScoreVectorSigned(
        bytes32 dataHash,
        bytes calldata scoreVector,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "Signature expired");
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(scoreVector.length > 0, "Empty score vector");
        
        // Get current nonce
        uint256 nonce = _scoreNonces[msg.sender][dataHash];
        
        // Reconstruct EIP-712 hash
        bytes32 structHash = keccak256(abi.encode(
            SCORE_TYPEHASH,
            dataHash,
            keccak256(scoreVector),
            nonce,
            deadline
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        
        // Recover signer and verify
        address signer = ECDSA.recover(digest, signature);
        require(signer == msg.sender, "Invalid signature");
        
        // Store score and increment nonce
        _scoreVectors[dataHash][msg.sender] = scoreVector;
        _scoreNonces[msg.sender][dataHash]++;
        
        emit ScoreVectorSubmitted(0, dataHash, scoreVector, block.timestamp);
    }
    
    /// @inheritdoc IStudioProxy
    function releaseFunds(
        address to,
        uint256 amount,
        bytes32 dataHash
    ) external override onlyRewardsDistributor nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(amount <= _totalEscrow, "Insufficient escrow");
        
        // Use pull payment pattern - credit withdrawable balance
        _totalEscrow -= amount;
        _withdrawable[to] += amount;
        
        emit FundsReleased(to, amount, dataHash);
    }
    
    /**
     * @notice Withdraw funds (pull payment pattern)
     * @dev Prevents reentrancy by using pull over push
     */
    function withdraw() external nonReentrant {
        uint256 amount = _withdrawable[msg.sender];
        require(amount > 0, "No funds to withdraw");
        
        _withdrawable[msg.sender] = 0;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }
    
    /// @inheritdoc IStudioProxy
    function getEscrowBalance(address account) external view override returns (uint256) {
        return _escrowBalances[account];
    }
    
    /// @inheritdoc IStudioProxy
    function deposit() external payable override {
        require(msg.value > 0, "No value sent");
        
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
    }
    
    // ============ Public View Functions ============
    
    /**
     * @notice Get total escrow in the Studio
     * @return total The total escrow amount
     */
    function getTotalEscrow() external view returns (uint256 total) {
        return _totalEscrow;
    }
    
    /**
     * @notice Get feedbackAuth signature for a work submission
     * @param dataHash The work dataHash
     * @param worker The worker address
     * @return feedbackAuth The EIP-712 signed feedbackAuth
     */
    function getFeedbackAuth(bytes32 dataHash, address worker) external view returns (bytes memory feedbackAuth) {
        return _feedbackAuths[dataHash][worker];
    }
    
    /**
     * @notice Get work submitter
     * @param dataHash The work hash
     * @return submitter The submitter address
     */
    function getWorkSubmitter(bytes32 dataHash) external view returns (address submitter) {
        return _workSubmissions[dataHash];
    }
    
    /**
     * @notice Get score vector for a validator
     * @param dataHash The work hash
     * @param validator The validator address
     * @return scoreVector The score vector
     */
    function getScoreVector(bytes32 dataHash, address validator) external view returns (bytes memory scoreVector) {
        return _scoreVectors[dataHash][validator];
    }
    
    /**
     * @notice Get RewardsDistributor address
     * @return distributor The RewardsDistributor address
     */
    function getRewardsDistributor() external view returns (address distributor) {
        return _rewardsDistributor;
    }
    
    /**
     * @notice Get participants for a work submission (Protocol Spec §4.2)
     * @param dataHash The work hash
     * @return participants Array of participant addresses
     */
    function getWorkParticipants(bytes32 dataHash) external view returns (address[] memory participants) {
        return _workParticipants[dataHash];
    }
    
    /**
     * @notice Get contribution weight for a participant (Protocol Spec §4.2)
     * @param dataHash The work hash
     * @param participant The participant address
     * @return weight Contribution weight in basis points (0-10000)
     */
    function getContributionWeight(bytes32 dataHash, address participant) external view returns (uint16 weight) {
        return _contributionWeights[dataHash][participant];
    }
    
    /**
     * @notice Get all contribution weights for a work submission
     * @param dataHash The work hash
     * @return weights Array of contribution weights in basis points
     */
    function getContributionWeights(bytes32 dataHash) external view returns (uint16[] memory weights) {
        address[] memory participants = _workParticipants[dataHash];
        weights = new uint16[](participants.length);
        for (uint256 i = 0; i < participants.length; i++) {
            weights[i] = _contributionWeights[dataHash][participants[i]];
        }
        return weights;
    }
    
    /**
     * @notice Get evidence package CID
     * @param dataHash The work hash
     * @return evidenceCID IPFS/Arweave CID
     */
    function getEvidenceCID(bytes32 dataHash) external view returns (string memory evidenceCID) {
        return _evidenceCIDs[dataHash];
    }
    
    /**
     * @notice Get score submission nonce for replay protection
     * @param validator The validator address
     * @param workId The work ID
     * @return nonce The current nonce
     */
    function getScoreNonce(address validator, bytes32 workId) external view returns (uint256 nonce) {
        return _scoreNonces[validator][workId];
    }
    
    /**
     * @notice Get withdrawable balance (pull payment pattern)
     * @param account The account to check
     * @return balance The withdrawable balance
     */
    function getWithdrawableBalance(address account) external view returns (uint256 balance) {
        return _withdrawable[account];
    }
    
    /**
     * @notice Update RewardsDistributor address
     * @dev Can only be called by ChaosCore
     * @param newDistributor The new RewardsDistributor address
     */
    function setRewardsDistributor(address newDistributor) external onlyChaosCore {
        require(newDistributor != address(0), "Invalid distributor");
        _rewardsDistributor = newDistributor;
    }
    
    // ============ DataHash EIP-712 Functions (§1.4, §5.1) ============
    
    /**
     * @notice Verify DataHash EIP-712 signature (protocol compliance)
     * @dev Implements the DataHash pattern from protocol_spec_v0.1.md §1.4
     * @param studio The studio address
     * @param epoch The studio epoch
     * @param demandHash Hash of task demand/intent
     * @param threadRoot VLC/Merkle root of XMTP thread
     * @param evidenceRoot Merkle root of Irys payloads
     * @param paramsHash Hash of policy params/config
     * @param signature EIP-712 signature
     * @return signer The recovered signer address
     */
    function verifyDataHash(
        address studio,
        uint64 epoch,
        bytes32 demandHash,
        bytes32 threadRoot,
        bytes32 evidenceRoot,
        bytes32 paramsHash,
        bytes calldata signature
    ) external view returns (address signer) {
        // Reconstruct EIP-712 hash
        bytes32 structHash = keccak256(abi.encode(
            DATAHASH_TYPEHASH,
            studio,
            epoch,
            demandHash,
            threadRoot,
            evidenceRoot,
            paramsHash
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        
        // Recover and return signer
        return ECDSA.recover(digest, signature);
    }
    
    /**
     * @notice Compute DataHash for verification (helper function)
     * @param studio The studio address
     * @param epoch The studio epoch
     * @param demandHash Hash of task demand
     * @param threadRoot VLC/Merkle root of XMTP thread
     * @param evidenceRoot Merkle root of Irys payloads
     * @param paramsHash Hash of policy params
     * @return dataHash The computed DataHash
     */
    function computeDataHash(
        address studio,
        uint64 epoch,
        bytes32 demandHash,
        bytes32 threadRoot,
        bytes32 evidenceRoot,
        bytes32 paramsHash
    ) external view returns (bytes32 dataHash) {
        bytes32 structHash = keccak256(abi.encode(
            DATAHASH_TYPEHASH,
            studio,
            epoch,
            demandHash,
            threadRoot,
            evidenceRoot,
            paramsHash
        ));
        
        return _hashTypedDataV4(structHash);
    }
    
    // ============ Commit-Reveal Protocol (§2.4) ============
    
    /**
     * @notice Set commit and reveal deadlines for a work submission
     * @dev Called by RewardsDistributor when work is submitted
     * @param dataHash The work hash
     * @param commitWindow Duration of commit phase (seconds)
     * @param revealWindow Duration of reveal phase (seconds)
     */
    function setCommitRevealDeadlines(
        bytes32 dataHash,
        uint256 commitWindow,
        uint256 revealWindow
    ) external onlyRewardsDistributor {
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(commitWindow > 0 && revealWindow > 0, "Invalid windows");
        
        _commitDeadlines[dataHash] = block.timestamp + commitWindow;
        _revealDeadlines[dataHash] = _commitDeadlines[dataHash] + revealWindow;
    }
    
    /**
     * @notice Commit to a score vector (phase 1 of commit-reveal)
     * @dev Prevents last-mover advantage and copycatting (§2.4)
     * @param dataHash The work hash
     * @param commitment keccak256(scoreVector || salt || dataHash)
     */
    function commitScore(bytes32 dataHash, bytes32 commitment) external {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(block.timestamp <= _commitDeadlines[dataHash], "Commit phase ended");
        require(_scoreCommitments[dataHash][msg.sender] == bytes32(0), "Already committed");
        require(commitment != bytes32(0), "Invalid commitment");
        
        _scoreCommitments[dataHash][msg.sender] = commitment;
        
        emit ScoreCommitted(dataHash, msg.sender, commitment);
    }
    
    /**
     * @notice Reveal score vector (phase 2 of commit-reveal)
     * @dev Must match previous commitment
     * @param dataHash The work hash
     * @param scoreVector The actual score vector
     * @param salt The random salt used in commitment
     */
    function revealScore(
        bytes32 dataHash,
        bytes calldata scoreVector,
        bytes32 salt
    ) external {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(block.timestamp > _commitDeadlines[dataHash], "Commit phase not ended");
        require(block.timestamp <= _revealDeadlines[dataHash], "Reveal phase ended");
        require(scoreVector.length > 0, "Empty score vector");
        
        // Verify commitment matches
        bytes32 expectedCommitment = keccak256(abi.encodePacked(scoreVector, salt, dataHash));
        bytes32 actualCommitment = _scoreCommitments[dataHash][msg.sender];
        require(actualCommitment != bytes32(0), "No commitment found");
        require(expectedCommitment == actualCommitment, "Commitment mismatch");
        
        // Store score vector
        _scoreVectors[dataHash][msg.sender] = scoreVector;
        _scoreNonces[msg.sender][dataHash]++;
        
        // Clear commitment
        delete _scoreCommitments[dataHash][msg.sender];
        
        emit ScoreRevealed(dataHash, msg.sender, scoreVector);
        emit ScoreVectorSubmitted(0, dataHash, scoreVector, block.timestamp);
    }
    
    /**
     * @notice Get commit deadline for a work
     * @param dataHash The work hash
     * @return deadline The commit deadline timestamp
     */
    function getCommitDeadline(bytes32 dataHash) external view returns (uint256 deadline) {
        return _commitDeadlines[dataHash];
    }
    
    /**
     * @notice Get reveal deadline for a work
     * @param dataHash The work hash
     * @return deadline The reveal deadline timestamp
     */
    function getRevealDeadline(bytes32 dataHash) external view returns (uint256 deadline) {
        return _revealDeadlines[dataHash];
    }
    
    /**
     * @notice Get score commitment for a validator
     * @param dataHash The work hash
     * @param validator The validator address
     * @return commitment The commitment hash
     */
    function getScoreCommitment(bytes32 dataHash, address validator) external view returns (bytes32 commitment) {
        return _scoreCommitments[dataHash][validator];
    }
    
    // ============ Role Helper Functions ============
    
    /**
     * @notice Check if agent has worker role
     */
    function hasWorkerRole(AgentRole role) internal pure returns (bool) {
        return role == AgentRole.WORKER || 
               role == AgentRole.WORKER_VERIFIER || 
               role == AgentRole.WORKER_CLIENT || 
               role == AgentRole.ALL;
    }
    
    /**
     * @notice Check if agent has verifier role
     */
    function hasVerifierRole(AgentRole role) internal pure returns (bool) {
        return role == AgentRole.VERIFIER || 
               role == AgentRole.WORKER_VERIFIER || 
               role == AgentRole.VERIFIER_CLIENT || 
               role == AgentRole.ALL;
    }
    
    /**
     * @notice Check if agent has client role
     */
    function hasClientRole(AgentRole role) internal pure returns (bool) {
        return role == AgentRole.CLIENT || 
               role == AgentRole.WORKER_CLIENT || 
               role == AgentRole.VERIFIER_CLIENT || 
               role == AgentRole.ALL;
    }
    
    // ============ Agent Registration Functions ============
    
    /**
     * @notice Register an agent with the Studio
     * @dev Agent must be registered in ERC-8004 Identity Registry first
     * @param agentId The agent ID from ERC-8004 Identity Registry
     * @param role The agent role (see AgentRole enum)
     */
    function registerAgent(uint256 agentId, AgentRole role) external payable {
        require(agentId != 0, "Invalid agent ID");
        require(role != AgentRole.NONE, "Invalid role");
        require(_agentIds[msg.sender] == 0, "Already registered");
        require(msg.value > 0, "Stake required");
        
        // Verify agent is registered in ERC-8004 Identity Registry and owned by msg.sender
        address identityRegistry = IChaosChainRegistry(_registry).getIdentityRegistry();
        require(identityRegistry != address(0), "Identity Registry not set");
        
        // Verify ownership of the agent NFT
        address owner = IERC8004IdentityV1(identityRegistry).ownerOf(agentId);
        require(owner == msg.sender, "Not agent owner");
        
        // Register agent with Studio
        _agentIds[msg.sender] = agentId;
        _agentRoles[agentId] = role;
        _agentStakes[agentId] = msg.value;
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
        
        emit AgentRegistered(agentId, msg.sender, uint8(role), msg.value);
    }
    
    /**
     * @notice Update agent stake
     * @dev Add more stake to existing registration
     */
    function addStake() external payable {
        uint256 agentId = _agentIds[msg.sender];
        require(agentId != 0, "Not registered");
        require(msg.value > 0, "No stake provided");
        
        uint256 oldStake = _agentStakes[agentId];
        uint256 newStake = oldStake + msg.value;
        
        _agentStakes[agentId] = newStake;
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
        
        emit StakeUpdated(agentId, oldStake, newStake);
    }
    
    /**
     * @notice Get agent ID for an address
     * @param agent The agent address
     * @return agentId The agent ID (0 if not registered)
     */
    function getAgentId(address agent) external view returns (uint256 agentId) {
        return _agentIds[agent];
    }
    
    /**
     * @notice Get agent role
     * @param agentId The agent ID
     * @return role The agent role (see AgentRole enum)
     */
    function getAgentRole(uint256 agentId) external view returns (AgentRole role) {
        return _agentRoles[agentId];
    }
    
    /**
     * @notice Get agent stake
     * @param agentId The agent ID
     * @return stake The agent stake amount
     */
    function getAgentStake(uint256 agentId) external view returns (uint256 stake) {
        return _agentStakes[agentId];
    }
    
    // ============ Client Reputation & Task Management ============
    
    /**
     * @notice Client creates a task and funds escrow
     * @dev Client must be registered with CLIENT role
     * @param taskDescription Description of the task
     * @param reward Reward amount for completion
     * @param paymentProofUri IPFS/Irys URI with x402 PaymentProof
     * @param paymentProofHash Hash of payment proof
     * @return taskId The created task ID
     */
    function createTask(
        string calldata taskDescription,
        uint256 reward,
        string calldata paymentProofUri,
        bytes32 paymentProofHash
    ) external payable returns (bytes32 taskId) {
        // Verify client is registered
        uint256 agentId = _agentIds[msg.sender];
        require(agentId != 0, "Agent not registered");
        require(hasClientRole(_agentRoles[agentId]), "Not a client agent");
        require(msg.value >= reward, "Insufficient payment");
        
        // Create task ID
        taskId = keccak256(abi.encodePacked(
            msg.sender,
            block.timestamp,
            taskDescription
        ));
        
        // Store task
        _tasks[taskId] = Task({
            clientAgentId: agentId,
            workerAgentId: 0,
            dataHash: bytes32(0),
            reward: reward,
            createdAt: block.timestamp,
            completedAt: 0,
            completed: false,
            paymentProofUri: paymentProofUri,
            paymentProofHash: paymentProofHash
        });
        
        // Track client's tasks
        _clientTasks[agentId].push(taskId);
        
        // Escrow funds
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
        
        emit TaskCreated(taskId, agentId, reward, taskDescription);
        
        return taskId;
    }
    
    /**
     * @notice Mark task as completed after work validation
     * @dev Called by RewardsDistributor after consensus
     * @param taskId The task ID
     * @param workerAgentId The worker who completed the task
     * @param dataHash The work submission hash
     */
    function completeTask(
        bytes32 taskId,
        uint256 workerAgentId,
        bytes32 dataHash
    ) external onlyRewardsDistributor {
        Task storage task = _tasks[taskId];
        require(!task.completed, "Task already completed");
        require(task.clientAgentId != 0, "Task not found");
        
        // Update task
        task.workerAgentId = workerAgentId;
        task.dataHash = dataHash;
        task.completedAt = block.timestamp;
        task.completed = true;
        
        emit TaskCompleted(taskId, workerAgentId, dataHash, block.timestamp);
        
        // Publish client reputation
        _publishClientReputation(task);
    }
    
    /**
     * @notice Publish client reputation after task completion
     * @dev Called internally after task completion
     * 
     * Triple-Verified Stack Integration:
     * - feedbackUri contains PaymentProof (Layer 3: x402 payments)
     * - SDK creates this automatically via create_feedback_with_payment()
     * 
     * @param task The completed task
     */
    function _publishClientReputation(Task storage task) internal {
        // Import IERC8004Reputation interface
        IERC8004Reputation reputationRegistry = IERC8004Reputation(
            IChaosChainRegistry(_registry).getReputationRegistry()
        );
        
        // Check if registry exists
        if (address(reputationRegistry) == address(0)) return;
        
        // Check if it's a real contract
        uint256 size;
        assembly {
            size := extcodesize(reputationRegistry)
        }
        if (size == 0) return;
        
        // Calculate client score (0-100)
        uint8 score = 0;
        
        // On-time payment (within 24 hours of task creation)
        bool onTimePayment = (task.completedAt - task.createdAt) <= 24 hours;
        if (onTimePayment) score += 50;
        
        // Clear requirements (task completed successfully)
        if (task.completed) score += 50;
        
        // Prepare feedback data
        bytes32 tag1 = bytes32("CLIENT_RELIABILITY");
        bytes32 tag2 = task.dataHash; // Link to specific work
        
        // Try to publish feedback with x402 PaymentProof
        // feedbackUri contains: PaymentProof (x402 transaction details)
        // Note: In production, this would use proper feedbackAuth signature
        try reputationRegistry.giveFeedback(
            task.clientAgentId,
            score,
            tag1,
            tag2,
            task.paymentProofUri,     // ✅ Contains x402 PaymentProof
            task.paymentProofHash,    // ✅ Hash of payment proof
            new bytes(0)              // feedbackAuth (would need proper signature)
        ) {
            emit ClientReputationPublished(
                task.clientAgentId,
                keccak256(abi.encodePacked(task.clientAgentId, task.dataHash)),
                score,
                task.paymentProofUri
            );
        } catch {
            // Failed - likely needs proper authorization or mock registry
        }
    }
    
    /**
     * @notice Get task details
     * @param taskId The task ID
     * @return task The task struct
     */
    function getTask(bytes32 taskId) external view returns (Task memory task) {
        return _tasks[taskId];
    }
    
    /**
     * @notice Get all tasks for a client
     * @param clientAgentId The client agent ID
     * @return taskIds Array of task IDs
     */
    function getClientTasks(uint256 clientAgentId) external view returns (bytes32[] memory taskIds) {
        return _clientTasks[clientAgentId];
    }
    
    /**
     * @notice Get client task count
     * @param clientAgentId The client agent ID
     * @return count Number of tasks
     */
    function getClientTaskCount(uint256 clientAgentId) external view returns (uint256 count) {
        return _clientTasks[clientAgentId].length;
    }
    
    /**
     * @notice Get client completion rate
     * @param clientAgentId The client agent ID
     * @return rate Completion rate (0-100)
     */
    function getClientCompletionRate(uint256 clientAgentId) external view returns (uint256 rate) {
        bytes32[] memory tasks = _clientTasks[clientAgentId];
        if (tasks.length == 0) return 0;
        
        uint256 completed = 0;
        for (uint256 i = 0; i < tasks.length; i++) {
            if (_tasks[tasks[i]].completed) {
                completed++;
            }
        }
        
        return (completed * 100) / tasks.length;
    }
    
    // ============ Fallback & Receive ============
    
    /**
     * @dev Fallback function delegates to logic module
     * This allows LogicModules to extend functionality
     */
    fallback() external payable {
        address logic = _logicModule;
        require(logic != address(0), "No logic module");
        
        assembly {
            // Copy msg.data
            calldatacopy(0, 0, calldatasize())
            
            // Delegatecall to logic module
            let result := delegatecall(gas(), logic, 0, calldatasize(), 0, 0)
            
            // Copy return data
            returndatacopy(0, 0, returndatasize())
            
            // Return or revert
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    // ============ Custom Dimension Management (Protocol Spec §3.1, §4.1) ============
    
    /**
     * @notice Set custom studio-specific dimensions
     * @dev Per Protocol Spec §3.1: Studios can add custom dimensions beyond the 5 universal PoA dimensions
     * @param dimensionNames Array of dimension names (e.g., ["risk_assessment", "accuracy"])
     * @param dimensionWeights Array of weights (must sum to PRECISION = 1e6)
     */
    function setCustomDimensions(
        string[] calldata dimensionNames,
        uint256[] calldata dimensionWeights
    ) external {
        require(msg.sender == _chaosCore, "Only ChaosCore");
        require(dimensionNames.length == dimensionWeights.length, "Length mismatch");
        
        // Validate weights sum to PRECISION
        uint256 sum = 0;
        for (uint256 i = 0; i < dimensionWeights.length; i++) {
            sum += dimensionWeights[i];
        }
        require(sum == PRECISION, "Weights must sum to PRECISION");
        
        // Clear old dimensions
        for (uint256 i = 0; i < _customDimensionNames.length; i++) {
            delete _customDimensionWeights[_customDimensionNames[i]];
        }
        delete _customDimensionNames;
        
        // Set new dimensions
        for (uint256 i = 0; i < dimensionNames.length; i++) {
            _customDimensionNames.push(dimensionNames[i]);
            _customDimensionWeights[dimensionNames[i]] = dimensionWeights[i];
        }
        
        emit CustomDimensionsSet(dimensionNames, dimensionWeights);
    }
    
    /**
     * @notice Set universal vs custom weight split
     * @dev Per Protocol Spec §4.1: q = w_u × (Σ universal / 5) + w_c × (Σ ρ_d × custom_d)
     * @param universal_ Weight for universal PoA dimensions (DKG-based)
     * @param custom_ Weight for custom studio dimensions
     */
    function setWeightSplit(uint256 universal_, uint256 custom_) external {
        require(msg.sender == _chaosCore, "Only ChaosCore");
        require(universal_ + custom_ == PRECISION, "Must sum to PRECISION");
        _universalWeight = universal_;
        _customWeight = custom_;
        emit WeightSplitUpdated(universal_, custom_);
    }
    
    /**
     * @notice Get custom dimension configuration
     * @return names Array of dimension names
     * @return weights Array of dimension weights
     * @return universalWeight Weight for universal dimensions
     * @return customWeight Weight for custom dimensions
     */
    function getCustomDimensionConfig() external view returns (
        string[] memory names,
        uint256[] memory weights,
        uint256 universalWeight,
        uint256 customWeight
    ) {
        names = new string[](_customDimensionNames.length);
        weights = new uint256[](_customDimensionNames.length);
        
        for (uint256 i = 0; i < _customDimensionNames.length; i++) {
            names[i] = _customDimensionNames[i];
            weights[i] = _customDimensionWeights[_customDimensionNames[i]];
        }
        
        return (names, weights, _universalWeight, _customWeight);
    }
    
    /**
     * @notice Get score vectors for a specific worker from all validators
     * @dev Used by RewardsDistributor to calculate per-worker consensus
     * @param dataHash The work hash
     * @param worker The worker address
     * @return validators Array of validator addresses
     * @return scoreVectors Array of score vectors for this worker
     */
    function getScoreVectorsForWorker(
        bytes32 dataHash,
        address worker
    ) external view returns (
        address[] memory validators,
        bytes[] memory scoreVectors
    ) {
        validators = _validators[dataHash];
        scoreVectors = new bytes[](validators.length);
        
        for (uint256 i = 0; i < validators.length; i++) {
            scoreVectors[i] = _scoreVectorsPerWorker[dataHash][validators[i]][worker];
        }
        
        return (validators, scoreVectors);
    }
    
    /**
     * @notice Get all validators who submitted scores for this work
     * @param dataHash The work hash
     * @return validators Array of validator addresses
     */
    function getValidators(bytes32 dataHash) external view returns (address[] memory validators) {
        return _validators[dataHash];
    }
    
    /**
     * @dev Receive function for plain ETH transfers
     */
    receive() external payable {
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
    }
}

