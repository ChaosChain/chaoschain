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
    MockIdentityRegistryQuality public mockIdentityRegistry;
    MockReputationRegistryQuality public mockReputationRegistry;

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

        // Deploy mocks
        mockIdentityRegistry = new MockIdentityRegistryQuality();
        mockReputationRegistry = new MockReputationRegistryQuality();

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

// ============ Minimal Mocks ============

contract MockIdentityRegistryQuality is IERC8004IdentityV1 {
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
    function balanceOf(address o) external view override returns (uint256) { return _balances[o]; }
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

contract MockReputationRegistryQuality is IERC8004Reputation {
    function giveFeedback(uint256, int128, uint8, string calldata, string calldata, string calldata, string calldata, bytes32) external override {
        emit NewFeedback(0, msg.sender, 0, 0, 0, "", "", "", "", "", bytes32(0));
    }
    function revokeFeedback(uint256, uint64) external override {}
    function appendResponse(uint256, address, uint64, string calldata, bytes32) external override {}
    function getIdentityRegistry() external pure override returns (address) { return address(0); }
    function getSummary(uint256, address[] calldata, string calldata, string calldata) external pure override returns (uint64, int128, uint8) { return (0, 0, 0); }
    function readFeedback(uint256, address, uint64) external pure override returns (int128, uint8, string memory, string memory, bool) { return (0, 0, "", "", false); }
    function readAllFeedback(uint256, address[] calldata, string calldata, string calldata, bool) external pure override returns (address[] memory, uint64[] memory, int128[] memory, uint8[] memory, string[] memory, string[] memory, bool[] memory) {
        return (new address[](0), new uint64[](0), new int128[](0), new uint8[](0), new string[](0), new string[](0), new bool[](0));
    }
    function getLastIndex(uint256, address) external pure override returns (uint64) { return 0; }
    function getClients(uint256) external pure override returns (address[] memory) { return new address[](0); }
    function getResponseCount(uint256, address, uint64, address[] calldata) external pure override returns (uint64) { return 0; }
}
