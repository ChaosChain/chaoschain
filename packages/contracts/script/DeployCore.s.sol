// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {PredictionMarketLogic} from "../src/logic/PredictionMarketLogic.sol";

/**
 * @title DeployCore
 * @notice Deployment script for ChaosChain MVP core protocol on Base Sepolia
 * @dev Usage: forge script script/DeployCore.s.sol --rpc-url base_sepolia --broadcast --verify
 * 
 * Prerequisites:
 * 1. Set DEPLOYER_PRIVATE_KEY in .env
 * 2. Set ERC-8004 v1 registry addresses in .env:
 *    - IDENTITY_REGISTRY
 *    - REPUTATION_REGISTRY
 *    - VALIDATION_REGISTRY
 * 3. Fund deployer with Base Sepolia ETH
 * 4. Set BASESCAN_API_KEY for verification
 * 
 * Deployment Order:
 * 1. ChaosChainRegistry (with ERC-8004 addresses)
 * 2. RewardsDistributor
 * 3. ChaosCore
 * 4. Update Registry with ChaosCore and RewardsDistributor
 * 5. PredictionMarketLogic (example)
 * 6. Register logic module
 * 
 * @author ChaosChain Labs
 */
contract DeployCore is Script {
    
    // ============ State Variables ============
    
    ChaosChainRegistry public registry;
    StudioProxyFactory public factory;
    ChaosCore public chaosCore;
    RewardsDistributor public rewardsDistributor;
    PredictionMarketLogic public predictionLogic;
    
    // ============ Main Deployment ============
    
    function run() external {
        // Load environment variables
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY");
        address reputationRegistry = vm.envAddress("REPUTATION_REGISTRY");
        address validationRegistry = vm.envAddress("VALIDATION_REGISTRY");
        
        console.log("===========================================");
        console.log("ChaosChain MVP Deployment - Base Sepolia");
        console.log("===========================================");
        console.log("");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("ERC-8004 Identity Registry:", identityRegistry);
        console.log("ERC-8004 Reputation Registry:", reputationRegistry);
        console.log("ERC-8004 Validation Registry:", validationRegistry);
        console.log("");
        
        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);
        
        // Step 1: Deploy ChaosChainRegistry
        console.log("Step 1/6: Deploying ChaosChainRegistry...");
        registry = new ChaosChainRegistry(
            identityRegistry,
            reputationRegistry,
            validationRegistry
        );
        console.log("  ChaosChainRegistry deployed at:", address(registry));
        console.log("");
        
        // Step 2: Deploy RewardsDistributor
        console.log("Step 2/7: Deploying RewardsDistributor...");
        rewardsDistributor = new RewardsDistributor(address(registry));
        console.log("  RewardsDistributor deployed at:", address(rewardsDistributor));
        console.log("");
        
        // Step 3: Deploy StudioProxyFactory
        console.log("Step 3/7: Deploying StudioProxyFactory...");
        factory = new StudioProxyFactory();
        console.log("  StudioProxyFactory deployed at:", address(factory));
        console.log("");
        
        // Step 4: Deploy ChaosCore
        console.log("Step 4/7: Deploying ChaosCore...");
        chaosCore = new ChaosCore(address(registry), address(factory));
        console.log("  ChaosCore deployed at:", address(chaosCore));
        console.log("");
        
        // Step 5: Update Registry
        console.log("Step 5/7: Updating Registry with deployed addresses...");
        registry.setChaosCore(address(chaosCore));
        registry.setRewardsDistributor(address(rewardsDistributor));
        console.log("  Registry updated successfully");
        console.log("");
        
        // Step 6: Deploy PredictionMarketLogic
        console.log("Step 6/7: Deploying PredictionMarketLogic...");
        predictionLogic = new PredictionMarketLogic();
        console.log("  PredictionMarketLogic deployed at:", address(predictionLogic));
        console.log("");
        
        // Step 7: Register logic module
        console.log("Step 7/7: Registering PredictionMarketLogic...");
        chaosCore.registerLogicModule(address(predictionLogic), "PredictionMarket");
        console.log("  Logic module registered successfully");
        console.log("");
        
        vm.stopBroadcast();
        
        // Print summary
        console.log("===========================================");
        console.log("Deployment Complete!");
        console.log("===========================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("-------------------------------------------");
        console.log("ChaosChainRegistry:    ", address(registry));
        console.log("RewardsDistributor:    ", address(rewardsDistributor));
        console.log("StudioProxyFactory:    ", address(factory));
        console.log("ChaosCore:             ", address(chaosCore));
        console.log("PredictionMarketLogic: ", address(predictionLogic));
        console.log("-------------------------------------------");
        console.log("");
        console.log("Next Steps:");
        console.log("1. Verify contracts on Basescan");
        console.log("2. Update .env with deployed addresses");
        console.log("3. Test Studio creation via ChaosCore");
        console.log("4. Register additional logic modules as needed");
        console.log("");
        console.log("Verification Command:");
        console.log("forge verify-contract <ADDRESS> <CONTRACT> --chain base-sepolia");
        console.log("");
    }
}

