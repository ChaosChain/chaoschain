// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../../src/ChaosCore.sol";
import {StudioProxy} from "../../src/StudioProxy.sol";
import {StudioProxyFactory} from "../../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../../src/RewardsDistributor.sol";
import {PredictionMarketLogic} from "../../src/logic/PredictionMarketLogic.sol";
import {MockIdentityRegistryIntegration, MockReputationRegistryIntegration} from "./CloseEpoch.integration.t.sol";

/**
 * @title EpochRecloseTest
 * @notice Tests whether a closed epoch can be re-opened and re-closed.
 * @dev Found during E2E validation: the contract has no `isEpochClosed` flag,
 *      so registerWork can add works to an already-closed epoch.
 *      This test verifies whether that's safe or causes double-pay.
 */
contract EpochRecloseTest is Test {

    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    PredictionMarketLogic public predictionLogic;
    MockIdentityRegistryIntegration public mockIdentity;
    MockReputationRegistryIntegration public mockReputation;

    address public owner;
    address public studioOwner;
    address public worker;
    address public validator;
    address public treasury;
    uint256 public workerAgentId;
    uint256 public validatorAgentId;

    address public studioProxy;
    uint64 public constant EPOCH = 10; // use a clean epoch number

    function setUp() public {
        owner = address(this);
        studioOwner = makeAddr("studioOwner");
        worker = makeAddr("worker");
        validator = makeAddr("validator");
        treasury = makeAddr("treasury");

        mockIdentity = new MockIdentityRegistryIntegration();
        mockReputation = new MockReputationRegistryIntegration();

        vm.prank(worker);
        workerAgentId = mockIdentity.register();
        vm.prank(validator);
        validatorAgentId = mockIdentity.register();

        registry = new ChaosChainRegistry(
            address(mockIdentity),
            address(mockReputation),
            address(0x1003)
        );
        rewardsDistributor = new RewardsDistributor(address(registry), treasury);
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        predictionLogic = new PredictionMarketLogic();

        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");

        vm.deal(studioOwner, 100 ether);
        vm.deal(worker, 10 ether);
        vm.deal(validator, 10 ether);

        // Create studio
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Reclose Test Studio", address(predictionLogic));
        studioProxy = proxy;

        // Register agents
        vm.prank(worker);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        vm.prank(validator);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        // Fund escrow
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 50 ether}();
    }

    /// @notice Helper: submit work, score it, register in epoch
    function _submitAndScore(bytes32 dataHash) internal {
        vm.prank(worker);
        StudioProxy(payable(studioProxy)).submitWork(
            dataHash,
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            new bytes(65)
        );

        bytes memory scores = abi.encode(uint8(80), uint8(75), uint8(85), uint8(82), uint8(78));
        vm.prank(validator);
        StudioProxy(payable(studioProxy)).submitScoreVectorForWorker(dataHash, worker, scores);

        rewardsDistributor.registerWork(studioProxy, EPOCH, dataHash);
        rewardsDistributor.registerValidator(dataHash, validator);
    }

    /**
     * @notice Test: can we add work to a closed epoch and re-close it?
     * @dev If this passes, double-close is possible and old works get reprocessed.
     */
    function test_registerWork_afterCloseEpoch_isAllowed() public {
        // Submit work 1 and close epoch
        bytes32 work1 = keccak256("work_1");
        _submitAndScore(work1);

        uint256 workerBalanceBefore = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 workerBalanceAfterFirst = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);

        console.log("Worker balance after first close:", workerBalanceAfterFirst);
        assertGt(workerBalanceAfterFirst, workerBalanceBefore, "Worker got rewards from first close");

        // Now add work 2 to the SAME epoch (already closed)
        bytes32 work2 = keccak256("work_2");
        _submitAndScore(work2);

        // Verify registerWork succeeded (no revert)
        bytes32[] memory works = rewardsDistributor.getEpochWork(studioProxy, EPOCH);
        assertEq(works.length, 2, "Both works in epoch");

        // Close the epoch AGAIN
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 workerBalanceAfterSecond = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);

        console.log("Worker balance after second close:", workerBalanceAfterSecond);

        // If balance increased significantly, work1 was reprocessed (double-pay)
        uint256 firstCloseReward = workerBalanceAfterFirst - workerBalanceBefore;
        uint256 secondCloseReward = workerBalanceAfterSecond - workerBalanceAfterFirst;

        console.log("First close reward:", firstCloseReward);
        console.log("Second close reward:", secondCloseReward);

        // If second reward > first reward, it means both works were processed
        // (work1 again + work2). That's double-pay for work1.
        if (secondCloseReward > firstCloseReward) {
            console.log("WARNING: Second close rewarded MORE than first - likely double-pay");
        }
    }

    /**
     * @notice Test: does closeEpoch on the same epoch with same works double-pay?
     * @dev Close the same epoch twice WITHOUT adding new work.
     */
    function test_doubleCloseEpoch_sameWorks_doublesPay() public {
        bytes32 work1 = keccak256("double_pay_work");
        _submitAndScore(work1);

        uint256 balanceBefore = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);

        // First close
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 balanceAfterFirst = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        uint256 firstReward = balanceAfterFirst - balanceBefore;

        console.log("First close reward:", firstReward);

        // Second close — same epoch, same work, no new work added
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 balanceAfterSecond = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        uint256 secondReward = balanceAfterSecond - balanceAfterFirst;

        console.log("Second close reward:", secondReward);

        // Document the finding
        if (secondReward > 0) {
            console.log("CONFIRMED: Double-close pays rewards TWICE for the same work");
            console.log("This is a potential vulnerability - no epoch close guard exists");
        } else {
            console.log("Safe: Second close did not pay additional rewards");
        }
    }
}

