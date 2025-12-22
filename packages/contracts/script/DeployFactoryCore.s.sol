// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {StudioProxyFactory} from "../src/StudioProxyFactory.sol";
import {FinanceStudioLogic} from "../src/logic/FinanceStudioLogic.sol";

/**
 * @title DeployFactoryCore
 * @notice Deploy updated StudioProxyFactory and ChaosCore (keeping existing Registry)
 * @dev Usage: forge script script/DeployFactoryCore.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
 */
contract DeployFactoryCore is Script {
    
    // Existing deployed contracts on Sepolia
    address constant REGISTRY = 0xB5Dba66ae57479190A7723518f8cA7ea8c40de53;
    address constant REWARDS_DISTRIBUTOR = 0xA050527d38Fae9467730412d941560c8706F060A;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        console.log("===========================================");
        console.log("Deploying Updated Factory + ChaosCore");
        console.log("===========================================");
        console.log("Registry:", REGISTRY);
        console.log("RewardsDistributor:", REWARDS_DISTRIBUTOR);
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Step 1: Deploy new StudioProxyFactory (contains updated StudioProxy)
        console.log("Step 1/3: Deploying StudioProxyFactory...");
        StudioProxyFactory factory = new StudioProxyFactory();
        console.log("  StudioProxyFactory:", address(factory));
        
        // Step 2: Deploy new ChaosCore
        console.log("Step 2/3: Deploying ChaosCore...");
        ChaosCore chaosCore = new ChaosCore(REGISTRY, address(factory));
        console.log("  ChaosCore:", address(chaosCore));
        
        // Step 3: Deploy FinanceStudioLogic and register
        console.log("Step 3/3: Deploying FinanceStudioLogic...");
        FinanceStudioLogic financeLogic = new FinanceStudioLogic();
        console.log("  FinanceStudioLogic:", address(financeLogic));
        
        chaosCore.registerLogicModule(address(financeLogic), "FinanceStudio");
        console.log("  Logic module registered!");
        
        vm.stopBroadcast();
        
        console.log("");
        console.log("===========================================");
        console.log("Deployment Complete!");
        console.log("===========================================");
        console.log("StudioProxyFactory:", address(factory));
        console.log("ChaosCore:         ", address(chaosCore));
        console.log("FinanceStudioLogic:", address(financeLogic));
        console.log("");
        console.log("NOW UPDATE REGISTRY:");
        console.log("cast send", REGISTRY);
        console.log('  "setChaosCore(address)"', address(chaosCore));
    }
}


