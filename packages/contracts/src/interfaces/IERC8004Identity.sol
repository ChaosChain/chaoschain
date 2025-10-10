// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Identity
 * @notice Minimal interface for ERC-8004 v1 IdentityRegistry
 * @dev Based on official ERC-8004 v1 spec - deployed separately
 * 
 * ChaosChain protocol consumes this as an external dependency.
 * Full implementation: https://github.com/ChaosChain/trustless-agents-erc-ri
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Identity {
    
    /**
     * @notice Check if an agent exists
     * @param agentId The agent ID to check
     * @return exists True if the agent exists
     */
    function agentExists(uint256 agentId) external view returns (bool exists);
    
    /**
     * @notice Get the owner of an agent
     * @param agentId The agent ID
     * @return owner The owner address
     */
    function ownerOf(uint256 agentId) external view returns (address owner);
    
    /**
     * @notice Check if an operator is approved for all of an owner's agents
     * @param owner The owner address
     * @param operator The operator address
     * @return approved True if approved
     */
    function isApprovedForAll(address owner, address operator) external view returns (bool approved);
    
    /**
     * @notice Get the approved address for a specific agent
     * @param agentId The agent ID
     * @return approved The approved address
     */
    function getApproved(uint256 agentId) external view returns (address approved);
}

