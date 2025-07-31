// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IAgentRegistry.sol";

/**
 * @title AgentRegistry
 * @notice Central registry for all ChaosChain agents with A2A AgentCard compliance
 * @dev Manages agent identities, ownership, and A2A-compliant metadata
 */
contract AgentRegistry is IAgentRegistry, Ownable, ReentrancyGuard {
    /// @notice Mapping from agent ID to agent data
    mapping(uint256 => Agent) public agents;
    
    /// @notice Mapping from owner address to array of owned agent IDs
    mapping(address => uint256[]) public ownerToAgents;
    
    /// @notice Counter for generating unique agent IDs
    uint256 public nextAgentId = 1;
    
    /// @notice Total number of registered agents
    uint256 public totalAgents;

    /**
     * @notice Contract constructor
     * @param initialOwner The initial owner of the contract
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @inheritdoc IAgentRegistry
     */
    function registerAgent(string calldata metadataCID) 
        external 
        nonReentrant 
        returns (uint256 agentId) 
    {
        require(bytes(metadataCID).length > 0, "AgentRegistry: Empty metadata CID");
        
        agentId = nextAgentId++;
        
        agents[agentId] = Agent({
            owner: msg.sender,
            metadataCID: metadataCID,
            registrationBlock: block.number,
            isActive: true
        });
        
        ownerToAgents[msg.sender].push(agentId);
        totalAgents++;
        
        emit AgentRegistered(agentId, msg.sender, metadataCID);
    }

    /**
     * @inheritdoc IAgentRegistry
     */
    function updateAgentMetadata(uint256 agentId, string calldata newCID) external {
        require(_isAgentOwner(agentId, msg.sender), "AgentRegistry: Not agent owner");
        require(agents[agentId].isActive, "AgentRegistry: Agent not active");
        require(bytes(newCID).length > 0, "AgentRegistry: Empty metadata CID");
        
        agents[agentId].metadataCID = newCID;
        
        emit AgentMetadataUpdated(agentId, newCID);
    }

    /**
     * @inheritdoc IAgentRegistry
     */
    function deactivateAgent(uint256 agentId) external {
        require(_isAgentOwner(agentId, msg.sender), "AgentRegistry: Not agent owner");
        require(agents[agentId].isActive, "AgentRegistry: Agent already inactive");
        
        agents[agentId].isActive = false;
        totalAgents--;
        
        emit AgentDeactivated(agentId);
    }

    /**
     * @inheritdoc IAgentRegistry
     */
    function getAgentsByOwner(address owner) external view returns (uint256[] memory agentIds) {
        return ownerToAgents[owner];
    }

    /**
     * @inheritdoc IAgentRegistry
     */
    function getAgent(uint256 agentId) external view returns (Agent memory agent) {
        require(_agentExists(agentId), "AgentRegistry: Agent does not exist");
        return agents[agentId];
    }

    /**
     * @inheritdoc IAgentRegistry
     */
    function isValidAgent(uint256 agentId) external view returns (bool isValid) {
        return _agentExists(agentId) && agents[agentId].isActive;
    }

    /**
     * @inheritdoc IAgentRegistry
     */
    function getTotalAgents() external view returns (uint256 count) {
        return totalAgents;
    }

    /**
     * @notice Check if an agent exists
     * @param agentId The agent identifier
     * @return exists True if agent exists
     */
    function _agentExists(uint256 agentId) internal view returns (bool exists) {
        return agentId > 0 && agentId < nextAgentId && bytes(agents[agentId].metadataCID).length > 0;
    }

    /**
     * @notice Check if an address owns a specific agent
     * @param agentId The agent identifier
     * @param account The address to check
     * @return isOwner True if account owns the agent
     */
    function _isAgentOwner(uint256 agentId, address account) internal view returns (bool isOwner) {
        return _agentExists(agentId) && agents[agentId].owner == account;
    }

    /**
     * @notice Get active agents owned by an address
     * @param owner The owner address
     * @return activeAgentIds Array of active agent IDs
     */
    function getActiveAgentsByOwner(address owner) external view returns (uint256[] memory activeAgentIds) {
        uint256[] memory allAgents = ownerToAgents[owner];
        uint256 activeCount = 0;
        
        // Count active agents
        for (uint256 i = 0; i < allAgents.length; i++) {
            if (agents[allAgents[i]].isActive) {
                activeCount++;
            }
        }
        
        // Build active agents array
        activeAgentIds = new uint256[](activeCount);
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < allAgents.length; i++) {
            if (agents[allAgents[i]].isActive) {
                activeAgentIds[currentIndex] = allAgents[i];
                currentIndex++;
            }
        }
    }

    /**
     * @notice Get agent metadata CID
     * @param agentId The agent identifier
     * @return metadataCID The IPFS CID of the A2A AgentCard
     */
    function getAgentMetadata(uint256 agentId) external view returns (string memory metadataCID) {
        require(_agentExists(agentId), "AgentRegistry: Agent does not exist");
        return agents[agentId].metadataCID;
    }
} 