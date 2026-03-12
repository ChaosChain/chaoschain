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
 * @notice Proves that the 5% orchestratorFee in closeEpoch() is never transferred
 *         to anyone and remains permanently locked in the StudioProxy escrow.
 *
 * BUG REPORT:
 *   RewardsDistributor.closeEpoch() calculates orchestratorFee = totalBudget * 5 / 100
 *   and subtracts it from the workerPool, but never calls releaseFunds() for that amount.
 *   The fee stays in _totalEscrow but is not assigned to any address's _withdrawable balance.
 *   There is no sweepExcess(), withdrawProtocolFees(), or emergencyWithdraw() function.
 *   Result: funds are permanently locked.
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

    // ============ Agent IDs ============
    uint256 public workerAgentId;
    uint256 public validatorAgentId;

    function setUp() public {
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");

        mockIdentityRegistry = new MockIdentityRegistryIntegration();
        mockReputationRegistry = new MockReputationRegistryIntegration();

        vm.prank(workerAgent);
        workerAgentId = mockIdentityRegistry.register();

        vm.prank(validatorAgent);
        validatorAgentId = mockIdentityRegistry.register();

        registry = new ChaosChainRegistry(
            address(mockIdentityRegistry),
            address(mockReputationRegistry),
            address(0x1003)
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

    /**
     * @notice Proves orchestratorFee (5%) is locked forever after closeEpoch
     *
     * Steps:
     *   1. Deposit 10 ETH into studio escrow
     *   2. Worker submits work, validator scores it
     *   3. closeEpoch() distributes rewards
     *   4. Assert: workerWithdrawable + validatorWithdrawable < 10 ETH
     *   5. Assert: the gap is at least 5% (orchestratorFee)
     *   6. Assert: nobody can withdraw the remaining funds
     *   7. Assert: contract balance still holds those funds
     */
    function test_orchestratorFee_is_permanently_locked() public {
        // ========== Setup: Create studio, register agents, fund escrow ==========
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Fee Test Studio", address(predictionLogic));
        StudioProxy studioProxy = StudioProxy(payable(proxy));

        vm.prank(workerAgent);
        studioProxy.registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        studioProxy.registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        studioProxy.deposit{value: 10 ether}();

        uint256 escrowBefore = studioProxy.getTotalEscrow();
        console.log("Escrow before closeEpoch:", escrowBefore);

        // ========== Submit work + scores ==========
        bytes32 dataHash = keccak256("fee_test_work");

        vm.prank(workerAgent);
        studioProxy.submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        bytes memory scoreVector = abi.encode(uint8(90), uint8(90), uint8(90), uint8(90), uint8(90));
        vm.prank(validatorAgent);
        studioProxy.submitScoreVectorForWorker(dataHash, workerAgent, scoreVector);

        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        // ========== Close epoch ==========
        mockReputationRegistry.resetCallCount();
        rewardsDistributor.closeEpoch(proxy, 1);

        // ========== Measure what was distributed ==========
        uint256 workerWithdrawable = studioProxy.getWithdrawableBalance(workerAgent);
        uint256 validatorWithdrawable = studioProxy.getWithdrawableBalance(validatorAgent);
        uint256 totalDistributed = workerWithdrawable + validatorWithdrawable;
        uint256 escrowAfter = studioProxy.getTotalEscrow();

        console.log("Worker withdrawable:    ", workerWithdrawable);
        console.log("Validator withdrawable: ", validatorWithdrawable);
        console.log("Total distributed:      ", totalDistributed);
        console.log("Escrow after closeEpoch:", escrowAfter);

        // ========== The gap: funds that went nowhere ==========
        uint256 stuckFunds = escrowBefore - totalDistributed;
        uint256 expectedOrchestratorFee = (escrowBefore * 5) / 100;

        console.log("Stuck funds:            ", stuckFunds);
        console.log("Expected 5% fee:        ", expectedOrchestratorFee);

        // The stuck funds should be AT LEAST the orchestratorFee
        // (could be more due to quality scalar rounding)
        assertGe(
            stuckFunds,
            expectedOrchestratorFee,
            "BUG: At least 5% of escrow is unaccounted for"
        );

        // ========== Prove nobody can withdraw the stuck funds ==========
        assertEq(studioProxy.getWithdrawableBalance(studioOwner), 0, "Studio owner has no withdrawable balance");
        assertEq(studioProxy.getWithdrawableBalance(owner), 0, "RD owner has no withdrawable balance");
        assertEq(studioProxy.getWithdrawableBalance(address(this)), 0, "Protocol has no withdrawable balance");

        // ========== Prove the ETH is still in the contract ==========
        uint256 contractBalance = address(proxy).balance;
        assertGt(contractBalance, totalDistributed, "Contract holds more ETH than what was distributed");

        // ========== Prove withdraw() reverts for non-recipients ==========
        vm.prank(studioOwner);
        vm.expectRevert("No funds to withdraw");
        studioProxy.withdraw();

        console.log("");
        console.log("=== BUG CONFIRMED ===");
        console.log("orchestratorFee (5%) calculated but never transferred.");
        console.log("Locked forever:", expectedOrchestratorFee, "wei");
    }

    /**
     * @notice Proves the issue compounds across multiple epochs
     */
    function test_stuck_funds_compound_across_epochs() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Compound Fee Studio", address(predictionLogic));
        StudioProxy studioProxy = StudioProxy(payable(proxy));

        vm.prank(workerAgent);
        studioProxy.registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        studioProxy.registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        // Run 3 epochs, depositing 10 ETH each time
        for (uint64 epoch = 1; epoch <= 3; epoch++) {
            vm.prank(studioOwner);
            studioProxy.deposit{value: 10 ether}();

            bytes32 dataHash = keccak256(abi.encodePacked("work_epoch_", epoch));

            vm.prank(workerAgent);
            studioProxy.submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

            rewardsDistributor.registerWork(proxy, epoch, dataHash);

            bytes memory scoreVector = abi.encode(uint8(90), uint8(90), uint8(90), uint8(90), uint8(90));
            vm.prank(validatorAgent);
            studioProxy.submitScoreVectorForWorker(dataHash, workerAgent, scoreVector);

            rewardsDistributor.registerValidator(dataHash, validatorAgent);

            rewardsDistributor.closeEpoch(proxy, epoch);
        }

        // After 3 epochs of 10 ETH each = 30 ETH total deposited
        uint256 workerWithdrawable = studioProxy.getWithdrawableBalance(workerAgent);
        uint256 validatorWithdrawable = studioProxy.getWithdrawableBalance(validatorAgent);
        uint256 totalDistributed = workerWithdrawable + validatorWithdrawable;

        // At least 5% x 30 ETH = 1.5 ETH stuck (plus rounding residuals)
        uint256 stuckFunds = 30 ether - totalDistributed;
        uint256 minExpectedStuck = (30 ether * 5) / 100;

        console.log("Total deposited (3 epochs): 30 ETH");
        console.log("Total distributed:         ", totalDistributed);
        console.log("Total stuck:               ", stuckFunds);
        console.log("Minimum expected stuck:    ", minExpectedStuck);

        assertGe(stuckFunds, minExpectedStuck, "BUG COMPOUNDS: stuck funds grow with each epoch");

        console.log("");
        console.log("=== COMPOUNDING BUG CONFIRMED ===");
        console.log("After 3 epochs, at least", minExpectedStuck / 1e18, "ETH is permanently locked");
    }
}
