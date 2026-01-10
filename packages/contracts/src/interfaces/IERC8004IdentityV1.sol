// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004IdentityV1
 * @notice Interface for ERC-8004 IdentityRegistry (Jan 2026 Update)
 * @dev Based on ERC-8004 spec where agents are ERC-721 NFTs
 * 
 * KEY CHANGES (Jan 2026):
 * - agentWallet is now a reserved on-chain metadata key
 * - getAgentWallet() returns the verified wallet address
 * - setAgentWallet() requires EIP-712 signature to prove wallet ownership
 * - agentWallet resets to zero on NFT transfer
 * - tokenURI renamed to agentURI in spec (we support both)
 * 
 * Official contracts: https://github.com/erc-8004/erc-8004-contracts
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
    
    // ============ ERC-8004 Agent URI ============
    
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
    
    // ============ ERC-8004 Registration Functions ============
    
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
    
    // ============ ERC-8004 Metadata Functions ============
    
    /**
     * @notice Metadata entry structure
     */
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }
    
    /**
     * @notice Get metadata for an agent
     * @param agentId The agent ID
     * @param metadataKey The metadata key
     * @return value The metadata value
     */
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory value);
    
    /**
     * @notice Set metadata for an agent
     * @dev Cannot set reserved key "agentWallet" - use setAgentWallet() instead
     * @param agentId The agent ID
     * @param metadataKey The metadata key
     * @param metadataValue The metadata value
     */
    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external;
    
    /**
     * @notice Update agent URI
     * @param agentId The agent ID
     * @param newUri The new URI
     */
    function setAgentURI(uint256 agentId, string calldata newUri) external;
    
    // ============ ERC-8004 Agent Wallet (Jan 2026 Update) ============
    
    /**
     * @notice Get the verified agent wallet address
     * @dev Jan 2026 Update: agentWallet is now a reserved on-chain metadata key
     * @param agentId The agent ID
     * @return wallet The verified wallet address (address(0) if not set or after transfer)
     */
    function getAgentWallet(uint256 agentId) external view returns (address wallet);
    
    /**
     * @notice Set the agent wallet with signature verification
     * @dev Jan 2026 Update: Requires proof of wallet ownership
     *      - For EOAs: EIP-712 signature
     *      - For smart contracts: ERC-1271 signature
     *      - Wallet resets to address(0) on NFT transfer
     * @param agentId The agent ID
     * @param newWallet The new wallet address
     * @param deadline Signature expiration timestamp
     * @param signature EIP-712 or ERC-1271 signature proving ownership of newWallet
     */
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external;
    
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
