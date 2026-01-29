// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Reputation
 * @notice Interface for ERC-8004 ReputationRegistry (Feb 2026 ABI update)
 * @dev Based on official ERC-8004 contracts v2.0.0
 * 
 * KEY CHANGES from Jan 2026 spec:
 * - CHANGED score (uint8) to value (int128) + valueDecimals (uint8)
 * - This allows signed decimal values (e.g., -3.2% = -32 with valueDecimals=1)
 * 
 * ChaosChain protocol uses this for reputation/feedback management.
 * Full implementation: https://github.com/erc-8004/erc-8004-contracts
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Reputation {
    
    // ============ Structs ============
    
    /**
     * @notice Feedback entry structure (Feb 2026 ABI)
     * @dev Changed: score (uint8) → value (int128) + valueDecimals (uint8)
     */
    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }
    
    // ============ Events ============
    
    /**
     * @dev Emitted when new feedback is given (Feb 2026 ABI)
     * @notice CHANGED: score (uint8) → value (int128) + valueDecimals (uint8)
     */
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    
    /**
     * @dev Emitted when feedback is revoked
     */
    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex
    );
    
    /**
     * @dev Emitted when a response is appended to feedback
     */
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );
    
    // ============ Core Functions ============
    
    /**
     * @notice Give feedback for an agent (Feb 2026 ABI)
     * @dev CHANGED: score (uint8) → value (int128) + valueDecimals (uint8)
     * @param agentId The agent ID (must be validly registered)
     * @param value The feedback value (signed, can be negative)
     * @param valueDecimals Number of decimal places (0-18)
     * @param tag1 First categorization tag (OPTIONAL, string)
     * @param tag2 Second categorization tag (OPTIONAL, string)
     * @param endpoint URI of the endpoint being reviewed (OPTIONAL)
     * @param feedbackURI URI pointing to off-chain feedback details (OPTIONAL)
     * @param feedbackHash KECCAK-256 hash of feedbackURI content (OPTIONAL, not needed for IPFS)
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
    
    /**
     * @notice Revoke previously given feedback
     * @param agentId The agent ID
     * @param feedbackIndex The feedback index to revoke
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;
    
    /**
     * @notice Append a response to feedback
     * @dev Anyone can append responses (agents showing refunds, aggregators tagging spam, etc.)
     * @param agentId The agent ID
     * @param clientAddress The client who gave feedback
     * @param feedbackIndex The feedback index
     * @param responseURI URI pointing to response content
     * @param responseHash KECCAK-256 hash of response content (not required for IPFS)
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external;
    
    // ============ View Functions ============
    
    /**
     * @notice Get the IdentityRegistry address
     * @return The address of the IdentityRegistry
     */
    function getIdentityRegistry() external view returns (address);
    
    /**
     * @notice Get summary for an agent (Feb 2026 ABI)
     * @dev CHANGED: returns summaryValue (int128) + summaryValueDecimals (uint8) instead of averageScore
     * @param agentId The agent ID (required)
     * @param clientAddresses Filter by client addresses (REQUIRED to mitigate Sybil)
     * @param tag1 Optional tag1 filter
     * @param tag2 Optional tag2 filter
     * @return count Number of feedback entries
     * @return summaryValue Average value (signed)
     * @return summaryValueDecimals Decimal precision of summary value
     */
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
    
    /**
     * @notice Read feedback for an agent from a client (Feb 2026 ABI)
     * @dev CHANGED: returns value (int128) + valueDecimals (uint8) instead of score
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @return value The feedback value (signed)
     * @return valueDecimals Decimal precision
     * @return tag1 First tag (string)
     * @return tag2 Second tag (string)
     * @return isRevoked Whether feedback is revoked
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);
    
    /**
     * @notice Read all feedback for an agent (Feb 2026 ABI)
     * @dev CHANGED: returns values (int128[]) + valueDecimals (uint8[]) instead of scores
     * @param agentId The agent ID (required)
     * @param clientAddresses Optional filter by client addresses
     * @param tag1 Optional tag1 filter
     * @param tag2 Optional tag2 filter
     * @param includeRevoked Whether to include revoked feedback (default: false)
     * @return clients Array of client addresses
     * @return feedbackIndexes Array of feedback indexes
     * @return values Array of values (signed)
     * @return valueDecimals Array of decimal precisions
     * @return tag1s Array of tag1 strings
     * @return tag2s Array of tag2 strings
     * @return revokedStatuses Array of revoked statuses
     */
    function readAllFeedback(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2,
        bool includeRevoked
    ) external view returns (
        address[] memory clients,
        uint64[] memory feedbackIndexes,
        int128[] memory values,
        uint8[] memory valueDecimals,
        string[] memory tag1s,
        string[] memory tag2s,
        bool[] memory revokedStatuses
    );
    
    /**
     * @notice Get last feedback index for an agent from a client
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @return The last feedback index
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
    
    /**
     * @notice Get all clients who gave feedback for an agent
     * @param agentId The agent ID
     * @return Array of client addresses
     */
    function getClients(uint256 agentId) external view returns (address[] memory);
    
    /**
     * @notice Get response count for feedback
     * @dev agentId required, others optional filters
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @param responders Optional responder filter
     * @return count The response count
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64 count);
}
