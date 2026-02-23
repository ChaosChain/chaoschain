// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ChaosChainRegistry} from "../../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../../src/ChaosCore.sol";
import {StudioProxy} from "../../src/StudioProxy.sol";
import {StudioProxyFactory} from "../../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../../src/RewardsDistributor.sol";
import {PredictionMarketLogic} from "../../src/logic/PredictionMarketLogic.sol";
import {IERC8004IdentityV1} from "../../src/interfaces/IERC8004IdentityV1.sol";
import {IERC8004Reputation} from "../../src/interfaces/IERC8004Reputation.sol";

/**
 * @title ERC8004Jan2026BoundaryTest
 * @notice Category C: ERC-8004 boundary tests for Jan 2026 spec compliance
 * @dev These tests answer exactly one question: "Are we calling ERC-8004 correctly?"
 * 
 * Jan 2026 Spec Requirements:
 * - tags MUST be strings (not bytes32)
 * - endpoint parameter MUST be included
 * - feedbackAuth MUST NOT be present
 * - agentWallet routing should work
 * 
 * These tests use a STRICT mock ReputationRegistry that REVERTS on invalid calls
 */
contract ERC8004Jan2026BoundaryTest is Test {
    
    // ============ Contracts ============
    ChaosChainRegistry public registry;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    StudioProxyFactory public factory;
    PredictionMarketLogic public predictionLogic;
    MockIdentityRegistryERC8004 public mockIdentityRegistry;
    StrictJan2026ReputationMock public strictReputationRegistry;
    
    // ============ Actors ============
    address public studioOwner;
    address public workerAgent;
    address public validatorAgent;
    
    uint256 public workerAgentId;
    uint256 public validatorAgentId;
    
    function setUp() public {
        studioOwner = makeAddr("studioOwner");
        workerAgent = makeAddr("workerAgent");
        validatorAgent = makeAddr("validatorAgent");
        
        mockIdentityRegistry = new MockIdentityRegistryERC8004();
        strictReputationRegistry = new StrictJan2026ReputationMock();
        
        vm.prank(workerAgent);
        workerAgentId = mockIdentityRegistry.register();
        
        vm.prank(validatorAgent);
        validatorAgentId = mockIdentityRegistry.register();
        
        registry = new ChaosChainRegistry(
            address(mockIdentityRegistry),
            address(strictReputationRegistry),  // STRICT mock that enforces Jan 2026
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
    
    // ============ Category C: ERC-8004 Jan 2026 Boundary Tests ============
    
    /**
     * @notice Verify giveFeedback is called with string tags (not bytes32)
     * @dev The strict mock reverts if tags are not proper strings
     */
    function test_giveFeedback_uses_string_tags() public {
        (address proxy, ) = _createStudioWithAgents();
        
        // Submit work and score
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        // Close epoch - this triggers giveFeedback
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        // If tags were bytes32 instead of strings, the strict mock would revert
        rewardsDistributor.closeEpoch(proxy, 1);
        
        // Verify string tags were used
        assertTrue(
            bytes(strictReputationRegistry.lastTag1()).length > 0,
            "tag1 should be non-empty string"
        );
        assertTrue(
            bytes(strictReputationRegistry.lastTag2()).length > 0,
            "tag2 should be non-empty string"
        );
        
        console.log("tag1:", strictReputationRegistry.lastTag1());
        console.log("tag2:", strictReputationRegistry.lastTag2());
    }
    
    /**
     * @notice Verify endpoint parameter is included in giveFeedback calls
     * @dev Jan 2026 spec requires endpoint parameter
     */
    function test_giveFeedback_includes_endpoint_parameter() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        // The strict mock records whether endpoint was provided
        rewardsDistributor.closeEpoch(proxy, 1);
        
        // Verify endpoint was included (even if empty string)
        assertTrue(
            strictReputationRegistry.endpointWasProvided(),
            "endpoint parameter must be provided"
        );
    }
    
    /**
     * @notice Verify feedbackAuth is NOT used in giveFeedback calls
     * @dev Feb 2026 ABI has 8 params: (agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
     */
    function test_giveFeedback_no_feedbackAuth() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        // The strict mock tracks the number of parameters received
        // Feb 2026 signature: (agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
        // That's 8 parameters (value replaced score, valueDecimals was added)
        
        rewardsDistributor.closeEpoch(proxy, 1);
        
        // If feedbackAuth was still being passed, the strict mock would revert
        // because it only accepts the Feb 2026 8-parameter signature
        assertEq(
            strictReputationRegistry.lastCallParameterCount(),
            8,
            "giveFeedback should have exactly 8 parameters (Feb 2026 ABI)"
        );
    }
    
    /**
     * @notice Verify giveFeedback is called with correct agentId
     * @dev agentId must match the worker's registered identity
     */
    function test_giveFeedback_correct_agentId() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        rewardsDistributor.closeEpoch(proxy, 1);
        
        assertEq(
            strictReputationRegistry.lastWorkerAgentId(),
            workerAgentId,
            "worker dimension feedback must use worker's agentId"
        );
    }
    
    /**
     * @notice Verify scores are in valid range (0-100)
     * @dev Consensus scores must be valid reputation scores
     */
    function test_giveFeedback_valid_score_range() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        rewardsDistributor.closeEpoch(proxy, 1);
        
        int128 value = strictReputationRegistry.lastValue();
        assertTrue(value >= 0 && value <= 100, "Value must be 0-100");
    }
    
    /**
     * @notice Verify feedback is published for each dimension
     * @dev ChaosChain publishes 5 universal dimensions
     */
    function test_giveFeedback_called_for_each_dimension() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        strictReputationRegistry.resetCallCount();
        
        rewardsDistributor.closeEpoch(proxy, 1);
        
        // Should be called at least 5 times (once per dimension)
        assertGe(
            strictReputationRegistry.giveFeedbackCallCount(),
            5,
            "giveFeedback should be called for each of 5 dimensions"
        );
    }
    
    /**
     * @notice Verify tag1 contains dimension name
     * @dev tag1 should be a human-readable dimension identifier
     */
    function test_tag1_is_dimension_name() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        rewardsDistributor.closeEpoch(proxy, 1);
        
        string memory tag1 = strictReputationRegistry.lastWorkerTag1();
        
        // tag1 should be one of the dimension names
        bool isValidDimension = (
            keccak256(bytes(tag1)) == keccak256(bytes("Initiative")) ||
            keccak256(bytes(tag1)) == keccak256(bytes("Collaboration")) ||
            keccak256(bytes(tag1)) == keccak256(bytes("Reasoning")) ||
            keccak256(bytes(tag1)) == keccak256(bytes("Compliance")) ||
            keccak256(bytes(tag1)) == keccak256(bytes("Efficiency"))
        );
        
        assertTrue(isValidDimension, "tag1 should be a valid dimension name");
    }
    
    /**
     * @notice Verify tag2 contains studio address
     * @dev tag2 should identify the studio for filtering
     */
    function test_tag2_is_studio_address() public {
        (address proxy, ) = _createStudioWithAgents();
        bytes32 dataHash = _submitWorkAndScore(proxy);
        
        rewardsDistributor.registerWork(proxy, 1, dataHash);
        rewardsDistributor.registerValidator(dataHash, validatorAgent);
        
        rewardsDistributor.closeEpoch(proxy, 1);
        
        string memory tag2 = strictReputationRegistry.lastWorkerTag2();
        
        // tag2 should be the studio address as a string (0x...)
        assertTrue(
            bytes(tag2).length == 42,  // "0x" + 40 hex chars
            "tag2 should be 42-char address string"
        );
        assertTrue(
            bytes(tag2)[0] == "0" && bytes(tag2)[1] == "x",
            "tag2 should start with 0x"
        );
    }
    
    // ============ ABI Selector Regression Tests ============
    
    /**
     * @notice Regression test: Verify giveFeedback selector matches upstream ERC-8004 ABI
     * @dev Feb 2026 ABI: giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)
     * Selector: keccak256("giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)")[:4]
     */
    function test_giveFeedback_selector_matches_upstream() public {
        // The expected selector for giveFeedback with Feb 2026 ABI
        // giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)
        bytes4 expectedSelector = bytes4(keccak256("giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)"));
        
        // Get the actual selector from the interface
        bytes4 actualSelector = IERC8004Reputation.giveFeedback.selector;
        
        assertEq(
            actualSelector,
            expectedSelector,
            "giveFeedback selector must match upstream ERC-8004 Feb 2026 ABI"
        );
    }
    
    // ============ Helper Functions ============
    
    function _createStudioWithAgents() internal returns (address proxy, uint256 studioId) {
        vm.prank(studioOwner);
        (proxy, studioId) = chaosCore.createStudio("ERC8004 Test Studio", address(predictionLogic));
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(workerAgentId, StudioProxy.AgentRole.WORKER);
        
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).registerAgent{value: 1 ether}(validatorAgentId, StudioProxy.AgentRole.VERIFIER);
        
        vm.prank(studioOwner);
        StudioProxy(payable(proxy)).deposit{value: 10 ether}();
    }
    
    function _submitWorkAndScore(address proxy) internal returns (bytes32 dataHash) {
        dataHash = keccak256("erc8004_boundary_test_work");
        
        vm.prank(workerAgent);
        StudioProxy(payable(proxy)).submitWork(dataHash, bytes32(uint256(1)), bytes32(uint256(2)), new bytes(65));
        
        bytes memory scoreVector = abi.encode(uint8(85), uint8(90), uint8(80), uint8(75), uint8(88));
        vm.prank(validatorAgent);
        StudioProxy(payable(proxy)).submitScoreVectorForWorker(dataHash, workerAgent, scoreVector);
    }
}

