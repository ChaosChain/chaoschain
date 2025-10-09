// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStudioProxy} from "./interfaces/IStudioProxy.sol";

/**
 * @title StudioProxy
 * @notice Lightweight proxy contract for Studios with delegatecall logic
 * @dev See §3.1.7 in ChaosChain_Implementation_Plan.md
 * 
 * StudioProxy is a minimal contract that:
 * 1. Holds all Studio funds in escrow
 * 2. Stores all Studio state
 * 3. Delegates business logic to LogicModule contracts via DELEGATECALL
 * 
 * This pattern allows shared logic across Studios while keeping state isolated.
 * Each Studio can be upgraded by pointing to a new LogicModule without migration.
 * 
 * Security:
 * - Only ChaosCore or authorized addresses can upgrade logic
 * - Only RewardsDistributor can release funds
 * - All state remains in proxy storage during upgrades
 * 
 * @author ChaosChain Labs
 */
contract StudioProxy is IStudioProxy {
    
    // ============ Storage Layout ============
    // CRITICAL: Storage layout must never change to maintain upgrade safety
    
    /// @dev Slot 0: ChaosCore factory address (immutable after deployment)
    address private immutable _chaosCore;
    
    /// @dev Slot 1: Current logic module address
    address private _logicModule;
    
    /// @dev Slot 2: RewardsDistributor address (can be updated by ChaosCore)
    address private _rewardsDistributor;
    
    /// @dev Slot 3+: Escrow balances (account => balance)
    mapping(address => uint256) private _escrowBalances;
    
    /// @dev Work submissions (dataHash => submitter)
    mapping(bytes32 => address) private _workSubmissions;
    
    /// @dev Score vectors (dataHash => validator => scoreVector)
    mapping(bytes32 => mapping(address => bytes)) private _scoreVectors;
    
    /// @dev Total escrow in the Studio
    uint256 private _totalEscrow;
    
    // ============ Modifiers ============
    
    /**
     * @dev Only ChaosCore can call
     */
    modifier onlyChaosCore() {
        require(msg.sender == _chaosCore, "Only ChaosCore");
        _;
    }
    
    /**
     * @dev Only RewardsDistributor can call
     */
    modifier onlyRewardsDistributor() {
        require(msg.sender == _rewardsDistributor, "Only RewardsDistributor");
        _;
    }
    
    // ============ Constructor ============
    
    /**
     * @dev Initialize the proxy
     * @param chaosCore_ The ChaosCore factory address
     * @param logicModule_ The initial logic module address
     * @param rewardsDistributor_ The RewardsDistributor address
     */
    constructor(
        address chaosCore_,
        address logicModule_,
        address rewardsDistributor_
    ) {
        require(chaosCore_ != address(0), "Invalid ChaosCore");
        require(logicModule_ != address(0), "Invalid logic module");
        require(rewardsDistributor_ != address(0), "Invalid RewardsDistributor");
        
        _chaosCore = chaosCore_;
        _logicModule = logicModule_;
        _rewardsDistributor = rewardsDistributor_;
    }
    
    // ============ Core Functions ============
    
    /// @inheritdoc IStudioProxy
    function getLogicModule() external view override returns (address) {
        return _logicModule;
    }
    
    /// @inheritdoc IStudioProxy
    function upgradeLogicModule(address newLogic) external override onlyChaosCore {
        require(newLogic != address(0), "Invalid logic module");
        require(newLogic != _logicModule, "Same logic module");
        
        address oldLogic = _logicModule;
        _logicModule = newLogic;
        
        emit LogicModuleUpgraded(oldLogic, newLogic);
    }
    
    /// @inheritdoc IStudioProxy
    function submitWork(bytes32 dataHash, string calldata evidenceUri) external override {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] == address(0), "Work already submitted");
        
        _workSubmissions[dataHash] = msg.sender;
        
        emit WorkSubmitted(0, dataHash, evidenceUri, block.timestamp); // agentId would come from logic
    }
    
    /// @inheritdoc IStudioProxy
    function submitScoreVector(bytes32 dataHash, bytes calldata scoreVector) external override {
        require(dataHash != bytes32(0), "Invalid dataHash");
        require(_workSubmissions[dataHash] != address(0), "Work not found");
        require(scoreVector.length > 0, "Empty score vector");
        
        _scoreVectors[dataHash][msg.sender] = scoreVector;
        
        emit ScoreVectorSubmitted(0, dataHash, scoreVector, block.timestamp); // validatorAgentId from logic
    }
    
    /// @inheritdoc IStudioProxy
    function releaseFunds(
        address to,
        uint256 amount,
        bytes32 dataHash
    ) external override onlyRewardsDistributor {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(amount <= _totalEscrow, "Insufficient escrow");
        
        _totalEscrow -= amount;
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit FundsReleased(to, amount, dataHash);
    }
    
    /// @inheritdoc IStudioProxy
    function getEscrowBalance(address account) external view override returns (uint256) {
        return _escrowBalances[account];
    }
    
    /// @inheritdoc IStudioProxy
    function deposit() external payable override {
        require(msg.value > 0, "No value sent");
        
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
    }
    
    // ============ Public View Functions ============
    
    /**
     * @notice Get total escrow in the Studio
     * @return total The total escrow amount
     */
    function getTotalEscrow() external view returns (uint256 total) {
        return _totalEscrow;
    }
    
    /**
     * @notice Get work submitter
     * @param dataHash The work hash
     * @return submitter The submitter address
     */
    function getWorkSubmitter(bytes32 dataHash) external view returns (address submitter) {
        return _workSubmissions[dataHash];
    }
    
    /**
     * @notice Get score vector for a validator
     * @param dataHash The work hash
     * @param validator The validator address
     * @return scoreVector The score vector
     */
    function getScoreVector(bytes32 dataHash, address validator) external view returns (bytes memory scoreVector) {
        return _scoreVectors[dataHash][validator];
    }
    
    /**
     * @notice Get RewardsDistributor address
     * @return distributor The RewardsDistributor address
     */
    function getRewardsDistributor() external view returns (address distributor) {
        return _rewardsDistributor;
    }
    
    /**
     * @notice Update RewardsDistributor address
     * @dev Can only be called by ChaosCore
     * @param newDistributor The new RewardsDistributor address
     */
    function setRewardsDistributor(address newDistributor) external onlyChaosCore {
        require(newDistributor != address(0), "Invalid distributor");
        _rewardsDistributor = newDistributor;
    }
    
    // ============ Fallback & Receive ============
    
    /**
     * @dev Fallback function delegates to logic module
     * This allows LogicModules to extend functionality
     */
    fallback() external payable {
        address logic = _logicModule;
        require(logic != address(0), "No logic module");
        
        assembly {
            // Copy msg.data
            calldatacopy(0, 0, calldatasize())
            
            // Delegatecall to logic module
            let result := delegatecall(gas(), logic, 0, calldatasize(), 0, 0)
            
            // Copy return data
            returndatacopy(0, 0, returndatasize())
            
            // Return or revert
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    /**
     * @dev Receive function for plain ETH transfers
     */
    receive() external payable {
        _escrowBalances[msg.sender] += msg.value;
        _totalEscrow += msg.value;
    }
}

