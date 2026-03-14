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
    MockIdentityRegistryOrcFee public mockIdentityRegistry;
    MockReputationRegistryOrcFee public mockReputationRegistry;

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
        mockIdentityRegistry = new MockIdentityRegistryOrcFee();
        mockReputationRegistry = new MockReputationRegistryOrcFee();

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
}

// ============ Minimal Mocks ============

contract MockIdentityRegistryOrcFee is IERC8004IdentityV1 {
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

contract MockReputationRegistryOrcFee is IERC8004Reputation {
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
