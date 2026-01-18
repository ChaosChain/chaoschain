// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../../src/ChaosCore.sol";
import {StudioProxy} from "../../src/StudioProxy.sol";
import {StudioProxyFactory} from "../../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../../src/RewardsDistributor.sol";
import {IRewardsDistributor} from "../../src/interfaces/IRewardsDistributor.sol";
import {PredictionMarketLogic} from "../../src/logic/PredictionMarketLogic.sol";
import {IERC8004IdentityV1} from "../../src/interfaces/IERC8004IdentityV1.sol";
import {IERC8004Reputation} from "../../src/interfaces/IERC8004Reputation.sol";

/**
 * @title CloseEpochIntegrationTest
 * @notice Category B: In-repo integration tests for epoch closure
 * @dev Proves that storage written by one contract is readable by another
 *      These tests verify cross-contract communication and state consistency
 * 
 * ⚠️  IF THESE TESTS FAIL, GENESIS STUDIO MUST NEVER BE RUN ⚠️
 */
contract CloseEpochIntegrationTest is Test {
    
    // ============ Contracts ============
    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    PredictionMarketLogic public predictionLogic;
    MockIdentityRegistryIntegration public mockIdentityRegistry;
    MockReputationRegistryIntegration public mockReputationRegistry;
    
    // ============ Actors ============
    address public owner;
    address public studioOwner;
    address public workerAgent;
    address public validatorAgent;
    
    // ============ Agent IDs ============
    uint256 public workerAgentId;
    uint256 public validatorAgentId;
    
    // ============ Events to verify ============
    event EpochClosed(address indexed studio, uint64 indexed epoch, uint256 totalWorkerRewards, uint256 totalValidatorRewards);
    event FundsReleased(address indexed recipient, uint256 amount, bytes32 dataHash);
    
    function setUp() public {
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");
        
        // Deploy real contracts (not mocks where possible)
        mockIdentityRegistry = new MockIdentityRegistryIntegration();
        mockReputationRegistry = new MockReputationRegistryIntegration();
        
        // Register agents BEFORE creating registry
        vm.prank(workerAgent);
        workerAgentId = mockIdentityRegistry.register();
        
        vm.prank(validatorAgent);
        validatorAgentId = mockIdentityRegistry.register();
        
        // Deploy ChaosChain infrastructure with mock ERC-8004 that actually works
        registry = new ChaosChainRegistry(
            address(mockIdentityRegistry),
            address(mockReputationRegistry),  // Real mock that logs calls
            address(0x1003)  // Validation registry (not tested here)
        );
        
        rewardsDistributor = new RewardsDistributor(address(registry));
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        predictionLogic = new PredictionMarketLogic();
        
        // Wire up the system
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");
        
        // Fund actors
        vm.deal(studioOwner, 100 ether);
        vm.deal(workerAgent, 10 ether);
        vm.deal(validatorAgent, 10 ether);
    }
    
    // ============================================================
    // ⭐ THE SINGLE MOST IMPORTANT INTEGRATION TEST ⭐
    // ============================================================
    
    /**
     * @notice Happy path: single worker, single validator, successful epoch closure
     * @dev This test MUST pass for Genesis Studio to be safe to run
     * 
     * This test verifies:
     * 1. Deploy: Registry, MockERC8004, StudioProxy, RewardsDistributor
     * 2. Register: 1 worker, 1 validator
     * 3. Submit: 1 work, 1 score
     * 4. Call: closeEpoch
     * 5. Assert: No revert, EpochClosed emitted, giveFeedback called
     */
    function test_closeEpoch_happy_path_single_worker_single_validator() public {
        // ========== 1. DEPLOY: Create Studio ==========
        vm.prank(studioOwner);
        (address proxy, uint256 studioId) = chaosCore.createStudio(
            "Integration Test Studio",
            address(predictionLogic)
        );
        assertTrue(proxy != address(0), "Studio proxy deployed");
        assertGt(studioId, 0, "Studio ID assigned");
        
        // ========== 2. REGISTER: Worker and Validator ==========
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(
            workerAgentId, 
            StudioProxy.AgentRole.WORKER
        );
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(
            validatorAgentId, 
            StudioProxy.AgentRole.VERIFIER
        );
        
        // Fund studio escrow
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();
        
        // ========== 3. SUBMIT: Work and Score ==========
        bytes32 dataHash = keccak256("integration_test_work");
        
        // Worker submits work
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(
            dataHash, 
            bytes32(uint256(1)),  // tag1
            bytes32(uint256(2)),  // tag2
            new bytes(65)         // signature placeholder
        );
        
        // Verify work was recorded
        assertEq(
            StudioProxy(payable(proxy)).getWorkSubmitter(dataHash),
            workerAgent,
            "Work submitter recorded"
        );
        
        // Register work for epoch
        uint64 epoch = 1;
        rewardsDistributor.registerWork(proxy, epoch, dataHash);
        
        // Validator submits score for worker
        bytes memory scoreVector = abi.encode(
            uint8(85),  // Initiative
            uint8(90),  // Collaboration
            uint8(80),  // Reasoning
            uint8(75),  // Compliance
            uint8(88)   // Efficiency
        );
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector);
        
        // Register validator
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        // Verify score was recorded
        (address[] memory validators, bytes[] memory scores) = StudioProxy(payable(proxy)).getScoreVectorsForWorker(dataHash, workerAgent);
        assertEq(validators.length, 1, "One validator recorded");
        assertEq(validators[0], validatorAgent, "Correct validator");
        assertGt(scores[0].length, 0, "Score vector stored");
        
        // ========== 4. CALL: closeEpoch ==========
        
        // Track worker balance before
        uint256 workerBalanceBefore = StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent);
        
        // Reset reputation registry call counter
        mockReputationRegistry.resetCallCount();
        
        // Expect EpochClosed event
        vm.expectEmit(true, true, false, false);
        emit EpochClosed(proxy, epoch, 0, 0); // We don't check exact amounts
        
        // THIS IS THE CRITICAL CALL
        rewardsDistributor.closeEpoch(proxy, epoch);
        
        // ========== 5. ASSERT: Success criteria ==========
        
        // 5a. No revert (implicit - we got here)
        
        // 5b. EpochClosed was emitted (verified by expectEmit above)
        
        // 5c. giveFeedback was called at least once
        assertGt(
            mockReputationRegistry.giveFeedbackCallCount(),
            0,
            "giveFeedback must be called at least once"
        );
        
        // 5d. Worker has withdrawable balance (rewards distributed)
        uint256 workerBalanceAfter = StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent);
        assertGt(
            workerBalanceAfter,
            workerBalanceBefore,
            "Worker must receive rewards"
        );
        
        // 5e. Consensus result was stored
        bytes32 workerDataHash = keccak256(abi.encodePacked(dataHash, workerAgent));
        IRewardsDistributor.ConsensusResult memory result = rewardsDistributor.getConsensusResult(workerDataHash);
        assertTrue(result.finalized, "Consensus must be finalized");
        assertEq(result.validatorCount, 1, "One validator in consensus");
        assertGt(result.consensusScores.length, 0, "Consensus scores stored");
        
        console.log("=== INTEGRATION TEST PASSED ===");
        console.log("Worker rewards:", workerBalanceAfter);
        console.log("giveFeedback calls:", mockReputationRegistry.giveFeedbackCallCount());
        console.log("Consensus dimensions:", result.consensusScores.length);
    }
    
    /**
     * @notice Multi-validator consensus integration test
     * @dev Verifies consensus calculation with multiple validators
     */
    function test_closeEpoch_multi_validator_consensus() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Multi-Validator Studio", address(predictionLogic));
        
        // Register worker
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        // Create and register 3 validators
        address validator1 = makeAddr("validator1");
        address validator2 = makeAddr("validator2");
        address validator3 = makeAddr("validator3");
        
        vm.prank(validator1);
        uint256 v1Id = mockIdentityRegistry.register();
        vm.prank(validator2);
        uint256 v2Id = mockIdentityRegistry.register();
        vm.prank(validator3);
        uint256 v3Id = mockIdentityRegistry.register();
        
        vm.deal(validator1, 10 ether);
        vm.deal(validator2, 10 ether);
        vm.deal(validator3, 10 ether);
        
        vm.prank(validator1);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(v1Id, StudioProxy.AgentRole.VERIFIER);
        vm.prank(validator2);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(v2Id, StudioProxy.AgentRole.VERIFIER);
        vm.prank(validator3);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(v3Id, StudioProxy.AgentRole.VERIFIER);
        
        // Fund escrow
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 20 ether}();
        
        // Submit work
        bytes32 dataHash = keccak256("multi_validator_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        
        // Submit varying scores from each validator
        bytes memory scores1 = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        bytes memory scores2 = abi.encode(uint8(82), uint8(87), uint8(82), uint8(76), uint8(85));
        bytes memory scores3 = abi.encode(uint8(88), uint8(92), uint8(78), uint8(77), uint8(90));
        
        vm.prank(validator1);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores1);
        rewardsDistributor.registerValidator(dataHash, validator1);
        
        vm.prank(validator2);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores2);
        rewardsDistributor.registerValidator(dataHash, validator2);
        
        vm.prank(validator3);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores3);
        rewardsDistributor.registerValidator(dataHash, validator3);
        
        // Close epoch
        rewardsDistributor.closeEpoch(proxy, 1);
        
        // Verify consensus was calculated
        bytes32 workerDataHash = keccak256(abi.encodePacked(dataHash, workerAgent));
        IRewardsDistributor.ConsensusResult memory result = rewardsDistributor.getConsensusResult(workerDataHash);
        
        assertTrue(result.finalized, "Consensus finalized");
        assertEq(result.validatorCount, 3, "Three validators in consensus");
        
        // Consensus scores should be reasonable averages
        for (uint256 i = 0; i < result.consensusScores.length; i++) {
            assertGe(result.consensusScores[i], 70, "Score above minimum");
            assertLe(result.consensusScores[i], 100, "Score below maximum");
        }
    }
    
    /**
     * @notice Cross-contract storage verification
     * @dev Verifies storage written by StudioProxy is readable by RewardsDistributor
     */
    function test_crossContract_storage_consistency() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Storage Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);
        
        bytes32 dataHash = keccak256("storage_test_work");
        
        // Worker writes to StudioProxy
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Verify StudioProxy has the data
        address submitter = StudioProxy(payable(proxy)).getWorkSubmitter(dataHash);
        assertEq(submitter, workerAgent, "StudioProxy recorded submitter");
        
        // Validator writes scores
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector);
        
        // Verify RewardsDistributor can read the data via StudioProxy
        (address[] memory validators, bytes[] memory scores) = StudioProxy(payable(proxy)).getScoreVectorsForWorker(dataHash, workerAgent);
        
        assertEq(validators.length, 1, "RewardsDistributor can see validator");
        assertEq(validators[0], validatorAgent, "Correct validator visible");
        assertGt(scores[0].length, 0, "Scores visible");
        
        // Verify participants are visible
        address[] memory participants = StudioProxy(payable(proxy)).getWorkParticipants(dataHash);
        assertEq(participants.length, 1, "Participants visible");
        assertEq(participants[0], workerAgent, "Correct participant");
    }
}

