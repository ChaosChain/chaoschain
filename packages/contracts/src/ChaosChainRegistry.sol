// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IChaosChainRegistry} from "./interfaces/IChaosChainRegistry.sol";

/**
 * @title ChaosChainRegistry
 * @notice Address book for ChaosChain protocol contracts and ERC-8004 registries
 * @dev See §3.1.4 in ChaosChain_Implementation_Plan.md
 * 
 * This contract acts as a single source of truth for all protocol contract addresses.
 * It allows the protocol to upgrade to new versions of ERC-8004 contracts or internal
 * components without requiring a full protocol redeployment.
 * 
 * Security: Only the contract owner (governance) can update addresses.
 * 
 * @author ChaosChain Labs
 */
contract ChaosChainRegistry is Ownable, IChaosChainRegistry {
    
    // ============ State Variables ============
    
    /// @dev ERC-8004 v1 IdentityRegistry address
    address private _identityRegistry;
    
    /// @dev ERC-8004 v1 ReputationRegistry address
    address private _reputationRegistry;
    
    /// @dev ERC-8004 v1 ValidationRegistry address
    address private _validationRegistry;
    
    /// @dev ChaosCore factory address
    address private _chaosCore;
    
    /// @dev RewardsDistributor address
    address private _rewardsDistributor;
    
    // ============ Constructor ============
    
    /**
     * @dev Initialize the registry with initial addresses
     * @param identityRegistry_ Address of ERC-8004 v1 IdentityRegistry
     * @param reputationRegistry_ Address of ERC-8004 v1 ReputationRegistry
     * @param validationRegistry_ Address of ERC-8004 v1 ValidationRegistry
     */
    constructor(
        address identityRegistry_,
        address reputationRegistry_,
        address validationRegistry_
    ) Ownable(msg.sender) {
        require(identityRegistry_ != address(0), "Invalid identity registry");
        require(reputationRegistry_ != address(0), "Invalid reputation registry");
        // ValidationRegistry is optional - ERC-8004 team hasn't deployed it yet
        // require(validationRegistry_ != address(0), "Invalid validation registry");
        
        _identityRegistry = identityRegistry_;
        _reputationRegistry = reputationRegistry_;
        _validationRegistry = validationRegistry_;
    }
    
    // ============ Getters ============
    
    /// @inheritdoc IChaosChainRegistry
    function getIdentityRegistry() external view override returns (address) {
        return _identityRegistry;
    }
    
    /// @inheritdoc IChaosChainRegistry
    function getReputationRegistry() external view override returns (address) {
        return _reputationRegistry;
    }
    
    /// @inheritdoc IChaosChainRegistry
    function getValidationRegistry() external view override returns (address) {
        return _validationRegistry;
    }
    
    /// @inheritdoc IChaosChainRegistry
    function getChaosCore() external view override returns (address) {
        return _chaosCore;
    }
    
    /// @inheritdoc IChaosChainRegistry
    function getRewardsDistributor() external view override returns (address) {
        return _rewardsDistributor;
    }
    
    // ============ Setters (Owner Only) ============
    
    /// @inheritdoc IChaosChainRegistry
    function setIdentityRegistry(address newAddress) external override onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = _identityRegistry;
        _identityRegistry = newAddress;
        emit IdentityRegistryUpdated(oldAddress, newAddress);
    }
    
    /// @inheritdoc IChaosChainRegistry
    function setReputationRegistry(address newAddress) external override onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = _reputationRegistry;
        _reputationRegistry = newAddress;
        emit ReputationRegistryUpdated(oldAddress, newAddress);
    }
    
    /// @inheritdoc IChaosChainRegistry
    function setValidationRegistry(address newAddress) external override onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = _validationRegistry;
        _validationRegistry = newAddress;
        emit ValidationRegistryUpdated(oldAddress, newAddress);
    }
    
    /// @inheritdoc IChaosChainRegistry
    function setChaosCore(address newAddress) external override onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = _chaosCore;
        _chaosCore = newAddress;
        emit ChaosCoreUpdated(oldAddress, newAddress);
    }
    
    /// @inheritdoc IChaosChainRegistry
    function setRewardsDistributor(address newAddress) external override onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = _rewardsDistributor;
        _rewardsDistributor = newAddress;
        emit RewardsDistributorUpdated(oldAddress, newAddress);
    }
}

