// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IChaosCore} from "./interfaces/IChaosCore.sol";
import {IChaosChainRegistry} from "./interfaces/IChaosChainRegistry.sol";
import {StudioProxyFactory} from "./StudioProxyFactory.sol";

interface IStudioProxy {
    function upgradeLogicModule(address newLogicModule) external;
}

/**
 * @title ChaosCore
 * @notice Factory and registry for Studio proxy contracts
 * @dev See §3.1.5 in ChaosChain_Implementation_Plan.md
 * 
 * ChaosCore is the central hub of the ChaosChain protocol that:
 * 1. Deploys new StudioProxy contracts
 * 2. Maintains a registry of all Studios and their configurations
 * 3. Manages logic module registration and approval
 * 4. Enforces protocol-level governance
 * 
 * Architecture:
 * - Reads ERC-8004 addresses from ChaosChainRegistry
 * - Deploys lightweight StudioProxy instances
 * - Links Studios to approved LogicModules
 * - Provides discovery and enumeration of Studios
 * 
 * @author ChaosChain Labs
 */
contract ChaosCore is Ownable, IChaosCore {
    
    // ============ State Variables ============
    
    /// @dev ChaosChainRegistry address
    IChaosChainRegistry public immutable registry;
    
    /// @dev StudioProxyFactory for deploying proxies
    StudioProxyFactory public immutable factory;
    
    /// @dev Studio counter
    uint256 private _studioCounter;
    
    /// @dev Studio configurations (studioId => StudioConfig)
    mapping(uint256 => StudioConfig) private _studios;
    
    /// @dev Proxy address to studio ID mapping
    mapping(address => uint256) private _proxyToStudioId;
    
    /// @dev Owner to studio IDs mapping
    mapping(address => uint256[]) private _ownerStudios;
    
    /// @dev Registered logic modules (module => name)
    mapping(address => string) private _logicModules;
    
    /// @dev Logic module registration status
    mapping(address => bool) private _isLogicModuleRegistered;
    
    // ============ Constructor ============
    
    /**
     * @dev Initialize ChaosCore with registry and factory
     * @param registry_ The ChaosChainRegistry address
     * @param factory_ The StudioProxyFactory address
     */
    constructor(address registry_, address factory_) Ownable(msg.sender) {
        require(registry_ != address(0), "Invalid registry");
        require(factory_ != address(0), "Invalid factory");
        registry = IChaosChainRegistry(registry_);
        factory = StudioProxyFactory(factory_);
    }
    
    // ============ Core Functions ============
    
    /// @inheritdoc IChaosCore
    function createStudio(
        string calldata name,
        address logicModule
    ) external override returns (address proxy, uint256 studioId) {
        require(bytes(name).length > 0, "Empty name");
        require(_isLogicModuleRegistered[logicModule], "Logic module not registered");
        
        // Get RewardsDistributor from registry
        address rewardsDistributor = registry.getRewardsDistributor();
        require(rewardsDistributor != address(0), "RewardsDistributor not set");
        
        // Increment studio counter
        studioId = ++_studioCounter;
        
        // Deploy new StudioProxy via factory
        proxy = factory.deployStudioProxy(
            address(this),
            address(registry),
            logicModule,
            rewardsDistributor
        );
        
        // Store studio configuration
        _studios[studioId] = StudioConfig({
            proxy: proxy,
            logicModule: logicModule,
            owner: msg.sender,
            name: name,
            createdAt: block.timestamp,
            active: true
        });
        
        // Update mappings
        _proxyToStudioId[proxy] = studioId;
        _ownerStudios[msg.sender].push(studioId);
        
        emit StudioCreated(proxy, logicModule, msg.sender, name, studioId);
    }
    
    /// @inheritdoc IChaosCore
    function registerLogicModule(
        address logicModule,
        string calldata name
    ) external override onlyOwner {
        require(logicModule != address(0), "Invalid logic module");
        require(bytes(name).length > 0, "Empty name");
        require(!_isLogicModuleRegistered[logicModule], "Already registered");
        
        _logicModules[logicModule] = name;
        _isLogicModuleRegistered[logicModule] = true;
        
        emit LogicModuleRegistered(logicModule, name);
    }
    
    /// @inheritdoc IChaosCore
    function deactivateStudio(uint256 studioId) external override {
        StudioConfig storage studio = _studios[studioId];
        require(studio.proxy != address(0), "Studio not found");
        require(studio.owner == msg.sender || msg.sender == owner(), "Not authorized");
        require(studio.active, "Already deactivated");
        
        studio.active = false;
        
        emit StudioDeactivated(studio.proxy, studioId);
    }
    
    // ============ View Functions ============
    
    /// @inheritdoc IChaosCore
    function getStudio(uint256 studioId) external view override returns (StudioConfig memory config) {
        config = _studios[studioId];
        require(config.proxy != address(0), "Studio not found");
        return config;
    }
    
    /// @inheritdoc IChaosCore
    function getStudioCount() external view override returns (uint256 count) {
        return _studioCounter;
    }
    
    /// @inheritdoc IChaosCore
    function isLogicModuleRegistered(address logicModule) external view override returns (bool registered) {
        return _isLogicModuleRegistered[logicModule];
    }
    
    /// @inheritdoc IChaosCore
    function getStudiosByOwner(address owner_) external view override returns (uint256[] memory studioIds) {
        return _ownerStudios[owner_];
    }
    
    /**
     * @notice Get studio ID from proxy address
     * @param proxy The proxy address
     * @return studioId The studio ID
     */
    function getStudioIdByProxy(address proxy) external view returns (uint256 studioId) {
        studioId = _proxyToStudioId[proxy];
        require(studioId != 0, "Studio not found");
        return studioId;
    }
    
    /**
     * @notice Get logic module name
     * @param logicModule The logic module address
     * @return name The logic module name
     */
    function getLogicModuleName(address logicModule) external view returns (string memory name) {
        return _logicModules[logicModule];
    }
    
    /**
     * @notice Upgrade logic module for a Studio
     * @dev Can only be called by Studio owner or protocol owner
     * @param studioId The studio ID
     * @param newLogicModule The new logic module address
     */
    function upgradeStudioLogic(uint256 studioId, address newLogicModule) external {
        StudioConfig storage studio = _studios[studioId];
        require(studio.proxy != address(0), "Studio not found");
        require(studio.owner == msg.sender || msg.sender == owner(), "Not authorized");
        require(_isLogicModuleRegistered[newLogicModule], "Logic module not registered");
        
        // Update Studio configuration
        studio.logicModule = newLogicModule;
        
        // Upgrade proxy
        IStudioProxy(studio.proxy).upgradeLogicModule(newLogicModule);
    }
}

