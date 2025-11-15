// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Reputation
 * @notice Interface for ERC-8004 v1 ReputationRegistry
 * @dev Based on official ERC-8004 v1 spec - deployed separately
 * 
 * ChaosChain protocol uses this for reputation/feedback management.
 * Full implementation: https://github.com/ChaosChain/trustless-agents-erc-ri
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Reputation {
    
    // ============ Structs ============
    
    /**
     * @notice Feedback entry structure
     */
    struct Feedback {
        uint8 score;
        bytes32 tag1;
        bytes32 tag2;
        bool isRevoked;
    }
    
    /**
     * @notice Feedback authorization structure for EIP-712 signing
     */
    struct FeedbackAuth {
        uint256 agentId;
        address clientAddress;
        uint64 indexLimit;
        uint256 expiry;
        uint256 chainId;
        address identityRegistry;
        address signerAddress;
    }
    
    // ============ Events ============
    
    /**
     * @dev Emitted when new feedback is given
     */
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint8 score,
        bytes32 indexed tag1,
        bytes32 tag2,
        string feedbackUri,
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
        string responseUri,
        bytes32 responseHash
    );
    
    // ============ Core Functions ============
    
    /**
     * @notice Give feedback for an agent
     * @param agentId The agent ID
     * @param score The feedback score (0-100)
     * @param tag1 First categorization tag
     * @param tag2 Second categorization tag
     * @param feedbackUri URI pointing to feedback details
     * @param feedbackHash Hash of feedback content
     * @param feedbackAuth EIP-712 signed authorization
     */
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata feedbackUri,
        bytes32 feedbackHash,
        bytes calldata feedbackAuth
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
     * @param responseUri URI pointing to response content
     * @param responseHash Hash of response content
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseUri,
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
     * @return feedback The feedback struct
     */
    function getFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (Feedback memory feedback);
    
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
     * @notice Get all responders for a specific feedback
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @return responders Array of responder addresses
     */
    function getResponders(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (address[] memory responders);
    
    /**
     * @notice Get response count for a responder on specific feedback
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @param responder The responder address
     * @return count The response count
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address responder
    ) external view returns (uint64 count);
}

