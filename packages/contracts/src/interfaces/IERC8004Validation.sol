// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Validation
 * @notice Interface for ERC-8004 ValidationRegistry (Jan 2026 Update)
 * @dev Based on official ERC-8004 spec
 * 
 * NOTE: The Validation Registry portion of ERC-8004 is still under active
 * update and discussion with the TEE community. This interface may change
 * in future updates.
 * 
 * Jan 2026 Update: tag changed from bytes32 to string
 * 
 * Official contracts: https://github.com/erc-8004/erc-8004-contracts
 * 
 * @author ERC-8004 Working Group
 */
interface IERC8004Validation {
    
    // ============ Events (Jan 2026 Update) ============
    
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
     * @dev Emitted when a validation response is provided
     * @dev Jan 2026: tag is now string, responseHash added to event
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
    
    // ============ Core Functions (Jan 2026 Update) ============
    
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
     * @notice Provide a validation response
     * @dev Jan 2026: tag changed from bytes32 to string
     * @param requestHash The hash of the validation request
     * @param response The validation result (0-100)
     * @param responseURI URI pointing to validation evidence (optional)
     * @param responseHash KECCAK-256 hash of response data (optional for IPFS)
     * @param tag Custom tag for categorization (string, optional)
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;
    
    /**
     * @notice Get validation status for a request
     * @dev Jan 2026: tag return type changed to string
     * @param requestHash The request hash
     * @return validatorAddress The validator address
     * @return agentId The agent ID
     * @return response The validation response (0-100)
     * @return tag The response tag (string)
     * @return lastUpdate Timestamp of last update
     */
    function getValidationStatus(bytes32 requestHash) external view returns (
        address validatorAddress,
        uint256 agentId,
        uint8 response,
        string memory tag,
        uint256 lastUpdate
    );
    
    /**
     * @notice Get aggregated validation statistics for an agent
     * @param agentId The agent ID
     * @param validatorAddresses Filter by validators (optional)
     * @param tag Filter by tag (optional, empty string to skip)
     * @return count Number of validations
     * @return avgResponse Average response score (0-100)
     */
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view returns (uint64 count, uint8 avgResponse);
    
    /**
     * @notice Get all validation request hashes for an agent
     * @param agentId The agent ID
     * @return requestHashes Array of request hashes
     */
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory requestHashes);
    
    /**
     * @notice Get all validation requests for a validator
     * @param validatorAddress The validator address
     * @return requestHashes Array of request hashes
     */
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory requestHashes);
}

