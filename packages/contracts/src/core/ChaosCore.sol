// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../interfaces/IChaosCore.sol";
import "../proxies/StudioProxy.sol";

/**
 * @title ChaosCore
 * @notice Factory contract for deploying ChaosChain Studios
 * @dev Manages Studio deployment using the proxy pattern and maintains protocol registry
 */
contract ChaosCore is IChaosCore, Ownable, ReentrancyGuard {
    using Clones for address;

    /// @notice Mapping from studio ID to studio information
    mapping(bytes32 => StudioInfo) public studios;
    
    /// @notice Mapping from studio type to logic module address
    mapping(string => address) public logicModules;
    
    /// @notice Mapping to track authorized logic contracts
    mapping(address => bool) public authorizedLogic;
    
    /// @notice Mapping from creator to their studio IDs
    mapping(address => bytes32[]) public creatorToStudios;
    
    /// @notice Array of all studio IDs
    bytes32[] public allStudios;
    
    /// @notice Address of the StudioProxy implementation contract
    address public immutable STUDIO_PROXY_IMPLEMENTATION;
    
    /// @notice Address of the AgentRegistry contract
    address public immutable AGENT_REGISTRY;
    
    /// @notice Address of the RewardsDistributor contract
    address public immutable REWARDS_DISTRIBUTOR;

    /**
     * @notice Contract constructor
     * @param initialOwner The initial owner of the contract
     * @param agentRegistry Address of the AgentRegistry contract
     * @param rewardsDistributor Address of the RewardsDistributor contract
     */
    constructor(
        address initialOwner,
        address agentRegistry,
        address rewardsDistributor
    ) Ownable(initialOwner) {
        require(agentRegistry != address(0), "ChaosCore: Invalid agent registry");
        require(rewardsDistributor != address(0), "ChaosCore: Invalid rewards distributor");
        
        AGENT_REGISTRY = agentRegistry;
        REWARDS_DISTRIBUTOR = rewardsDistributor;
        
        // Deploy the StudioProxy implementation
        STUDIO_PROXY_IMPLEMENTATION = address(new StudioProxy());
    }

    /**
     * @inheritdoc IChaosCore
     */
    function createStudio(string calldata studioType, bytes calldata initData) 
        external 
        nonReentrant 
        returns (address studioProxy) 
    {
        address logicAddress = logicModules[studioType];
        require(logicAddress != address(0), "ChaosCore: Studio type not registered");
        require(authorizedLogic[logicAddress], "ChaosCore: Logic not authorized");
        
        // Generate unique studio ID
        bytes32 salt = keccak256(abi.encodePacked(msg.sender, studioType, block.timestamp, allStudios.length));
        bytes32 studioId = generateStudioId(msg.sender, studioType, salt);
        
        require(studios[studioId].proxyAddress == address(0), "ChaosCore: Studio already exists");
        
        // Deploy studio proxy using CREATE2 for deterministic addresses
        studioProxy = Clones.cloneDeterministic(STUDIO_PROXY_IMPLEMENTATION, salt);
        
        // Initialize the proxy with logic address and initialization data
        StudioProxy(payable(studioProxy)).initialize(
            logicAddress,
            AGENT_REGISTRY,
            REWARDS_DISTRIBUTOR,
            initData
        );
        
        // Store studio information
        studios[studioId] = StudioInfo({
            proxyAddress: studioProxy,
            logicAddress: logicAddress,
            studioType: studioType,
            creator: msg.sender,
            creationBlock: block.number,
            isActive: true
        });
        
        // Update tracking arrays
        creatorToStudios[msg.sender].push(studioId);
        allStudios.push(studioId);
        
        emit StudioCreated(studioId, studioType, studioProxy, msg.sender);
    }

    /**
     * @inheritdoc IChaosCore
     */
    function registerLogicModule(string calldata studioType, address logicAddress) external onlyOwner {
        require(bytes(studioType).length > 0, "ChaosCore: Empty studio type");
        require(logicAddress != address(0), "ChaosCore: Invalid logic address");
        require(logicModules[studioType] == address(0), "ChaosCore: Studio type already registered");
        
        logicModules[studioType] = logicAddress;
        authorizedLogic[logicAddress] = true;
        
        emit LogicModuleRegistered(studioType, logicAddress);
    }

    /**
     * @inheritdoc IChaosCore
     */
    function getStudioInfo(bytes32 studioId) external view returns (StudioInfo memory info) {
        require(studios[studioId].proxyAddress != address(0), "ChaosCore: Studio does not exist");
        return studios[studioId];
    }

    /**
     * @inheritdoc IChaosCore
     */
    function getAllStudios() external view returns (bytes32[] memory studioIds) {
        return allStudios;
    }

    /**
     * @inheritdoc IChaosCore
     */
    function getStudiosByCreator(address creator) external view returns (bytes32[] memory studioIds) {
        return creatorToStudios[creator];
    }

    /**
     * @inheritdoc IChaosCore
     */
    function getLogicModule(string calldata studioType) external view returns (address logicAddress) {
        return logicModules[studioType];
    }

    /**
     * @inheritdoc IChaosCore
     */
    function isAuthorizedLogic(address logicAddress) external view returns (bool isAuthorized) {
        return authorizedLogic[logicAddress];
    }

    /**
     * @inheritdoc IChaosCore
     */
    function generateStudioId(
        address creator,
        string calldata studioType,
        bytes32 salt
    ) public pure returns (bytes32 studioId) {
        return keccak256(abi.encodePacked(creator, studioType, salt));
    }

    /**
     * @inheritdoc IChaosCore
     */
    function deactivateStudio(bytes32 studioId) external {
        StudioInfo storage studio = studios[studioId];
        require(studio.proxyAddress != address(0), "ChaosCore: Studio does not exist");
        require(
            studio.creator == msg.sender || owner() == msg.sender,
            "ChaosCore: Not authorized to deactivate"
        );
        require(studio.isActive, "ChaosCore: Studio already inactive");
        
        studio.isActive = false;
        
        emit StudioDeactivated(studioId);
    }

    /**
     * @notice Get active studios only
     * @return activeStudioIds Array of active studio IDs
     */
    function getActiveStudios() external view returns (bytes32[] memory activeStudioIds) {
        uint256 activeCount = 0;
        
        // Count active studios
        for (uint256 i = 0; i < allStudios.length; i++) {
            if (studios[allStudios[i]].isActive) {
                activeCount++;
            }
        }
        
        // Build active studios array
        activeStudioIds = new bytes32[](activeCount);
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < allStudios.length; i++) {
            if (studios[allStudios[i]].isActive) {
                activeStudioIds[currentIndex] = allStudios[i];
                currentIndex++;
            }
        }
    }

    /**
     * @notice Predict studio proxy address
     * @param creator The creator address
     * @param studioType The studio type
     * @param salt Salt for deterministic deployment
     * @return predictedAddress The predicted proxy address
     */
    function predictStudioAddress(
        address creator,
        string calldata studioType,
        bytes32 salt
    ) external view returns (address predictedAddress) {
        return Clones.predictDeterministicAddress(STUDIO_PROXY_IMPLEMENTATION, salt);
    }

    /**
     * @notice Get total number of studios
     * @return count Total studio count
     */
    function getTotalStudios() external view returns (uint256 count) {
        return allStudios.length;
    }

    /**
     * @notice Remove logic module authorization (emergency function)
     * @param logicAddress The logic address to deauthorize
     */
    function deauthorizeLogic(address logicAddress) external onlyOwner {
        require(authorizedLogic[logicAddress], "ChaosCore: Logic not authorized");
        authorizedLogic[logicAddress] = false;
    }
} 