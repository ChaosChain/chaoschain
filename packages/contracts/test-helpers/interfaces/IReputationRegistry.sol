// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.19;

/**
 * @title IReputationRegistry
 * @dev Interface for ERC-8004 Reputation Registry (Jan 2026 Update)
 * @notice On-chain feedback system
 * 
 * Jan 2026 Update Changes:
 * - feedbackAuth REMOVED - any client can give feedback directly
 * - tag1, tag2 changed from bytes32 to string
 * - endpoint parameter added
 * - feedbackIndex added to events
 * 
 * @author ChaosChain Labs
 */
interface IReputationRegistry {
    
    // ============ Events (Jan 2026 Update) ============
    
    /**
     * @dev Emitted when new feedback is given
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
     */
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );

    // ============ Core Functions (Jan 2026 Update) ============
    
    /**
     * @notice Give feedback for an agent
     * @dev Jan 2026 Update: feedbackAuth removed, string tags, endpoint added
     * @param agentId The agent receiving feedback
     * @param score The feedback score (0-100)
     * @param tag1 First tag for categorization (string)
     * @param tag2 Second tag for categorization (string)
     * @param endpoint Endpoint URI for context (optional)
     * @param feedbackURI URI pointing to off-chain feedback data (optional)
     * @param feedbackHash KECCAK-256 hash of the file content (optional)
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
     * @param agentId The agent ID
     * @param clientAddress The client who gave the feedback
     * @param feedbackIndex The feedback index
     * @param responseURI URI pointing to the response data
     * @param responseHash KECCAK-256 hash of response content
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external;

    // ============ Read Functions (Jan 2026 Update) ============
    
    /**
     * @notice Get aggregated summary for an agent
     * @param agentId The agent ID (mandatory)
     * @param clientAddresses Filter by specific clients (optional)
     * @param tag1 Filter by tag1 (optional, empty string to skip)
     * @param tag2 Filter by tag2 (optional, empty string to skip)
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
     * @notice Read a specific feedback entry
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @return score The feedback score
     * @return tag1 First tag
     * @return tag2 Second tag
     * @return isRevoked Whether the feedback is revoked
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (
        uint8 score,
        string memory tag1,
        string memory tag2,
        bool isRevoked
    );
    
    /**
     * @notice Get response count for a feedback entry
     * @param agentId The agent ID (mandatory)
     * @param clientAddress The client address (optional)
     * @param feedbackIndex The feedback index (optional)
     * @param responders Filter by responders (required for non-zero counts)
     * @return count Total response count
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64 count);
    
    /**
     * @notice Get all clients who gave feedback to an agent
     * @param agentId The agent ID
     * @return clientList Array of client addresses
     */
    function getClients(uint256 agentId) external view returns (address[] memory clientList);
    
    /**
     * @notice Get the last feedback index for a client-agent pair
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @return lastIndex The last feedback index
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64 lastIndex);
    
    /**
     * @notice Get the identity registry address
     * @return registry The identity registry address
     */
    function getIdentityRegistry() external view returns (address registry);
}