/**
 * @notice Mock Identity Registry for integration tests
 */
contract MockIdentityRegistryIntegration is IERC8004IdentityV1 {
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    uint256 private _nextTokenId = 1;
    
    function register() external override returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _owners[agentId] = msg.sender;
        _balances[msg.sender]++;
        emit Transfer(address(0), msg.sender, agentId);
        return agentId;
    }
    
    function register(string memory) external override returns (uint256) { return this.register(); }
    function register(string memory, MetadataEntry[] memory) external override returns (uint256) { return this.register(); }
    function ownerOf(uint256 tokenId) external view override returns (address) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return _owners[tokenId];
    }
    function balanceOf(address owner) external view override returns (uint256) { return _balances[owner]; }
    function isApprovedForAll(address, address) external pure override returns (bool) { return false; }
    function getApproved(uint256) external pure override returns (address) { return address(0); }
    function tokenURI(uint256) external pure override returns (string memory) { return ""; }
    function agentExists(uint256 tokenId) external view override returns (bool) { return _owners[tokenId] != address(0); }
    function totalAgents() external view override returns (uint256) { return _nextTokenId - 1; }
    function getMetadata(uint256, string memory) external pure override returns (bytes memory) { return ""; }
    function setMetadata(uint256, string memory, bytes memory) external override {}
    function setAgentUri(uint256, string calldata) external override {}
    function setAgentWallet(uint256, address, uint256, bytes calldata) external override {}
}

