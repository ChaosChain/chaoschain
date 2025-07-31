// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/core/AgentRegistry.sol";
import "../src/core/ChaosCore.sol";
import "../src/core/RewardsDistributor.sol";
import "../src/logic/VerifiableIntelligenceLogic.sol";

/**
 * @title Deploy
 * @notice Deployment script for ChaosChain contracts
 * @dev Deploys the complete ChaosChain protocol on testnet
 */
contract Deploy is Script {
    // Deployment addresses will be stored here
    AgentRegistry public agentRegistry;
    RewardsDistributor public rewardsDistributor;
    ChaosCore public chaosCore;
    VerifiableIntelligenceLogic public verifiableIntelligenceLogic;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying ChaosChain contracts...");
        console.log("Deployer address:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy AgentRegistry
        agentRegistry = new AgentRegistry(deployer);
        console.log("AgentRegistry deployed at:", address(agentRegistry));

        // 2. Deploy RewardsDistributor
        rewardsDistributor = new RewardsDistributor(deployer, deployer); // deployer as fee recipient for now
        console.log("RewardsDistributor deployed at:", address(rewardsDistributor));

        // 3. Deploy ChaosCore (factory)
        chaosCore = new ChaosCore(
            deployer,
            address(agentRegistry),
            address(rewardsDistributor)
        );
        console.log("ChaosCore deployed at:", address(chaosCore));

        // 4. Deploy VerifiableIntelligenceLogic
        verifiableIntelligenceLogic = new VerifiableIntelligenceLogic();
        console.log("VerifiableIntelligenceLogic deployed at:", address(verifiableIntelligenceLogic));

        // 5. Register the VerifiableIntelligence studio type
        chaosCore.registerLogicModule("VerifiableIntelligence", address(verifiableIntelligenceLogic));
        console.log("Registered VerifiableIntelligence studio type");

        vm.stopBroadcast();

        console.log("\n=== ChaosChain Deployment Complete ===");
        console.log("AgentRegistry:", address(agentRegistry));
        console.log("RewardsDistributor:", address(rewardsDistributor));
        console.log("ChaosCore:", address(chaosCore));
        console.log("VerifiableIntelligenceLogic:", address(verifiableIntelligenceLogic));
        
        // Output deployment info for verification
        _writeDeploymentInfo();
    }

    function _writeDeploymentInfo() internal {
        string memory deploymentInfo = string(abi.encodePacked(
            "{\n",
            '  "agentRegistry": "', vm.toString(address(agentRegistry)), '",\n',
            '  "rewardsDistributor": "', vm.toString(address(rewardsDistributor)), '",\n',
            '  "chaosCore": "', vm.toString(address(chaosCore)), '",\n',
            '  "verifiableIntelligenceLogic": "', vm.toString(address(verifiableIntelligenceLogic)), '"\n',
            "}"
        ));
        
        vm.writeFile("deployment.json", deploymentInfo);
        console.log("Deployment info written to deployment.json");
    }
} 