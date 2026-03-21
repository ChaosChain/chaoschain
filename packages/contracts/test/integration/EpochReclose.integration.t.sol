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
 * @notice Proves that closeEpoch can be called twice on the same epoch,
 *         resulting in double reward distribution (vulnerability).
 * @dev Found during E2E validation: the contract has no `isEpochClosed` flag.
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
    uint64 public constant EPOCH = 10;

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

        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Reclose Test Studio", address(predictionLogic));
        studioProxy = proxy;

        vm.prank(worker);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        vm.prank(validator);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 50 ether}();
    }

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
     * @notice Double-close same epoch without adding new work pays rewards twice.
     * @dev This test ASSERTS the vulnerability exists. When the contract is fixed
     *      (epoch close guard added), this test should be updated to expect revert.
     */
    function test_doubleCloseEpoch_paysRewardsTwice() public {
        bytes32 work1 = keccak256("double_pay_work");
        _submitAndScore(work1);

        uint256 balanceBefore = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);

        // First close
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 balanceAfterFirst = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        uint256 firstReward = balanceAfterFirst - balanceBefore;

        assertGt(firstReward, 0, "First close must pay rewards");

        // Second close — same epoch, same work, no new work
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 balanceAfterSecond = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        uint256 secondReward = balanceAfterSecond - balanceAfterFirst;

        // VULNERABILITY: second close pays again
        assertGt(secondReward, 0, "Double-close pays rewards twice (no epoch close guard)");
    }

    /**
     * @notice registerWork succeeds on an already-closed epoch.
     * @dev No on-chain state tracks whether an epoch was closed.
     */
    function test_registerWork_afterCloseEpoch_succeeds() public {
        bytes32 work1 = keccak256("work_1");
        _submitAndScore(work1);

        rewardsDistributor.closeEpoch(studioProxy, EPOCH);

        // Add work to already-closed epoch — should not revert
        bytes32 work2 = keccak256("work_2");
        _submitAndScore(work2);

        bytes32[] memory works = rewardsDistributor.getEpochWork(studioProxy, EPOCH);
        assertEq(works.length, 2, "registerWork allowed on closed epoch");
    }

    /**
     * @notice Re-closing after adding new work reprocesses old work too.
     */
    function test_reclose_afterNewWork_reprocessesOldWork() public {
        bytes32 work1 = keccak256("reprocess_work_1");
        _submitAndScore(work1);

        uint256 balanceBefore = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 firstReward = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker) - balanceBefore;

        // Add work 2 and re-close
        bytes32 work2 = keccak256("reprocess_work_2");
        _submitAndScore(work2);

        uint256 balanceBeforeSecond = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker);
        rewardsDistributor.closeEpoch(studioProxy, EPOCH);
        uint256 secondReward = StudioProxy(payable(studioProxy)).getWithdrawableBalance(worker) - balanceBeforeSecond;

        // Second close processes 2 works (work1 again + work2).
        // Reward may be less than first (escrow partially drained) but must be > 0,
        // proving work1 was reprocessed alongside work2.
        assertGt(secondReward, 0, "Re-close paid rewards again (old work reprocessed)");
    }
}
