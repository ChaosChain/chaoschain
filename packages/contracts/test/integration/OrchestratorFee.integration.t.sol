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
import {MockIdentityRegistryIntegration, MockReputationRegistryIntegration} from "./CloseEpoch.integration.t.sol";

/**
 * @title OrchestratorFeeIntegrationTest
 * @notice Verifies that the 5% orchestrator fee is transferred to the treasury
 * @dev Fix for: orchestratorFee was calculated but never released (locked forever)
 */
contract OrchestratorFeeIntegrationTest is Test {

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
    address public treasury;

    // ============ Agent IDs ============
    uint256 public workerAgentId;
    uint256 public validatorAgentId;

    function setUp() public {
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");
        treasury = makeAddr("treasury");

        // Deploy mocks (shared with CloseEpoch tests)
        mockIdentityRegistry = new MockIdentityRegistryIntegration();
        mockReputationRegistry = new MockReputationRegistryIntegration();

        // Register agents
        vm.prank(workerAgent);
        workerAgentId = mockIdentityRegistry.register();

        vm.prank(validatorAgent);
        validatorAgentId = mockIdentityRegistry.register();

        // Deploy infrastructure
        registry = new ChaosChainRegistry(
            address(mockIdentityRegistry),
            address(mockReputationRegistry),
            address(0x1003)
        );

        rewardsDistributor = new RewardsDistributor(address(registry), treasury);
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        predictionLogic = new PredictionMarketLogic();

        // Wire up
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");

        // Fund actors
        vm.deal(studioOwner, 100 ether);
        vm.deal(workerAgent, 10 ether);
        vm.deal(validatorAgent, 10 ether);
    }

    /**
     * @notice Treasury receives 5% orchestrator fee after closeEpoch
     */
    function test_orchestratorFee_transferred_to_treasury() public {
        // Create studio, register agents, fund escrow
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Fee Test Studio", address(predictionLogic));

        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();

        uint256 totalEscrow = StudioProxy(payable(proxy)).getTotalEscrow();
        // Orchestrator fee formula from RewardsDistributor.sol:113
        uint256 expectedFee = (totalEscrow * 5) / 100;

        // Submit work + scores
        bytes32 dataHash = keccak256("fee_test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        bytes memory scores = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        // Track treasury balance before
        uint256 treasuryBalanceBefore = StudioProxy(payable(proxy)).getWithdrawableBalance(treasury);

        // Close epoch
        rewardsDistributor.closeEpoch(proxy, 1);

        // Treasury should have withdrawable balance == 5% of escrow
        uint256 treasuryBalanceAfter = StudioProxy(payable(proxy)).getWithdrawableBalance(treasury);
        assertEq(
            treasuryBalanceAfter - treasuryBalanceBefore,
            expectedFee,
            "Treasury must receive exactly 5% orchestrator fee"
        );
    }

    /**
     * @notice setTreasury reverts for non-owner
     */
    function test_setTreasury_onlyOwner() public {
        address nonOwner = makeAddr("nonOwner");
        vm.prank(nonOwner);
        vm.expectRevert();
        rewardsDistributor.setTreasury(makeAddr("newTreasury"));
    }

    /**
     * @notice setTreasury reverts for zero address
     */
    function test_setTreasury_rejects_zero_address() public {
        vm.expectRevert("Invalid treasury");
        rewardsDistributor.setTreasury(address(0));
    }

    /**
     * @notice Constructor reverts if treasury is address(0)
     */
    function test_constructor_rejects_zero_treasury() public {
        vm.expectRevert("Invalid treasury");
        new RewardsDistributor(address(registry), address(0));
    }

    /**
     * @notice After setTreasury, the new treasury receives the 5% fee
     */
    function test_setTreasury_redirects_fee_to_new_address() public {
        address newTreasury = makeAddr("newTreasury");
        rewardsDistributor.setTreasury(newTreasury);

        // Create studio, register agents, fund escrow
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Treasury Redirect Studio", address(predictionLogic));

        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();

        uint256 totalEscrow = StudioProxy(payable(proxy)).getTotalEscrow();
        // Orchestrator fee formula from RewardsDistributor.sol:113
        uint256 expectedFee = (totalEscrow * 5) / 100;

        // Submit work + scores
        bytes32 dataHash = keccak256("treasury_redirect_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        bytes memory scores = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        // Close epoch
        rewardsDistributor.closeEpoch(proxy, 1);

        // New treasury receives the fee, old treasury gets nothing
        uint256 newTreasuryBalance = StudioProxy(payable(proxy)).getWithdrawableBalance(newTreasury);
        uint256 oldTreasuryBalance = StudioProxy(payable(proxy)).getWithdrawableBalance(treasury);

        assertEq(newTreasuryBalance, expectedFee, "New treasury must receive 5% fee");
        assertEq(oldTreasuryBalance, 0, "Old treasury must receive nothing");
    }
}
