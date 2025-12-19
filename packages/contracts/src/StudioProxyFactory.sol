// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StudioProxy} from "./StudioProxy.sol";

/**
 * @title StudioProxyFactory
 * @notice Deploys StudioProxy contracts to avoid code size limits in ChaosCore
 * @dev Separating deployment logic keeps ChaosCore under 24KB limit
 * @author ChaosChain
 */
contract StudioProxyFactory {
    /**
     * @notice Deploy a new StudioProxy
     * @param chaosCore_ ChaosCore address
     * @param registry_ ChaosChainRegistry address
     * @param logicModule_ Logic module address
     * @param rewardsDistributor_ RewardsDistributor address
     * @return proxy The deployed StudioProxy address
     */
    function deployStudioProxy(
        address chaosCore_,
        address registry_,
        address logicModule_,
        address rewardsDistributor_
    ) external returns (address proxy) {
        proxy = address(new StudioProxy(
            chaosCore_,
            registry_,
            logicModule_,
            rewardsDistributor_
        ));
    }
}

