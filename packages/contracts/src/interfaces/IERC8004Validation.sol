// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC8004Validation
 * @notice Minimal interface for ERC-8004 v1 ValidationRegistry
 * @dev Based on official ERC-8004 v1 spec - deployed separately
 * 
 * ChaosChain protocol uses this for validation requests/responses.
 * Full implementation: https://github.com/ChaosChain/trustless-agents-erc-ri
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
        string requestUri,
        bytes32 indexed requestHash
    );
    
    /**
     * @dev Emitted when a validation response is provided
     */
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseUri,
        bytes32 tag
    );
    
    // ============ Core Functions ============
    
    /**
     * @notice Request validation for an agent
     * @param validatorAddress The validator address
     * @param agentId The agent ID to validate
     * @param requestUri URI pointing to validation request details
     * @param requestHash Hash of the validation request
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestUri,
        bytes32 requestHash
    ) external;
    
    /**
     * @notice Provide a validation response
     * @param requestHash The hash of the validation request
     * @param response The validation result (0-100)
     * @param responseUri URI pointing to validation evidence (optional)
     * @param responseHash KECCAK-256 hash of response data (optional for IPFS)
     * @param tag Custom tag for categorization (optional)
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseUri,
        bytes32 responseHash,
        bytes32 tag
    ) external;
    
    /**
     * @notice Get validation status for a request
     * @param requestHash The request hash
     * @return validatorAddress The validator address
     * @return agentId The agent ID
     * @return response The validation response (0-100)
     * @return tag The response tag
     * @return lastUpdate Timestamp of last update
     */
    function getValidationStatus(bytes32 requestHash) external view returns (
        address validatorAddress,
        uint256 agentId,
        uint8 response,
        bytes32 tag,
        uint256 lastUpdate
    );
}

