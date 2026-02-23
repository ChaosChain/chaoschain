// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console, Vm} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../../src/ChaosCore.sol";
import {StudioProxy} from "../../src/StudioProxy.sol";
import {StudioProxyFactory} from "../../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../../src/RewardsDistributor.sol";
import {PredictionMarketLogic} from "../../src/logic/PredictionMarketLogic.sol";
import {AccumulatingReputationRegistry, SimpleValidationRegistry} from "../helpers/E2EMocks.sol";
import {IERC8004IdentityV1} from "../../src/interfaces/IERC8004IdentityV1.sol";

contract VerifierRepE2EReproTest is Test {
    ChaosChainRegistry registry;
    ChaosCore chaosCore;
    RewardsDistributor rd;
    StudioProxyFactory factory;
    PredictionMarketLogic predictionLogic;
    AccumulatingReputationRegistry repReg;
    SimpleValidationRegistry valReg;
    MockIdForRepro idReg;

    address deployer;
    address worker1;
    address worker2;
    address verifier1;
    address verifier2;
    address studioOwner;

    function setUp() public {
        deployer = address(this);
        worker1 = makeAddr("worker1");
        worker2 = makeAddr("worker2");
        verifier1 = makeAddr("verifier1");
        verifier2 = makeAddr("verifier2");
        studioOwner = makeAddr("studioOwner");

        idReg = new MockIdForRepro();
        repReg = new AccumulatingReputationRegistry();
        valReg = new SimpleValidationRegistry();

        registry = new ChaosChainRegistry(address(idReg), address(repReg), address(valReg));
        rd = new RewardsDistributor(address(registry));
        factory = new StudioProxyFactory();
        chaosCore = new ChaosCore(address(registry), address(factory));
        predictionLogic = new PredictionMarketLogic();

        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rd));
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");

        vm.deal(studioOwner, 100 ether);
        vm.deal(worker1, 10 ether);
        vm.deal(worker2, 10 ether);
        vm.deal(verifier1, 10 ether);
        vm.deal(verifier2, 10 ether);

        // Register identities
        vm.prank(worker1);
        uint256 w1Id = idReg.register(); // 1
        vm.prank(worker2);
        uint256 w2Id = idReg.register(); // 2
        vm.prank(verifier1);
        uint256 v1Id = idReg.register(); // 3
        vm.prank(verifier2);
        uint256 v2Id = idReg.register(); // 4

        // Create studio
        vm.prank(studioOwner);
        (address proxy,) = chaosCore.createStudio("E2E Repro Studio", address(predictionLogic));

        // Register agents
        vm.prank(worker1);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(w1Id, StudioProxy.AgentRole.WORKER);
        vm.prank(worker2);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(w2Id, StudioProxy.AgentRole.WORKER);
        vm.prank(verifier1);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(v1Id, StudioProxy.AgentRole.VERIFIER);
        vm.prank(verifier2);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(v2Id, StudioProxy.AgentRole.VERIFIER);

        // Deposit
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 20 ether}();

        // Submit work
        bytes32 dataHash1 = keccak256("e2e_work_1");
        bytes32 dataHash2 = keccak256("e2e_work_2");

        vm.prank(worker1);
        StudioProxy(payable(proxy)).submitWork(dataHash1, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        vm.prank(worker2);
        StudioProxy(payable(proxy)).submitWork(dataHash2, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));

        // Scores
        bytes memory scores1 = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        bytes memory scores2 = abi.encode(uint8(82), uint8(87), uint8(82), uint8(76), uint8(85));

        vm.prank(verifier1);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash1, worker1, scores1);
        vm.prank(verifier2);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash1, worker1, scores2);
        vm.prank(verifier1);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash2, worker2, scores1);
        vm.prank(verifier2);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash2, worker2, scores2);

        // Register work + validators with RD
        rd.registerWork(proxy, 1, dataHash1);
        rd.registerWork(proxy, 1, dataHash2);
        rd.registerValidator(dataHash1, verifier1);
        rd.registerValidator(dataHash1, verifier2);
        rd.registerValidator(dataHash2, verifier1);
        rd.registerValidator(dataHash2, verifier2);
    }

    function test_verifierRepNonZero() public {
        address proxy = address(chaosCore.getStudio(1).proxy);

        vm.recordLogs();
        rd.closeEpoch(proxy, 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Count NewFeedback events
        bytes32 newFeedbackSig = keccak256("NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)");
        uint256 feedbackCount = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == newFeedbackSig) {
                feedbackCount++;
                uint256 agentId = uint256(logs[i].topics[1]);
                console.log("NewFeedback agentId:", agentId);
            }
        }
        console.log("Total NewFeedback events:", feedbackCount);

        // Check verifier rep
        (uint64 v1Count,,) = repReg.getSummary(3, new address[](0), "", "");
        (uint64 v2Count,,) = repReg.getSummary(4, new address[](0), "", "");
        console.log("Verifier1 rep count:", v1Count);
        console.log("Verifier2 rep count:", v2Count);

        assertGt(v1Count, 0, "Verifier1 rep must be > 0");
        assertGt(v2Count, 0, "Verifier2 rep must be > 0");
    }
}

contract MockIdForRepro is IERC8004IdentityV1 {
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
    }
    function register(string memory) external override returns (uint256) { return this.register(); }
    function register(string memory, MetadataEntry[] memory) external override returns (uint256) { return this.register(); }
    function ownerOf(uint256 tokenId) external view override returns (address) { return _owners[tokenId]; }
    function balanceOf(address owner) external view override returns (uint256) { return _balances[owner]; }
    function isApprovedForAll(address, address) external pure override returns (bool) { return false; }
    function getApproved(uint256) external pure override returns (address) { return address(0); }
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view override returns (bool) {
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
