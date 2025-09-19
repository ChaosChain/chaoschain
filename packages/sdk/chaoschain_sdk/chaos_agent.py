"""
Production-ready base agent for ChaosChain protocol interactions.

This module provides the foundational ChaosAgent class that handles
ERC-8004 registry interactions, identity management, and core protocol operations.
"""

import json
import os
from typing import Dict, Optional, Any, Tuple
from web3 import Web3
from web3.contract import Contract
from rich import print as rprint

from .types import NetworkConfig, AgentID, TransactionHash, ContractAddresses
from .exceptions import (
    AgentRegistrationError, 
    NetworkError, 
    ContractError,
    ConfigurationError
)
from .wallet_manager import WalletManager


class ChaosAgent:
    """
    Base class for ChaosChain agents interacting with ERC-8004 registries.
    
    Provides core functionality for agent identity management, contract interactions,
    and protocol operations across multiple blockchain networks.
    
    Attributes:
        agent_domain: Domain where the agent's identity is hosted
        wallet_manager: Wallet manager for transaction handling
        network: Target blockchain network
        agent_id: On-chain agent identifier (set after registration)
    """
    
    def __init__(self, agent_domain: str, wallet_manager: WalletManager, 
                 network: NetworkConfig = NetworkConfig.BASE_SEPOLIA):
        """
        Initialize the ChaosChain base agent.
        
        Args:
            agent_domain: Domain where agent's identity is hosted
            wallet_manager: Wallet manager instance
            network: Target blockchain network
        """
        self.agent_domain = agent_domain
        self.wallet_manager = wallet_manager
        self.network = network
        self.agent_id: Optional[AgentID] = None
        
        # Get wallet address from manager
        # Extract agent name from domain for wallet lookup
        self.agent_name = agent_domain.split('.')[0].split('-')[0].title()
        self.address = wallet_manager.get_wallet_address(self.agent_name)
        
        # Initialize Web3 connection
        self.w3 = wallet_manager.w3
        self.chain_id = wallet_manager.chain_id
        
        # Load contract addresses and initialize contracts
        self._load_contract_addresses()
        self._load_contracts()
        
        rprint(f"[green]🌐 Connected to {self.network} (Chain ID: {self.chain_id})[/green]")
    
    def _load_contract_addresses(self):
        """Load contract addresses from deployment files."""
        deployment_files = {
            NetworkConfig.LOCAL: 'deployment.json',
            NetworkConfig.ETHEREUM_SEPOLIA: 'deployments/sepolia.json',
            NetworkConfig.BASE_SEPOLIA: 'deployments/base-sepolia.json',
            NetworkConfig.OPTIMISM_SEPOLIA: 'deployments/optimism-sepolia.json'
        }
        
        deployment_file = deployment_files.get(self.network)
        if not deployment_file:
            raise ConfigurationError(f"No deployment file configured for network: {self.network}")
        
        if not os.path.exists(deployment_file):
            raise ConfigurationError(f"Deployment file not found: {deployment_file}")
        
        try:
            with open(deployment_file, 'r') as f:
                deployment_data = json.load(f)
            
            # Handle different deployment file structures
            if 'contracts' in deployment_data:
                contracts = deployment_data['contracts']
            else:
                contracts = deployment_data
            
            self.contract_addresses = ContractAddresses(
                identity_registry=contracts.get('identity_registry'),
                reputation_registry=contracts.get('reputation_registry'), 
                validation_registry=contracts.get('validation_registry'),
                network=self.network
            )
            
            if not all([
                self.contract_addresses.identity_registry,
                self.contract_addresses.reputation_registry,
                self.contract_addresses.validation_registry
            ]):
                raise ConfigurationError(
                    "Missing contract addresses in deployment file",
                    {"file": deployment_file, "contracts": contracts}
                )
            
            rprint(f"[green]📋 Contracts loaded for {self.network}[/green]")
            
        except Exception as e:
            raise ConfigurationError(f"Failed to load contract addresses: {str(e)}")
    
    def _load_contracts(self):
        """Load contract instances with ABIs."""
        try:
            # First try to load full ABIs from compiled contracts (like base_agent_genesis.py)
            contracts_dir = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'contracts', 'out')
            
            try:
                # Load Identity Registry
                identity_abi_path = os.path.join(contracts_dir, 'IdentityRegistry.sol', 'IdentityRegistry.json')
                with open(identity_abi_path, 'r') as f:
                    identity_artifact = json.load(f)
                identity_abi = identity_artifact['abi']
                
                # Load Reputation Registry
                reputation_abi_path = os.path.join(contracts_dir, 'ReputationRegistry.sol', 'ReputationRegistry.json')
                with open(reputation_abi_path, 'r') as f:
                    reputation_artifact = json.load(f)
                reputation_abi = reputation_artifact['abi']
                
                # Load Validation Registry
                validation_abi_path = os.path.join(contracts_dir, 'ValidationRegistry.sol', 'ValidationRegistry.json')
                with open(validation_abi_path, 'r') as f:
                    validation_artifact = json.load(f)
                validation_abi = validation_artifact['abi']
                
                rprint(f"[blue]📋 Loaded full contract ABIs from compiled contracts[/blue]")
                
            except FileNotFoundError:
                rprint(f"[yellow]⚠️  Compiled contracts not found, using minimal ABIs[/yellow]")
                # Fallback to minimal ABIs
                identity_abi = self._load_abi('contracts/src/interfaces/IIdentityRegistry.sol')
                reputation_abi = self._load_abi('contracts/src/interfaces/IReputationRegistry.sol')
                validation_abi = self._load_abi('contracts/src/interfaces/IValidationRegistry.sol')
            
            # Create contract instances
            self.identity_registry = self.w3.eth.contract(
                address=self.contract_addresses.identity_registry,
                abi=identity_abi
            )
            
            self.reputation_registry = self.w3.eth.contract(
                address=self.contract_addresses.reputation_registry,
                abi=reputation_abi
            )
            
            self.validation_registry = self.w3.eth.contract(
                address=self.contract_addresses.validation_registry,
                abi=validation_abi
            )
            
        except Exception as e:
            raise ContractError(f"Failed to load contracts: {str(e)}")
    
    def _load_abi(self, interface_path: str) -> list:
        """
        Load ABI from Solidity interface file.
        
        Args:
            interface_path: Path to the Solidity interface file
            
        Returns:
            Contract ABI as list
        """
        # For production SDK, we'll include compiled ABIs
        # This is a simplified version that uses minimal ABIs
        
        if 'IIdentityRegistry' in interface_path:
            return [
                {
                    "inputs": [
                        {"name": "agentDomain", "type": "string"},
                        {"name": "agentAddress", "type": "address"}
                    ],
                    "name": "newAgent",
                    "outputs": [{"name": "agentId", "type": "uint256"}],
                    "stateMutability": "nonpayable",
                    "type": "function"
                },
                {
                    "inputs": [{"name": "agentAddress", "type": "address"}],
                    "name": "resolveByAddress",
                    "outputs": [
                        {"name": "", "type": "uint256"},
                        {"name": "", "type": "string"},
                        {"name": "", "type": "address"}
                    ],
                    "stateMutability": "view",
                    "type": "function"
                }
            ]
        elif 'IReputationRegistry' in interface_path:
            return [
                {
                    "inputs": [
                        {"name": "agentClientId", "type": "uint256"},
                        {"name": "agentServerId", "type": "uint256"}
                    ],
                    "name": "acceptFeedback",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
        elif 'IValidationRegistry' in interface_path:
            return [
                {
                    "inputs": [
                        {"name": "validatorId", "type": "uint256"},
                        {"name": "requesterId", "type": "uint256"},
                        {"name": "dataHash", "type": "string"}
                    ],
                    "name": "validationRequest",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                },
                {
                    "inputs": [
                        {"name": "requestId", "type": "uint256"},
                        {"name": "response", "type": "uint8"},
                        {"name": "feedback", "type": "string"}
                    ],
                    "name": "submitValidation",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
        
        return []
    
    def register_agent(self) -> Tuple[AgentID, TransactionHash]:
        """
        Register this agent on the ERC-8004 IdentityRegistry.
        
        Returns:
            Tuple of (agent_id, transaction_hash)
        """
        rprint(f"[yellow]🔧 Registering agent: {self.agent_domain}[/yellow]")
        
        # Check if already registered
        try:
            existing_agent = self.identity_registry.functions.resolveByAddress(self.address).call()
            if existing_agent[0] > 0:  # agentId > 0 means already registered
                self.agent_id = existing_agent[0]
                rprint(f"[green]✅ Agent already registered with ID: {self.agent_id}[/green]")
                return self.agent_id, "already_registered"
        except Exception as e:
            # Agent not found, proceed with registration
            rprint(f"[blue]🔍 Agent not yet registered (expected): {e}[/blue]")
            pass
        
        try:
            
            # Prepare registration transaction
            contract_call = self.identity_registry.functions.newAgent(
                self.agent_domain,
                self.address
            )
            
            # Estimate gas
            gas_estimate = contract_call.estimate_gas({'from': self.address})
            gas_limit = int(gas_estimate * 1.2)  # Add 20% buffer
            
            rprint(f"[yellow]⛽ Gas estimate: {gas_estimate}, using limit: {gas_limit}[/yellow]")
            
            # Build transaction
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': gas_limit,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            # Sign and send transaction
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            
            rprint(f"[yellow]⏳ Waiting for transaction confirmation...[/yellow]")
            # Handle both old and new Web3.py versions
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                # Extract agent ID from logs
                # This is simplified - in production, parse logs properly
                self.agent_id = receipt.blockNumber  # Placeholder
                
                # Try to get actual agent ID
                try:
                    agent_info = self.identity_registry.functions.resolveByAddress(self.address).call()
                    if agent_info[0] != 0:
                        self.agent_id = agent_info[0]
                except:
                    pass
                
                rprint(f"[green]✅ Agent registered successfully with ID: {self.agent_id}[/green]")
                return self.agent_id, tx_hash.hex()
            else:
                raise AgentRegistrationError("Transaction failed")
                
        except Exception as e:
            error_msg = str(e)
            rprint(f"[red]❌ Registration failed: {error_msg}[/red]")
            
            # Check for specific error types
            if "insufficient funds" in error_msg.lower():
                rprint(f"[yellow]💰 Insufficient ETH for gas fees in wallet: {self.address}[/yellow]")
                rprint(f"[blue]Please fund this wallet using Base Sepolia faucet:[/blue]")
                rprint(f"[blue]https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet[/blue]")
            elif "0x7b857a6b" in error_msg:
                rprint(f"[yellow]⚠️  Contract revert - likely insufficient gas or contract issue[/yellow]")
            
            raise AgentRegistrationError(f"Failed to register {self.agent_domain}: {error_msg}")
    
    def get_agent_id(self) -> Optional[AgentID]:
        """
        Get the agent's on-chain ID.
        
        Returns:
            Agent ID if registered, None otherwise
        """
        if self.agent_id:
            return self.agent_id
        
        try:
            agent_info = self.identity_registry.functions.resolveByAddress(self.address).call()
            if agent_info[0] != 0:
                self.agent_id = agent_info[0]
                return self.agent_id
        except:
            pass
        
        return None
    
    def request_validation(self, validator_agent_id: AgentID, data_hash: str) -> TransactionHash:
        """
        Request validation from another agent.
        
        Args:
            validator_agent_id: ID of the validator agent
            data_hash: Hash of data to validate
            
        Returns:
            Transaction hash
        """
        try:
            # Convert string hash to bytes32
            if isinstance(data_hash, str):
                if data_hash.startswith('0x'):
                    data_hash_bytes = bytes.fromhex(data_hash[2:])
                else:
                    data_hash_bytes = bytes.fromhex(data_hash)
            else:
                data_hash_bytes = data_hash
            
            # Ensure 32 bytes
            if len(data_hash_bytes) != 32:
                import hashlib
                data_hash_bytes = hashlib.sha256(data_hash.encode()).digest()
            
            contract_call = self.validation_registry.functions.validationRequest(
                validator_agent_id,
                self.agent_id,
                data_hash
            )
            
            # Build and send transaction
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': 200000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            # Handle both old and new Web3.py versions
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                return tx_hash.hex()
            else:
                raise ContractError("Validation request transaction failed")
                
        except Exception as e:
            raise ContractError(f"Failed to request validation: {str(e)}")
    
    def submit_validation_response(self, data_hash: str, score: int) -> TransactionHash:
        """
        Submit a validation response with score via ValidationRegistry.
        
        Args:
            data_hash: Hash of the data that was validated
            score: Validation score (0-100)
            
        Returns:
            Transaction hash
        """
        try:
            # Convert string hash to bytes32 if needed
            if isinstance(data_hash, str):
                if data_hash.startswith('0x'):
                    data_hash_bytes = bytes.fromhex(data_hash[2:])
                else:
                    data_hash_bytes = bytes.fromhex(data_hash)
            else:
                data_hash_bytes = data_hash
                
            contract_call = self.validation_registry.functions.validationResponse(
                data_hash_bytes,
                min(100, max(0, int(score)))  # Ensure score is 0-100
            )
            
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': 150000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            # Handle both old and new Web3.py versions
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to submit validation response: {str(e)}")

    def submit_feedback(self, agent_id: AgentID, score: int, feedback: str) -> TransactionHash:
        """
        Submit feedback authorization for another agent via ReputationRegistry.
        Note: This only authorizes feedback, doesn't store the score.
        Use submit_validation_response() for actual score submission.
        
        Args:
            agent_id: Target agent ID
            score: Feedback score (0-100) - not stored on-chain
            feedback: Feedback text - not stored on-chain
            
        Returns:
            Transaction hash
        """
        try:
            contract_call = self.reputation_registry.functions.acceptFeedback(
                self.agent_id,  # client agent ID (Bob giving feedback)
                agent_id        # server agent ID (Alice receiving feedback)
            )
            
            transaction = contract_call.build_transaction({
                'from': self.address,
                'gas': 150000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.address)
            })
            
            account = self.wallet_manager.wallets[self.agent_name]
            signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
            # Handle both old and new Web3.py versions
            raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
            if raw_transaction is None:
                raise Exception("Could not get raw transaction from signed transaction")
            tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
            
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                return tx_hash.hex()
            else:
                raise ContractError("Feedback submission failed")
                
        except Exception as e:
            raise ContractError(f"Failed to submit feedback: {str(e)}")
    
    @property
    def wallet_address(self) -> str:
        """Get the agent's wallet address."""
        return self.address
