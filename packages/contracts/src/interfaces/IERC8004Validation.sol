// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Validation
 * @notice Interface for ERC-8004 ValidationRegistry (Feb 2026 ABI update)
 * @dev Based on official ERC-8004 contracts v2.0.0
 * 
 * Key Changes:
 * - tag changed from bytes32 to string
 * - getValidationStatus now returns responseHash
 * - Event field names: requestUri→requestURI, responseUri→responseURI
 * 
 * Full implementation: https://github.com/erc-8004/erc-8004-contracts
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Validation {
    
    // ============ Events ============
    
    /**
     * @dev Emitted when a validation request is made
     */
    event ValidationRequest(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI,
        bytes32 indexed requestHash
    );
    
    /**
     * @dev Emitted when a validation response is provided (Feb 2026 ABI)
     * @notice CHANGED: tag is now string, added responseHash
     */
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );
    
    // ============ Core Functions ============
    
    /**
     * @notice Request validation for an agent
     * @param validatorAddress The validator address
     * @param agentId The agent ID to validate
     * @param requestURI URI pointing to validation request details
     * @param requestHash Hash of the validation request
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;
    
    /**
     * @notice Provide a validation response (Feb 2026 ABI)
     * @dev CHANGED: tag is now string type
     * @param requestHash The hash of the validation request
     * @param response The validation result (0-100)
     * @param responseURI URI pointing to validation evidence (optional)
     * @param responseHash KECCAK-256 hash of response data (optional for IPFS)
     * @param tag Custom tag for categorization (optional, string)
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;
    
    // ============ View Functions ============
    
    /**
     * @notice Get the IdentityRegistry address
     * @return The address of the IdentityRegistry
     */
    function getIdentityRegistry() external view returns (address);
    
    /**
     * @notice Get validation status for a request (Feb 2026 ABI)
     * @dev CHANGED: added responseHash, tag is now string
     * @param requestHash The request hash
     * @return validatorAddress The validator address
     * @return agentId The agent ID
     * @return response The validation response (0-100)
     * @return responseHash The response content hash
     * @return tag The response tag (string)
     * @return lastUpdate Timestamp of last update
     */
    function getValidationStatus(bytes32 requestHash) external view returns (
        address validatorAddress,
        uint256 agentId,
        uint8 response,
        bytes32 responseHash,
        string memory tag,
        uint256 lastUpdate
    );
    
    /**
     * @notice Get summary for an agent's validations
     * @param agentId The agent ID
     * @param validatorAddresses Optional filter by validator addresses
     * @param tag Optional tag filter
     * @return count Number of validations
     * @return avgResponse Average response (0-100)
     */
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view returns (uint64 count, uint8 avgResponse);
    
    /**
     * @notice Get all validation request hashes for an agent
     * @param agentId The agent ID
     * @return Array of request hashes
     */
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory);
    
    /**
     * @notice Get all validation request hashes for a validator
     * @param validatorAddress The validator address
     * @return Array of request hashes
     */
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory);
}
