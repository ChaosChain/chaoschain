// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

/**
 * @title IChaosCore
 * @notice Interface for the ChaosChain Core Factory Contract
 * @dev Manages Studio deployment and protocol registry
 */
interface IChaosCore {
    /**
     * @notice Studio information structure
     * @param proxyAddress Address of the deployed StudioProxy
     * @param logicAddress Address of the logic module contract
     * @param studioType Type identifier for the studio
     * @param creator Address that created the studio
     * @param creationBlock Block number when studio was created
     * @param isActive Whether the studio is currently active
     */
    struct StudioInfo {
        address proxyAddress;
        address logicAddress;
        string studioType;
        address creator;
        uint256 creationBlock;
        bool isActive;
    }

    /**
     * @notice Emitted when a new studio is created
     * @param studioId Unique identifier for the studio
     * @param studioType Type of studio created
     * @param proxyAddress Address of the deployed proxy
     * @param creator Address that created the studio
     */
    event StudioCreated(
        bytes32 indexed studioId,
        string indexed studioType,
        address proxyAddress,
        address indexed creator
    );

    /**
     * @notice Emitted when a logic module is registered
     * @param studioType Type identifier for the logic
     * @param logicAddress Address of the logic contract
     */
    event LogicModuleRegistered(string indexed studioType, address logicAddress);

    /**
     * @notice Emitted when a studio is deactivated
     * @param studioId The studio identifier
     */
    event StudioDeactivated(bytes32 indexed studioId);

    /**
     * @notice Create a new studio instance
     * @param studioType Type of studio to create
     * @param initData Initialization data for the studio
     * @return studioProxy Address of the deployed studio proxy
     */
    function createStudio(string calldata studioType, bytes calldata initData) 
        external 
        returns (address studioProxy);

    /**
     * @notice Register a new logic module type
     * @param studioType Type identifier for the logic
     * @param logicAddress Address of the logic contract
     */
    function registerLogicModule(string calldata studioType, address logicAddress) external;

    /**
     * @notice Get studio information by ID
     * @param studioId The studio identifier
     * @return info Studio information structure
     */
    function getStudioInfo(bytes32 studioId) external view returns (StudioInfo memory info);

    /**
     * @notice Get all active studios
     * @return studioIds Array of active studio IDs
     */
    function getAllStudios() external view returns (bytes32[] memory studioIds);

    /**
     * @notice Get studios created by a specific address
     * @param creator The creator address
     * @return studioIds Array of studio IDs created by the address
     */
    function getStudiosByCreator(address creator) external view returns (bytes32[] memory studioIds);

    /**
     * @notice Get the logic module address for a studio type
     * @param studioType The studio type
     * @return logicAddress Address of the logic module
     */
    function getLogicModule(string calldata studioType) external view returns (address logicAddress);

    /**
     * @notice Check if a logic module is authorized
     * @param logicAddress The logic contract address
     * @return isAuthorized True if the logic is authorized
     */
    function isAuthorizedLogic(address logicAddress) external view returns (bool isAuthorized);

    /**
     * @notice Generate studio ID from parameters
     * @param creator The creator address
     * @param studioType The studio type
     * @param salt Additional salt for uniqueness
     * @return studioId The computed studio ID
     */
    function generateStudioId(
        address creator,
        string calldata studioType,
        bytes32 salt
    ) external pure returns (bytes32 studioId);

    /**
     * @notice Deactivate a studio (only creator or admin)
     * @param studioId The studio to deactivate
     */
    function deactivateStudio(bytes32 studioId) external;
} 