// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

/**
 * @title IAgentRegistry
 * @notice Interface for the ChaosChain Agent Registry
 * @dev Manages agent identities with A2A AgentCard compliance
 */
interface IAgentRegistry {
    /**
     * @notice Agent registration data structure
     * @param owner The Ethereum address that owns this agent
     * @param metadataCID IPFS CID pointing to A2A-compliant AgentCard
     * @param registrationBlock Block number when agent was registered
     * @param isActive Whether the agent is currently active
     */
    struct Agent {
        address owner;
        string metadataCID;
        uint256 registrationBlock;
        bool isActive;
    }

    /**
     * @notice Emitted when a new agent is registered
     * @param agentId The unique identifier for the agent
     * @param owner The address that owns the agent
     * @param metadataCID IPFS CID of the A2A AgentCard
     */
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string metadataCID);

    /**
     * @notice Emitted when agent metadata is updated
     * @param agentId The agent identifier
     * @param newMetadataCID Updated IPFS CID
     */
    event AgentMetadataUpdated(uint256 indexed agentId, string newMetadataCID);

    /**
     * @notice Emitted when an agent is deactivated
     * @param agentId The agent identifier
     */
    event AgentDeactivated(uint256 indexed agentId);

    /**
     * @notice Register a new agent with A2A-compliant metadata
     * @param metadataCID IPFS CID pointing to the agent's A2A AgentCard
     * @return agentId The unique identifier assigned to the agent
     */
    function registerAgent(string calldata metadataCID) external returns (uint256 agentId);

    /**
     * @notice Update an existing agent's metadata
     * @param agentId The agent to update
     * @param newCID New IPFS CID for the updated AgentCard
     */
    function updateAgentMetadata(uint256 agentId, string calldata newCID) external;

    /**
     * @notice Deactivate an agent (only owner can call)
     * @param agentId The agent to deactivate
     */
    function deactivateAgent(uint256 agentId) external;

    /**
     * @notice Get all agents owned by a specific address
     * @param owner The owner address to query
     * @return agentIds Array of agent IDs owned by the address
     */
    function getAgentsByOwner(address owner) external view returns (uint256[] memory agentIds);

    /**
     * @notice Get agent information by ID
     * @param agentId The agent identifier
     * @return agent The agent data structure
     */
    function getAgent(uint256 agentId) external view returns (Agent memory agent);

    /**
     * @notice Check if an agent exists and is active
     * @param agentId The agent identifier
     * @return isValid True if agent exists and is active
     */
    function isValidAgent(uint256 agentId) external view returns (bool isValid);

    /**
     * @notice Get the total number of registered agents
     * @return count Total agent count
     */
    function getTotalAgents() external view returns (uint256 count);
} 