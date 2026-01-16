// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004IdentityV1
 * @notice Minimal interface for ERC-8004 Jan 2026 IdentityRegistry (ERC-721 based)
 * @dev Based on ERC-8004 Jan 2026 spec where agents are ERC-721 NFTs
 * 
 * Key Changes from Oct 2025:
 * - agentRegistry: formal format "{namespace}:{chainId}:{identityRegistry}"
 * - tokenURI renamed to agentURI in spec; setAgentURI function added
 * - Reserved metadata key "agentWallet" with signature verification:
 *   - Cannot be set via setMetadata() or during register()
 *   - Initially set to owner's address
 *   - Changed via setAgentWallet() with EIP-712/ERC-1271 signature
 *   - Reset to zero address on transfer
 * - Optional endpoint domain verification via /.well-known/agent-registration.json
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
    
    // ============ ERC-8004 v1 Registration Functions ============
    
    /**
     * @notice Register a new agent without tokenURI
     * @return agentId The newly minted agent ID
     */
    function register() external returns (uint256 agentId);
    
    /**
     * @notice Register a new agent with tokenURI
     * @param tokenUri The URI pointing to agent metadata
     * @return agentId The newly minted agent ID
     */
    function register(string memory tokenUri) external returns (uint256 agentId);
    
    /**
     * @notice Register a new agent with tokenURI and metadata
     * @param tokenUri The URI pointing to agent metadata
     * @param metadata Array of key-value metadata entries
     * @return agentId The newly minted agent ID
     */
    function register(string memory tokenUri, MetadataEntry[] memory metadata) external returns (uint256 agentId);
    
    // ============ ERC-8004 v1 Metadata Functions ============
    
    /**
     * @notice Metadata entry structure
     */
    struct MetadataEntry {
        string key;
        bytes value;
    }
    
    /**
     * @notice Get metadata for an agent
     * @param agentId The agent ID
     * @param key The metadata key
     * @return value The metadata value
     */
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory value);
    
    /**
     * @notice Set metadata for an agent
     * @param agentId The agent ID
     * @param key The metadata key
     * @param value The metadata value
     */
    function setMetadata(uint256 agentId, string memory key, bytes memory value) external;
    
    /**
     * @notice Update agent URI (Jan 2026: renamed from setTokenURI to setAgentURI)
     * @param agentId The agent ID
     * @param newUri The new URI
     */
    function setAgentUri(uint256 agentId, string calldata newUri) external;
    
    /**
     * @notice Set agent wallet with signature verification (Jan 2026 NEW)
     * @dev Reserved key "agentWallet" cannot be set via setMetadata()
     * Agent owner must prove control of new wallet via EIP-712 (EOA) or ERC-1271 (smart contract)
     * @param agentId The agent ID
     * @param newWallet The new wallet address
     * @param deadline Signature deadline
     * @param signature EIP-712/ERC-1271 signature proving control of newWallet
     */
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    
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
    
    // ============ ERC-8004 v1 Specific Events ============
    
    /**
     * @dev Emitted when an agent is registered
     */
    event Registered(uint256 indexed agentId, string tokenURI, address indexed owner);
    
    /**
     * @dev Emitted when metadata is set
     */
    event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value);
    
    /**
     * @dev Emitted when URI is updated (Jan 2026: renamed from TokenURIUpdated to URIUpdated)
     */
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    
    /**
     * @dev DEPRECATED: Kept for backward compatibility
     */
    event UriUpdated(uint256 indexed agentId, string newUri, address indexed updatedBy);
}

