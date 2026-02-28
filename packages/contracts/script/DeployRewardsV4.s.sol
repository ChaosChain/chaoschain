// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";

contract DeployRewardsV4 is Script {
    function run() external {
        address registry = 0x7F38C1aFFB24F30500d9174ed565110411E42d50;
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        
        console.log("===========================================");
        console.log("Deploying RewardsDistributor V4");
        console.log("Fix: validator feedbackUri/feedbackHash");
        console.log("===========================================");
        
        vm.startBroadcast(deployerPrivateKey);
        
        RewardsDistributor rewardsDistributor = new RewardsDistributor(registry);
        console.log("RewardsDistributor V4:", address(rewardsDistributor));
        
        ChaosChainRegistry(registry).setRewardsDistributor(address(rewardsDistributor));
        console.log("Registry updated");
        
        vm.stopBroadcast();
        
        console.log("===========================================");
        console.log("DONE! New RewardsDistributor:");
        console.log(address(rewardsDistributor));
        console.log("===========================================");
    }
}
