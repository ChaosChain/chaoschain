// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {IChaosCore} from "../src/interfaces/IChaosCore.sol";
import {StudioProxy} from "../src/StudioProxy.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {IRewardsDistributor} from "../src/interfaces/IRewardsDistributor.sol";
import {PredictionMarketLogic} from "../src/logic/PredictionMarketLogic.sol";

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
    
    // ============ Test Actors ============
    
    address public owner;
    address public studioOwner;
    address public workerAgent;
    address public validatorAgent;
    
    // ============ Mock ERC-8004 Addresses ============
    
    address public mockIdentityRegistry = address(0x1001);
    address public mockReputationRegistry = address(0x1002);
    address public mockValidationRegistry = address(0x1003);
    
    // ============ Setup ============
    
    function setUp() public {
        // Setup test actors
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");
        
        // Deploy ChaosChainRegistry with mock ERC-8004 addresses
        registry = new ChaosChainRegistry(
            mockIdentityRegistry,
            mockReputationRegistry,
            mockValidationRegistry
        );
        
        // Deploy RewardsDistributor
        rewardsDistributor = new RewardsDistributor(address(registry));
        
        // Deploy ChaosCore
        chaosCore = new ChaosCore(address(registry));
        
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
    
    // ============ Registry Tests ============
    
    function test_RegistryDeployment() public {
        assertEq(registry.getIdentityRegistry(), mockIdentityRegistry);
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
        
        // Submit work
        bytes32 dataHash = keccak256("test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, "ipfs://test");
        
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
        // 1. Create Studio
        vm.prank(studioOwner);
        (address proxy, uint256 studioId) = chaosCore.createStudio(
            "E2E Test Studio",
            address(predictionLogic)
        );
        
        // 2. Deposit funds
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();
        
        // 3. Submit work
        bytes32 dataHash = keccak256("e2e_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, "ipfs://e2e_evidence");
        
        // 4. Submit score vector
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVector(dataHash, scoreVector);
        
        // Verify state
        assertEq(StudioProxy(payable(proxy)).getWorkSubmitter(dataHash), workerAgent);
        assertGt(StudioProxy(payable(proxy)).getScoreVector(dataHash, validatorAgent).length, 0);
        assertTrue(chaosCore.getStudio(studioId).active);
    }
}

