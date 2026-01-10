// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Reputation
 * @notice Interface for ERC-8004 ReputationRegistry (Jan 2026 Update)
 * @dev Based on official ERC-8004 spec - Jan 2026 update
 * 
 * KEY CHANGES from previous version:
 * - feedbackAuth REMOVED - any client can now give feedback directly
 * - tag1, tag2 changed from bytes32 to string
 * - Added endpoint parameter
 * - Added feedbackIndex to events
 * 
 * ChaosChain protocol uses this for reputation/feedback management.
 * Official contracts: https://github.com/erc-8004/erc-8004-contracts
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Reputation {
    
    // ============ Events ============
    
    /**
     * @dev Emitted when new feedback is given
     * @param agentId The agent receiving feedback
     * @param clientAddress The client giving feedback
     * @param feedbackIndex The index of this feedback (1-indexed)
     * @param score The feedback score (0-100)
     * @param tag1 First categorization tag (indexed)
     * @param tag2 Second categorization tag
     * @param endpoint The endpoint URI (optional)
     * @param feedbackURI URI pointing to feedback details
     * @param feedbackHash Hash of feedback content
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
    
    // ============ Core Functions ============
    
    /**
     * @notice Give feedback for an agent
     * @dev Jan 2026 Update: feedbackAuth removed, tags are now strings, endpoint added
     * @param agentId The agent ID
     * @param score The feedback score (0-100)
     * @param tag1 First categorization tag (string)
     * @param tag2 Second categorization tag (string)
     * @param endpoint Endpoint URI for context (optional, can be empty)
     * @param feedbackURI URI pointing to feedback details
     * @param feedbackHash Hash of feedback content
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
     * @param feedbackIndex The feedback index to revoke (1-indexed)
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;
    
    /**
     * @notice Append a response to feedback
     * @param agentId The agent ID
     * @param clientAddress The client who gave feedback
     * @param feedbackIndex The feedback index
     * @param responseURI URI pointing to response content
     * @param responseHash Hash of response content (not required for IPFS URIs)
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
     * @notice Get feedback for an agent from a client
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index (1-indexed)
     * @return score The feedback score
     * @return tag1 First tag
     * @return tag2 Second tag
     * @return isRevoked Whether feedback is revoked
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
     * @notice Get aggregated summary for an agent
     * @param agentId The agent ID
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
     * @notice Get response count for feedback
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @param responders Filter by specific responders
     * @return count The response count
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64 count);
}
