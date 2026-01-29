// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";

/**
 * @title RedeployERC8004Update
 * @notice Redeploy contracts after ERC-8004 Feb 2026 ABI update
 * @dev Updates: RewardsDistributor, StudioProxyFactory, ChaosCore
 *      Reuses: ChaosChainRegistry (updated via setters)
 * 
 * Usage:
 *   forge script script/RedeployERC8004Update.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     -vvv
 * 
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY - deployer private key (must own ChaosChainRegistry)
 *   EXISTING_REGISTRY    - existing ChaosChainRegistry address
 *   PREDICTION_LOGIC     - existing PredictionMarketLogic address (optional)
 */
contract RedeployERC8004Update is Script {
    
    function run() external {
        // Load environment
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address existingRegistry = vm.envAddress("EXISTING_REGISTRY");
        
        // Optional: existing prediction logic to re-register
        address predictionLogic = vm.envOr("PREDICTION_LOGIC", address(0));
        
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("===========================================");
        console.log("ERC-8004 Feb 2026 ABI Update - Redeployment");
        console.log("===========================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Existing Registry:", existingRegistry);
        console.log("Prediction Logic:", predictionLogic);
        console.log("");
        
        // Verify registry ownership
        ChaosChainRegistry registry = ChaosChainRegistry(existingRegistry);
        require(registry.owner() == deployer, "Deployer must own registry");
        
        console.log("Registry ownership verified");
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Step 1: Deploy new RewardsDistributor
        console.log("Step 1/4: Deploying RewardsDistributor (updated ABI)...");
        RewardsDistributor newRewardsDistributor = new RewardsDistributor(existingRegistry);
        console.log("  RewardsDistributor:", address(newRewardsDistributor));
        console.log("");
        
        // Step 2: Deploy new StudioProxyFactory
        console.log("Step 2/4: Deploying StudioProxyFactory (updated StudioProxy)...");
        StudioProxyFactory newFactory = new StudioProxyFactory();
        console.log("  StudioProxyFactory:", address(newFactory));
        console.log("");
        
        // Step 3: Deploy new ChaosCore
        console.log("Step 3/4: Deploying ChaosCore (new factory)...");
        ChaosCore newChaosCore = new ChaosCore(existingRegistry, address(newFactory));
        console.log("  ChaosCore:", address(newChaosCore));
        console.log("");
        
        // Step 4: Update Registry
        console.log("Step 4/4: Updating ChaosChainRegistry...");
        registry.setChaosCore(address(newChaosCore));
        registry.setRewardsDistributor(address(newRewardsDistributor));
        console.log("  Registry updated");
        console.log("");
        
        // Optional: Re-register prediction logic
        if (predictionLogic != address(0)) {
            console.log("Registering PredictionMarketLogic with new ChaosCore...");
            newChaosCore.registerLogicModule(predictionLogic, "PredictionMarket");
            console.log("  Logic module registered");
            console.log("");
        }
        
        vm.stopBroadcast();
        
        // Print summary
        console.log("===========================================");
        console.log("Redeployment Complete!");
        console.log("===========================================");
        console.log("");
        console.log("NEW Contract Addresses (update in SDK/Gateway):");
        console.log("-------------------------------------------");
        console.log("ChaosChainRegistry:    ", existingRegistry, "(unchanged)");
        console.log("RewardsDistributor:    ", address(newRewardsDistributor));
        console.log("StudioProxyFactory:    ", address(newFactory));
        console.log("ChaosCore:             ", address(newChaosCore));
        if (predictionLogic != address(0)) {
            console.log("PredictionMarketLogic: ", predictionLogic, "(re-registered)");
        }
        console.log("-------------------------------------------");
        console.log("");
        console.log("IMPORTANT: Update these addresses in:");
        console.log("  1. packages/sdk/chaoschain_sdk/chaos_agent.py");
        console.log("  2. packages/gateway/.env (or .env.example defaults)");
        console.log("");
    }
}