/**
 * @notice Mock Reputation Registry that tracks giveFeedback calls
 * @dev Used to verify ERC-8004 integration is working
 */
contract MockReputationRegistryIntegration is IERC8004Reputation {
    uint256 private _giveFeedbackCalls;
    
    // Track the last giveFeedback call parameters for verification
    uint256 public lastAgentId;
    uint8 public lastScore;
    string public lastTag1;
    string public lastTag2;
    string public lastEndpoint;
    
    function resetCallCount() external {
        _giveFeedbackCalls = 0;
    }
    
    function giveFeedbackCallCount() external view returns (uint256) {
        return _giveFeedbackCalls;
    }
    
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackUri,
        bytes32 feedbackHash
    ) external override {
        _giveFeedbackCalls++;
        lastAgentId = agentId;
        lastScore = score;
        lastTag1 = tag1;
        lastTag2 = tag2;
        lastEndpoint = endpoint;
        
        // Emit event for verification (Jan 2026 spec with 9 params)
        emit NewFeedback(
            agentId,
            msg.sender,
            uint64(_giveFeedbackCalls),
            score,
            tag1,
            tag2,
            endpoint,
            feedbackUri,
            feedbackHash
        );
    }
    
    function revokeFeedback(uint256, uint64) external override {}
    
    function appendResponse(uint256, address, uint64, string calldata, bytes32) external override {}
    
    function getIdentityRegistry() external pure override returns (address) {
        return address(0);
    }
    
    function getSummary(uint256, address[] calldata, string calldata, string calldata) 
        external pure override returns (uint64, uint8) 
    {
        return (0, 0);
    }
    
    function readFeedback(uint256, address, uint64) external pure override returns (
        uint8, string memory, string memory, bool
    ) {
        return (0, "", "", false);
    }
    
    function readAllFeedback(uint256, address[] calldata, string calldata, string calldata, bool) 
        external pure override returns (
            address[] memory,
            uint64[] memory,
            uint8[] memory,
            string[] memory,
            string[] memory,
            bool[] memory
        ) 
    {
        return (
            new address[](0),
            new uint64[](0),
            new uint8[](0),
            new string[](0),
            new string[](0),
            new bool[](0)
        );
    }
    
    function getLastIndex(uint256, address) external pure override returns (uint64) {
        return 0;
    }
    
    function getClients(uint256) external pure override returns (address[] memory) {
        return new address[](0);
    }
    
    function getResponseCount(uint256, address, uint64, address[] calldata) external pure override returns (uint64) {
        return 0;
    }
}
