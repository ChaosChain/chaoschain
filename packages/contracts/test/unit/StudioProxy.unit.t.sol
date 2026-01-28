// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../../src/ChaosChainRegistry.sol";
import {RewardsDistributor} from "../../src/RewardsDistributor.sol";
import {StudioProxy} from "../../src/StudioProxy.sol";
import {StudioProxyFactory} from "../../src/StudioProxyFactory.sol";
import {ChaosCore} from "../../src/ChaosCore.sol";
import {PredictionMarketLogic} from "../../src/logic/PredictionMarketLogic.sol";
import {IERC8004IdentityV1} from "../../src/interfaces/IERC8004IdentityV1.sol";

/**
 * @title StudioProxyUnitTest
 * @notice Category A: Protocol invariant tests for StudioProxy
 * @dev Small, fast, brutal tests that prove invalid states are unrepresentable
 *      These tests mock aggressively and do not cross contract boundaries unnecessarily
 */
contract StudioProxyUnitTest is Test {
    
    ChaosChainRegistry public registry;
    RewardsDistributor public rewardsDistributor;
    ChaosCore public chaosCore;
    StudioProxyFactory public factory;
    PredictionMarketLogic public predictionLogic;
    MockIdentityRegistryStudio public mockIdentityRegistry;
    
    address public owner;
    address public studioOwner;
    address public workerAgent;
    address public validatorAgent;
    
    uint256 public workerAgentId;
    uint256 public validatorAgentId;
    
    address public mockReputationRegistry = address(0x1002);
    address public mockValidationRegistry = address(0x1003);
    
    function setUp() public {
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");
        
        mockIdentityRegistry = new MockIdentityRegistryStudio();
        
        vm.prank(workerAgent);
        workerAgentId = mockIdentityRegistry.register();
        
        vm.prank(validatorAgent);
        validatorAgentId = mockIdentityRegistry.register();
        
        registry = new ChaosChainRegistry(
            address(mockIdentityRegistry),
            mockReputationRegistry,
            mockValidationRegistry
        );
        
        rewardsDistributor = new RewardsDistributor(address(registry));
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        predictionLogic = new PredictionMarketLogic();
        
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");
        
        vm.deal(studioOwner, 100 ether);
        vm.deal(workerAgent, 10 ether);
        vm.deal(validatorAgent, 10 ether);
    }
    
    // ============ Category A: Protocol Invariants ============
    
    /**
     * @notice getWorkParticipants returns exactly the workers who submitted
     * @dev Critical invariant: participants list matches actual submissions
     */
    function test_getWorkParticipants_matches_submissions() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register worker
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Verify participants
        address[] memory participants = StudioProxy(payable(proxy)).getWorkParticipants(dataHash);
        
        assertEq(participants.length, 1, "Should have exactly 1 participant");
        assertEq(participants[0], workerAgent, "Participant should be workerAgent");
    }
    
    /**
     * @notice getScoreVectorsForWorker returns validators who submitted scores
     * @dev Verifies validator discovery works correctly
     */
    function test_getValidators_returns_exactly_submitters() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register agents
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        // Submit score for worker
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector);
        
        // Get validators who scored this worker
        (address[] memory validators, bytes[] memory scores) = StudioProxy(payable(proxy)).getScoreVectorsForWorker(dataHash, workerAgent);
        
        assertEq(validators.length, 1, "Should have exactly 1 validator");
        assertEq(validators[0], validatorAgent, "Validator should be validatorAgent");
        assertEq(scores.length, 1, "Should have 1 score vector");
    }
    
    /**
     * @notice Work submitter is correctly recorded
     * @dev Critical: ensures work attribution is correct
     */
    function test_getWorkSubmitter_returns_correct_address() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        address submitter = StudioProxy(payable(proxy)).getWorkSubmitter(dataHash);
        assertEq(submitter, workerAgent, "Submitter should be workerAgent");
    }
    
    /**
     * @notice Agent ID lookup is consistent
     * @dev Verifies agentId ↔ address mapping is bijective
     */
    function test_getAgentId_returns_registered_id() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        uint256 retrievedId = StudioProxy(payable(proxy)).getAgentId(workerAgent);
        assertEq(retrievedId, workerAgentId, "Agent ID should match registration");
    }
    
    /**
     * @notice Escrow balance tracking is accurate
     * @dev Verifies deposit/withdraw accounting
     */
    function test_escrow_balance_tracking_accurate() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        uint256 depositAmount = 5 ether;
        
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: depositAmount}();
        
        assertEq(StudioProxy(payable(proxy)).getEscrowBalance(studioOwner), depositAmount);
        assertEq(StudioProxy(payable(proxy)).getTotalEscrow(), depositAmount);
    }
    
    /**
     * @notice Score vectors are stored correctly
     * @dev Verifies score storage and retrieval
     */
    function test_scoreVector_stored_and_retrieved() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVector(dataHash, scoreVector);
        
        bytes memory retrieved = StudioProxy(payable(proxy)).getScoreVector(dataHash, validatorAgent);
        assertGt(retrieved.length, 0, "Score vector should be stored");
    }
    
    /**
     * @notice Non-registered agent cannot submit work
     * @dev Access control invariant
     */
    function test_revert_unregistered_agent_submit_work() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        address randomAgent = makeAddr("random");
        bytes32 dataHash = keccak256("test_work");
        
        vm.prank(randomAgent);
        vm.expectRevert(); // Should revert - not registered
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
    }
    
    /**
     * @notice Non-validator cannot submit scores
     * @dev Access control invariant
     */
    function test_revert_non_validator_submit_score() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        // Register only as worker, not validator
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        
        vm.prank(workerAgent); // Worker trying to submit score
        vm.expectRevert(); // Should revert - not a validator
        StudioProxy(payable(proxy)).submitScoreVector(dataHash, scoreVector);
    }
    
    /**
     * @notice Contribution weight defaults to 100% for single worker
     * @dev Ensures fair distribution baseline
     */
    function test_contributionWeight_single_worker_full() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        uint256 weight = StudioProxy(payable(proxy)).getContributionWeight(dataHash, workerAgent);
        assertEq(weight, 10000, "Single worker should have 100% weight (10000 basis points)");
    }
}

/**
 * @notice Minimal mock for unit tests (Feb 2026 ABI)
 */
contract MockIdentityRegistryStudio is IERC8004IdentityV1 {
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _agentWallets;
    uint256 private _nextTokenId = 1;
    
    function register() external override returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _owners[agentId] = msg.sender;
        _balances[msg.sender]++;
        _agentWallets[agentId] = msg.sender;
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
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view override returns (bool) {
        require(_owners[agentId] != address(0), "ERC721NonexistentToken");
        return spender == _owners[agentId];
    }
    function tokenURI(uint256) external pure override returns (string memory) { return ""; }
    function getMetadata(uint256, string memory) external pure override returns (bytes memory) { return ""; }
    function setMetadata(uint256, string memory, bytes memory) external override {}
    function setAgentURI(uint256, string calldata) external override {}
    function getAgentWallet(uint256 agentId) external view override returns (address) { return _agentWallets[agentId]; }
    function setAgentWallet(uint256, address, uint256, bytes calldata) external override {}
    function unsetAgentWallet(uint256 agentId) external override { _agentWallets[agentId] = address(0); }
}
