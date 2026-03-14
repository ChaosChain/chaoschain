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
 * @title QualityScalarIntegrationTest
 * @notice Verifies that quality scalar uses 100% universal weight when no custom dimensions
 * @dev Fix for: quality was capped at 70% because custom component was always 0
 */
contract QualityScalarIntegrationTest is Test {

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
     * @notice Documents that createStudio never calls setCustomDimensions
     */
    function test_customDimensions_never_registered() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Quality Studio", address(predictionLogic));

        (
            string[] memory customDimNames,
            ,
            uint256 universalWeight,
            uint256 customWeight
        ) = StudioProxy(payable(proxy)).getCustomDimensionConfig();

        assertEq(customDimNames.length, 0, "No custom dims registered by createStudio");
        assertGt(universalWeight, 0, "Universal weight is set");
        assertGt(customWeight, 0, "Custom weight is set (but unused)");
    }

    /**
     * @notice With scores of 90, quality scalar should be 90 (not 63)
     * @dev Before fix: q = 70% * 90 + 30% * 0 = 63
     *      After fix:  q = 90 (100% universal when no custom dims)
     */
    function test_qualityScalar_not_capped_without_custom_dims() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Quality Score Studio", address(predictionLogic));

        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();

        uint256 totalEscrow = StudioProxy(payable(proxy)).getTotalEscrow();
        uint256 orchestratorFee = (totalEscrow * 5) / 100;
        uint256 validatorPool = (totalEscrow * 10) / 100;
        uint256 workerPool = totalEscrow - orchestratorFee - validatorPool;

        // Submit work with all scores = 90
        bytes32 dataHash = keccak256("quality_test_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        // All 5 universal dims = 90
        bytes memory scores = abi.encode(uint8(90), uint8(90), uint8(90), uint8(90), uint8(90));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        // Close epoch
        rewardsDistributor.closeEpoch(proxy, 1);

        // Worker should get ~90% of worker pool (quality scalar = 90)
        uint256 workerBalance = StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent);
        uint256 expectedReward = (workerPool * 90) / 100;

        // Allow small rounding tolerance
        assertApproxEqAbs(
            workerBalance,
            expectedReward,
            workerPool / 100, // 1% tolerance for rounding
            "Worker reward should reflect 90% quality (not capped at 63%)"
        );

        // Verify it's significantly more than the old buggy value
        uint256 buggyReward = (workerPool * 63) / 100;
        assertGt(workerBalance, buggyReward, "Reward must be higher than old buggy 63% cap");
    }

    /**
     * @notice Perfect scores (100) should give worker full pool
     */
    function test_perfectScores_full_worker_pool() public {
        vm.prank(studioOwner);
        (address proxy, ) = chaosCore.createStudio("Perfect Score Studio", address(predictionLogic));

        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);

        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);

        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();

        uint256 totalEscrow = StudioProxy(payable(proxy)).getTotalEscrow();
        uint256 orchestratorFee = (totalEscrow * 5) / 100;
        uint256 validatorPool = (totalEscrow * 10) / 100;
        uint256 workerPool = totalEscrow - orchestratorFee - validatorPool;

        // Submit work with perfect scores = 100
        bytes32 dataHash = keccak256("perfect_score_work");
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        rewardsDistributor.registerWork(proxy, 1, dataHash);

        bytes memory scores = abi.encode(uint8(100), uint8(100), uint8(100), uint8(100), uint8(100));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scores);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);

        // Close epoch
        rewardsDistributor.closeEpoch(proxy, 1);

        // Worker should get 100% of worker pool
        uint256 workerBalance = StudioProxy(payable(proxy)).getWithdrawableBalance(workerAgent);

        assertApproxEqAbs(
            workerBalance,
            workerPool,
            workerPool / 100, // 1% tolerance
            "Perfect scores should yield full worker pool"
        );
    }
}
