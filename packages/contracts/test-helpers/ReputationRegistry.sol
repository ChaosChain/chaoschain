// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.19;

import "./IdentityRegistry.sol";
import "./interfaces/IReputationRegistry.sol";

/**
 * @title ReputationRegistry
 * @dev ERC-8004 Reputation Registry - Test Helper (Jan 2026 Update)
 * @notice On-chain feedback system for testing ChaosChain integration
 * 
 * Jan 2026 Update Changes:
 * - feedbackAuth REMOVED - any client can give feedback directly
 * - tag1, tag2 changed from bytes32 to string
 * - endpoint parameter added
 * - feedbackIndex added to events
 * 
 * @author ChaosChain Labs
 */
contract ReputationRegistry is IReputationRegistry {

    // ============ State Variables ============
    
    /// @dev Reference to the IdentityRegistry
    IdentityRegistry public immutable identityRegistry;
    
    /// @dev Struct to store feedback data (Jan 2026: string tags)
    struct Feedback {
        uint8 score;
        string tag1;
        string tag2;
        bool isRevoked;
    }
    
    /// @dev agentId => clientAddress => feedbackIndex => Feedback (1-indexed)
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) private _feedback;
    
    /// @dev agentId => clientAddress => last feedback index
    mapping(uint256 => mapping(address => uint64)) private _lastIndex;
    
    /// @dev agentId => list of client addresses
    mapping(uint256 => address[]) private _clients;
    
    /// @dev agentId => clientAddress => exists in clients array
    mapping(uint256 => mapping(address => bool)) private _clientExists;
    
    /// @dev agentId => clientAddress => feedbackIndex => responder => response count
    mapping(uint256 => mapping(address => mapping(uint64 => mapping(address => uint64)))) private _responseCount;

    // ============ Events (Jan 2026 Update) ============
    
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
    
    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex
    );
    
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );

    // ============ Constructor ============
    
    /**
     * @dev Constructor sets the identity registry reference
     * @param _identityRegistry Address of the IdentityRegistry contract
     */
    constructor(address _identityRegistry) {
        require(_identityRegistry != address(0), "Invalid registry address");
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

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
    ) external {
        // Validate score
        require(score <= 100, "Score must be 0-100");
        
        // Verify agent exists
        require(identityRegistry.agentExists(agentId), "Agent does not exist");
        
        // Get agent owner
        address agentOwner = identityRegistry.ownerOf(agentId);
        
        // SECURITY: Prevent self-feedback from owner and operators
        require(
            msg.sender != agentOwner &&
            !identityRegistry.isApprovedForAll(agentOwner, msg.sender) &&
            identityRegistry.getApproved(agentId) != msg.sender,
            "Self-feedback not allowed"
        );
        
        // Get current index for this client-agent pair (1-indexed)
        uint64 currentIndex = _lastIndex[agentId][msg.sender] + 1;
        
        // Store feedback
        _feedback[agentId][msg.sender][currentIndex] = Feedback({
            score: score,
            tag1: tag1,
            tag2: tag2,
            isRevoked: false
        });
        
        // Update last index
        _lastIndex[agentId][msg.sender] = currentIndex;
        
        // Add client to list if first feedback
        if (!_clientExists[agentId][msg.sender]) {
            _clients[agentId].push(msg.sender);
            _clientExists[agentId][msg.sender] = true;
        }
        
        emit NewFeedback(agentId, msg.sender, currentIndex, score, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }
    
    /**
     * @notice Revoke previously given feedback
     * @param agentId The agent ID
     * @param feedbackIndex The feedback index to revoke
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        require(feedbackIndex > 0 && feedbackIndex <= _lastIndex[agentId][msg.sender], "Invalid index");
        require(!_feedback[agentId][msg.sender][feedbackIndex].isRevoked, "Already revoked");
        
        _feedback[agentId][msg.sender][feedbackIndex].isRevoked = true;
        
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }
    
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
    ) external {
        require(feedbackIndex > 0 && feedbackIndex <= _lastIndex[agentId][clientAddress], "Invalid index");
        require(bytes(responseURI).length > 0, "Empty URI");
        
        // Increment response count for this responder
        _responseCount[agentId][clientAddress][feedbackIndex][msg.sender]++;
        
        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

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
    ) external view returns (uint64 count, uint8 averageScore) {
        address[] memory clients;
        if (clientAddresses.length > 0) {
            clients = clientAddresses;
        } else {
            clients = _clients[agentId];
        }
        
        uint256 totalScore = 0;
        uint64 validCount = 0;
        
        bytes32 emptyHash = keccak256(bytes(""));
        bytes32 tag1Hash = keccak256(bytes(tag1));
        bytes32 tag2Hash = keccak256(bytes(tag2));
        
        for (uint256 i = 0; i < clients.length; i++) {
            uint64 lastIdx = _lastIndex[agentId][clients[i]];
            
            for (uint64 j = 1; j <= lastIdx; j++) {
                Feedback storage fb = _feedback[agentId][clients[i]][j];
                
                // Skip revoked feedback
                if (fb.isRevoked) continue;
                
                // Apply tag filters (empty string = no filter)
                if (emptyHash != tag1Hash && tag1Hash != keccak256(bytes(fb.tag1))) continue;
                if (emptyHash != tag2Hash && tag2Hash != keccak256(bytes(fb.tag2))) continue;
                
                totalScore += fb.score;
                validCount++;
            }
        }
        
        count = validCount;
        averageScore = validCount > 0 ? uint8(totalScore / validCount) : 0;
    }
    
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
    ) {
        require(feedbackIndex > 0 && feedbackIndex <= _lastIndex[agentId][clientAddress], "Invalid index");
        Feedback storage fb = _feedback[agentId][clientAddress][feedbackIndex];
        return (fb.score, fb.tag1, fb.tag2, fb.isRevoked);
    }
    
    /**
     * @notice Get response count for feedback
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @param feedbackIndex The feedback index
     * @param responders Filter by specific responders (required for non-zero counts)
     * @return count Total response count
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64 count) {
        // Early return if no responders specified
        if (responders.length == 0) {
            return 0;
        }
        
        if (clientAddress == address(0)) {
            // Count all responses for all clients from specified responders
            address[] memory clients = _clients[agentId];
            for (uint256 i = 0; i < clients.length; i++) {
                uint64 lastIdx = _lastIndex[agentId][clients[i]];
                for (uint64 j = 1; j <= lastIdx; j++) {
                    for (uint256 k = 0; k < responders.length; k++) {
                        count += _responseCount[agentId][clients[i]][j][responders[k]];
                    }
                }
            }
        } else if (feedbackIndex == 0) {
            // Count all responses for specific client from specified responders
            uint64 lastIdx = _lastIndex[agentId][clientAddress];
            for (uint64 j = 1; j <= lastIdx; j++) {
                for (uint256 k = 0; k < responders.length; k++) {
                    count += _responseCount[agentId][clientAddress][j][responders[k]];
                }
            }
        } else {
            // Count responses for specific feedback from specified responders
            for (uint256 k = 0; k < responders.length; k++) {
                count += _responseCount[agentId][clientAddress][feedbackIndex][responders[k]];
            }
        }
    }
    
    /**
     * @notice Get all clients who gave feedback to an agent
     * @param agentId The agent ID
     * @return clientList Array of client addresses
     */
    function getClients(uint256 agentId) external view returns (address[] memory clientList) {
        return _clients[agentId];
    }
    
    /**
     * @notice Get the last feedback index for a client-agent pair
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @return lastIndex The last feedback index
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64 lastIndex) {
        return _lastIndex[agentId][clientAddress];
    }
    
    /**
     * @notice Get the identity registry address
     * @return registry The identity registry address
     */
    function getIdentityRegistry() external view returns (address registry) {
        return address(identityRegistry);
    }
}