/**
 * @notice STRICT Mock Reputation Registry for Feb 2026 ABI compliance testing
 * @dev This mock ENFORCES the Feb 2026 ABI and REVERTS on invalid calls
 */
contract StrictJan2026ReputationMock is IERC8004Reputation {
    // Call tracking
    uint256 private _giveFeedbackCalls;
    uint256 private _lastCallParameterCount;
    bool private _endpointProvided;
    
    // Last call values (any call)
    uint256 public lastAgentId;
    int128 public lastValue;
    uint8 public lastValueDecimals;
    string public lastTag1;
    string public lastTag2;
    string public lastEndpoint;
    string public lastFeedbackUri;
    bytes32 public lastFeedbackHash;

    // Last WORKER dimension feedback (tag1 is a dimension name, not VALIDATOR_ACCURACY)
    uint256 public lastWorkerAgentId;
    string public lastWorkerTag1;
    string public lastWorkerTag2;
    
    function resetCallCount() external {
        _giveFeedbackCalls = 0;
    }
    
    function giveFeedbackCallCount() external view returns (uint256) {
        return _giveFeedbackCalls;
    }
    
    function lastCallParameterCount() external view returns (uint256) {
        return _lastCallParameterCount;
    }
    
    function endpointWasProvided() external view returns (bool) {
        return _endpointProvided;
    }
    
    /**
     * @notice Feb 2026 ABI compliant giveFeedback
     * @dev REVERTS if called with wrong signature
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackUri,
        bytes32 feedbackHash
    ) external override {
        // Record that we received exactly 8 parameters (Feb 2026 ABI)
        _lastCallParameterCount = 8;
        
        // Validate requirements
        
        // 1. valueDecimals must be <= 18
        require(valueDecimals <= 18, "StrictMock: valueDecimals must be <= 18");
        
        // 2. endpoint must be provided (even if empty)
        _endpointProvided = true;
        
        // 3. tag1 should be non-empty (dimension name)
        require(bytes(tag1).length > 0, "StrictMock: tag1 (dimension) required");
        
        // 4. tag2 should be non-empty (studio address)
        require(bytes(tag2).length > 0, "StrictMock: tag2 (studio) required");
        
        // Store for verification
        _giveFeedbackCalls++;
        lastAgentId = agentId;
        lastValue = value;
        lastValueDecimals = valueDecimals;
        lastTag1 = tag1;
        lastTag2 = tag2;
        lastEndpoint = endpoint;
        lastFeedbackUri = feedbackUri;
        lastFeedbackHash = feedbackHash;

        // Track worker dimension feedback separately from validator feedback
        if (keccak256(bytes(tag1)) != keccak256(bytes("VALIDATOR_ACCURACY"))) {
            lastWorkerAgentId = agentId;
            lastWorkerTag1 = tag1;
            lastWorkerTag2 = tag2;
        }
        
        emit NewFeedback(
            agentId,
            msg.sender,
            uint64(_giveFeedbackCalls),
            value,
            valueDecimals,
            tag1,   // indexedTag1 (also emitted as non-indexed)
            tag1,
            tag2,
            endpoint,
            feedbackUri,
            feedbackHash
        );
    }
    
    function revokeFeedback(uint256, uint64) external override {}
    
    function appendResponse(uint256, address, uint64, string calldata, bytes32) external override {}
    
    function getIdentityRegistry() external pure override returns (address) {
        return address(0);
    }
    
    function getSummary(uint256, address[] calldata, string calldata, string calldata) 
        external pure override returns (uint64, int128, uint8) 
    {
        return (0, 0, 0);
    }
    
    function readFeedback(uint256, address, uint64) external pure override returns (
        int128, uint8, string memory, string memory, bool
    ) {
        return (0, 0, "", "", false);
    }
    
    function readAllFeedback(uint256, address[] calldata, string calldata, string calldata, bool) 
        external pure override returns (
            address[] memory,
            uint64[] memory,
            int128[] memory,
            uint8[] memory,
            string[] memory,
            string[] memory,
            bool[] memory
        ) 
    {
        return (
            new address[](0),
            new uint64[](0),
            new int128[](0),
            new uint8[](0),
            new string[](0),
            new string[](0),
            new bool[](0)
        );
    }
    
    function getLastIndex(uint256, address) external pure override returns (uint64) {
        return 0;
    }
    
    function getClients(uint256) external pure override returns (address[] memory) {
        return new address[](0);
    }
    
    function getResponseCount(uint256, address, uint64, address[] calldata) external pure override returns (uint64) {
        return 0;
    }
}

/**
 * @notice Mock Identity Registry for ERC-8004 boundary tests (Feb 2026 ABI)
 */
contract MockIdentityRegistryERC8004 is IERC8004IdentityV1 {
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
    function balanceOf(address owner) external view override returns (uint256) { return _balances[owner]; }
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
