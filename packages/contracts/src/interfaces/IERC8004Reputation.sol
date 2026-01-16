// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Reputation
 * @notice Interface for ERC-8004 Jan 2026 ReputationRegistry
 * @dev Based on official ERC-8004 Jan 2026 spec update
 * 
 * KEY CHANGES from Oct 2025 spec:
 * - REMOVED feedbackAuth parameter (no pre-authorization required)
 * - ADDED endpoint parameter for feedback
 * - CHANGED tag1, tag2 from bytes32 to string
 * - ADDED feedbackIndex to NewFeedback event
 * 
 * ChaosChain protocol uses this for reputation/feedback management.
 * Full implementation: https://github.com/ChaosChain/trustless-agents-erc-ri
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Reputation {
    
    // ============ Structs ============
    
    /**
     * @notice Feedback entry structure (Jan 2026 spec)
     * @dev Tags changed from bytes32 to string
     */
    struct Feedback {
        uint8 score;
        string tag1;
        string tag2;
        bool isRevoked;
    }
    
    // NOTE: FeedbackAuth struct REMOVED in Jan 2026 spec
    // Feedback submission is now permissionless (any clientAddress can submit)
    
    // ============ Events ============
    
    /**
     * @dev Emitted when new feedback is given (Jan 2026 spec)
     * @notice CHANGED: Added feedbackIndex, endpoint; tags now string (tag1 indexed as string)
     */
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        uint8 score,
        string indexed tag1,
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
     * @notice CHANGED: responseUri renamed to responseURI
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
     * @notice Give feedback for an agent (Jan 2026 spec)
     * @dev CHANGED: Removed feedbackAuth, added endpoint, tags now string
     * @param agentId The agent ID (must be validly registered)
     * @param score The feedback score (0-100)
     * @param tag1 First categorization tag (OPTIONAL, string)
     * @param tag2 Second categorization tag (OPTIONAL, string)
     * @param endpoint URI of the endpoint being reviewed (OPTIONAL)
     * @param feedbackURI URI pointing to off-chain feedback details (OPTIONAL)
     * @param feedbackHash KECCAK-256 hash of feedbackURI content (OPTIONAL, not needed for IPFS)
     */
    function giveFeedback(
        uint256 agentId,
        uint8 score,
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
     * @notice Get summary for an agent (Jan 2026 spec)
     * @dev Tags changed to string; filtering by clientAddresses mitigates Sybil attacks
     * @param agentId The agent ID (required)
     * @param clientAddresses Optional filter by client addresses
     * @param tag1 Optional tag1 filter
     * @param tag2 Optional tag2 filter
     * @return count Number of feedback entries
     * @return averageScore Average score (0-100)
     */
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, uint8 averageScore);
    
    /**
     * @notice Read feedback for an agent from a client (Jan 2026 spec)
     * @dev CHANGED: feedbackIndex parameter name, returns string tags
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @return score The feedback score
     * @return tag1 First tag (string)
     * @return tag2 Second tag (string)
     * @return isRevoked Whether feedback is revoked
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (uint8 score, string memory tag1, string memory tag2, bool isRevoked);
    
    /**
     * @notice Read all feedback for an agent (Jan 2026 spec)
     * @dev CHANGED: Returns feedbackIndexes array, string tags; revoked omitted by default
     * @param agentId The agent ID (required)
     * @param clientAddresses Optional filter by client addresses
     * @param tag1 Optional tag1 filter
     * @param tag2 Optional tag2 filter
     * @param includeRevoked Whether to include revoked feedback (default: false)
     * @return clientAddresses_ Array of client addresses
     * @return feedbackIndexes Array of feedback indexes
     * @return scores Array of scores
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
        address[] memory clientAddresses_,
        uint64[] memory feedbackIndexes,
        uint8[] memory scores,
        string[] memory tag1s,
        string[] memory tag2s,
        bool[] memory revokedStatuses
    );
    
    /**
     * @notice Get last feedback index for an agent from a client
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @return index The last feedback index
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64 index);
    
    /**
     * @notice Get all clients who gave feedback for an agent
     * @param agentId The agent ID
     * @return clients Array of client addresses
     */
    function getClients(uint256 agentId) external view returns (address[] memory clients);
    
    /**
     * @notice Get response count for feedback (Jan 2026 spec)
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

