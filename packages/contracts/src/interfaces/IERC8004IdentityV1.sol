// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004IdentityV1
 * @notice Interface for ERC-8004 IdentityRegistry (Feb 2026 ABI update)
 * @dev Based on official ERC-8004 contracts v2.0.0 (ERC-721 based)
 * 
 * Key Changes:
 * - MetadataEntry struct: key→metadataKey, value→metadataValue
 * - setAgentUri → setAgentURI (capital I)
 * - Added: isAuthorizedOrOwner, getAgentWallet, unsetAgentWallet
 * 
 * Full implementation: https://github.com/erc-8004/erc-8004-contracts
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004IdentityV1 {
    
    // ============ ERC-721 Core ============
    
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
    
    /**
     * @notice Check if spender is owner or approved for the agent
     * @dev Reverts with ERC721NonexistentToken if agent doesn't exist
     * @param spender The address to check
     * @param agentId The agent ID
     * @return True if spender is owner or approved
     */
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    
    // ============ ERC-8004 Specific ============
    
    /**
     * @notice Get the token URI for an agent (points to registration file)
     * @param tokenId The agent ID
     * @return uri The token URI (IPFS or HTTPS)
     */
    function tokenURI(uint256 tokenId) external view returns (string memory uri);
    
    // ============ Registration Functions ============
    
    /**
     * @notice Metadata entry structure (Feb 2026 ABI)
     * @dev CHANGED: key→metadataKey, value→metadataValue
     */
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }
    
    /**
     * @notice Register a new agent without URI
     * @return agentId The newly minted agent ID
     */
    function register() external returns (uint256 agentId);
    
    /**
     * @notice Register a new agent with URI
     * @param agentURI The URI pointing to agent metadata
     * @return agentId The newly minted agent ID
     */
    function register(string memory agentURI) external returns (uint256 agentId);
    
    /**
     * @notice Register a new agent with URI and metadata
     * @param agentURI The URI pointing to agent metadata
     * @param metadata Array of key-value metadata entries
     * @return agentId The newly minted agent ID
     */
    function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
    
    // ============ Metadata Functions ============
    
    /**
     * @notice Get metadata for an agent
     * @param agentId The agent ID
     * @param metadataKey The metadata key
     * @return The metadata value
     */
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory);
    
    /**
     * @notice Set metadata for an agent
     * @dev Cannot set reserved key "agentWallet"
     * @param agentId The agent ID
     * @param metadataKey The metadata key
     * @param metadataValue The metadata value
     */
    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external;
    
    /**
     * @notice Update agent URI (Feb 2026: renamed from setAgentUri to setAgentURI)
     * @param agentId The agent ID
     * @param newURI The new URI
     */
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    
    /**
     * @notice Get the agent's verified wallet address
     * @param agentId The agent ID
     * @return The wallet address (zero if unset)
     */
    function getAgentWallet(uint256 agentId) external view returns (address);
    
    /**
     * @notice Set agent wallet with signature verification
     * @dev Reserved key "agentWallet" cannot be set via setMetadata()
     * Agent owner must prove control of new wallet via EIP-712 (EOA) or ERC-1271 (smart contract)
     * @param agentId The agent ID
     * @param newWallet The new wallet address
     * @param deadline Signature deadline
     * @param signature EIP-712/ERC-1271 signature proving control of newWallet
     */
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    
    /**
     * @notice Unset agent wallet (clear to zero address)
     * @param agentId The agent ID
     */
    function unsetAgentWallet(uint256 agentId) external;
    
    // ============ Events (ERC-721 Standard) ============
    
    /**
     * @dev Emitted when agent is minted/transferred
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
    
    // ============ ERC-8004 Specific Events ============
    
    /**
     * @dev Emitted when an agent is registered
     */
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    
    /**
     * @dev Emitted when metadata is set
     */
    event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue);
    
    /**
     * @dev Emitted when URI is updated
     */
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
}
