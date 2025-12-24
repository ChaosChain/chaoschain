// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {IChaosCore} from "../src/interfaces/IChaosCore.sol";
import {StudioProxy} from "../src/StudioProxy.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {IRewardsDistributor} from "../src/interfaces/IRewardsDistributor.sol";
import {PredictionMarketLogic} from "../src/logic/PredictionMarketLogic.sol";
import {IERC8004IdentityV1} from "../src/interfaces/IERC8004IdentityV1.sol";

/**
 * @notice Mock Identity Registry for testing
 */
contract MockIdentityRegistry is IERC8004IdentityV1 {
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
    
    function register(string memory) external override returns (uint256 agentId) {
        return this.register();
    }
    
    function register(string memory, MetadataEntry[] memory) external override returns (uint256 agentId) {
        return this.register();
    }
    
    function ownerOf(uint256 tokenId) external view override returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "Token does not exist");
        return owner;
    }
    
    function balanceOf(address owner) external view override returns (uint256) {
        return _balances[owner];
    }
    
    function isApprovedForAll(address, address) external pure override returns (bool) {
        return false;
    }
    
    function getApproved(uint256) external pure override returns (address) {
        return address(0);
    }
    
    function tokenURI(uint256) external pure override returns (string memory) {
        return "";
    }
    
    function agentExists(uint256 tokenId) external view override returns (bool) {
        return _owners[tokenId] != address(0);
    }
    
    function totalAgents() external view override returns (uint256) {
        return _nextTokenId - 1;
    }
    
    function getMetadata(uint256, string memory) external pure override returns (bytes memory) {
        return "";
    }
    
    function setMetadata(uint256, string memory, bytes memory) external override {}
    
    function setAgentUri(uint256, string calldata) external override {}
}

/**
 * @title ChaosChainCoreTest
 * @notice Comprehensive tests for ChaosChain MVP core protocol
 * @dev Tests the complete flow: Registry → ChaosCore → StudioProxy → LogicModule
 * 
 * Test Coverage:
 * - ChaosChainRegistry deployment and configuration
 * - ChaosCore Studio factory functionality
 * - StudioProxy deployment and escrow management
 * - Logic module registration and upgrades
 * - RewardsDistributor consensus algorithm
 * 
 * @author ChaosChain Labs
 */
