// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IChaosCore
 * @notice Factory and registry for Studio proxy contracts
 * @dev See §3.1.5 in ChaosChain_Implementation_Plan.md
 * 
 * ChaosCore is the central hub that deploys new StudioProxy contracts
 * and maintains a registry of all active Studios and their logic modules.
 * 
 * @author ChaosChain Labs
 */
interface IChaosCore {
    
    // ============ Structs ============
    
    /**
     * @dev Studio configuration
     */
    struct StudioConfig {
        address proxy;
        address logicModule;
        address owner;
        string name;
        uint256 createdAt;
        bool active;
    }
    
    // ============ Events ============
    
    /**
     * @dev Emitted when a new Studio is created
     */
    event StudioCreated(
        address indexed proxy,
        address indexed logicModule,
        address indexed owner,
        string name,
        uint256 studioId
    );
    
    /**
     * @dev Emitted when a Studio is deactivated
     */
    event StudioDeactivated(address indexed proxy, uint256 indexed studioId);
    
    /**
     * @dev Emitted when a logic module is registered
     */
    event LogicModuleRegistered(address indexed logicModule, string name);

    // ============ Core Functions ============
    
    /**
     * @notice Create a new Studio
     * @param name The name of the Studio
     * @param logicModule The address of the logic module to use
     * @return proxy The address of the newly created Studio proxy
     * @return studioId The ID of the newly created Studio
     */
    function createStudio(
        string calldata name,
        address logicModule
    ) external returns (address proxy, uint256 studioId);
    
    /**
     * @notice Register a logic module
     * @dev Can only be called by authorized address
     * @param logicModule The address of the logic module
     * @param name The name of the logic module
     */
    function registerLogicModule(address logicModule, string calldata name) external;
    
    /**
     * @notice Deactivate a Studio
     * @dev Can only be called by the Studio owner or admin
     * @param studioId The ID of the Studio to deactivate
     */
    function deactivateStudio(uint256 studioId) external;
    
    /**
     * @notice Get Studio configuration
     * @param studioId The ID of the Studio
     * @return config The Studio configuration
     */
    function getStudio(uint256 studioId) external view returns (StudioConfig memory config);
    
    /**
     * @notice Get the total number of Studios
     * @return count The total number of Studios
     */
    function getStudioCount() external view returns (uint256 count);
    
    /**
     * @notice Check if a logic module is registered
     * @param logicModule The address to check
     * @return registered True if the logic module is registered
     */
    function isLogicModuleRegistered(address logicModule) external view returns (bool registered);
    
    /**
     * @notice Get Studios created by an owner
     * @param owner The owner address
     * @return studioIds Array of Studio IDs
     */
    function getStudiosByOwner(address owner) external view returns (uint256[] memory studioIds);
}

