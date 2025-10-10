// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004IdentityV1
 * @notice Minimal interface for ERC-8004 v1 IdentityRegistry (ERC-721 based)
 * @dev Based on ERC-8004 v1 spec where agents are ERC-721 NFTs
 * 
 * Key Changes from v0.4:
 * - Agents are now ERC-721 tokens (tokenId = agentId)
 * - Registration emits Transfer(0x0, owner, tokenId) not custom event
 * - Indexers should listen to Transfer events for mints
 * 
 * Full implementation: https://github.com/ChaosChain/trustless-agents-erc-ri
 * 
 * @author ChaosChain Labs
 */
interface IERC8004IdentityV1 {
    
    // ============ ERC-721 Core (What We Need) ============
    
    /**
     * @notice Get the owner of an agent NFT
     * @param tokenId The agent ID (ERC-721 tokenId)
     * @return owner The owner address
     */
    function ownerOf(uint256 tokenId) external view returns (address owner);
    
    /**
     * @notice Get the number of agents owned by an address
     * @param owner The owner address
     * @return balance The number of agents owned
     */
    function balanceOf(address owner) external view returns (uint256 balance);
    
    /**
     * @notice Check if an operator is approved for all of an owner's agents
     * @param owner The owner address
     * @param operator The operator address
     * @return approved True if approved
     */
    function isApprovedForAll(address owner, address operator) external view returns (bool approved);
    
    /**
     * @notice Get the approved address for a specific agent
     * @param tokenId The agent ID
     * @return operator The approved address
     */
    function getApproved(uint256 tokenId) external view returns (address operator);
    
    // ============ ERC-8004 v1 Specific ============
    
    /**
     * @notice Get the token URI for an agent (points to registration file)
     * @param tokenId The agent ID
     * @return uri The token URI (IPFS or HTTPS)
     */
    function tokenURI(uint256 tokenId) external view returns (string memory uri);
    
    /**
     * @notice Check if an agent exists
     * @param tokenId The agent ID to check
     * @return exists True if the agent exists
     */
    function agentExists(uint256 tokenId) external view returns (bool exists);
    
    /**
     * @notice Get total number of registered agents
     * @return count The total agent count
     */
    function totalAgents() external view returns (uint256 count);
    
    // ============ Events (ERC-721 Standard) ============
    
    /**
     * @dev Emitted when agent is minted/transferred
     * @dev For registration: Transfer(address(0), owner, tokenId)
     */
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    
    /**
     * @dev Emitted when approval is granted
     */
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    
    /**
     * @dev Emitted when operator approval is set
     */
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
}

