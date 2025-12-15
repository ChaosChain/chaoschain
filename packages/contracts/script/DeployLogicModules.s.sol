// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChaosCore} from "../src/ChaosCore.sol";
import {FinanceStudioLogic} from "../src/examples/FinanceStudioLogic.sol";
import {CreativeStudioLogic} from "../src/examples/CreativeStudioLogic.sol";

/**
 * @title DeployLogicModules
 * @notice Deploy additional LogicModules (Finance, Creative) to Ethereum Sepolia
 * @dev Run after DeployCore.s.sol
 */
contract DeployLogicModules is Script {
    
    function run() external {
        // Load environment variables
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address chaosCoreAddress = vm.envAddress("CHAOS_CORE");
        
        console.log("===========================================");
        console.log("Deploying Additional LogicModules");
        console.log("===========================================");
        console.log("");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("ChaosCore:", chaosCoreAddress);
        console.log("");
        
        ChaosCore chaosCore = ChaosCore(chaosCoreAddress);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy FinanceStudioLogic
        console.log("Step 1/4: Deploying FinanceStudioLogic...");
        FinanceStudioLogic financeLogic = new FinanceStudioLogic();
        console.log("  FinanceStudioLogic deployed at:", address(financeLogic));
        console.log("");
        
        // Register FinanceStudioLogic
        console.log("Step 2/4: Registering FinanceStudioLogic...");
        chaosCore.registerLogicModule(address(financeLogic), "FinanceStudio");
        console.log("  FinanceStudioLogic registered");
        console.log("");
        
        // Deploy CreativeStudioLogic
        console.log("Step 3/4: Deploying CreativeStudioLogic...");
        CreativeStudioLogic creativeLogic = new CreativeStudioLogic();
        console.log("  CreativeStudioLogic deployed at:", address(creativeLogic));
        console.log("");
        
        // Register CreativeStudioLogic
        console.log("Step 4/4: Registering CreativeStudioLogic...");
        chaosCore.registerLogicModule(address(creativeLogic), "CreativeStudio");
        console.log("  CreativeStudioLogic registered");
        console.log("");
        
        vm.stopBroadcast();
        
        console.log("===========================================");
        console.log("Deployment Complete!");
        console.log("===========================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("-------------------------------------------");
        console.log("FinanceStudioLogic:  ", address(financeLogic));
        console.log("CreativeStudioLogic: ", address(creativeLogic));
        console.log("-------------------------------------------");
        console.log("");
    }
}

