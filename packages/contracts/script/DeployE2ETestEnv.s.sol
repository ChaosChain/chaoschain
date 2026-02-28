// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {PredictionMarketLogic} from "../src/logic/PredictionMarketLogic.sol";
import {IERC8004IdentityV1} from "../src/interfaces/IERC8004IdentityV1.sol";

/**
 * @notice Inline MockIdentityRegistry for E2E test deployment
 */
contract MockIdentityRegistry is IERC8004IdentityV1 {
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

    function register(string memory) external override returns (uint256 agentId) {
        return this.register();
    }

    function register(string memory, MetadataEntry[] memory) external override returns (uint256 agentId) {
        return this.register();
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "Token does not exist");
        return owner;
    }

    function balanceOf(address owner) external view override returns (uint256) {
        return _balances[owner];
    }

    function isApprovedForAll(address, address) external pure override returns (bool) {
        return false;
    }

    function getApproved(uint256) external pure override returns (address) {
        return address(0);
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view override returns (bool) {
        address owner = _owners[agentId];
        require(owner != address(0), "ERC721NonexistentToken");
        return spender == owner;
    }

    function tokenURI(uint256) external pure override returns (string memory) {
        return "";
    }

    function getMetadata(uint256, string memory) external pure override returns (bytes memory) {
        return "";
    }

    function setMetadata(uint256, string memory, bytes memory) external override {}

    function setAgentURI(uint256, string calldata) external override {}

    function getAgentWallet(uint256 agentId) external view override returns (address) {
        return _agentWallets[agentId];
    }

    function setAgentWallet(uint256, address, uint256, bytes calldata) external override {}

    function unsetAgentWallet(uint256 agentId) external override {
        _agentWallets[agentId] = address(0);
    }
}

/**
 * @title DeployE2ETestEnv
 * @notice Deploys the full ChaosChain E2E test environment on Anvil
 * @dev Usage: forge script script/DeployE2ETestEnv.s.sol --broadcast --rpc-url http://127.0.0.1:8545
 */
contract DeployE2ETestEnv is Script {
    function run() external {
        vm.startBroadcast();

        // 1. Deploy MockIdentityRegistry
        MockIdentityRegistry identityRegistry = new MockIdentityRegistry();

        // 2. Deploy ChaosChainRegistry
        ChaosChainRegistry registry = new ChaosChainRegistry(
            address(identityRegistry),
            address(0xdead), // dummy reputation registry
            address(0xbeef)  // dummy validation registry
        );

        // 3. Deploy RewardsDistributor
        RewardsDistributor rewardsDistributor = new RewardsDistributor(address(registry));

        // 4. Deploy StudioProxyFactory
        StudioProxyFactory factory = new StudioProxyFactory();

        // 5. Deploy ChaosCore
        ChaosCore chaosCore = new ChaosCore(address(registry), address(factory));

        // 6. Deploy PredictionMarketLogic
        PredictionMarketLogic logic = new PredictionMarketLogic();

        // 7. Wire registry
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));

        // 8. Register logic module
        chaosCore.registerLogicModule(address(logic), "PredictionMarket");

        vm.stopBroadcast();

        // Output addresses in KEY=value format for TypeScript parsing
        console.log("IDENTITY_REGISTRY=%s", address(identityRegistry));
        console.log("REGISTRY=%s", address(registry));
        console.log("REWARDS_DISTRIBUTOR=%s", address(rewardsDistributor));
        console.log("FACTORY=%s", address(factory));
        console.log("CHAOS_CORE=%s", address(chaosCore));
        console.log("LOGIC_MODULE=%s", address(logic));
    }
}
