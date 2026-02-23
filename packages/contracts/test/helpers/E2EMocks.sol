// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC8004Reputation} from "../../src/interfaces/IERC8004Reputation.sol";
import {IERC8004IdentityV1} from "../../src/interfaces/IERC8004IdentityV1.sol";
import {IERC8004Validation} from "../../src/interfaces/IERC8004Validation.sol";

/**
 * @title AccumulatingReputationRegistry
 * @notice Stores giveFeedback calls; getSummary returns accumulated values.
 */
contract AccumulatingReputationRegistry is IERC8004Reputation {
    mapping(uint256 => int128) private _accValue;
    mapping(uint256 => uint64)  private _count;

    function giveFeedback(
        uint256 agentId, int128 value, uint8 valueDecimals,
        string calldata tag1, string calldata tag2,
        string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash
    ) external override {
        _accValue[agentId] += value;
        _count[agentId]++;
        emit NewFeedback(agentId, msg.sender, _count[agentId], value, valueDecimals,
            tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function getSummary(uint256 agentId, address[] calldata, string calldata, string calldata)
        external view override returns (uint64, int128, uint8)
    {
        return (_count[agentId], _accValue[agentId], 0);
    }

    function revokeFeedback(uint256, uint64) external override {}
    function appendResponse(uint256, address, uint64, string calldata, bytes32) external override {}
    function getIdentityRegistry() external pure override returns (address) { return address(0); }
    function readFeedback(uint256, address, uint64) external pure override
        returns (int128, uint8, string memory, string memory, bool) { return (0,0,"","",false); }
    function readAllFeedback(uint256, address[] calldata, string calldata, string calldata, bool)
        external pure override returns (address[] memory, uint64[] memory, int128[] memory,
        uint8[] memory, string[] memory, string[] memory, bool[] memory)
    { return (new address[](0),new uint64[](0),new int128[](0),new uint8[](0),
              new string[](0),new string[](0),new bool[](0)); }
    function getLastIndex(uint256, address) external pure override returns (uint64) { return 0; }
    function getClients(uint256) external pure override returns (address[] memory) { return new address[](0); }
    function getResponseCount(uint256, address, uint64, address[] calldata) external pure override returns (uint64) { return 0; }
}

/**
 * @title SimpleValidationRegistry
 * @notice No-op ValidationRegistry that accepts all calls without reverting.
 */
contract SimpleValidationRegistry is IERC8004Validation {
    function validationRequest(address, uint256, string calldata, bytes32) external override {}
    function validationResponse(bytes32, uint8, string calldata, bytes32, string calldata) external override {}
    function getIdentityRegistry() external pure override returns (address) { return address(0); }
    function getValidationStatus(bytes32) external pure override
        returns (address, uint256, uint8, bytes32, string memory, uint256) { return (address(0),0,0,bytes32(0),"",0); }
    function getSummary(uint256, address[] calldata, string calldata)
        external pure override returns (uint64, uint8) { return (0,0); }
    function getAgentValidations(uint256) external pure override returns (bytes32[] memory) { return new bytes32[](0); }
    function getValidatorRequests(address) external pure override returns (bytes32[] memory) { return new bytes32[](0); }
}
