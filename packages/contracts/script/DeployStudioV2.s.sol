// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {ChaosChainRegistry} from "../src/ChaosChainRegistry.sol";
import {ChaosCore} from "../src/ChaosCore.sol";

/**
 * @title DeployStudioV2
 * @notice All-in-one: deploy new RewardsDistributor (with treasury), update registry, create new studio.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... forge script script/DeployStudioV2.s.sol \
 *     --rpc-url https://eth-sepolia.g.alchemy.com/v2/<key> \
 *     --broadcast -vvv
 *
 * After running, update gateway config with the new studio address printed at the end.
 */
contract DeployStudioV2 is Script {
    // Existing Sepolia contracts
    address constant REGISTRY   = 0x7F38C1aFFB24F30500d9174ed565110411E42d50;
    address constant CHAOS_CORE = 0x92cBc471D8a525f3Ffb4BB546DD8E93FC7EE67ca;
    address constant LOGIC_MODULE = 0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3; // PredictionMarketLogic
    address constant TREASURY   = 0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("Engineering Studio v2 - Full Deploy");
        console.log("===========================================");
        console.log("Deployer:", deployer);
        console.log("Registry:", REGISTRY);
        console.log("ChaosCore:", CHAOS_CORE);
        console.log("Treasury:", TREASURY);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy new RewardsDistributor with treasury
        console.log("Step 1/3: Deploying RewardsDistributor (treasury-enabled)...");
        RewardsDistributor newDistributor = new RewardsDistributor(REGISTRY, TREASURY);
        console.log("  RewardsDistributor:", address(newDistributor));
        console.log("");

        // Step 2: Update registry to point to new distributor
        console.log("Step 2/3: Updating ChaosChainRegistry...");
        ChaosChainRegistry(REGISTRY).setRewardsDistributor(address(newDistributor));
        console.log("  Registry updated");
        console.log("");

        // Step 3: Create new Studio (reads distributor from registry automatically)
        console.log("Step 3/3: Creating Engineering Studio v2...");
        (address proxy, uint256 studioId) = ChaosCore(CHAOS_CORE).createStudio(
            "Engineering Studio v2",
            LOGIC_MODULE
        );
        console.log("  Studio ID:", studioId);
        console.log("  Studio Proxy:", proxy);
        console.log("");

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("");
        console.log("NEW RewardsDistributor:", address(newDistributor));
        console.log("NEW Studio Proxy:     ", proxy);
        console.log("Studio ID:            ", studioId);
        console.log("Treasury:             ", TREASURY);
        console.log("");
        console.log("NEXT STEPS:");
        console.log("1. Update REWARDS_DISTRIBUTOR_ADDRESS in gateway .env");
        console.log("2. Replace all 0xA855F789... with new studio proxy address");
        console.log("3. Run full loop test");
        console.log("===========================================");
    }
}