contract ChaosChainCoreTest is Test {
    
    // ============ Test Contracts ============
    
    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    PredictionMarketLogic public predictionLogic;
    MockIdentityRegistry public mockIdentityRegistry;
    
    // ============ Test Actors ============
    
    address public owner;
    address public studioOwner;
    address public workerAgent;
    address public validatorAgent;
    
    // ============ Agent IDs ============
    
    uint256 public workerAgentId;
    uint256 public validatorAgentId;
    
    // ============ Mock ERC-8004 Addresses ============
    
    address public mockReputationRegistry = address(0x1002);
    address public mockValidationRegistry = address(0x1003);
    
    // ============ Setup ============
    
    function setUp() public {
        // Setup test actors
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");
        
        // Deploy Mock Identity Registry
        mockIdentityRegistry = new MockIdentityRegistry();
        
        // Register agents in Identity Registry
        vm.prank(workerAgent);
        workerAgentId = mockIdentityRegistry.register();
        
        vm.prank(validatorAgent);
        validatorAgentId = mockIdentityRegistry.register();
        
        // Deploy ChaosChainRegistry with mock ERC-8004 addresses
        registry = new ChaosChainRegistry(
            address(mockIdentityRegistry),
            mockReputationRegistry,
            mockValidationRegistry
        );
        
        // Deploy RewardsDistributor
        rewardsDistributor = new RewardsDistributor(address(registry));
        
        // Deploy StudioProxyFactory
        StudioProxyFactory factory = new StudioProxyFactory();
        
        // Deploy ChaosCore
        chaosCore = new ChaosCore(address(registry), address(factory));
        
        // Deploy PredictionMarketLogic
        predictionLogic = new PredictionMarketLogic();
        
        // Update registry with deployed addresses
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        
        // Register logic module
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");
        
        // Fund test actors
        vm.deal(studioOwner, 100 ether);
        vm.deal(workerAgent, 10 ether);
        vm.deal(validatorAgent, 10 ether);
    }
    
    // ============ Helper Functions ============
    
    /**
     * @notice Helper to register an agent with a Studio
     */
    function registerAgentWithStudio(
        address studio,
        address agent,
        uint256 agentId,
        StudioProxy.AgentRole role,
        uint256 stake
    ) internal {
        vm.prank(agent);
        StudioProxy(payable(studio)).registerAgent{value: stake}(agentId, role);
    }
    
    /**
     * @notice Helper to create a studio and register both worker and validator
     */
    function createStudioWithAgents() internal returns (address proxy) {
        vm.prank(studioOwner);
        (proxy, ) = chaosCore.createStudio(
            "Test Studio",
            address(predictionLogic)
        );
        
        // Register worker and validator agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        return proxy;
    }
    
    // ============ Registry Tests ============
    
    function test_RegistryDeployment() public {
        assertEq(registry.getIdentityRegistry(), address(mockIdentityRegistry));
        assertEq(registry.getReputationRegistry(), mockReputationRegistry);
        assertEq(registry.getValidationRegistry(), mockValidationRegistry);
        assertEq(registry.getChaosCore(), address(chaosCore));
        assertEq(registry.getRewardsDistributor(), address(rewardsDistributor));
    }
    
    function test_RegistryUpdate() public {
        address newIdentity = address(0x2001);
        registry.setIdentityRegistry(newIdentity);
        assertEq(registry.getIdentityRegistry(), newIdentity);
    }
    
    function test_RevertWhen_RegistryUpdateUnauthorized() public {
        vm.prank(studioOwner);
        vm.expectRevert();
        registry.setIdentityRegistry(address(0x2001));
    }
    
    // ============ ChaosCore Tests ============
    
    function test_CreateStudio() public {
        vm.prank(studioOwner);
        (address proxy, uint256 studioId) = chaosCore.createStudio(
            "Test Prediction Market",
            address(predictionLogic)
        );
        
        assertGt(studioId, 0);
        assertTrue(proxy != address(0));
        assertEq(chaosCore.getStudioCount(), 1);
        
        // Verify studio configuration
        IChaosCore.StudioConfig memory config = chaosCore.getStudio(studioId);
        assertEq(config.proxy, proxy);
        assertEq(config.logicModule, address(predictionLogic));
        assertEq(config.owner, studioOwner);
        assertEq(config.name, "Test Prediction Market");
        assertTrue(config.active);
    }
    
    function test_LogicModuleRegistration() public {
        address newLogic = address(0x3001);
        chaosCore.registerLogicModule(newLogic, "CustomLogic");
        assertTrue(chaosCore.isLogicModuleRegistered(newLogic));
    }
    
    function test_RevertWhen_CreateStudioUnregisteredLogic() public {
        vm.prank(studioOwner);
        vm.expectRevert();
        chaosCore.createStudio("Test Studio", address(0x9999));
    }
    
    // ============ StudioProxy Tests ============
    
    function test_StudioProxyDeposit() public {
        // Create studio
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio(
            "Test Studio",
            address(predictionLogic)
        );
        
        // Deposit to studio
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 5 ether}();
        
        assertEq(StudioProxy(payable(proxy)).getEscrowBalance(studioOwner), 5 ether);
        assertEq(StudioProxy(payable(proxy)).getTotalEscrow(), 5 ether);
    }
    
    function test_WorkSubmission() public {
        // Create and fund studio
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio(
            "Test Studio",
            address(predictionLogic)
        );
        
        // Register worker agent with Studio
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        assertEq(StudioProxy(payable(proxy)).getWorkSubmitter(dataHash), workerAgent);
    }
    
    // ============ RewardsDistributor Tests ============
    
    function test_ConsensusCalculation() public {
        // Prepare test score vectors
        IRewardsDistributor.ScoreVector[] memory vectors = new IRewardsDistributor.ScoreVector[](3);
        
        // Vector 1: [80, 85, 90, 75, 80]
        uint8[] memory scores1 = new uint8[](5);
        scores1[0] = 80; scores1[1] = 85; scores1[2] = 90; scores1[3] = 75; scores1[4] = 80;
        vectors[0] = IRewardsDistributor.ScoreVector({
            validatorAgentId: 1,
            dataHash: keccak256("work1"),
            stake: 1000 ether,
            scores: scores1,
            timestamp: block.timestamp,
            processed: false
        });
        
        // Vector 2: [82, 87, 88, 76, 82]
        uint8[] memory scores2 = new uint8[](5);
        scores2[0] = 82; scores2[1] = 87; scores2[2] = 88; scores2[3] = 76; scores2[4] = 82;
        vectors[1] = IRewardsDistributor.ScoreVector({
            validatorAgentId: 2,
            dataHash: keccak256("work1"),
            stake: 1500 ether,
            scores: scores2,
            timestamp: block.timestamp,
            processed: false
        });
        
        // Vector 3: [78, 83, 92, 77, 79] 
        uint8[] memory scores3 = new uint8[](5);
        scores3[0] = 78; scores3[1] = 83; scores3[2] = 92; scores3[3] = 77; scores3[4] = 79;
        vectors[2] = IRewardsDistributor.ScoreVector({
            validatorAgentId: 3,
            dataHash: keccak256("work1"),
            stake: 800 ether,
            scores: scores3,
            timestamp: block.timestamp,
            processed: false
        });
        
        // Calculate consensus
        uint8[] memory consensus = rewardsDistributor.calculateConsensus(keccak256("work1"), vectors);
        
        // Verify consensus scores are reasonable (should be around input values)
        assertGe(consensus[0], 75); // quality
        assertLe(consensus[0], 85);
        assertEq(consensus.length, 5); // All 5 criteria
    }
    
    function test_ConsensusParameters() public {
        uint256 newAlpha = 2 * 1e6;
        uint256 newBeta = 2 * 1e6;
        uint256 newKappa = 3 * 1e6;
        uint256 newTau = 15 * 1e6;
        
        rewardsDistributor.setConsensusParameters(newAlpha, newBeta, newKappa, newTau);
        
        assertEq(rewardsDistributor.alpha(), newAlpha);
        assertEq(rewardsDistributor.beta(), newBeta);
    }
    
    // ============ Integration Tests ============
    
    function test_EndToEndStudioFlow() public {
        // 1. Create Studio and register agents
        vm.prank(studioOwner);
        (address proxy, uint256 studioId) = chaosCore.createStudio(
            "E2E Test Studio",
            address(predictionLogic)
        );
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        // 2. Deposit funds
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();
        
        // 3. Submit work
        bytes32 dataHash = keccak256("e2e_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // 4. Submit score vector
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVector(dataHash, scoreVector);
        
        // Verify state
        assertEq(StudioProxy(payable(proxy)).getWorkSubmitter(dataHash), workerAgent);
        assertGt(StudioProxy(payable(proxy)).getScoreVector(dataHash, validatorAgent).length, 0);
        assertTrue(chaosCore.getStudio(studioId).active);
    }
    
    // ============ Security Feature Tests ============
    
    // -------- EIP-712 Signed Score Submission Tests --------
    
    function test_SignedScoreSubmission() public {
        // Create studio
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Prepare score vector
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        uint256 deadline = block.timestamp + 1 hours;
        
        // Get nonce
        uint256 nonce = StudioProxy(payable(proxy)).getScoreNonce(validatorAgent, dataHash);
        
        // Sign the score (would use proper EIP-712 signing in production)
        // For now, we'll test the basic submission path
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVector(dataHash, scoreVector);
        
        // Verify score was stored and nonce incremented
        assertGt(StudioProxy(payable(proxy)).getScoreVector(dataHash, validatorAgent).length, 0);
        assertEq(StudioProxy(payable(proxy)).getScoreNonce(validatorAgent, dataHash), nonce + 1);
    }
    
    // -------- Pull Payment Pattern Tests --------
    
    function test_PullPaymentWithdraw() public {
        // Create studio
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Simulate RewardsDistributor releasing funds
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).releaseFunds(workerAgent, 1 ether, dataHash);
        
        // Check withdrawable balance
        assertEq(StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent), 1 ether);
        
        // Worker withdraws funds
        uint256 balanceBefore = workerAgent.balance;
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).withdraw();
        
        // Verify withdrawal
        assertEq(workerAgent.balance, balanceBefore + 1 ether);
        assertEq(StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent), 0);
    }
    
    function test_RevertWhen_WithdrawNoFunds() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        vm.expectRevert("No funds to withdraw");
        StudioProxy(payable(proxy)).withdraw();
    }
    
    // -------- DataHash EIP-712 Tests --------
    
    function test_ComputeDataHash() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        address studio = proxy;
        uint64 epoch = 1;
        bytes32 demandHash = keccak256("demand");
        bytes32 threadRoot = keccak256("thread");
        bytes32 evidenceRoot = keccak256("evidence");
        bytes32 paramsHash = keccak256("params");
        
        bytes32 dataHash = StudioProxy(payable(proxy)).computeDataHash(
            studio,
            epoch,
            demandHash,
            threadRoot,
            evidenceRoot,
            paramsHash
        );
        
        // Verify DataHash is non-zero and deterministic
        assertTrue(dataHash != bytes32(0));
        
        // Computing again should give same result
        bytes32 dataHash2 = StudioProxy(payable(proxy)).computeDataHash(
            studio,
            epoch,
            demandHash,
            threadRoot,
            evidenceRoot,
            paramsHash
        );
        assertEq(dataHash, dataHash2);
    }
    
    // -------- Commit-Reveal Protocol Tests --------
    
    function test_CommitRevealFlow() public {
        // Create studio
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Set commit-reveal deadlines
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).setCommitRevealDeadlines(dataHash, 1 hours, 1 hours);
        
        // Prepare score vector and commitment
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        bytes32 salt = keccak256("random_salt");
        bytes32 commitment = keccak256(abi.encodePacked(scoreVector, salt, dataHash));
        
        // Phase 1: Commit
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).commitScore(dataHash, commitment);
        
        // Verify commitment stored
        assertEq(StudioProxy(payable(proxy)).getScoreCommitment(dataHash, validatorAgent), commitment);
        
        // Fast forward past commit deadline
        vm.warp(block.timestamp + 1 hours + 1);
        
        // Phase 2: Reveal
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).revealScore(dataHash, scoreVector, salt);
        
        // Verify score stored and commitment cleared
        assertGt(StudioProxy(payable(proxy)).getScoreVector(dataHash, validatorAgent).length, 0);
        assertEq(StudioProxy(payable(proxy)).getScoreCommitment(dataHash, validatorAgent), bytes32(0));
    }
    
    function test_RevertWhen_CommitAfterDeadline() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Set short commit window
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).setCommitRevealDeadlines(dataHash, 1 hours, 1 hours);
        
        // Fast forward past commit deadline
        vm.warp(block.timestamp + 2 hours);
        
        // Try to commit after deadline
        bytes32 commitment = keccak256("commitment");
        vm.prank(validatorAgent);
        vm.expectRevert("Commit phase ended");
        StudioProxy(payable(proxy)).commitScore(dataHash, commitment);
    }
    
    function test_RevertWhen_RevealBeforeCommitEnd() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).setCommitRevealDeadlines(dataHash, 1 hours, 1 hours);
        
        // Commit
        bytes memory scoreVector = abi.encode(uint8(85));
        bytes32 salt = keccak256("salt");
        bytes32 commitment = keccak256(abi.encodePacked(scoreVector, salt, dataHash));
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).commitScore(dataHash, commitment);
        
        // Try to reveal before commit phase ends
        vm.prank(validatorAgent);
        vm.expectRevert("Commit phase not ended");
        StudioProxy(payable(proxy)).revealScore(dataHash, scoreVector, salt);
    }
    
    function test_RevertWhen_RevealMismatch() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).setCommitRevealDeadlines(dataHash, 1 hours, 1 hours);
        
        // Commit with one score
        bytes memory scoreVector1 = abi.encode(uint8(85));
        bytes32 salt = keccak256("salt");
        bytes32 commitment = keccak256(abi.encodePacked(scoreVector1, salt, dataHash));
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).commitScore(dataHash, commitment);
        
        // Fast forward
        vm.warp(block.timestamp + 1 hours + 1);
        
        // Try to reveal with different score
        bytes memory scoreVector2 = abi.encode(uint8(90)); // Different!
        vm.prank(validatorAgent);
        vm.expectRevert("Commitment mismatch");
        StudioProxy(payable(proxy)).revealScore(dataHash, scoreVector2, salt);
    }
    
    function test_RevertWhen_DoubleCommit() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).setCommitRevealDeadlines(dataHash, 1 hours, 1 hours);
        
        bytes32 commitment = keccak256("commitment");
        
        // First commit
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).commitScore(dataHash, commitment);
        
        // Try to commit again
        vm.prank(validatorAgent);
        vm.expectRevert("Already committed");
        StudioProxy(payable(proxy)).commitScore(dataHash, commitment);
    }
    
    // ============ Epoch Closure Tests ============
    
    function test_EpochClosureFlow() public {
        // Create studio
        vm.prank(studioOwner);
        (address proxy, uint256 studioId) = chaosCore.createStudio(
            "Epoch Test Studio",
            address(predictionLogic)
        );
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();
        
        // Submit work
        bytes32 dataHash = keccak256("epoch_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Register work for epoch
        uint64 epoch = 1;
        rewardsDistributor.registerWork(proxy, epoch, dataHash);
        
        // Create and register additional validators
        address validator1 = makeAddr("validator1");
        address validator2 = makeAddr("validator2");
        address validator3 = makeAddr("validator3");
        
        // Register validators in Identity Registry and get their agent IDs
        vm.prank(validator1);
        uint256 validator1AgentId = mockIdentityRegistry.register();
        vm.prank(validator2);
        uint256 validator2AgentId = mockIdentityRegistry.register();
        vm.prank(validator3);
        uint256 validator3AgentId = mockIdentityRegistry.register();
        
        // Fund validators
        vm.deal(validator1, 10 ether);
        vm.deal(validator2, 10 ether);
        vm.deal(validator3, 10 ether);
        
        // Register validators with Studio
        registerAgentWithStudio(proxy, validator1, validator1AgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        registerAgentWithStudio(proxy, validator2, validator2AgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        registerAgentWithStudio(proxy, validator3, validator3AgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        // Submit per-worker score vectors from multiple validators (Protocol Spec §2.1)
        bytes memory scoreVector1 = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        bytes memory scoreVector2 = abi.encode(uint8(82), uint8(87), uint8(82), uint8(76), uint8(85));
        bytes memory scoreVector3 = abi.encode(uint8(88), uint8(92), uint8(78), uint8(77), uint8(90));
        
        // Each validator scores EACH worker (per-worker consensus!)
        vm.prank(validator1);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector1);
        rewardsDistributor.registerValidator(dataHash, validator1);
        
        vm.prank(validator2);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector2);
        rewardsDistributor.registerValidator(dataHash, validator2);
        
        vm.prank(validator3);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector3);
        rewardsDistributor.registerValidator(dataHash, validator3);
        
        // Close epoch
        rewardsDistributor.closeEpoch(proxy, epoch);
        
        // Verify per-worker consensus result was stored (key = keccak256(dataHash, worker))
        bytes32 workerDataHash = keccak256(abi.encodePacked(dataHash, workerAgent));
        IRewardsDistributor.ConsensusResult memory result = rewardsDistributor.getConsensusResult(workerDataHash);
        assertTrue(result.finalized);
        assertEq(result.validatorCount, 3);
        assertGt(result.consensusScores.length, 0);
        
        // Verify worker has withdrawable balance
        assertGt(StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent), 0);
    }
    
    function test_EpochManagementFunctions() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        uint64 epoch = 1;
        bytes32 dataHash1 = keccak256("work1");
        bytes32 dataHash2 = keccak256("work2");
        
        // Register work
        rewardsDistributor.registerWork(proxy, epoch, dataHash1);
        rewardsDistributor.registerWork(proxy, epoch, dataHash2);
        
        // Get epoch work
        bytes32[] memory work = rewardsDistributor.getEpochWork(proxy, epoch);
        assertEq(work.length, 2);
        assertEq(work[0], dataHash1);
        assertEq(work[1], dataHash2);
        
        // Register validators
        address validator1 = makeAddr("validator1");
        address validator2 = makeAddr("validator2");
        
        rewardsDistributor.registerValidator(dataHash1, validator1);
        rewardsDistributor.registerValidator(dataHash1, validator2);
        
        // Get validators
        address[] memory validators = rewardsDistributor.getWorkValidators(dataHash1);
        assertEq(validators.length, 2);
        assertEq(validators[0], validator1);
        assertEq(validators[1], validator2);
    }
    
    function test_RevertWhen_CloseEpochNoWork() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        vm.expectRevert("No work in epoch");
        rewardsDistributor.closeEpoch(proxy, 1);
    }
    
    // ============ ERC-8004 Integration Tests ============
    
    function test_ValidationRegistryIntegration() public {
        // This test verifies the integration with ValidationRegistry
        // In production, this would interact with the real ERC-8004 contracts
        
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        registerAgentWithStudio(proxy, validatorAgent, validatorAgentId, StudioProxy.AgentRole.VERIFIER, 1 ether);
        
        bytes32 dataHash = keccak256("validation_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Submit score
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVector(dataHash, scoreVector);
        
        // Verify score was stored
        assertGt(StudioProxy(payable(proxy)).getScoreVector(dataHash, validatorAgent).length, 0);
    }
    
    // ============ Client Reputation Tests ============
    
    function test_ClientTaskCreation() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register client agent
        address clientAgent = makeAddr("clientAgent");
        vm.deal(clientAgent, 10 ether);
        
        // Register with Identity Registry
        vm.prank(clientAgent);
        uint256 clientAgentId = mockIdentityRegistry.register();
        
        // Register with Studio as CLIENT
        registerAgentWithStudio(proxy, clientAgent, clientAgentId, StudioProxy.AgentRole.CLIENT, 1 ether);
        
        // Create task
        string memory taskDescription = "Build a data pipeline";
        uint256 reward = 5 ether;
        string memory paymentProofUri = "ipfs://Qm.../payment_proof.json";
        bytes32 paymentProofHash = keccak256("payment_proof");
        
        vm.prank(clientAgent);
        bytes32 taskId = StudioProxy(payable(proxy)).createTask{value: reward}(
            taskDescription,
            reward,
            paymentProofUri,
            paymentProofHash
        );
        
        // Verify task was created
        StudioProxy.Task memory task = StudioProxy(payable(proxy)).getTask(taskId);
        assertEq(task.clientAgentId, clientAgentId);
        assertEq(task.reward, reward);
        assertEq(task.completed, false);
        assertEq(task.paymentProofUri, paymentProofUri);
        assertEq(task.paymentProofHash, paymentProofHash);
        
        // Verify client task tracking
        bytes32[] memory clientTasks = StudioProxy(payable(proxy)).getClientTasks(clientAgentId);
        assertEq(clientTasks.length, 1);
        assertEq(clientTasks[0], taskId);
    }
    
    function test_ClientReputationPublishing() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register client and worker
        address clientAgent = makeAddr("clientAgent");
        vm.deal(clientAgent, 10 ether);
        vm.prank(clientAgent);
        uint256 clientAgentId = mockIdentityRegistry.register();
        registerAgentWithStudio(proxy, clientAgent, clientAgentId, StudioProxy.AgentRole.CLIENT, 1 ether);
        
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        
        // Create task
        string memory taskDescription = "Test task";
        uint256 reward = 2 ether;
        string memory paymentProofUri = "ipfs://Qm.../payment_proof.json";
        bytes32 paymentProofHash = keccak256("payment_proof");
        
        vm.prank(clientAgent);
        bytes32 taskId = StudioProxy(payable(proxy)).createTask{value: reward}(
            taskDescription,
            reward,
            paymentProofUri,
            paymentProofHash
        );
        
        // Worker submits work
        bytes32 dataHash = keccak256("completed_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Complete task (simulating RewardsDistributor call)
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).completeTask(taskId, workerAgentId, dataHash);
        
        // Verify task completed
        StudioProxy.Task memory task = StudioProxy(payable(proxy)).getTask(taskId);
        assertEq(task.completed, true);
        assertEq(task.workerAgentId, workerAgentId);
        assertEq(task.dataHash, dataHash);
        assertGt(task.completedAt, 0);
    }
    
    function test_ClientCompletionRate() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register client and worker
        address clientAgent = makeAddr("clientAgent");
        vm.deal(clientAgent, 20 ether);
        vm.prank(clientAgent);
        uint256 clientAgentId = mockIdentityRegistry.register();
        registerAgentWithStudio(proxy, clientAgent, clientAgentId, StudioProxy.AgentRole.CLIENT, 1 ether);
        
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        
        // Create 3 tasks
        bytes32[] memory taskIds = new bytes32[](3);
        bytes32[] memory dataHashes = new bytes32[](3);
        
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(clientAgent);
            taskIds[i] = StudioProxy(payable(proxy)).createTask{value: 2 ether}(
                string(abi.encodePacked("Task ", i)),
                2 ether,
                "ipfs://payment",
                keccak256(abi.encodePacked("proof", i))
            );
            
            // Generate unique data hash for each task
            dataHashes[i] = keccak256(abi.encodePacked("work", i));
        }
        
        // Complete 2 out of 3 tasks
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(workerAgent);
            StudioProxy(payable(proxy)).submitWork(dataHashes[i], bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
            
            vm.prank(address(rewardsDistributor));
            StudioProxy(payable(proxy)).completeTask(taskIds[i], workerAgentId, dataHashes[i]);
        }
        
        // Check completion rate (2/3 = 66%)
        uint256 completionRate = StudioProxy(payable(proxy)).getClientCompletionRate(clientAgentId);
        assertEq(completionRate, 66);
    }
    
    function test_RevertWhen_NonClientCreatesTask() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register as WORKER (not CLIENT)
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        
        // Try to create task as worker
        vm.prank(workerAgent);
        vm.expectRevert("Not a client agent");
        StudioProxy(payable(proxy)).createTask{value: 1 ether}(
            "Task",
            1 ether,
            "ipfs://payment",
            keccak256("proof")
        );
    }
    
    function test_OnTimePaymentBonus() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register client and worker
        address clientAgent = makeAddr("clientAgent");
        vm.deal(clientAgent, 10 ether);
        vm.prank(clientAgent);
        uint256 clientAgentId = mockIdentityRegistry.register();
        registerAgentWithStudio(proxy, clientAgent, clientAgentId, StudioProxy.AgentRole.CLIENT, 1 ether);
        
        registerAgentWithStudio(proxy, workerAgent, workerAgentId, StudioProxy.AgentRole.WORKER, 1 ether);
        
        // Create task
        vm.prank(clientAgent);
        bytes32 taskId = StudioProxy(payable(proxy)).createTask{value: 2 ether}(
            "Test task",
            2 ether,
            "ipfs://payment",
            keccak256("proof")
        );
        
        // Complete within 24 hours (on-time)
        vm.warp(block.timestamp + 12 hours);
        
        bytes32 dataHash = keccak256("work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        vm.prank(address(rewardsDistributor));
        StudioProxy(payable(proxy)).completeTask(taskId, workerAgentId, dataHash);
        
        // Verify task completed on time
        StudioProxy.Task memory task = StudioProxy(payable(proxy)).getTask(taskId);
        assertTrue(task.completedAt - task.createdAt <= 24 hours);
        
        // Score should be 100 (50 for on-time + 50 for completion)
    }
}

