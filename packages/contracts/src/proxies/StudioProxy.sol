// SPDX-License-Identifier: APACHE-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../logic/IStudioLogic.sol";

/**
 * @title StudioProxy
 * @notice Lightweight proxy contract for Studio instances
 * @dev Holds state and funds while delegating logic to modular contracts
 */
contract StudioProxy is Initializable, ReentrancyGuard {
    /// @notice Submission data for evidence packages
    mapping(uint256 => IStudioLogic.Submission) public submissions;
    
    /// @notice Score vectors for each submission
    mapping(uint256 => ScoreVector[]) public scoreVectors;
    
    /// @notice Agent stakes mapping
    mapping(uint256 => uint256) public agentStakes;
    
    /// @notice Counter for generating submission IDs
    uint256 public nextSubmissionId = 1;
    
    /// @notice Address of the logic module contract
    address public logicAddress;
    
    /// @notice Address of the AgentRegistry contract
    address public agentRegistry;
    
    /// @notice Address of the RewardsDistributor contract
    address public rewardsDistributor;
    
    /// @notice Whether the studio is initialized
    bool public initialized;

    /**
     * @notice Score vector structure for verifier submissions
     * @param verifierAgentId The agent ID of the verifier
     * @param submissionId The submission being scored
     * @param scores Array of numerical scores
     * @param reportCID IPFS CID of the detailed verification report
     * @param timestamp When the score was submitted
     */
    struct ScoreVector {
        uint256 verifierAgentId;
        uint256 submissionId;
        uint256[] scores;
        string reportCID;
        uint256 timestamp;
    }

    /**
     * @notice Emitted when evidence is submitted
     * @param submissionId The submission identifier
     * @param agentId The agent that submitted evidence
     * @param evidenceCID IPFS CID of the evidence package
     */
    event EvidenceSubmitted(uint256 indexed submissionId, uint256 indexed agentId, string evidenceCID);

    /**
     * @notice Emitted when a score vector is submitted
     * @param submissionId The submission being scored
     * @param verifierAgentId The verifier agent
     * @param scores The score values
     */
    event ScoreSubmitted(
        uint256 indexed submissionId,
        uint256 indexed verifierAgentId,
        uint256[] scores
    );

    /**
     * @notice Emitted when an agent stakes funds
     * @param agentId The agent staking funds
     * @param amount The stake amount
     */
    event AgentStaked(uint256 indexed agentId, uint256 amount);

    /**
     * @notice Emitted when an agent withdraws stake
     * @param agentId The agent withdrawing stake
     * @param amount The withdrawal amount
     */
    event StakeWithdrawn(uint256 indexed agentId, uint256 amount);

    /**
     * @notice Contract constructor (implementation contract)
     * @dev This constructor is for the implementation contract deployed by ChaosCore
     */
    constructor() {
        // Disable initialization for the implementation contract
        _disableInitializers();
    }

    /**
     * @notice Initialize the studio proxy
     * @param _logicAddress Address of the logic module
     * @param _agentRegistry Address of the AgentRegistry
     * @param _rewardsDistributor Address of the RewardsDistributor
     * @param initData Encoded initialization data for the logic module
     */
    function initialize(
        address _logicAddress,
        address _agentRegistry,
        address _rewardsDistributor,
        bytes calldata initData
    ) external initializer {
        require(_logicAddress != address(0), "StudioProxy: Invalid logic address");
        require(_agentRegistry != address(0), "StudioProxy: Invalid agent registry");
        require(_rewardsDistributor != address(0), "StudioProxy: Invalid rewards distributor");
        
        // Set storage variables
        logicAddress = _logicAddress;
        agentRegistry = _agentRegistry;
        rewardsDistributor = _rewardsDistributor;
        
        initialized = true;
        
        // Delegate initialization to the logic contract
        (bool success, ) = _logicAddress.delegatecall(
            abi.encodeWithSelector(IStudioLogic.initialize.selector, initData)
        );
        require(success, "StudioProxy: Initialization failed");
    }

    /**
     * @notice Submit evidence package for verification
     * @param agentId The agent submitting evidence
     * @param evidenceCID IPFS CID of the evidence package
     * @return submissionId The unique submission identifier
     */
    function submitEvidence(uint256 agentId, string calldata evidenceCID) 
        external 
        nonReentrant 
        returns (uint256 submissionId) 
    {
        require(initialized, "StudioProxy: Not initialized");
        require(bytes(evidenceCID).length > 0, "StudioProxy: Empty evidence CID");
        
        submissionId = nextSubmissionId++;
        
        submissions[submissionId] = IStudioLogic.Submission({
            agentId: agentId,
            evidenceCID: evidenceCID,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        
        emit EvidenceSubmitted(submissionId, agentId, evidenceCID);
        
        // Delegate to logic contract for additional processing
        (bool success, ) = logicAddress.delegatecall(
            abi.encodeWithSelector(
                IStudioLogic.submitEvidence.selector,
                agentId,
                evidenceCID
            )
        );
        require(success, "StudioProxy: Logic execution failed");
    }

    /**
     * @notice Submit score vector for a submission
     * @param submissionId The submission to score
     * @param scores Array of numerical scores
     * @param reportCID IPFS CID of the detailed verification report
     */
    function submitScore(
        uint256 submissionId,
        uint256[] calldata scores,
        string calldata reportCID
    ) external nonReentrant {
        require(initialized, "StudioProxy: Not initialized");
        require(submissionId < nextSubmissionId, "StudioProxy: Invalid submission ID");
        require(scores.length > 0, "StudioProxy: Empty scores");
        
        // Note: In a real implementation, we would extract verifierAgentId from msg.sender
        // For now, using placeholder value
        uint256 verifierAgentId = 1; // TODO: Get from AgentRegistry
        
        scoreVectors[submissionId].push(ScoreVector({
            verifierAgentId: verifierAgentId,
            submissionId: submissionId,
            scores: scores,
            reportCID: reportCID,
            timestamp: block.timestamp
        }));
        
        emit ScoreSubmitted(submissionId, verifierAgentId, scores);
        
        // Delegate to logic contract
        (bool success, ) = logicAddress.delegatecall(
            abi.encodeWithSelector(
                IStudioLogic.submitScore.selector,
                submissionId,
                scores,
                reportCID
            )
        );
        require(success, "StudioProxy: Logic execution failed");
    }

    /**
     * @notice Stake funds for agent participation
     * @param agentId The agent to stake for
     */
    function stakeAgent(uint256 agentId) external payable nonReentrant {
        require(initialized, "StudioProxy: Not initialized");
        require(msg.value > 0, "StudioProxy: No stake provided");
        
        agentStakes[agentId] += msg.value;
        
        emit AgentStaked(agentId, msg.value);
        
        // Delegate to logic contract
        (bool success, ) = logicAddress.delegatecall(
            abi.encodeWithSelector(
                IStudioLogic.stakeAgent.selector,
                agentId
            )
        );
        require(success, "StudioProxy: Logic execution failed");
    }

    /**
     * @notice Withdraw staked funds
     * @param agentId The agent to withdraw stake for
     */
    function withdrawStake(uint256 agentId) external nonReentrant {
        require(initialized, "StudioProxy: Not initialized");
        
        uint256 stakeAmount = agentStakes[agentId];
        require(stakeAmount > 0, "StudioProxy: No stake to withdraw");
        
        // Note: Additional checks would be delegated to logic contract
        
        agentStakes[agentId] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: stakeAmount}("");
        require(success, "StudioProxy: Transfer failed");
        
        emit StakeWithdrawn(agentId, stakeAmount);
        
        // Delegate to logic contract
        (bool success2, ) = logicAddress.delegatecall(
            abi.encodeWithSelector(
                IStudioLogic.withdrawStake.selector,
                agentId
            )
        );
        require(success2, "StudioProxy: Logic execution failed");
    }

    /**
     * @notice Get submission by ID
     * @param submissionId The submission identifier
     * @return submission The submission data
     */
    function getSubmission(uint256 submissionId) 
        external 
        view 
        returns (IStudioLogic.Submission memory submission) 
    {
        require(submissionId < nextSubmissionId, "StudioProxy: Invalid submission ID");
        return submissions[submissionId];
    }

    /**
     * @notice Get score vectors for a submission
     * @param submissionId The submission identifier
     * @return vectors Array of score vectors
     */
    function getScoreVectors(uint256 submissionId) 
        external 
        view 
        returns (ScoreVector[] memory vectors) 
    {
        require(submissionId < nextSubmissionId, "StudioProxy: Invalid submission ID");
        return scoreVectors[submissionId];
    }

    /**
     * @notice Get agent stake amount
     * @param agentId The agent identifier
     * @return stakeAmount The current stake amount
     */
    function getAgentStake(uint256 agentId) external view returns (uint256 stakeAmount) {
        return agentStakes[agentId];
    }

    /**
     * @notice Fallback function to handle delegated calls
     */
    fallback() external payable {
        require(initialized, "StudioProxy: Not initialized");
        
        (bool success, bytes memory result) = logicAddress.delegatecall(msg.data);
        
        if (!success) {
            if (result.length > 0) {
                assembly {
                    let returndata_size := mload(result)
                    revert(add(32, result), returndata_size)
                }
            } else {
                revert("StudioProxy: Delegatecall failed");
            }
        }
        
        assembly {
            return(add(result, 32), mload(result))
        }
    }

    /**
     * @notice Receive function to accept ETH deposits
     */
    receive() external payable {
        require(initialized, "StudioProxy: Not initialized");
    }
} 