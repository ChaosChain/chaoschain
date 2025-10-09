// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IChaosChainRegistry
 * @notice Address book for ChaosChain protocol contracts and ERC-8004 registries
 * @dev See §3.1.4 in ChaosChain_Implementation_Plan.md
 * 
 * This contract acts as a single source of truth for all protocol contract addresses,
 * enabling seamless upgrades and future-proofing the protocol without full redeployment.
 * 
 * @author ChaosChain Labs
 */
interface IChaosChainRegistry {
    
    // ============ Events ============
    
    /**
     * @dev Emitted when the IdentityRegistry address is updated
     */
    event IdentityRegistryUpdated(address indexed oldAddress, address indexed newAddress);
    
    /**
     * @dev Emitted when the ReputationRegistry address is updated
     */
    event ReputationRegistryUpdated(address indexed oldAddress, address indexed newAddress);
    
    /**
     * @dev Emitted when the ValidationRegistry address is updated
     */
    event ValidationRegistryUpdated(address indexed oldAddress, address indexed newAddress);
    
    /**
     * @dev Emitted when the ChaosCore address is updated
     */
    event ChaosCoreUpdated(address indexed oldAddress, address indexed newAddress);
    
    /**
     * @dev Emitted when the RewardsDistributor address is updated
     */
    event RewardsDistributorUpdated(address indexed oldAddress, address indexed newAddress);

    // ============ Getters ============
    
    /**
     * @notice Get the IdentityRegistry contract address
     * @return The address of the ERC-8004 v1 IdentityRegistry
     */
    function getIdentityRegistry() external view returns (address);
    
    /**
     * @notice Get the ReputationRegistry contract address
     * @return The address of the ERC-8004 v1 ReputationRegistry
     */
    function getReputationRegistry() external view returns (address);
    
    /**
     * @notice Get the ValidationRegistry contract address
     * @return The address of the ERC-8004 v1 ValidationRegistry
     */
    function getValidationRegistry() external view returns (address);
    
    /**
     * @notice Get the ChaosCore contract address
     * @return The address of the ChaosCore factory
     */
    function getChaosCore() external view returns (address);
    
    /**
     * @notice Get the RewardsDistributor contract address
     * @return The address of the RewardsDistributor
     */
    function getRewardsDistributor() external view returns (address);

    // ============ Setters (Owner Only) ============
    
    /**
     * @notice Update the IdentityRegistry address
     * @dev Can only be called by the contract owner
     * @param newAddress The new IdentityRegistry address
     */
    function setIdentityRegistry(address newAddress) external;
    
    /**
     * @notice Update the ReputationRegistry address
     * @dev Can only be called by the contract owner
     * @param newAddress The new ReputationRegistry address
     */
    function setReputationRegistry(address newAddress) external;
    
    /**
     * @notice Update the ValidationRegistry address
     * @dev Can only be called by the contract owner
     * @param newAddress The new ValidationRegistry address
     */
    function setValidationRegistry(address newAddress) external;
    
    /**
     * @notice Update the ChaosCore address
     * @dev Can only be called by the contract owner
     * @param newAddress The new ChaosCore address
     */
    function setChaosCore(address newAddress) external;
    
    /**
     * @notice Update the RewardsDistributor address
     * @dev Can only be called by the contract owner
     * @param newAddress The new RewardsDistributor address
     */
    function setRewardsDistributor(address newAddress) external;
}

