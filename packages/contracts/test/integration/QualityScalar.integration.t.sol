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
 * @title QualityScalarIntegrationTest
 * @notice Proves that Studios without custom dimensions registered in StudioProxy
 *         lose ~30% of the workerPool due to the quality scalar formula.
 *
 * BUG REPORT:
 *   StudioProxy defaults to universalWeight=70% and customWeight=30%.
 *   When a Studio has NO custom dimensions registered (which is always the case
 *   because createStudio() never calls setCustomDimensions()), the 30% custom
 *   component evaluates to 0, capping the quality scalar at 70% of consensus scores.
 *
 *   Example: All verifiers score a perfect 90/100 on every dimension.
 *     qualityScalar = (700000 * 90 + 300000 * 0) / 1000000 = 63
 *     Worker receives 63% of workerPool instead of 90%.
 *     The remaining 27% is permanently locked in the StudioProxy.
 *
 *   Root cause: getScoringCriteria() in LogicModule defines custom dimensions,
 *   but these are never synced to StudioProxy._customDimensionNames via
 *   setCustomDimensions(). ChaosCore.createStudio() doesn't call it either.
 *
 *   Impact: ALL Studios are affected. No Studio ever has custom dimensions registered.
 */
contract QualityScalarIntegrationTest is Test {

    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    PredictionMarketLogic public predictionLogic;
    MockIdentityRegistryIntegration public mockIdentityRegistry;
    MockReputationRegistryIntegration public mockReputationRegistry;

    address public studioOwner;
    address public workerAgent;
    address public validatorAgent;
    uint256 public workerAgentId;
    uint256 public validatorAgentId;

    function setUp() public {
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
     * @notice Proves custom dimensions are never registered in StudioProxy
     *         even though LogicModule defines them in getScoringCriteria()
     */
    function test_customDimensions_never_registered_after_createStudio() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Test Studio", address(predictionLogic));
        StudioProxy studioProxy = StudioProxy(payable(proxy));

        // LogicModule defines 8 dimensions (5 universal + 3 custom)
        (string[] memory criteriaNames, ) = predictionLogic.getScoringCriteria();
        assertEq(criteriaNames.length, 8, "LogicModule defines 8 dimensions");
        console.log("LogicModule defines", criteriaNames.length, "dimensions");

        // But StudioProxy has 0 custom dimensions registered
        (
            string[] memory customNames,
            ,
            uint256 universalWeight,
            uint256 customWeight
        ) = studioProxy.getCustomDimensionConfig();

        assertEq(customNames.length, 0, "BUG: StudioProxy has 0 custom dimensions");
        assertEq(universalWeight, 700000, "Universal weight is 70%");
        assertEq(customWeight, 300000, "Custom weight is 30% but points to nothing");

        console.log("StudioProxy custom dimensions:", customNames.length);
        console.log("Universal weight:", universalWeight, "(70%)");
        console.log("Custom weight:", customWeight, "(30% -> WASTED)");
        console.log("");
        console.log("=== BUG: 30% of quality weight points to zero custom dimensions ===");
    }

    /**
     * @notice Proves quality scalar is capped at 70% of scores due to missing custom dims
     *
     *   With perfect scores (90 on every dimension):
     *     Expected quality: 90 (if custom dims were registered or weight was 100% universal)
     *     Actual quality:   63 (because 30% of weight -> 0)
     *
     *   Worker receives 63/90 = 70% of what they should get.
     */
    function test_qualityScalar_capped_at_70_percent() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Quality Test Studio", address(predictionLogic));
        StudioProxy studioProxy = StudioProxy(payable(proxy));

        vm.prank(workerAgent);
        studioProxy.registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        studioProxy.registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        // Deposit exactly 10 ETH to make math clean
        vm.prank(studioOwner);
        studioProxy.deposit{value: 10 ether}();

        uint256 totalEscrow = studioProxy.getTotalEscrow(); // 12 ETH (10 + 2 stakes)

        // Submit work with perfect scores (90 across all 5 universal dimensions)
        bytes32 dataHash = keccak256("quality_test_work");

        vm.prank(workerAgent);
        studioProxy.submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        // All 90s — should be considered excellent work
        bytes memory scores = abi.encode(uint8(90), uint8(90), uint8(90), uint8(90), uint8(90));
        vm.prank(validatorAgent);
        studioProxy.submitScoreVectorForWorker(dataHash, workerAgent, scores);

        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        // Close epoch
        rewardsDistributor.closeEpoch(proxy, 1);

        // Calculate expected vs actual
        uint256 workerPool = totalEscrow - (totalEscrow * 5 / 100) - (totalEscrow * 10 / 100);
        // workerPool = 12 - 0.6 - 1.2 = 10.2 ETH

        // What worker SHOULD get (if quality = 90):
        // workerShare = (10.2 * 10000 * 90) / (10000 * 100) = 9.18 ETH
        uint256 expectedShare = (workerPool * 10000 * 90) / (10000 * 100);

        // What worker ACTUALLY gets (quality = 63 due to bug):
        // workerShare = (10.2 * 10000 * 63) / (10000 * 100) = 6.426 ETH
        uint256 actualShare = studioProxy.getWithdrawableBalance(workerAgent);

        uint256 lostToQualityBug = expectedShare - actualShare;
        uint256 lostPercentage = (lostToQualityBug * 100) / expectedShare;

        console.log("=== Quality Scalar Bug Impact ===");
        console.log("Total escrow:           ", totalEscrow);
        console.log("Worker pool (85%):      ", workerPool);
        console.log("Consensus score:         90/100 (excellent)");
        console.log("");
        console.log("Expected quality scalar: 90 (if custom dims worked)");
        console.log("Actual quality scalar:   63 (30% weight -> 0)");
        console.log("");
        console.log("Expected worker share:  ", expectedShare);
        console.log("Actual worker share:    ", actualShare);
        console.log("Lost to quality bug:    ", lostToQualityBug);
        console.log("Lost percentage:        ", lostPercentage, "%");

        // Worker should get ~9.18 ETH but gets ~6.426 ETH
        // That's ~30% less than expected
        assertGt(
            lostToQualityBug,
            workerPool * 25 / 100,  // At least 25% of workerPool is lost
            "BUG: Worker loses >25% of rewards due to phantom custom weight"
        );

        // Quality scalar should be 90 but is only 63
        // 63/90 = 0.7 = exactly 70% (the universalWeight proportion)
        assertEq(
            actualShare * 90,
            expectedShare * 63,
            "Quality scalar is exactly 70% of what it should be"
        );

        console.log("");
        console.log("=== BUG CONFIRMED ===");
        console.log("Worker scored 90/100 but quality scalar is 63.");
        console.log("63/90 = 70% = exactly the universalWeight proportion.");
        console.log("The 30% customWeight contributes 0 because no custom dims are registered.");
    }

    /**
     * @notice Proves that even with perfect scores (100/100), the quality scalar
     *         is capped at 70 — making it impossible for any worker to earn full rewards
     */
    function test_even_perfect_scores_capped_at_70() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Perfect Score Studio", address(predictionLogic));
        StudioProxy studioProxy = StudioProxy(payable(proxy));

        vm.prank(workerAgent);
        studioProxy.registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        studioProxy.registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        studioProxy.deposit{value: 10 ether}();

        uint256 totalEscrow = studioProxy.getTotalEscrow();

        bytes32 dataHash = keccak256("perfect_score_work");

        vm.prank(workerAgent);
        studioProxy.submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        // PERFECT scores: 100 on everything
        bytes memory scores = abi.encode(uint8(100), uint8(100), uint8(100), uint8(100), uint8(100));
        vm.prank(validatorAgent);
        studioProxy.submitScoreVectorForWorker(dataHash, workerAgent, scores);

        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        rewardsDistributor.closeEpoch(proxy, 1);

        uint256 workerPool = totalEscrow - (totalEscrow * 5 / 100) - (totalEscrow * 10 / 100);
        uint256 actualShare = studioProxy.getWithdrawableBalance(workerAgent);

        // With quality=70 (100 * 0.7), worker gets 70% of pool
        uint256 expectedWithBug = (workerPool * 10000 * 70) / (10000 * 100);
        // With quality=100, worker should get 100% of pool
        uint256 expectedWithoutBug = (workerPool * 10000 * 100) / (10000 * 100);

        console.log("=== Perfect Scores Still Capped ===");
        console.log("Scores: 100/100 on all dimensions");
        console.log("Worker pool:                ", workerPool);
        console.log("Expected (no bug):          ", expectedWithoutBug);
        console.log("Expected (with bug, q=70):  ", expectedWithBug);
        console.log("Actual:                     ", actualShare);
        console.log("Lost:                       ", expectedWithoutBug - actualShare);

        // Even perfect work only pays 70% of the pool
        assertEq(actualShare, expectedWithBug, "BUG: Perfect scores yield quality=70, not 100");
        assertLt(actualShare, expectedWithoutBug, "Worker cannot earn full pool even with 100/100");
    }
}
