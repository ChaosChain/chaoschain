"""Wallet management utilities for ChaosChain agents."""

import os
import hashlib
from typing import Optional, Dict, Any
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
from loguru import logger
import httpx


class WalletManager:
    """
    Manages agent wallets and signing operations.
    
    Supports:
    - Private key management
    - Message signing for A2A authentication
    - Crossmint integration for serverless wallet creation
    - Multi-wallet support for agent operators
    """
    
    def __init__(
        self,
        private_key: Optional[str] = None,
        crossmint_api_key: Optional[str] = None
    ):
        """Initialize wallet manager."""
        self.crossmint_api_key = crossmint_api_key
        self._account: Optional[Account] = None
        
        if private_key:
            self._init_from_private_key(private_key)
        elif crossmint_api_key:
            # TODO: Initialize with Crossmint
            logger.info("Crossmint integration not yet implemented")
        else:
            # Generate new wallet
            self._generate_new_wallet()
    
    def _init_from_private_key(self, private_key: str) -> None:
        """Initialize wallet from private key."""
        if not private_key.startswith('0x'):
            private_key = '0x' + private_key
        
        try:
            self._account = Account.from_key(private_key)
            logger.info(f"Initialized wallet from private key: {self.address}")
        except Exception as e:
            logger.error(f"Failed to initialize wallet from private key: {e}")
            raise
    
    def _generate_new_wallet(self) -> None:
        """Generate a new wallet."""
        self._account = Account.create()
        logger.info(f"Generated new wallet: {self.address}")
        logger.warning(f"Private key: {self._account.key.hex()}")
        logger.warning("SAVE THIS PRIVATE KEY SECURELY!")
    
    @property
    def address(self) -> str:
        """Get wallet address."""
        if not self._account:
            raise ValueError("Wallet not initialized")
        return self._account.address
    
    @property
    def public_key(self) -> str:
        """Get public key for A2A authentication."""
        if not self._account:
            raise ValueError("Wallet not initialized")
        
        # Get public key from private key
        private_key_bytes = self._account.key
        public_key = Account._keys.private_key_to_public_key(private_key_bytes)
        return public_key.to_hex()
    
    @property
    def private_key_hex(self) -> str:
        """Get private key as hex string (use carefully!)."""
        if not self._account:
            raise ValueError("Wallet not initialized")
        return self._account.key.hex()
    
    def sign_message(self, message: str) -> str:
        """
        Sign a message for A2A authentication.
        
        Args:
            message: The message to sign
            
        Returns:
            Hex-encoded signature
        """
        if not self._account:
            raise ValueError("Wallet not initialized")
        
        # Create message hash
        message_hash = encode_defunct(text=message)
        
        # Sign the message
        signed_message = self._account.sign_message(message_hash)
        
        return signed_message.signature.hex()
    
    def verify_signature(self, message: str, signature: str, address: str) -> bool:
        """
        Verify a signature against a message and address.
        
        Args:
            message: Original message
            signature: Hex-encoded signature
            address: Expected signer address
            
        Returns:
            True if signature is valid
        """
        try:
            # Create message hash
            message_hash = encode_defunct(text=message)
            
            # Recover address from signature
            recovered_address = Account.recover_message(
                message_hash,
                signature=bytes.fromhex(signature.replace('0x', ''))
            )
            
            return recovered_address.lower() == address.lower()
            
        except Exception as e:
            logger.error(f"Error verifying signature: {e}")
            return False
    
    def sign_transaction(self, transaction: Dict[str, Any]) -> str:
        """
        Sign a transaction.
        
        Args:
            transaction: Transaction dictionary
            
        Returns:
            Signed transaction hash
        """
        if not self._account:
            raise ValueError("Wallet not initialized")
        
        signed_txn = self._account.sign_transaction(transaction)
        return signed_txn.rawTransaction.hex()
    
    async def create_crossmint_wallet(
        self,
        agent_name: str,
        email: Optional[str] = None
    ) -> Dict[str, str]:
        """
        Create a wallet using Crossmint Wallet as a Service.
        
        Args:
            agent_name: Name for the agent wallet
            email: Optional email for wallet notifications
            
        Returns:
            Dictionary with wallet information
        """
        if not self.crossmint_api_key:
            raise ValueError("Crossmint API key not provided")
        
        # TODO: Implement Crossmint wallet creation
        # This would call Crossmint's API to create a serverless wallet
        
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {self.crossmint_api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "type": "ethereum",
                "metadata": {
                    "name": agent_name,
                    "email": email,
                    "purpose": "chaoschain-agent"
                }
            }
            
            # Placeholder for actual Crossmint API call
            logger.info(f"Would create Crossmint wallet for {agent_name}")
            
            # For now, return placeholder data
            return {
                "wallet_id": "crossmint_" + hashlib.sha256(agent_name.encode()).hexdigest()[:16],
                "address": "0x" + "0" * 40,  # Placeholder address
                "public_key": "0x" + "0" * 128,  # Placeholder public key
                "api_endpoint": "https://api.crossmint.io/wallets/...",
                "status": "created"
            }
    
    def get_balance(self, w3: Web3, token_address: Optional[str] = None) -> float:
        """
        Get wallet balance.
        
        Args:
            w3: Web3 instance
            token_address: Optional ERC20 token address (None for ETH)
            
        Returns:
            Balance as float
        """
        if not self._account:
            raise ValueError("Wallet not initialized")
        
        try:
            if token_address:
                # ERC20 token balance
                # TODO: Implement ERC20 balance checking
                logger.warning("ERC20 balance checking not yet implemented")
                return 0.0
            else:
                # ETH balance
                balance_wei = w3.eth.get_balance(self.address)
                balance_eth = w3.from_wei(balance_wei, 'ether')
                return float(balance_eth)
                
        except Exception as e:
            logger.error(f"Error getting balance: {e}")
            return 0.0
    
    def export_keystore(self, password: str) -> Dict[str, Any]:
        """
        Export wallet as encrypted keystore.
        
        Args:
            password: Password for encryption
            
        Returns:
            Keystore dictionary
        """
        if not self._account:
            raise ValueError("Wallet not initialized")
        
        return Account.encrypt(self._account.key, password)
    
    @classmethod
    def from_keystore(cls, keystore: Dict[str, Any], password: str) -> "WalletManager":
        """
        Create wallet manager from encrypted keystore.
        
        Args:
            keystore: Keystore dictionary
            password: Decryption password
            
        Returns:
            WalletManager instance
        """
        private_key = Account.decrypt(keystore, password)
        return cls(private_key=private_key.hex())
    
    @classmethod
    def from_mnemonic(cls, mnemonic: str, account_path: str = "m/44'/60'/0'/0/0") -> "WalletManager":
        """
        Create wallet manager from mnemonic phrase.
        
        Args:
            mnemonic: BIP39 mnemonic phrase
            account_path: Derivation path
            
        Returns:
            WalletManager instance
        """
        Account.enable_unaudited_hdwallet_features()
        account = Account.from_mnemonic(mnemonic, account_path=account_path)
        return cls(private_key=account.key.hex())
    
    def get_agent_signature_metadata(self) -> Dict[str, str]:
        """
        Get signature metadata for A2A agent authentication.
        
        Returns:
            Dictionary with signature metadata
        """
        return {
            "address": self.address,
            "public_key": self.public_key,
            "signature_type": "ethereum_personal_sign",
            "curve": "secp256k1"
        } 