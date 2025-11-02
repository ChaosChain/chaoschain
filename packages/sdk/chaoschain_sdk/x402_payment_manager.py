"""
ChaosChain SDK - Native x402 Payment Manager

This module provides native x402 payment integration using Coinbase's official x402 protocol.
Enables verifiable, monetizable agent-to-agent payments with cryptographic receipts.

Based on: https://github.com/coinbase/x402 (Coinbase official implementation)
Protocol: https://www.x402.org/
"""

import base64
import json
import os
import time
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime, timezone
from decimal import Decimal
from rich import print as rprint

# EIP-3009 and EIP-712 imports
from eth_account.messages import encode_typed_data

# Official Coinbase x402 imports
from x402.clients import x402Client
from x402.types import PaymentRequirements
from x402.encoding import safe_base64_encode
from x402.exact import encode_payment, prepare_payment_header, sign_payment_header

from .types import NetworkConfig, PaymentProof, AgentID, TransactionHash
from .exceptions import PaymentError, ConfigurationError
from .wallet_manager import WalletManager


class X402PaymentManager:
    """
    Native x402 Payment Manager for ChaosChain agents.
    
    Implements Coinbase's official x402 protocol for agent-to-agent payments.
    
    Key Features:
    - Native x402 protocol compliance (HTTP 402 Payment Required)
    - Cryptographic payment proofs and receipts
    - ChaosChain protocol fee collection (2.5% to treasury)
    - Agent-to-agent payment flows with evidence integration
    - Multi-network support (Base, Ethereum, Optimism Sepolia)
    - Production-ready USDC transfers with fee splitting
    
    x402 Protocol Flow:
    1. Client requests resource from server
    2. Server responds with 402 Payment Required + PaymentRequirements
    3. Client creates x402 payment with cryptographic proof
    4. Client retries request with X-PAYMENT header
    5. Server verifies payment and provides resource
    6. Both parties get cryptographic receipts
    """
    
    def __init__(self, wallet_manager: WalletManager, network: NetworkConfig = NetworkConfig.BASE_SEPOLIA):
        """
        Initialize the x402 payment manager.
        
        Args:
            wallet_manager: ChaosChain wallet manager instance
            network: Target blockchain network
        """
        self.wallet_manager = wallet_manager
        self.network = network
        self.payment_history: List[Dict[str, Any]] = []
        
        # x402 configuration
        self._setup_x402_config()
        
        # Initialize official Coinbase x402 client
        self._initialize_x402_client()
        
        # ChaosChain protocol configuration
        self.chaoschain_treasury = self._get_treasury_address()
        self.protocol_fee_percentage = float(os.getenv("CHAOSCHAIN_FEE_PERCENTAGE", "2.5"))
        
        # x402 facilitator configuration (defaults to ChaosChain hosted facilitator)
        self.facilitator_url = os.getenv("X402_FACILITATOR_URL", "https://facilitator.chaoscha.in")
        self.use_facilitator = os.getenv("X402_USE_FACILITATOR", "true").lower() == "true"
        
        rprint(f"[green]💳 Native x402 Payment Manager initialized for {network.value}[/green]")
        rprint(f"[blue]🔗 Using official Coinbase x402 protocol v0.2.1+[/blue]")
        if self.use_facilitator and self.facilitator_url:
            rprint(f"[blue]🏛️  x402 Facilitator: {self.facilitator_url}[/blue]")
        else:
            rprint(f"[yellow]⚠️  x402 Mode: Simulated payments (no facilitator)[/yellow]")
    
    def _setup_x402_config(self):
        """Setup x402 network configuration."""
        network_configs = {
            NetworkConfig.BASE_SEPOLIA: {
                "chain_id": 84532,
                "usdc_address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                "rpc_url": os.getenv("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
                "x402_network": "base-sepolia",
                "token_symbol": "USDC",
                "decimals": 6
            },
            NetworkConfig.ETHEREUM_SEPOLIA: {
                "chain_id": 11155111,
                "usdc_address": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
                "rpc_url": os.getenv("ETHEREUM_SEPOLIA_RPC_URL"),
                "x402_network": "ethereum-sepolia",
                "token_symbol": "USDC",
                "decimals": 6
            },
            NetworkConfig.ZEROG_TESTNET: {
                "chain_id": 16602,
                "usdc_address": "0x0000000000000000000000000000000000000000",  # Placeholder for native A0GI
                "rpc_url": os.getenv("ZEROG_TESTNET_RPC_URL", "https://evmrpc-testnet.0g.ai"),
                "x402_network": "base-sepolia",  # Use base-sepolia for x402 protocol validation (Coinbase doesn't support 0G yet)
                "token_symbol": "A0GI",
                "decimals": 18,  # Native token, 18 decimals
                "native_token": True  # Use native token instead of ERC-20
            },
            NetworkConfig.OPTIMISM_SEPOLIA: {
                "chain_id": 11155420,
                "usdc_address": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
                "rpc_url": os.getenv("OPTIMISM_SEPOLIA_RPC_URL"),
                "x402_network": "optimism-sepolia"
            }
        }
        
        config = network_configs.get(self.network)
        if not config:
            raise ConfigurationError(f"Unsupported network for x402: {self.network}")
        
        self.chain_id = config["chain_id"]
        self.usdc_address = config.get("usdc_address")  # Can be None for native tokens
        self.rpc_url = config["rpc_url"]
        self.x402_network = config["x402_network"]
        self.token_symbol = config.get("token_symbol", "USDC")
        self.decimals = config.get("decimals", 6)
        self.native_token = config.get("native_token", False)
        
        if not self.rpc_url:
            raise ConfigurationError(f"RPC URL not configured for {self.network}")
        
        # Log token configuration
        if self.native_token:
            rprint(f"[cyan]💰 Using native token: {self.token_symbol}[/cyan]")
        else:
            rprint(f"[cyan]💰 Using ERC-20 token: {self.token_symbol} at {self.usdc_address}[/cyan]")
    
    def _initialize_x402_client(self):
        """Initialize official Coinbase x402Client."""
        try:
            # Get operator account for x402 transactions
            operator_private_key = os.getenv("CHAOSCHAIN_OPERATOR_PRIVATE_KEY")
            if not operator_private_key:
                # Use first available wallet as operator
                if self.wallet_manager.wallets:
                    first_agent = list(self.wallet_manager.wallets.keys())[0]
                    operator_account = self.wallet_manager.wallets[first_agent]
                else:
                    raise ConfigurationError("No operator private key or wallets available for x402")
            else:
                from eth_account import Account
                operator_account = Account.from_key(operator_private_key)
            
            # Initialize official Coinbase x402Client
            self.x402_client = x402Client(account=operator_account)
            
        except Exception as e:
            raise ConfigurationError(f"Failed to initialize x402Client: {str(e)}")
    
    def _get_treasury_address(self) -> str:
        """
        Get ChaosChain treasury address for fee collection.
        
        Security: Uses environment variable override with validation,
        falls back to official ChaosChain treasury addresses.
        """
        # Check for custom treasury address (allows for testing/private deployments)
        custom_treasury = os.getenv("CHAOSCHAIN_TREASURY_ADDRESS")
        if custom_treasury:
            # Validate custom treasury address format
            if not custom_treasury.startswith("0x") or len(custom_treasury) != 42:
                raise ConfigurationError(f"Invalid treasury address format: {custom_treasury}")
            
            rprint(f"[yellow]⚠️  Using custom treasury address: {custom_treasury}[/yellow]")
            rprint(f"[yellow]   Make sure this is intentional for your deployment[/yellow]")
            return custom_treasury
        
        # Official ChaosChain treasury addresses (ChaosChain.eth)
        # These are the verified addresses for protocol fee collection
        official_treasury_addresses = {
            NetworkConfig.BASE_SEPOLIA: "0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70",
            NetworkConfig.ETHEREUM_SEPOLIA: "0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70", 
            NetworkConfig.OPTIMISM_SEPOLIA: "0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70"
        }
        
        official_treasury = official_treasury_addresses.get(
            self.network, 
            "0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70"  # Default fallback
        )
        
        rprint(f"[green]🏛️  Using official ChaosChain treasury: {official_treasury}[/green]")
        return official_treasury
    
    def create_payment_requirements(
        self,
        to_agent: str,
        amount_usdc: float,
        service_description: str,
        evidence_cid: Optional[str] = None
    ) -> PaymentRequirements:
        """
        Create x402 PaymentRequirements for a service.
        
        Args:
            to_agent: Name of the agent providing the service
            amount_usdc: Amount in USDC to pay
            service_description: Description of the service
            evidence_cid: Optional IPFS CID of related evidence
            
        Returns:
            x402 PaymentRequirements object
        """
        # Get recipient address
        to_address = self.wallet_manager.get_wallet_address(to_agent)
        if not to_address:
            raise PaymentError(f"Could not resolve address for agent: {to_agent}")
        
        # Convert amount to wei (USDC has 6 decimals)
        amount_wei = int(Decimal(str(amount_usdc)) * Decimal("1000000"))
        
        # Create x402 PaymentRequirements using official Coinbase format
        payment_requirements = PaymentRequirements(
            scheme="exact",
            network=self.x402_network,
            max_amount_required=str(amount_wei),
            resource=f"/chaoschain/service/{service_description.lower().replace(' ', '-')}",
            description=service_description,
            mime_type="application/json",
            pay_to=to_address,
            max_timeout_seconds=300,  # 5 minutes
            asset=self.usdc_address,
            extra={
                "name": "USDC",  # ✅ CORRECT: Base Sepolia USDC uses "USDC" not "USD Coin"
                "version": "2",  # ✅ CORRECT: Version 2 for EIP-3009
                "chaoschain_metadata": {
                    "to_agent": to_agent,
                    "evidence_cid": evidence_cid,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "network": self.network.value,
                    "protocol_fee_percentage": self.protocol_fee_percentage,
                    "treasury_address": self.chaoschain_treasury
                }
            }
        )
        
        return payment_requirements
    
    def create_x402_payment(
        self,
        from_agent: str,
        payment_requirements: PaymentRequirements,
        amount_usdc: float
    ) -> Dict[str, Any]:
        """
        Create an x402 payment with EIP-3009 authorization.
        
        NOTE: We use custom EIP-3009 signing instead of the Python x402 library because:
        1. Python x402 library has a nonce bug (bytes vs hex string)
        2. Python x402 sign_payment_header() doesn't produce EIP-3009 compliant signatures
        3. Facilitators (PayAI, ChaosChain) expect EIP-3009 with v/r/s components
        4. TypeScript x402 library has full EIP-3009 support, Python doesn't
        
        Args:
            from_agent: Name of the paying agent
            payment_requirements: x402 PaymentRequirements
            amount_usdc: Amount to pay in USDC
            
        Returns:
            x402 payment data with EIP-3009 signed headers
        """
        try:
            # Get paying agent's wallet
            from_wallet = self.wallet_manager.wallets.get(from_agent)
            if not from_wallet:
                raise PaymentError(f"Wallet not found for agent: {from_agent}")
            
            # Convert amount to wei (USDC has 6 decimals)
            amount_wei = int(Decimal(str(amount_usdc)) * Decimal("1000000"))
            
            # Create payment header structure using Coinbase x402 library
            payment_header = prepare_payment_header(
                sender_address=from_wallet.address,
                x402_version=1,
                payment_requirements=payment_requirements
            )
            
            # Fix nonce type (x402 library bug)
            if 'payload' in payment_header and 'authorization' in payment_header['payload']:
                auth = payment_header['payload']['authorization']
                if 'nonce' in auth and isinstance(auth['nonce'], bytes):
                    auth['nonce'] = auth['nonce'].hex()
            
            # Extract authorization parameters for EIP-3009 signing
            auth = payment_header['payload']['authorization']
            
            # Convert nonce to bytes32 format
            if isinstance(auth['nonce'], str):
                nonce_bytes32 = '0x' + auth['nonce'] if not auth['nonce'].startswith('0x') else auth['nonce']
            else:
                nonce_bytes32 = '0x' + auth['nonce'].hex()
            
            # EIP-712 domain data (dynamic chainId based on network)
            # CRITICAL: Must use "USDC" not "USD Coin" for Base Sepolia
            domain_data = {
                "name": "USDC",  # ✅ CORRECT: Base Sepolia USDC uses "USDC" not "USD Coin"
                "version": "2",
                "chainId": self.chain_id,  # Dynamic: 84532 (Base Sepolia), 11155111 (Ethereum Sepolia), etc.
                "verifyingContract": self.usdc_address
            }
            
            # EIP-3009 TransferWithAuthorization message types
            message_types = {
                "TransferWithAuthorization": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "validAfter", "type": "uint256"},
                    {"name": "validBefore", "type": "uint256"},
                    {"name": "nonce", "type": "bytes32"}
                ]
            }
            
            # EIP-3009 message data
            message_data = {
                "from": auth['from'],
                "to": auth['to'],
                "value": int(auth['value']),
                "validAfter": int(auth['validAfter']),
                "validBefore": int(auth['validBefore']),
                "nonce": nonce_bytes32
            }
            
            # Sign using EIP-712 typed data
            signable_message = encode_typed_data(
                domain_data=domain_data,
                message_types=message_types,
                message_data=message_data
            )
            signed_data = from_wallet.sign_message(signable_message)
            
            # Extract v, r, s components
            v = signed_data.v
            r = '0x' + hex(signed_data.r)[2:].zfill(64)
            s = '0x' + hex(signed_data.s)[2:].zfill(64)
            
            # Create combined signature (r + s + v) for compatibility
            eip3009_signature = r + s[2:] + hex(v)[2:].zfill(2)
            
            # Create signed header with EIP-3009 signature
            signed_header = {
                'x402Version': payment_header.get('x402Version', 1),
                'scheme': payment_header.get('scheme', 'exact'),
                'network': payment_header.get('network', self.x402_network),
                'payload': payment_header['payload'],
                'signature': eip3009_signature,
                'v': v,
                'r': r,
                's': s
            }
            
            # CRITICAL FIX: Remove signature from payload if it exists
            # The x402 library sometimes puts signature inside payload, but facilitator expects it at top level only
            if 'signature' in signed_header['payload']:
                del signed_header['payload']['signature']
            
            # Encode to base64 for X-PAYMENT header
            signed_header_json = json.dumps(signed_header)
            x_payment_header = base64.b64encode(signed_header_json.encode()).decode()
            
            rprint(f"[green]✅ Created EIP-3009 payment authorization[/green]")
            
            return {
                "x_payment_header": x_payment_header,
                "payment_payload": signed_header,
                "amount_wei": amount_wei,
                "amount_usdc": amount_usdc,
                "from_agent": from_agent,
                "payment_requirements": payment_requirements
            }
            
        except Exception as e:
            raise PaymentError(f"Failed to create x402 payment: {str(e)}")
    
    def verify_payment_with_facilitator(
        self,
        x402_payment: Dict[str, Any],
        payment_requirements: PaymentRequirements
    ) -> Dict[str, Any]:
        """
        Verify x402 payment using facilitator service.
        
        Args:
            x402_payment: x402 payment data
            payment_requirements: Payment requirements
            
        Returns:
            Verification result from facilitator
        """
        if not self.use_facilitator or not self.facilitator_url:
            raise PaymentError("Facilitator not configured for verification")
        
        try:
            import requests
            
            verification_data = {
                "x402Version": 1,
                "paymentHeader": x402_payment["x_payment_header"],
                "paymentRequirements": payment_requirements.model_dump()
            }
            
            response = requests.post(
                f"{self.facilitator_url}/verify",
                json=verification_data,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                rprint(f"[green]✅ Facilitator verification: {'Valid' if result.get('isValid') else 'Invalid'}[/green]")
                return result
            else:
                raise PaymentError(f"Facilitator verification failed: {response.status_code}")
                
        except Exception as e:
            raise PaymentError(f"Facilitator verification error: {str(e)}")
    
    def settle_payment_with_facilitator(
        self,
        x402_payment: Dict[str, Any],
        payment_requirements: PaymentRequirements
    ) -> Dict[str, Any]:
        """
        Settle x402 payment using facilitator service.
        
        The facilitator executes the actual USDC transfer on-chain using the
        EIP-3009 signed authorization from the payment header.
        
        Args:
            x402_payment: x402 payment data with EIP-3009 signature
            payment_requirements: Payment requirements
            
        Returns:
            Settlement result from facilitator with transaction hash
        """
        if not self.use_facilitator or not self.facilitator_url:
            raise PaymentError("Facilitator not configured for settlement")
        
        try:
            import requests
            
            # Convert PaymentRequirements to camelCase (facilitator expects this format)
            payment_reqs_dict = {
                "scheme": payment_requirements.scheme,
                "network": payment_requirements.network,
                "maxAmountRequired": payment_requirements.max_amount_required,
                "payTo": payment_requirements.pay_to,
                "asset": payment_requirements.asset,
                "resource": payment_requirements.resource,
            }
            
            # Add optional fields if present
            if hasattr(payment_requirements, 'description') and payment_requirements.description:
                payment_reqs_dict["description"] = payment_requirements.description
            if hasattr(payment_requirements, 'mime_type') and payment_requirements.mime_type:
                payment_reqs_dict["mimeType"] = payment_requirements.mime_type
            if hasattr(payment_requirements, 'max_timeout_seconds') and payment_requirements.max_timeout_seconds:
                payment_reqs_dict["maxTimeoutSeconds"] = payment_requirements.max_timeout_seconds
            
            settlement_data = {
                "x402Version": 1,
                "paymentHeader": x402_payment["x_payment_header"],
                "paymentRequirements": payment_reqs_dict
            }
            
            response = requests.post(
                f"{self.facilitator_url}/settle",
                json=settlement_data,
                timeout=60  # Settlement may take longer
            )
            
            if response.status_code == 200:
                result = response.json()
                if result.get("success"):
                    rprint(f"[green]✅ Facilitator settlement successful: {result.get('txHash')}[/green]")
                else:
                    rprint(f"[red]❌ Facilitator settlement failed: {result.get('error')}[/red]")
                return result
            else:
                error_text = response.text
                rprint(f"[red]❌ Facilitator returned {response.status_code}: {error_text}[/red]")
                raise PaymentError(f"Facilitator settlement failed: {response.status_code} - {error_text}")
                
        except Exception as e:
            raise PaymentError(f"Facilitator settlement error: {str(e)}")
    
    def get_facilitator_supported_schemes(self) -> List[Dict[str, str]]:
        """
        Get supported payment schemes from facilitator.
        
        Returns:
            List of supported scheme/network combinations
        """
        if not self.facilitator_url:
            return []
        
        try:
            import requests
            
            response = requests.get(f"{self.facilitator_url}/supported", timeout=10)
            
            if response.status_code == 200:
                result = response.json()
                return result.get("kinds", [])
            else:
                rprint(f"[yellow]⚠️  Could not fetch facilitator schemes: {response.status_code}[/yellow]")
                return []
                
        except Exception as e:
            rprint(f"[yellow]⚠️  Facilitator schemes error: {e}[/yellow]")
            return []
    
    def execute_agent_payment(
        self,
        from_agent: str,
        to_agent: str,
        amount_usdc: float,
        service_description: str,
        evidence_cid: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute a complete agent-to-agent x402 payment with ChaosChain features.
        
        Args:
            from_agent: Name of the paying agent
            to_agent: Name of the receiving agent
            amount_usdc: Amount in USDC to pay
            service_description: Description of the service being paid for
            evidence_cid: Optional IPFS CID of related evidence
            
        Returns:
            Payment execution result with receipt and transaction hashes
        """
        rprint(f"[blue]💰 Executing x402 payment: {from_agent} → {to_agent} ({amount_usdc} {self.token_symbol})[/blue]")
        
        try:
            # Step 1: Create payment requirements
            payment_requirements = self.create_payment_requirements(
                to_agent=to_agent,
                amount_usdc=amount_usdc,
                service_description=service_description,
                evidence_cid=evidence_cid
            )
            
            # Step 2: Create x402 payment
            x402_payment = self.create_x402_payment(
                from_agent=from_agent,
                payment_requirements=payment_requirements,
                amount_usdc=amount_usdc
            )
            
            # Step 3: Execute payment with ChaosChain fee collection
            payment_result = self._execute_payment_with_fees(
                from_agent=from_agent,
                to_agent=to_agent,
                amount_usdc=amount_usdc,
                x402_payment=x402_payment,
                payment_requirements=payment_requirements
            )
            
            # Step 4: Create payment receipt
            payment_receipt = self._create_payment_receipt(
                from_agent=from_agent,
                to_agent=to_agent,
                amount_usdc=amount_usdc,
                service_description=service_description,
                evidence_cid=evidence_cid,
                x402_payment=x402_payment,
                payment_result=payment_result
            )
            
            # Store in payment history
            self.payment_history.append(payment_receipt)
            
            if payment_result["success"]:
                rprint(f"[green]✅ x402 payment executed successfully[/green]")
                rprint(f"[blue]   Main TX: {payment_result['main_tx_hash']}[/blue]")
                if payment_result.get("fee_tx_hash"):
                    rprint(f"[blue]   Fee TX: {payment_result['fee_tx_hash']}[/blue]")
            else:
                rprint(f"[red]❌ x402 payment failed: {payment_result.get('error', 'Unknown error')}[/red]")
            
            return {
                "success": payment_result["success"],
                "payment_receipt": payment_receipt,
                "main_transaction_hash": payment_result["main_tx_hash"],
                "fee_transaction_hash": payment_result.get("fee_tx_hash"),
                "x402_payment_header": x402_payment["x_payment_header"],
                "error": payment_result.get("error")
            }
            
        except Exception as e:
            rprint(f"[red]❌ x402 payment execution failed: {e}[/red]")
            return {
                "success": False,
                "error": str(e),
                "payment_receipt": None,
                "main_transaction_hash": None,
                "fee_transaction_hash": None,
                "x402_payment_header": None
            }
    
    def _execute_payment_with_fees(
        self,
        from_agent: str,
        to_agent: str,
        amount_usdc: float,
        x402_payment: Dict[str, Any],
        payment_requirements: Any = None
    ) -> Dict[str, Any]:
        """
        Execute USDC transfer with ChaosChain protocol fee collection.
        
        When using a facilitator, this delegates to the facilitator to execute
        the actual blockchain transaction. Otherwise, returns a simulated result.
        
        Args:
            from_agent: Payer agent name
            to_agent: Payee agent name
            amount_usdc: Total payment amount in USDC
            x402_payment: x402 payment data
            payment_requirements: Payment requirements (needed for facilitator)
        """
        try:
            # Calculate fees for display
            protocol_fee_usdc = amount_usdc * (self.protocol_fee_percentage / 100)
            net_amount_usdc = amount_usdc - protocol_fee_usdc
            
            rprint(f"[blue]💰 ChaosChain Fee Collection:[/blue]")
            rprint(f"   Total Payment: ${amount_usdc} {self.token_symbol}")
            rprint(f"   Protocol Fee ({self.protocol_fee_percentage}%): ${protocol_fee_usdc:.6f} {self.token_symbol}")
            rprint(f"   Net to {to_agent}: ${net_amount_usdc:.6f} {self.token_symbol}")
            rprint(f"   Treasury: {self.chaoschain_treasury}")
            
            # If using facilitator, delegate to facilitator for actual blockchain transaction
            if self.use_facilitator and self.facilitator_url and payment_requirements:
                rprint(f"[yellow]🔄 Settling payment via facilitator...[/yellow]")
                
                try:
                    settlement_result = self.settle_payment_with_facilitator(
                        x402_payment=x402_payment,
                        payment_requirements=payment_requirements
                    )
                    
                    if settlement_result.get("success"):
                        main_tx_hash = settlement_result.get("txHash")
                        rprint(f"[green]✅ Facilitator executed payment: {main_tx_hash}[/green]")
                        
                        return {
                            "success": True,
                            "main_tx_hash": main_tx_hash,
                            "fee_tx_hash": None,  # Facilitator handles fee collection
                            "is_simulation": False,
                            "facilitator_settlement": settlement_result,
                            "fee_breakdown": {
                                "total_amount_usdc": amount_usdc,
                                "protocol_fee_usdc": protocol_fee_usdc,
                                "net_amount_usdc": net_amount_usdc,
                                "fee_percentage": self.protocol_fee_percentage,
                                "treasury_address": self.chaoschain_treasury
                            }
                        }
                    else:
                        error_msg = settlement_result.get("error", "Unknown facilitator error")
                        rprint(f"[red]❌ Facilitator settlement failed: {error_msg}[/red]")
                        return {
                            "success": False,
                            "error": f"Facilitator settlement failed: {error_msg}",
                            "main_tx_hash": None,
                            "fee_tx_hash": None,
                            "is_simulation": False
                        }
                        
                except Exception as e:
                    rprint(f"[red]❌ Facilitator error: {e}[/red]")
                    return {
                        "success": False,
                        "error": f"Facilitator error: {str(e)}",
                        "main_tx_hash": None,
                        "fee_tx_hash": None,
                        "is_simulation": False
                    }
            
            # No facilitator configured - return simulated result for demo/testing
            rprint(f"[yellow]⚠️  No facilitator configured - simulating payment[/yellow]")
            rprint(f"[yellow]   Set X402_USE_FACILITATOR=true and X402_FACILITATOR_URL to execute real transactions[/yellow]")
            
            main_tx_hash = f"0x402{int(time.time())}{from_agent[:2]}{to_agent[:2]}"
            fee_tx_hash = f"0xfee{int(time.time())}{from_agent[:2]}CC" if protocol_fee_usdc > 0.000001 else None
            
            return {
                "success": True,
                "main_tx_hash": main_tx_hash,
                "fee_tx_hash": fee_tx_hash,
                "is_simulation": True,
                "fee_breakdown": {
                    "total_amount_usdc": amount_usdc,
                    "protocol_fee_usdc": protocol_fee_usdc,
                    "net_amount_usdc": net_amount_usdc,
                    "fee_percentage": self.protocol_fee_percentage,
                    "treasury_address": self.chaoschain_treasury
                }
            }
            
        except Exception as e:
            rprint(f"[red]❌ Payment execution failed: {e}[/red]")
            return {
                "success": False,
                "error": str(e),
                "main_tx_hash": None,
                "fee_tx_hash": None,
                "is_simulation": True
            }
    
    def _create_payment_receipt(
        self,
        from_agent: str,
        to_agent: str,
        amount_usdc: float,
        service_description: str,
        evidence_cid: Optional[str],
        x402_payment: Dict[str, Any],
        payment_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create a comprehensive payment receipt for evidence packages."""
        
        payment_id = f"x402_{int(time.time())}_{from_agent}_{to_agent}"
        
        return {
            "payment_id": payment_id,
            "protocol": "x402",
            "protocol_version": "0.2.1",
            "from_agent": from_agent,
            "to_agent": to_agent,
            "amount_usdc": amount_usdc,
            "service_description": service_description,
            "evidence_cid": evidence_cid,
            "main_transaction_hash": payment_result["main_tx_hash"],
            "fee_transaction_hash": payment_result.get("fee_tx_hash"),
            "x402_payment_header": x402_payment["x_payment_header"],
            "x402_payload": x402_payment["payment_payload"],
            "network": self.network.value,
            "chain_id": self.chain_id,
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "status": "completed" if payment_result["success"] else "failed",
            "fee_breakdown": payment_result.get("fee_breakdown", {}),
            "is_simulation": payment_result.get("is_simulation", False)
        }
    
    def get_payment_history(self, agent_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get payment history for an agent or all agents.
        
        Args:
            agent_name: Optional agent name to filter by
            
        Returns:
            List of payment records
        """
        if agent_name:
            return [
                receipt for receipt in self.payment_history
                if receipt["from_agent"] == agent_name or receipt["to_agent"] == agent_name
            ]
        
        return self.payment_history.copy()
    
    def get_payment_proof(self, payment_id: str) -> Optional[PaymentProof]:
        """
        Get cryptographic payment proof for evidence packages.
        
        Args:
            payment_id: The payment ID to retrieve
            
        Returns:
            PaymentProof for evidence packaging
        """
        for receipt in self.payment_history:
            if receipt["payment_id"] == payment_id:
                return PaymentProof(
                    payment_id=receipt["payment_id"],
                    from_agent=receipt["from_agent"],
                    to_agent=receipt["to_agent"],
                    amount=receipt["amount_usdc"],
                    currency="USDC",
                    transaction_hash=receipt["main_transaction_hash"],
                    network=receipt["network"],
                    timestamp=receipt["executed_at"],
                    protocol="x402",
                    proof_data={
                        "x402_payment_header": receipt["x402_payment_header"],
                        "x402_payload": receipt["x402_payload"],
                        "fee_transaction_hash": receipt.get("fee_transaction_hash"),
                        "fee_breakdown": receipt.get("fee_breakdown", {})
                    }
                )
        
        return None
    
    def generate_payment_summary(self) -> Dict[str, Any]:
        """Generate a comprehensive summary of all x402 payments."""
        
        total_payments = len(self.payment_history)
        successful_payments = len([r for r in self.payment_history if r["status"] == "completed"])
        total_volume = sum(r["amount_usdc"] for r in self.payment_history if r["status"] == "completed")
        total_fees = sum(
            r.get("fee_breakdown", {}).get("protocol_fee_usdc", 0) 
            for r in self.payment_history if r["status"] == "completed"
        )
        
        agent_stats = {}
        for receipt in self.payment_history:
            if receipt["status"] == "completed":
                # Sender stats
                if receipt["from_agent"] not in agent_stats:
                    agent_stats[receipt["from_agent"]] = {"sent": 0, "received": 0, "fees_paid": 0}
                agent_stats[receipt["from_agent"]]["sent"] += receipt["amount_usdc"]
                agent_stats[receipt["from_agent"]]["fees_paid"] += receipt.get("fee_breakdown", {}).get("protocol_fee_usdc", 0)
                
                # Receiver stats
                if receipt["to_agent"] not in agent_stats:
                    agent_stats[receipt["to_agent"]] = {"sent": 0, "received": 0, "fees_paid": 0}
                net_received = receipt.get("fee_breakdown", {}).get("net_amount_usdc", receipt["amount_usdc"])
                agent_stats[receipt["to_agent"]]["received"] += net_received
        
        return {
            "protocol": "x402",
            "protocol_version": "0.2.1",
            "total_payments": total_payments,
            "successful_payments": successful_payments,
            "success_rate": successful_payments / total_payments if total_payments > 0 else 0,
            "total_volume_usdc": total_volume,
            "total_protocol_fees_usdc": total_fees,
            "agent_statistics": agent_stats,
            "network": self.network.value,
            "treasury_address": self.chaoschain_treasury,
            "protocol_fee_percentage": self.protocol_fee_percentage,
            "generated_at": datetime.now(timezone.utc).isoformat()
        }