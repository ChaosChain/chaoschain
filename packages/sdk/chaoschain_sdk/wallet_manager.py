"""
Production-ready wallet management for ChaosChain agents.

This module provides secure wallet creation, management, and transaction handling
for agents interacting with the ChaosChain protocol across multiple networks.
"""

import os
import json
from typing import Dict, Optional
from web3 import Web3
from eth_account import Account
from rich.console import Console
from rich import print as rprint

from .types import NetworkConfig, WalletAddress
from .exceptions import NetworkError, ConfigurationError

console = Console()


class WalletManager:
    """
    Production-ready wallet manager for ChaosChain agents.
    
    Handles wallet creation, balance checking, and transactions across
    multiple blockchain networks with secure private key management.
    
    Attributes:
        network: The blockchain network configuration
        w3: Web3 instance for blockchain interactions
        wallets: Dictionary of loaded wallet accounts
    """
    
    def __init__(self, network: NetworkConfig = NetworkConfig.BASE_SEPOLIA, wallet_file: str = None):
        """
        Initialize the wallet manager.
        
        Args:
            network: Target blockchain network
            wallet_file: Optional custom wallet storage file path
        """
        self.network = network
        self.wallets: Dict[str, Account] = {}
        self.wallet_data_file = wallet_file or "chaoschain_wallets.json"
        
        # Initialize Web3 connection
        self._initialize_web3_connection()
        
    def _initialize_web3_connection(self):
        """Initialize Web3 connection based on network configuration."""
        rpc_urls = {
            NetworkConfig.BASE_SEPOLIA: os.getenv('BASE_SEPOLIA_RPC_URL'),
            NetworkConfig.ETHEREUM_SEPOLIA: os.getenv('SEPOLIA_RPC_URL'), 
            NetworkConfig.OPTIMISM_SEPOLIA: os.getenv('OPTIMISM_SEPOLIA_RPC_URL'),
            NetworkConfig.LOCAL: os.getenv('LOCAL_RPC_URL', 'http://127.0.0.1:8545')
        }
        
        rpc_url = rpc_urls.get(self.network)
        if not rpc_url:
            raise ConfigurationError(
                f"RPC URL not configured for network: {self.network}",
                {"network": self.network, "required_env_var": f"{self.network.upper()}_RPC_URL"}
            )
        
        try:
            self.w3 = Web3(Web3.HTTPProvider(rpc_url))
            if not self.w3.is_connected():
                raise NetworkError(f"Failed to connect to {self.network} at {rpc_url}")
        except Exception as e:
            raise NetworkError(f"Web3 connection failed: {str(e)}")
    
    def create_or_load_wallet(self, agent_name: str) -> Account:
        """
        Create a new wallet or load existing one for an agent.
        
        Args:
            agent_name: Name of the agent
            
        Returns:
            Account object for the agent
        """
        if agent_name in self.wallets:
            return self.wallets[agent_name]
        
        # Try to load existing wallet
        wallet_data = self._load_wallet_data()
        
        if agent_name in wallet_data:
            rprint(f"[green]📂 Loading existing wallet for {agent_name}...[/green]")
            private_key = wallet_data[agent_name]['private_key']
            account = Account.from_key(private_key)
        else:
            rprint(f"[blue]🔑 Creating new wallet for {agent_name}...[/blue]")
            account = Account.create()
            
            # Save to file
            wallet_data[agent_name] = {
                'address': account.address,
                'private_key': account.key.hex()
            }
            self._save_wallet_data(wallet_data)
            
            rprint(f"[green]✅ New wallet created for {agent_name}[/green]")
            rprint(f"[yellow]   Address: {account.address}[/yellow]")
        
        self.wallets[agent_name] = account
        return account
    
    def get_wallet_address(self, agent_name: str) -> WalletAddress:
        """
        Get the wallet address for an agent.
        
        Args:
            agent_name: Name of the agent
            
        Returns:
            Wallet address as string
        """
        if agent_name not in self.wallets:
            self.create_or_load_wallet(agent_name)
        return self.wallets[agent_name].address
    
    def get_wallet_balance(self, agent_name: str) -> float:
        """
        Get ETH balance for an agent's wallet.
        
        Args:
            agent_name: Name of the agent
            
        Returns:
            ETH balance as float
        """
        if agent_name not in self.wallets:
            self.create_or_load_wallet(agent_name)
        
        address = self.wallets[agent_name].address
        balance_wei = self.w3.eth.get_balance(address)
        return self.w3.from_wei(balance_wei, 'ether')
    
    def get_usdc_balance(self, agent_name: str, usdc_contract_address: str) -> float:
        """
        Get USDC balance for an agent's wallet.
        
        Args:
            agent_name: Name of the agent
            usdc_contract_address: USDC contract address
            
        Returns:
            USDC balance as float
        """
        if agent_name not in self.wallets:
            self.create_or_load_wallet(agent_name)
        
        # USDC contract ABI (minimal)
        usdc_abi = [
            {
                "constant": True,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "type": "function"
            },
            {
                "constant": True,
                "inputs": [],
                "name": "decimals",
                "outputs": [{"name": "", "type": "uint8"}],
                "type": "function"
            }
        ]
        
        try:
            contract = self.w3.eth.contract(address=usdc_contract_address, abi=usdc_abi)
            address = self.wallets[agent_name].address
            balance = contract.functions.balanceOf(address).call()
            decimals = contract.functions.decimals().call()
            return balance / (10 ** decimals)
        except Exception as e:
            rprint(f"[red]❌ Error getting USDC balance: {e}[/red]")
            return 0.0
    
    def send_transaction(self, from_agent: str, to_address: str, value_wei: int, 
                        gas_limit: int = 21000, data: bytes = b'') -> str:
        """
        Send a transaction from an agent's wallet.
        
        Args:
            from_agent: Name of the sending agent
            to_address: Recipient address
            value_wei: Value to send in wei
            gas_limit: Gas limit for the transaction
            data: Optional transaction data
            
        Returns:
            Transaction hash
        """
        if from_agent not in self.wallets:
            self.create_or_load_wallet(from_agent)
        
        account = self.wallets[from_agent]
        
        # Build transaction
        transaction = {
            'to': to_address,
            'value': value_wei,
            'gas': gas_limit,
            'gasPrice': self.w3.eth.gas_price,
            'nonce': self.w3.eth.get_transaction_count(account.address),
            'data': data
        }
        
        # Sign and send transaction
        signed_txn = self.w3.eth.account.sign_transaction(transaction, account.key)
        # Handle both old and new Web3.py versions
        raw_transaction = getattr(signed_txn, 'raw_transaction', getattr(signed_txn, 'rawTransaction', None))
        if raw_transaction is None:
            raise Exception("Could not get raw transaction from signed transaction")
        tx_hash = self.w3.eth.send_raw_transaction(raw_transaction)
        
        return tx_hash.hex()
    
    def wait_for_transaction_receipt(self, tx_hash: str, timeout: int = 120) -> dict:
        """
        Wait for transaction confirmation.
        
        Args:
            tx_hash: Transaction hash to wait for
            timeout: Timeout in seconds
            
        Returns:
            Transaction receipt
        """
        return self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
    
    def _load_wallet_data(self) -> Dict:
        """Load wallet data from file."""
        if os.path.exists(self.wallet_data_file):
            try:
                with open(self.wallet_data_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                rprint(f"[red]❌ Error loading wallet data: {e}[/red]")
        return {}
    
    def _save_wallet_data(self, wallet_data: Dict):
        """Save wallet data to file."""
        try:
            with open(self.wallet_data_file, 'w') as f:
                json.dump(wallet_data, f, indent=2)
        except Exception as e:
            rprint(f"[red]❌ Error saving wallet data: {e}[/red]")
    
    @property
    def chain_id(self) -> int:
        """Get the chain ID of the connected network."""
        return self.w3.eth.chain_id
    
    @property
    def is_connected(self) -> bool:
        """Check if Web3 is connected to the network."""
        return self.w3.is_connected()
