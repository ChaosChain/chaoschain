"""
ChaosChain Agent SDK - Main SDK Class

This is the primary interface for developers building agents on the ChaosChain protocol.
It provides a unified API for all protocol interactions including identity management,
payments, process integrity, and evidence storage.
"""

import os
import asyncio
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone
from rich import print as rprint

from mandates_core import Mandate
from .types import (
    AgentRole, 
    NetworkConfig, 
    PaymentMethod, 
    IntegrityProof,
    ValidationResult,
    PaymentProof,
    AgentIdentity,
    EvidencePackage,
    AgentID,
    TransactionHash
)
from .exceptions import (
    ChaosChainSDKError,
    AgentRegistrationError,
    PaymentError,
    IntegrityVerificationError,
    ContractError,
    NetworkError
)
from .wallet_manager import WalletManager
from .providers.storage import StorageProvider, LocalIPFSStorage
from .payment_manager import PaymentManager
from .x402_payment_manager import X402PaymentManager
from .x402_server import X402PaywallServer
from .process_integrity import ProcessIntegrityVerifier
from .chaos_agent import ChaosAgent
from .google_ap2_integration import GoogleAP2Integration, GoogleAP2IntegrationResult
from .a2a_x402_extension import A2AX402Extension
from .mandate_manager import MandateManager


class ChaosChainAgentSDK:
    """
    Production-ready SDK for building agents on the ChaosChain protocol.
    
    This is the main entry point for developers. It provides a unified interface
    for all ChaosChain protocol operations including:
    
    - ERC-8004 identity, reputation, and validation registries
    - Process integrity verification with cryptographic proofs
    - Multi-payment method support (W3C compliant + A2A-x402)
    - IPFS storage for verifiable evidence
    - Production-ready wallet management
    
    Example:
        ```python
        from chaoschain_sdk import ChaosChainAgentSDK, NetworkConfig, AgentRole
        
        # Initialize your agent
        sdk = ChaosChainAgentSDK(
            agent_name="MyAgent",
            agent_domain="myagent.example.com",
            agent_role=AgentRole.SERVER,
            network=NetworkConfig.BASE_SEPOLIA
        )
        
        # Register on ERC-8004
        agent_id, tx_hash = sdk.register_identity()
        
        # Execute work with process integrity
        result, proof = await sdk.execute_with_integrity_proof(
            "my_function", 
            {"param": "value"}
        )
        
        # Process payments
        payment_proof = sdk.execute_payment(
            to_agent="RecipientAgent",
            amount=1.5,
            service_type="analysis"
        )
        ```
    
    Attributes:
        agent_name: Name of the agent
        agent_domain: Domain where agent identity is hosted
        agent_role: Role of the agent (server, validator, client)
        network: Target blockchain network
        wallet_manager: Wallet management instance
        storage_manager: Pluggable storage management instance
        payment_manager: Payment processing instance
        process_integrity: Process integrity verification instance
        chaos_agent: Core agent for ERC-8004 interactions
    """
    
    def __init__(
        self,
        agent_name: str,
        agent_domain: str,
        agent_role: AgentRole | str,
        network: NetworkConfig | str = NetworkConfig.BASE_SEPOLIA,
        enable_process_integrity: bool = True,
        enable_payments: bool = True,
        enable_storage: bool = True,
        enable_ap2: bool = True,
        wallet_file: str = None,
        storage_jwt: str = None,
        storage_gateway: str = None,
        storage_provider: Optional[Any] = None,  # Pluggable storage provider
        compute_provider: Optional[Any] = None   # Pluggable compute provider
    ):
        """
        Initialize the ChaosChain Agent SDK.
        
        Args:
            agent_name: Name of the agent
            agent_domain: Domain where agent identity is hosted  
            agent_role: Role of the agent (server, validator, client)
            network: Target blockchain network
            enable_process_integrity: Enable process integrity verification
            enable_payments: Enable payment processing
            enable_storage: Enable IPFS storage
            enable_ap2: Enable Google AP2 integration
            wallet_file: Custom wallet storage file path
            storage_jwt: Custom Pinata JWT token
            storage_gateway: Custom IPFS gateway URL
            storage_provider: Optional custom storage provider (0G, Pinata, local IPFS, etc.)
            compute_provider: Optional custom compute provider (0G Compute, local, etc.)
        """
        # Convert string parameters to enums if needed
        if isinstance(agent_role, str):
            try:
                agent_role = AgentRole(agent_role)
            except ValueError:
                raise ValueError(f"Invalid agent_role: {agent_role}. Must be one of: {[r.value for r in AgentRole]}")
        
        if isinstance(network, str):
            try:
                network = NetworkConfig(network)
            except ValueError:
                raise ValueError(f"Invalid network: {network}. Must be one of: {[n.value for n in NetworkConfig]}")
        
        self.agent_name = agent_name
        self.agent_domain = agent_domain
        self.agent_role = agent_role
        self.network = network
        
        # Store optional provider references for pluggable architecture
        self._custom_storage_provider = storage_provider
        self._custom_compute_provider = compute_provider
        
        # Initialize core components
        self._initialize_wallet_manager(wallet_file)
        self._initialize_mandate_manager()
        self._initialize_storage_manager(enable_storage, storage_jwt, storage_gateway, storage_provider)
        self._initialize_x402_payment_manager(enable_payments)  # x402 is now primary
        self._initialize_payment_manager(enable_payments)  # Keep for backward compatibility
        self._initialize_process_integrity(enable_process_integrity, compute_provider)
        self._initialize_ap2_integration(enable_ap2)
        self._initialize_xmtp_manager()  # NEW: XMTP for agent communication
        self._initialize_chaos_agent()
        
        rprint(f"[green]🚀 ChaosChain Agent SDK initialized for {agent_name} ({agent_role.value})[/green]")
        rprint(f"   Domain: {agent_domain}")
        rprint(f"   Network: {network.value}")
        rprint(f"   🔗 Triple-Verified Stack: ChaosChain owns 2/3 layers! 🚀")
    
    def get_sdk_status(self) -> Dict[str, Any]:
        """Get comprehensive SDK status and configuration."""
        return {
            "agent_name": self.agent_name,
            "agent_domain": self.agent_domain,
            "agent_role": self.agent_role.value,
            "network": self.network.value,
            "wallet_address": self.wallet_address if hasattr(self, 'wallet_manager') else None,
            "agent_id": getattr(self.chaos_agent, 'agent_id', None) if hasattr(self, 'chaos_agent') else None,
            "features": {
                "x402_enabled": hasattr(self, 'x402_payment_manager') and self.x402_payment_manager is not None,
                "process_integrity": hasattr(self, 'process_integrity') and self.process_integrity is not None,
                "payments": hasattr(self, 'payment_manager') and self.payment_manager is not None,
                "storage": hasattr(self, 'storage_manager') and self.storage_manager is not None,
                "ap2_integration": hasattr(self, 'google_ap2') and self.google_ap2 is not None,
                "x402_extension": hasattr(self, 'a2a_x402') and self.a2a_x402 is not None,
                "mandates": hasattr(self, 'mandate_manager') and self.mandate_manager is not None,
            },
            "x402_enabled": hasattr(self, 'x402_payment_manager') and self.x402_payment_manager is not None,
            "payment_methods": self.get_supported_payment_methods() if hasattr(self, 'payment_manager') and self.payment_manager else [],
            "chain_id": getattr(self.chaos_agent, 'chain_id', None) if hasattr(self, 'chaos_agent') else None,
        }
    
    def _initialize_wallet_manager(self, wallet_file: str = None):
        """Initialize wallet management."""
        try:
            self.wallet_manager = WalletManager(
                network=self.network,
                wallet_file=wallet_file
            )
            # Ensure wallet exists for this agent
            self.wallet_manager.create_or_load_wallet(self.agent_name)
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to initialize wallet manager: {str(e)}")
    
    def _initialize_mandate_manager(self):
        """Initialize mandates-core helper."""
        try:
            self.mandate_manager = MandateManager(
                agent_name=self.agent_name,
                wallet_manager=self.wallet_manager
            )
        except Exception as e:
            rprint(f"[yellow]⚠️  Mandates integration not available: {e}[/yellow]")
            self.mandate_manager = None
    
    def _initialize_storage_manager(self, enabled: bool, jwt: str = None, gateway: str = None, custom_provider: Any = None):
        """Initialize pluggable storage management with optional custom provider."""
        if enabled:
            try:
                # If custom provider injected, use it directly
                if custom_provider:
                    rprint(f"[cyan]📦 Using custom storage provider: {custom_provider.__class__.__name__}[/cyan]")
                    self.storage_manager = custom_provider
                    return
                
                # Priority: 0G Storage -> Pinata -> IPFS -> Memory
                zerog_storage_node = os.getenv('ZEROG_STORAGE_NODE')
                
                # 1. Try 0G Storage first (highest priority for 0G testnet)
                if zerog_storage_node:
                    try:
                        from chaoschain_sdk.providers.storage import ZeroGStorageGRPC
                        zerog_storage = ZeroGStorageGRPC(grpc_url=zerog_storage_node)
                        if zerog_storage.is_available:
                            self.storage_manager = zerog_storage
                            rprint(f"[green]✅ Storage initialized: 0G Storage (decentralized)[/green]")
                            return
                    except Exception as e:
                        rprint(f"[yellow]⚠️  0G Storage not available: {e}[/yellow]")
                
                # 2. Try Pinata if credentials provided
                if jwt and gateway:
                    from .providers.storage import PinataStorage
                    self.storage_manager = PinataStorage(jwt_token=jwt, gateway_url=gateway)
                    rprint(f"[green]✅ Storage initialized: Pinata[/green]")
                else:
                    # 3. Fall back to Local IPFS
                    self.storage_manager = LocalIPFSStorage()
                    rprint(f"[green]✅ Storage initialized: Local IPFS[/green]")
                    
            except Exception as e:
                rprint(f"[yellow]⚠️  Storage not available: {e}[/yellow]")
                self.storage_manager = None
        else:
            self.storage_manager = None
    
    def _initialize_x402_payment_manager(self, enabled: bool):
        """Initialize native x402 payment processing (PRIMARY)."""
        if enabled:
            try:
                self.x402_payment_manager = X402PaymentManager(
                    wallet_manager=self.wallet_manager,
                    network=self.network
                )
                rprint(f"[green]💳 Native x402 payments enabled (Coinbase protocol)[/green]")
            except Exception as e:
                rprint(f"[yellow]⚠️  x402 payment processing not available: {e}[/yellow]")
                self.x402_payment_manager = None
        else:
            self.x402_payment_manager = None
    
    def _initialize_payment_manager(self, enabled: bool):
        """Initialize legacy payment processing (FALLBACK)."""
        # Disable legacy payment manager for 0G testnet - use x402 only
        if self.network == NetworkConfig.ZEROG_TESTNET:
            rprint(f"[cyan]ℹ️  Legacy payment manager disabled for 0G testnet (using x402 only)[/cyan]")
            self.payment_manager = None
            return
            
        if enabled:
            try:
                self.payment_manager = PaymentManager(
                    network=self.network,
                    wallet_manager=self.wallet_manager
                )
                rprint(f"[green]💳 Multi-payment support: {len(self.payment_manager.supported_payment_methods)} methods available[/green]")
            except Exception as e:
                rprint(f"[yellow]⚠️  Payment processing not available: {e}[/yellow]")
                self.payment_manager = None
        else:
            self.payment_manager = None
    
    def _initialize_process_integrity(self, enabled: bool, custom_compute_provider: Any = None):
        """Initialize process integrity verification with optional custom compute provider."""
        if enabled:
            try:
                # If custom compute provider injected, note it (ProcessIntegrityVerifier would use it in future)
                if custom_compute_provider:
                    rprint(f"[cyan]⚙️  Using custom compute provider: {custom_compute_provider.__class__.__name__}[/cyan]")
                    # Future: Pass custom_compute_provider to ProcessIntegrityVerifier
                
                self.process_integrity = ProcessIntegrityVerifier(
                    agent_name=self.agent_name,
                    storage_manager=self.storage_manager
                )
            except Exception as e:
                rprint(f"[yellow]⚠️  Process integrity not available: {e}[/yellow]")
                self.process_integrity = None
        else:
            self.process_integrity = None
    
    def _initialize_ap2_integration(self, enabled: bool):
        """Initialize Google AP2 integration."""
        if enabled:
            try:
                self.google_ap2 = GoogleAP2Integration(agent_name=self.agent_name)
                
                # Initialize A2A-x402 extension if payment manager is available
                if self.payment_manager:
                    self.a2a_x402 = A2AX402Extension(
                        agent_name=self.agent_name,
                        network=self.network,
                        payment_manager=self.payment_manager
                    )
                    rprint(f"[green]🔗 Google AP2 + A2A-x402 integration enabled[/green]")
                else:
                    self.a2a_x402 = None
                    rprint(f"[green]📝 Google AP2 integration enabled (x402 requires payments)[/green]")
                    
            except Exception as e:
                rprint(f"[yellow]⚠️  AP2 integration not available: {e}[/yellow]")
                self.google_ap2 = None
                self.a2a_x402 = None
        else:
            self.google_ap2 = None
            self.a2a_x402 = None
    
    def _initialize_xmtp_manager(self):
        """
        Initialize XMTP manager for agent-to-agent communication.
        
        XMTP enables:
        - Real-time agent communication
        - Causal DAG construction (§1.1)
        - Multi-dimensional scoring (§3.1)
        - Proof of Agency computation
        """
        try:
            from .xmtp_client import XMTPManager
            self.xmtp_manager = XMTPManager(self.wallet_manager)
            rprint("[green]💬 XMTP communication enabled (causal DAG)[/green]")
        except Exception as e:
            rprint(f"[yellow]⚠️  XMTP not available: {e}[/yellow]")
            rprint(f"[yellow]   Install with: pip install xmtp[/yellow]")
            self.xmtp_manager = None
    
    def _initialize_chaos_agent(self):
        """Initialize core ChaosChain agent."""
        try:
            self.chaos_agent = ChaosAgent(
                agent_name=self.agent_name,
                agent_domain=self.agent_domain,
                wallet_manager=self.wallet_manager,
                network=self.network
            )
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to initialize ChaosChain agent: {str(e)}")
    
    # === IDENTITY MANAGEMENT ===
    
    def register_identity(
        self,
        token_uri: Optional[str] = None,
        metadata: Optional[Dict[str, bytes]] = None
    ) -> Tuple[AgentID, TransactionHash]:
        """
        Register agent identity on ERC-8004 v1.0 IdentityRegistry.
        
        Args:
            token_uri: Optional custom tokenURI. If not provided, generates default.
            metadata: Optional dict of on-chain metadata {key: value_bytes}.
                     Example: {"agentName": b"MyAgent", "agentWallet": address_bytes}
        
        Returns:
            Tuple of (agent_id, transaction_hash)
        """
        try:
            return self.chaos_agent.register_agent(token_uri=token_uri, metadata=metadata)
        except Exception as e:
            raise AgentRegistrationError(f"Identity registration failed: {str(e)}")
    
    def set_agent_metadata(self, key: str, value: bytes) -> TransactionHash:
        """
        Set on-chain metadata for this agent (ERC-8004 v1.0).
        
        Args:
            key: Metadata key (e.g., "agentWallet", "agentName")
            value: Metadata value as bytes
        
        Returns:
            Transaction hash
        """
        try:
            return self.chaos_agent.set_agent_metadata(key, value)
        except Exception as e:
            raise ContractError(f"Failed to set metadata: {str(e)}")
    
    def get_agent_metadata(self, key: str, agent_id: Optional[int] = None) -> bytes:
        """
        Get on-chain metadata for an agent (ERC-8004 v1.0).
        
        Args:
            key: Metadata key to retrieve
            agent_id: Agent ID to query. If None, uses this agent's ID.
        
        Returns:
            Metadata value as bytes
        """
        try:
            return self.chaos_agent.get_agent_metadata(key, agent_id)
        except Exception as e:
            raise ContractError(f"Failed to get metadata: {str(e)}")
    
    def get_agent_id(self) -> Optional[AgentID]:
        """
        Get the agent's on-chain ID.
        
        Returns:
            Agent ID if registered, None otherwise
        """
        return self.chaos_agent.get_agent_id()
    
    def get_agent_identity(self) -> AgentIdentity:
        """
        Get complete agent identity information.
        
        Returns:
            AgentIdentity object with all identity details
        """
        agent_id = self.get_agent_id()
        if not agent_id:
            raise AgentRegistrationError("Agent not registered")
        
        return AgentIdentity(
            agent_id=agent_id,
            agent_name=self.agent_name,
            agent_domain=self.agent_domain,
            wallet_address=self.wallet_address,
            registration_tx="registered",  # Would get from chain in production
            network=self.network
        )
    
    # === MANDATES (ERC-8004) ===
    
    def build_mandate_core(
        self,
        kind: str,
        payload: Dict[str, Any],
        base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build a mandate `core` payload using the mandate-specs registry.
        """
        try:
            if not self.mandate_manager:
                raise ChaosChainSDKError("Mandates integration not available")
            return self.mandate_manager.build_core(kind=kind, payload=payload, base_url=base_url)
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to build mandate core: {e}") from e
    
    def create_mandate(
        self,
        *,
        intent: str,
        core: Dict[str, Any],
        deadline: str,
        client: str,
        server: Optional[str] = None,
        version: str = "0.1.0",
        mandate_id: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> Mandate:
        """
        Create a new mandate for deterministic agent agreements.
        
        Args:
            intent: Natural-language description of the agreement
            core: Core payload built via `build_mandate_core`
            deadline: ISO timestamp mandate expiry
            client: CAIP-10 or plain address for the client
            server: CAIP-10 or plain address for the server (defaults to this agent)
            version: Mandate version string
            mandate_id: Optional custom mandate id
            created_at: Optional ISO timestamp (defaults to now)
        """
        try:
            if not self.mandate_manager:
                raise ChaosChainSDKError("Mandates integration not available")
            
            return self.mandate_manager.create_mandate(
                intent=intent,
                core=core,
                deadline=deadline,
                client=client,
                server=server,
                version=version,
                mandate_id=mandate_id,
                created_at=created_at,
            )
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to create mandate: {e}") from e
    
    def sign_mandate_as_server(
        self,
        mandate: Mandate | Dict[str, Any],
        private_key: Optional[str] = None,
    ):
        """
        Sign a mandate as the server (defaults to this agent's wallet key).
        """
        try:
            if not self.mandate_manager:
                raise ChaosChainSDKError("Mandates integration not available")
            return self.mandate_manager.sign_as_server(mandate, private_key=private_key)
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to sign mandate as server: {e}") from e
    
    def sign_mandate_as_client(
        self,
        mandate: Mandate | Dict[str, Any],
        private_key: str,
    ):
        """
        Sign a mandate as the client.
        """
        try:
            if not self.mandate_manager:
                raise ChaosChainSDKError("Mandates integration not available")
            return self.mandate_manager.sign_as_client(mandate, private_key=private_key)
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to sign mandate as client: {e}") from e
    
    def verify_mandate(self, mandate: Mandate | Dict[str, Any]) -> Dict[str, Any]:
        """Verify both client and server signatures on a mandate."""
        try:
            if not self.mandate_manager:
                raise ChaosChainSDKError("Mandates integration not available")
            return self.mandate_manager.verify(mandate)
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to verify mandate: {e}") from e
    
    # === PROCESS INTEGRITY ===
    
    def register_integrity_checked_function(self, func: callable, function_name: str = None) -> str:
        """
        Register a function for integrity checking.
        
        Args:
            func: Function to register
            function_name: Optional custom name
            
        Returns:
            Code hash of the registered function
        """
        if not self.process_integrity:
            raise IntegrityVerificationError("Process integrity not enabled")
        
        return self.process_integrity.register_function(func, function_name)
    
    async def execute_with_integrity_proof(
        self, 
        function_name: str, 
        inputs: Dict[str, Any],
        require_proof: bool = True
    ) -> Tuple[Any, Optional[IntegrityProof]]:
        """
        Execute a registered function with integrity proof generation.
        
        Args:
            function_name: Name of the registered function
            inputs: Function input parameters
            require_proof: Whether to generate integrity proof
            
        Returns:
            Tuple of (function_result, integrity_proof)
        """
        if not self.process_integrity:
            raise IntegrityVerificationError("Process integrity not enabled")
        
        return await self.process_integrity.execute_with_proof(
            function_name, inputs, require_proof
        )
    
    # === GOOGLE AP2 INTEGRATION ===
    
    def create_intent_mandate(
        self,
        user_description: str,
        merchants: Optional[List[str]] = None,
        skus: Optional[List[str]] = None,
        requires_refundability: bool = False,
        expiry_minutes: int = 60
    ) -> GoogleAP2IntegrationResult:
        """
        Create Google AP2 Intent Mandate for user authorization.
        
        Args:
            user_description: Natural language description of intent
            merchants: Allowed merchants (optional)
            skus: Specific SKUs (optional)
            requires_refundability: Whether items must be refundable
            expiry_minutes: Minutes until intent expires
            
        Returns:
            GoogleAP2IntegrationResult with IntentMandate
        """
        if not self.google_ap2:
            raise PaymentError("Google AP2 integration not enabled")
        
        return self.google_ap2.create_intent_mandate(
            user_description=user_description,
            merchants=merchants,
            skus=skus,
            requires_refundability=requires_refundability,
            expiry_minutes=expiry_minutes
        )
    
    def create_cart_mandate(
        self,
        cart_id: str,
        items: List[Dict[str, Any]],
        total_amount: float,
        currency: str = "USD",
        merchant_name: Optional[str] = None,
        expiry_minutes: int = 15
    ) -> GoogleAP2IntegrationResult:
        """
        Create Google AP2 Cart Mandate with JWT signing.
        
        Args:
            cart_id: Unique cart identifier
            items: List of items in cart
            total_amount: Total cart amount
            currency: Currency code
            merchant_name: Name of merchant
            expiry_minutes: Minutes until cart expires
            
        Returns:
            GoogleAP2IntegrationResult with CartMandate and JWT
        """
        if not self.google_ap2:
            raise PaymentError("Google AP2 integration not enabled")
        
        return self.google_ap2.create_cart_mandate(
            cart_id=cart_id,
            items=items,
            total_amount=total_amount,
            currency=currency,
            merchant_name=merchant_name or self.agent_name,
            expiry_minutes=expiry_minutes
        )
    
    def verify_jwt_token(self, token: str) -> Dict[str, Any]:
        """
        Verify Google AP2 JWT token.
        
        Args:
            token: JWT token to verify
            
        Returns:
            Decoded payload if valid, empty dict if invalid
        """
        if not self.google_ap2:
            raise PaymentError("Google AP2 integration not enabled")
        
        return self.google_ap2.verify_jwt_token(token)
    
    # === A2A-X402 EXTENSION ===
    
    def create_x402_payment_request(
        self,
        cart_id: str,
        total_amount: float,
        currency: str,
        items: List[Dict[str, Any]],
        settlement_address: str = None
    ) -> Dict[str, Any]:
        """
        Create A2A-x402 payment request with multi-payment support.
        
        Args:
            cart_id: Cart identifier
            total_amount: Total payment amount
            currency: Payment currency
            items: List of items
            settlement_address: Crypto settlement address
            
        Returns:
            X402PaymentRequest object
        """
        if not self.a2a_x402:
            raise PaymentError("A2A-x402 extension not enabled")
        
        # Use agent's wallet address as settlement address if not provided
        if not settlement_address:
            settlement_address = self.wallet_address
        
        return self.a2a_x402.create_enhanced_payment_request(
            cart_id=cart_id,
            total_amount=total_amount,
            currency=currency,
            items=items,
            settlement_address=settlement_address
        )
    
    def execute_x402_crypto_payment(
        self,
        payment_request: Dict[str, Any],
        payer_agent: str,
        service_description: str = "Agent Service"
    ) -> Dict[str, Any]:
        """
        Execute A2A-x402 crypto payment.
        
        Args:
            payment_request: x402 payment request
            payer_agent: Name of paying agent
            service_description: Service description
            
        Returns:
            X402PaymentResponse with transaction details
        """
        if not self.a2a_x402:
            raise PaymentError("A2A-x402 extension not enabled")
        
        return self.a2a_x402.execute_x402_payment(
            payment_request=payment_request,
            payer_agent=payer_agent,
            service_description=service_description
        )
    
    def execute_traditional_payment(
        self,
        payment_method: str,
        amount: float,
        currency: str,
        payment_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute traditional payment method (cards, Google Pay, etc.).
        
        Args:
            payment_method: W3C payment method identifier
            amount: Payment amount
            currency: Payment currency
            payment_data: Method-specific payment data
            
        Returns:
            TraditionalPaymentResponse with transaction details
        """
        if not self.a2a_x402:
            raise PaymentError("A2A-x402 extension not enabled")
        
        return self.a2a_x402.execute_traditional_payment(
            payment_method=payment_method,
            amount=amount,
            currency=currency,
            payment_data=payment_data
        )

    # === x402 PAYMENT PROCESSING (PRIMARY) ===
    
    def execute_x402_payment(
        self,
        to_agent: str,
        amount: float,
        service_type: str,
        evidence_cid: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute native x402 payment to another agent (PRIMARY payment method).
        
        Args:
            to_agent: Name of the receiving agent
            amount: Amount in USDC to pay
            service_type: Type of service being paid for
            evidence_cid: Optional IPFS CID of related evidence
            
        Returns:
            Payment result with x402 headers and transaction hashes
        """
        if not self.x402_payment_manager:
            raise PaymentError("x402 payment manager not initialized")
        
        return self.x402_payment_manager.execute_agent_payment(
            from_agent=self.agent_name,
            to_agent=to_agent,
            amount_usdc=amount,
            service_description=f"ChaosChain {service_type} Service",
            evidence_cid=evidence_cid
        )
    
    def create_x402_payment_requirements(
        self,
        amount: float,
        service_description: str,
        evidence_cid: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create x402 PaymentRequirements for this agent's services.
        
        Args:
            amount: Amount in USDC required
            service_description: Description of the service
            evidence_cid: Optional IPFS CID of related evidence
            
        Returns:
            x402 PaymentRequirements data
        """
        if not self.x402_payment_manager:
            raise PaymentError("x402 payment manager not initialized")
        
        payment_requirements = self.x402_payment_manager.create_payment_requirements(
            to_agent=self.agent_name,
            amount_usdc=amount,
            service_description=service_description,
            evidence_cid=evidence_cid
        )
        
        return payment_requirements.model_dump()
    
    def get_x402_payment_history(self) -> List[Dict[str, Any]]:
        """Get x402 payment history for this agent."""
        if not self.x402_payment_manager:
            return []
        
        return self.x402_payment_manager.get_payment_history(self.agent_name)
    
    def get_x402_payment_summary(self) -> Dict[str, Any]:
        """Get comprehensive x402 payment summary."""
        if not self.x402_payment_manager:
            return {"error": "x402 payment manager not available"}
        
        return self.x402_payment_manager.generate_payment_summary()
    
    def create_x402_paywall_server(self, port: int = 8402) -> X402PaywallServer:
        """
        Create an x402 paywall server for this agent.
        
        Args:
            port: Port to run the server on (default 8402)
            
        Returns:
            X402PaywallServer instance
        """
        if not self.x402_payment_manager:
            raise PaymentError("x402 payment manager not initialized")
        
        return X402PaywallServer(
            agent_name=self.agent_name,
            payment_manager=self.x402_payment_manager
        )
    
    # === LEGACY PAYMENT PROCESSING (FALLBACK) ===
    
    def create_payment_request(
        self, 
        to_agent: str, 
        amount: float, 
        service_type: str = "agent_service",
        currency: str = "USDC"
    ) -> Dict[str, Any]:
        """
        Create a payment request for agent services.
        
        Args:
            to_agent: Name of the receiving agent
            amount: Payment amount
            service_type: Type of service being paid for
            currency: Payment currency
            
        Returns:
            Payment request dictionary
        """
        if not self.payment_manager:
            raise PaymentError("Payment processing not enabled")
        
        return self.payment_manager.create_x402_payment_request(
            from_agent=self.agent_name,
            to_agent=to_agent,
            amount=amount,
            currency=currency,
            service_description=f"{service_type.replace('_', ' ').title()} Service"
        )
    
    def execute_payment(
        self, 
        payment_request: Dict[str, Any] = None,
        to_agent: str = None,
        amount: float = None,
        service_type: str = "agent_service"
    ) -> PaymentProof:
        """
        Execute a payment - direct transfers for 0G, x402 for other networks.
        
        Args:
            payment_request: Pre-created payment request, or
            to_agent: Name of receiving agent (if creating new request)
            amount: Payment amount (if creating new request)
            service_type: Service type (if creating new request)
            
        Returns:
            Payment proof with transaction details
        """
        # For 0G Testnet, use direct native token transfers (A0GI)
        if self.network == NetworkConfig.ZEROG_TESTNET:
            if not to_agent or amount is None:
                raise PaymentError("to_agent and amount must be provided")
            
            rprint(f"[blue]💰 Direct A0GI transfer: {self.agent_name} → {to_agent} ({amount} A0GI)[/blue]")
            
            # Get recipient address
            to_address = self.wallet_manager.get_wallet_address(to_agent)
            if not to_address:
                raise PaymentError(f"Could not resolve address for agent: {to_agent}")
            
            # Execute direct native token transfer
            from web3 import Web3
            from eth_account import Account
            import time
            
            # Get sender wallet
            from_wallet = self.wallet_manager.wallets.get(self.agent_name)
            if not from_wallet:
                raise PaymentError(f"Wallet not found for agent: {self.agent_name}")
            
            # Use wallet manager's web3 instance
            w3 = self.wallet_manager.w3
            
            # Convert amount to wei (A0GI has 18 decimals like ETH)
            amount_wei = w3.to_wei(amount, 'ether')
            
            # Build transaction
            nonce = w3.eth.get_transaction_count(from_wallet.address)
            
            tx = {
                'nonce': nonce,
                'to': to_address,
                'value': amount_wei,
                'gas': 21000,
                'gasPrice': w3.eth.gas_price,
                'chainId': w3.eth.chain_id
            }
            
            # Sign and send transaction
            signed_tx = w3.eth.account.sign_transaction(tx, from_wallet.key)
            
            # Handle both old and new Web3.py versions
            raw_transaction = getattr(signed_tx, 'raw_transaction', getattr(signed_tx, 'rawTransaction', None))
            if raw_transaction is None:
                raise PaymentError("Could not get raw transaction from signed transaction")
            
            tx_hash = w3.eth.send_raw_transaction(raw_transaction)
            tx_hash_hex = tx_hash.hex()
            
            rprint(f"[green]✅ A0GI transfer successful[/green]")
            rprint(f"   TX: {tx_hash_hex}")
            
            # Create payment proof
            from .types import PaymentProof, PaymentMethod
            from datetime import datetime
            
            return PaymentProof(
                payment_id=f"a0gi_{int(time.time())}",
                from_agent=self.agent_name,
                to_agent=to_agent,
                amount=amount,
                currency="A0GI",
                payment_method=PaymentMethod.DIRECT_TRANSFER,
                transaction_hash=tx_hash_hex,
                timestamp=datetime.now(),
                receipt_data={
                    "service_type": service_type,
                    "network": "0G Testnet",
                    "amount_wei": str(amount_wei)
                }
            )
        
        # For other networks, use x402
        if self.x402_payment_manager:
            if not to_agent or amount is None:
                raise PaymentError("to_agent and amount must be provided")
            
            result = self.x402_payment_manager.execute_agent_payment(
                from_agent=self.agent_name,
                to_agent=to_agent,
                amount_usdc=amount,
                service_description=f"ChaosChain {service_type} Service"
            )
            return result
        
        # Legacy path for other networks
        if not self.payment_manager:
            raise PaymentError("Payment processing not enabled")
        
        # Create payment request if not provided
        if not payment_request:
            if not to_agent or amount is None:
                raise PaymentError("Either payment_request or (to_agent, amount) must be provided")
            payment_request = self.create_payment_request(to_agent, amount, service_type)
        
        return self.payment_manager.execute_x402_payment(payment_request)
    
    def get_supported_payment_methods(self) -> List[str]:
        """
        Get list of all supported payment methods.
        
        Returns:
            List of payment method identifiers
        """
        methods = []
        
        # x402 is the primary payment method
        if self.x402_payment_manager:
            methods.append("x402 (Coinbase Official)")
        
        # Legacy payment methods
        if self.payment_manager:
            methods.extend(self.payment_manager.get_supported_payment_methods())
        
        # Optional enhancements
        if self.google_ap2:
            methods.append("Google AP2")
        if self.a2a_x402:
            methods.append("A2A-x402")
        
        return methods
    
    # === STORAGE MANAGEMENT ===
    
    def store_evidence(
        self, 
        data: Dict[str, Any], 
        evidence_type: str = "evidence",
        metadata: Dict[str, Any] = None
    ) -> Optional[str]:
        """
        Store evidence data on IPFS.
        
        Args:
            data: Data to store
            evidence_type: Type of evidence
            metadata: Optional metadata
            
        Returns:
            IPFS CID if successful, None otherwise
        """
        if not self.storage_manager:
            rprint("[yellow]⚠️  Storage not available[/yellow]")
            return None
        
        import json
        from datetime import datetime as dt
        
        filename = f"{evidence_type}_{self.agent_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        # Add agent metadata
        storage_metadata = {
            "agent_name": self.agent_name,
            "agent_domain": self.agent_domain,
            "evidence_type": evidence_type,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if metadata:
            storage_metadata.update(metadata)
        
        # Custom JSON encoder for datetime objects
        def json_serial(obj):
            if isinstance(obj, dt):
                return obj.isoformat()
            raise TypeError(f"Type {type(obj)} not serializable")
        
        data_bytes = json.dumps(data, indent=2, default=json_serial).encode('utf-8')
        result = self.storage_manager.put(data_bytes, mime="application/json", tags=storage_metadata)
        return result.uri if hasattr(result, 'uri') else result
    
    def retrieve_evidence(self, cid: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve evidence data from IPFS.
        
        Args:
            cid: IPFS Content Identifier
            
        Returns:
            Retrieved data if successful, None otherwise
        """
        if not self.storage_manager:
            return None
        
        try:
            # Use new storage provider interface
            result = self.storage_manager.get(cid)
            
            # Handle tuple response (data, metadata)
            if isinstance(result, tuple):
                data, metadata = result
                if data:
                    import json
                    return json.loads(data.decode('utf-8'))
            # Handle object response with .data attribute
            elif hasattr(result, 'data') and result.data:
                import json
                return json.loads(result.data.decode('utf-8'))
            
            return None
        except Exception as e:
            rprint(f"[red]❌ Failed to retrieve evidence: {e}[/red]")
            return None
    
    # === VALIDATION ===
    
    def request_validation(self, validator_agent_id: AgentID, data_hash: str) -> TransactionHash:
        """
        Request validation from another agent via ERC-8004.
        
        Args:
            validator_agent_id: ID of the validator agent
            data_hash: Hash of data to validate
            
        Returns:
            Transaction hash
        """
        return self.chaos_agent.request_validation(validator_agent_id, data_hash)
    
    def submit_feedback(self, agent_id: AgentID, score: int, feedback: str) -> TransactionHash:
        """
        Submit feedback for another agent via ERC-8004.
        
        Args:
            agent_id: Target agent ID
            score: Feedback score (0-100)
            feedback: Feedback text
            
        Returns:
            Transaction hash
        """
        return self.chaos_agent.submit_feedback(agent_id, score, feedback)
    
    def submit_validation_response(self, data_hash: str, score: int) -> TransactionHash:
        """
        Submit a validation response with score via ValidationRegistry.
        
        Args:
            data_hash: Hash of the data that was validated
            score: Validation score (0-100)
            
        Returns:
            Transaction hash
        """
        return self.chaos_agent.submit_validation_response(data_hash, score)
    
    def get_reputation(
        self,
        agent_id: Optional[int] = None,
        tag1: Optional[bytes] = None,
        tag2: Optional[bytes] = None
    ) -> List[Dict[str, Any]]:
        """
        Get reputation feedback for an agent from ERC-8004 Reputation Registry.
        
        Args:
            agent_id: Agent ID to query (default: this agent)
            tag1: Optional first tag filter (e.g., dimension name)
            tag2: Optional second tag filter (e.g., studio address)
            
        Returns:
            List of reputation entries
        """
        return self.chaos_agent.get_reputation(agent_id, tag1, tag2)
    
    def get_reputation_summary(
        self,
        agent_id: Optional[int] = None,
        client_addresses: Optional[List[str]] = None,
        tag1: Optional[bytes] = None,
        tag2: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """
        Get reputation summary for an agent (count and average score).
        
        Args:
            agent_id: Agent ID to query (default: this agent)
            client_addresses: Optional list of client addresses to filter by
            tag1: Optional first tag filter (e.g., dimension name)
            tag2: Optional second tag filter (e.g., studio address)
            
        Returns:
            Dictionary with count and averageScore
        """
        return self.chaos_agent.get_reputation_summary(agent_id, client_addresses, tag1, tag2)
    
    # === XMTP AGENT COMMUNICATION ===
    
    def send_message(
        self,
        to_agent: str,
        message_type: str,
        content: Dict[str, Any],
        parent_id: Optional[str] = None
    ) -> str:
        """
        Send message to another agent via XMTP.
        
        Creates a node in the causal DAG (§1.1) for later audit.
        
        Args:
            to_agent: Recipient agent address
            message_type: Message type (task_request, bid, collaboration_request, etc.)
            content: Message content (JSON serializable)
            parent_id: Parent message ID (for causal DAG)
        
        Returns:
            Message ID
            
        Raises:
            ChaosChainSDKError: If XMTP not available
        
        Example:
            ```python
            # Send task request
            msg_id = sdk.send_message(
                to_agent="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
                message_type="task_request",
                content={
                    "task_id": "task_123",
                    "description": "Analyze data",
                    "budget": 10.0
                }
            )
            
            # Send reply
            reply_id = sdk.send_message(
                to_agent="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
                message_type="bid",
                content={"proposed_price": 8.0},
                parent_id=msg_id
            )
            ```
        """
        if not self.xmtp_manager:
            raise ChaosChainSDKError(
                "XMTP not available. Install with: pip install xmtp"
            )
        
        message_data = {
            "type": message_type,
            "from": self.wallet_address,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **content
        }
        
        return self.xmtp_manager.send_message(to_agent, message_data, parent_id)
    
    def get_messages(self, from_agent: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Get all messages from a specific agent.
        
        Fetches the entire XMTP thread for causal audit (§1.5).
        
        Args:
            from_agent: Agent address to fetch messages from
            force_refresh: Force refresh from XMTP network
        
        Returns:
            List of messages with causal DAG metadata
            
        Raises:
            ChaosChainSDKError: If XMTP not available
        
        Example:
            ```python
            messages = sdk.get_messages("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb")
            for msg in messages:
                print(f"{msg.author}: {msg.content}")
            ```
        """
        if not self.xmtp_manager:
            raise ChaosChainSDKError(
                "XMTP not available. Install with: pip install xmtp"
            )
        
        messages = self.xmtp_manager.get_thread(from_agent, force_refresh)
        return [msg.to_dict() for msg in messages]
    
    def get_all_conversations(self) -> List[str]:
        """
        Get all conversation addresses.
        
        Returns:
            List of agent addresses this agent has communicated with
        """
        if not self.xmtp_manager:
            return []
        
        return self.xmtp_manager.get_conversation_addresses()
    
    def compute_thread_root(self, messages: List[Dict[str, Any]]) -> str:
        """
        Compute Merkle root of XMTP DAG.
        
        Used for DataHash commitment (§1.4).
        
        Args:
            messages: List of messages (from get_messages)
        
        Returns:
            Thread root (Merkle root) as hex string
        """
        if not self.xmtp_manager:
            raise ChaosChainSDKError(
                "XMTP not available. Install with: pip install xmtp"
            )
        
        from .xmtp_client import XMTPMessage
        xmtp_messages = [XMTPMessage.from_dict(msg) for msg in messages]
        return self.xmtp_manager.compute_thread_root(xmtp_messages)
    
    def verify_thread_causality(self, messages: List[Dict[str, Any]]) -> bool:
        """
        Verify causality of an XMTP thread.
        
        Checks that parents exist and timestamps are monotonic (§1.5).
        
        Args:
            messages: List of messages (from get_messages)
        
        Returns:
            True if causality is valid
        """
        if not self.xmtp_manager:
            return False
        
        from .xmtp_client import XMTPMessage
        xmtp_messages = [XMTPMessage.from_dict(msg) for msg in messages]
        return self.xmtp_manager.verify_causality(xmtp_messages)
    
    # === EVIDENCE PACKAGES ===
    
    def create_evidence_package(
        self,
        task_id: str,
        studio_id: str,
        work_proof: Dict[str, Any],
        xmtp_thread_id: str = None,
        participants: List[Dict[str, Any]] = None,
        artifacts: List[Dict[str, Any]] = None,
        integrity_proof: IntegrityProof = None,
        payment_proofs: List[PaymentProof] = None,
        validation_results: List[ValidationResult] = None
    ) -> EvidencePackage:
        """
        Create a comprehensive evidence package for Proof of Agency.
        
        Includes XMTP thread for causal audit (§1.5) and multi-dimensional scoring (§3.1).
        
        Args:
            task_id: Task identifier
            studio_id: Studio identifier
            work_proof: Evidence of work performed
            xmtp_thread_id: XMTP conversation ID (for causal audit)
            participants: All agents involved (with roles and contributions)
            artifacts: List of all IPFS/Irys artifacts
            integrity_proof: Process integrity proof
            payment_proofs: List of payment proofs
            validation_results: List of validation results
            
        Returns:
            Complete evidence package with causal DAG
        """
        import uuid
        
        # Compute thread_root and build DKG if XMTP thread provided
        thread_root = "0x" + "0" * 64
        dkg_export = None
        
        if xmtp_thread_id and self.xmtp_manager:
            try:
                messages = self.xmtp_manager.get_thread(xmtp_thread_id)
                
                # Build artifacts map for DKG
                artifacts_map = {}
                if artifacts:
                    for artifact in artifacts:
                        msg_id = artifact.get("message_id", artifact.get("xmtp_msg_id"))
                        cid = artifact.get("cid", artifact.get("ipfs_cid"))
                        if msg_id and cid:
                            if msg_id not in artifacts_map:
                                artifacts_map[msg_id] = []
                            artifacts_map[msg_id].append(cid)
                
                # Build DKG from XMTP thread
                from .dkg import DKG
                dkg = DKG.from_xmtp_thread(messages, artifacts_map)
                
                # Compute thread root from DKG
                thread_root = dkg.compute_thread_root()
                
                # Export DKG for verifiers
                dkg_export = dkg.to_dict()
                
                rprint(f"[green]✅ DKG exported: {len(dkg.nodes)} nodes, {len(dkg.agents)} agents[/green]")
                
            except Exception as e:
                rprint(f"[yellow]⚠️  Failed to build DKG: {e}[/yellow]")
                import traceback
                traceback.print_exc()
        
        # Compute evidence_root from artifacts
        evidence_root = "0x" + "0" * 64
        if artifacts:
            from eth_utils import keccak
            artifact_hashes = [keccak(text=str(art)) for art in artifacts]
            if artifact_hashes:
                evidence_root = self.xmtp_manager._compute_merkle_root(artifact_hashes) if self.xmtp_manager else "0x" + "0" * 64
        
        package = EvidencePackage(
            package_id=f"evidence_{uuid.uuid4().hex[:8]}",
            task_id=task_id,
            studio_id=studio_id,
            xmtp_thread_id=xmtp_thread_id or "",
            thread_root=thread_root,
            evidence_root=evidence_root,
            participants=participants or [],
            agent_identity=self.get_agent_identity(),
            work_proof=work_proof,
            artifacts=artifacts or [],
            integrity_proof=integrity_proof,
            payment_proofs=payment_proofs or [],
            validation_results=validation_results or []
        )
        
        # Store on IPFS if available
        if self.storage_manager:
            package_data = {
                "package_id": package.package_id,
                "task_id": package.task_id,
                "studio_id": package.studio_id,
                "xmtp_thread_id": package.xmtp_thread_id,
                "thread_root": package.thread_root,
                "evidence_root": package.evidence_root,
                "participants": package.participants,
                "dkg_export": dkg_export,  # Full DKG for verifiers!
                "artifacts": artifacts or [],
                "agent_identity": {
                    "agent_id": package.agent_identity.agent_id,
                    "agent_name": package.agent_identity.agent_name,
                    "agent_domain": package.agent_identity.agent_domain,
                    "wallet_address": package.agent_identity.wallet_address,
                    "network": package.agent_identity.network.value
                },
                "work_proof": package.work_proof,
                "artifacts": package.artifacts,
                "integrity_proof": package.integrity_proof.__dict__ if package.integrity_proof else None,
                "payment_proofs": [proof.__dict__ for proof in package.payment_proofs],
                "validation_results": [result.__dict__ for result in package.validation_results],
                "created_at": package.created_at.isoformat()
            }
            
            cid = self.store_evidence(package_data, "evidence_package")
            if cid:
                package.ipfs_cid = cid
        
        return package
    
    # === PROPERTIES ===
    
    # === CHAOSCHAIN PROTOCOL METHODS ===
    
    def create_studio(
        self,
        name: str,
        logic_module_address: str
    ) -> str:
        """
        Create a new Studio on the ChaosChain protocol.
        
        Args:
            name: Name for the studio
            logic_module_address: Address of deployed LogicModule contract
            
        Returns:
            Studio proxy address
            
        Raises:
            ContractError: If studio creation fails
        """
        try:
            from rich import print as rprint
            
            # Get ChaosCore contract address from contract_addresses
            chaos_core_address = self.chaos_agent.contract_addresses.chaos_core
            if not chaos_core_address:
                raise ContractError("ChaosCore address not configured for this network")
            
            # Get ChaosCore ABI
            chaos_core_abi = [
                {
                    "inputs": [
                        {"name": "name", "type": "string"},
                        {"name": "logicModule", "type": "address"}
                    ],
                    "name": "createStudio",
                    "outputs": [
                        {"name": "proxy", "type": "address"},
                        {"name": "studioId", "type": "uint256"}
                    ],
                    "stateMutability": "nonpayable",
                    "type": "function"
                },
                {
                    "anonymous": False,
                    "inputs": [
                        {"indexed": True, "name": "studioId", "type": "uint256"},
                        {"indexed": False, "name": "proxy", "type": "address"},
                        {"indexed": False, "name": "logicModule", "type": "address"},
                        {"indexed": True, "name": "creator", "type": "address"}
                    ],
                    "name": "StudioCreated",
                    "type": "event"
                }
            ]
            
            # Create contract instance
            chaos_core = self.chaos_agent.w3.eth.contract(
                address=chaos_core_address,
                abi=chaos_core_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Creating Studio with LogicModule: {logic_module_address}")
            
            # Build transaction
            tx = chaos_core.functions.createStudio(
                name,
                logic_module_address
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 5000000,  # Increased for StudioProxy deployment
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign transaction
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            
            # Send transaction
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Studio creation transaction failed")
            
            # Extract studio address from event logs
            # The proxy address is in topics[1] of the StudioCreated event
            studio_address = None
            for log in receipt['logs']:
                if log['address'].lower() == chaos_core_address.lower():
                    # topics[0] = event signature
                    # topics[1] = proxy address (indexed)
                    if len(log['topics']) >= 2:
                        raw_address = '0x' + log['topics'][1].hex()[-40:]
                        studio_address = self.chaos_agent.w3.to_checksum_address(raw_address)
                        rprint(f"[green]✓[/green] Studio created: {studio_address}")
                        break
            
            if not studio_address:
                raise ContractError("Could not extract studio address from transaction")
            
            return studio_address
            
        except Exception as e:
            raise ContractError(f"Failed to create studio: {str(e)}")
    
    def register_with_studio(
        self,
        studio_address: str,
        agent_id: int,
        role: int,
        stake_amount: int = None
    ) -> str:
        """
        Register this agent with a Studio.
        
        Args:
            studio_address: Address of the Studio proxy
            agent_id: Agent's ERC-8004 ID
            role: Agent role (1=WORKER, 2=VERIFIER, 3=CLIENT, 4=WORKER_VERIFIER, etc.)
            stake_amount: Amount to stake in wei (default: 0.0001 ETH if None)
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If registration fails
            
        Note:
            Stake is required by the contract. Default is 0.0001 ETH (100000000000000 wei).
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # Default stake: 0.0001 ETH (required by contract)
            if stake_amount is None:
                stake_amount = 100000000000000  # 0.0001 ETH in wei
            
            if stake_amount == 0:
                raise ContractError("Stake amount must be > 0 (contract requirement)")
            
            # StudioProxy ABI (minimal)
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "agentId", "type": "uint256"},
                        {"name": "role", "type": "uint8"}
                    ],
                    "name": "registerAgent",
                    "outputs": [],
                    "stateMutability": "payable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Registering agent {agent_id} with studio {studio_address}")
            rprint(f"[dim]   Role: {role}, Stake: {stake_amount / 1e18} ETH[/dim]")
            
            # Build transaction
            tx = studio.functions.registerAgent(
                agent_id,
                role
            ).build_transaction({
                'from': account.address,
                'value': stake_amount,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 500000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Studio registration transaction failed")
            
            rprint(f"[green]✓[/green] Agent registered with studio")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to register with studio: {str(e)}")
    
    def submit_work(
        self,
        studio_address: str,
        data_hash: bytes,
        thread_root: bytes,
        evidence_root: bytes
    ) -> str:
        """
        Submit work to a Studio (§1.4 protocol spec).
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: EIP-712 DataHash of the work (bytes32)
            thread_root: VLC/Merkle root of XMTP thread (bytes32)
            evidence_root: Merkle root of Irys payloads (bytes32)
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If submission fails
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # Get agent ID
            agent_id = self.chaos_agent.get_agent_id()
            if not agent_id or agent_id == 0:
                raise ContractError("Agent not registered. Call register_agent() first.")
            
            # NOTE: ERC-8004 Jan 2026 removed feedbackAuth requirement
            # Feedback is now permissionless - feedbackAuth is kept for backward compatibility
            # but will emit deprecation warning
            import warnings
            rewards_distributor = self.chaos_agent.contract_addresses.rewards_distributor
            feedback_auth = b''  # Empty by default (Jan 2026 spec)
            
            if rewards_distributor:
                # Generate feedbackAuth for backward compatibility (DEPRECATED)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", DeprecationWarning)
                    feedback_auth = self.chaos_agent._generate_feedback_auth(
                        agent_id,
                        rewards_distributor
                    )
                rprint(f"[dim]   (feedbackAuth included for backward compatibility)[/dim]")
            
            # StudioProxy ABI (feedbackAuth kept for backward compatibility)
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "threadRoot", "type": "bytes32"},
                        {"name": "evidenceRoot", "type": "bytes32"},
                        {"name": "feedbackAuth", "type": "bytes"}  # DEPRECATED in Jan 2026
                    ],
                    "name": "submitWork",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Submitting work to studio {studio_address}")
            rprint(f"[dim]   DataHash: {data_hash.hex() if isinstance(data_hash, bytes) else data_hash}[/dim]")
            rprint(f"[dim]   ThreadRoot: {thread_root.hex() if isinstance(thread_root, bytes) else thread_root}[/dim]")
            rprint(f"[dim]   EvidenceRoot: {evidence_root.hex() if isinstance(evidence_root, bytes) else evidence_root}[/dim]")
            
            # Build transaction (feedbackAuth for backward compatibility)
            tx = studio.functions.submitWork(
                data_hash,
                thread_root,
                evidence_root,
                feedback_auth
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 500000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Work submission transaction failed")
            
            rprint(f"[green]✓[/green] Work submitted successfully")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to submit work: {str(e)}")
    
    def submit_work_multi_agent(
        self,
        studio_address: str,
        data_hash: bytes,
        thread_root: bytes,
        evidence_root: bytes,
        participants: List[str],
        contribution_weights,  # Can be Dict[str, float] or List[int] or List[float]
        evidence_cid: str = ""
    ) -> str:
        """
        Submit work with multi-agent attribution (Protocol Spec §4.2).
        
        This method enables multiple agents to collaborate on a task and receive
        rewards based on their contribution weights computed FROM DKG causal analysis.
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: EIP-712 DataHash of the work (bytes32)
            thread_root: VLC/Merkle root of XMTP thread (bytes32)
            evidence_root: Merkle root of artifacts (bytes32)
            participants: List of participant addresses (in order)
            contribution_weights: Contribution weights in one of these formats:
                - Dict[str, float]: {address: weight} where weights sum to 1.0
                  Example: {"0xAlice": 0.45, "0xBob": 0.35, "0xCarol": 0.20}
                - List[float]: weights in same order as participants, sum to 1.0
                  Example: [0.45, 0.35, 0.20]
                - List[int]: basis points in same order as participants, sum to 10000
                  Example: [4500, 3500, 2000]
                These come FROM DKG.compute_contribution_weights()!
            evidence_cid: IPFS/Arweave CID of evidence package (optional)
            
        Returns:
            Transaction hash
            
        Example:
            # After DKG causal analysis
            dkg = DKG.from_xmtp_messages_and_artifacts(messages, artifacts)
            contribution_weights = dkg.compute_contribution_weights()  # FROM DKG!
            
            # Submit work
            tx = sdk.submit_work_multi_agent(
                studio_address="0x...",
                data_hash=data_hash,
                thread_root=thread_root,
                evidence_root=evidence_root,
                participants=["0xAlice", "0xBob", "0xCarol"],
                contribution_weights=contribution_weights,  # FROM DKG!
                evidence_cid="Qm..."
            )
        
        Raises:
            ValueError: If contribution weights don't sum to 1.0
            ContractError: If submission fails
        """
        try:
            from rich import print as rprint
            
            # Normalize contribution_weights to basis points (0-10000)
            # Handle different input formats: Dict, List[float], List[int]
            weights_bp = []
            
            if isinstance(contribution_weights, dict):
                # Dict format: {address: float_weight}
                total_weight = sum(contribution_weights.values())
                if abs(total_weight - 1.0) > 1e-6:
                    raise ValueError(f"Dict contribution weights must sum to 1.0, got {total_weight}")
                
                # Validate participants match weights
                for p in participants:
                    if p not in contribution_weights:
                        raise ValueError(f"No contribution weight for participant {p}")
                
                # Convert to basis points
                weights_bp = [int(contribution_weights[p] * 10000) for p in participants]
                
            elif isinstance(contribution_weights, list):
                if len(contribution_weights) != len(participants):
                    raise ValueError(f"Weights list length ({len(contribution_weights)}) must match participants ({len(participants)})")
                
                # Check if list contains floats (0-1) or ints (basis points)
                total = sum(contribution_weights)
                
                if total <= 1.1:  # Float weights (0-1 range)
                    if abs(total - 1.0) > 1e-6:
                        raise ValueError(f"Float contribution weights must sum to 1.0, got {total}")
                    weights_bp = [int(w * 10000) for w in contribution_weights]
                else:  # Basis points (0-10000 range)
                    if total != 10000:
                        rprint(f"[yellow]⚠️  Basis point weights sum to {total}, expected 10000. Auto-normalizing...[/yellow]")
                        weights_bp = [int(w * 10000 / total) for w in contribution_weights]
                    else:
                        weights_bp = [int(w) for w in contribution_weights]
            else:
                raise ValueError(f"contribution_weights must be dict or list, got {type(contribution_weights)}")
            
            # Checksum addresses
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            participants_checksummed = [
                self.chaos_agent.w3.to_checksum_address(p) for p in participants
            ]
            
            # Verify sum is 10000 (handling rounding)
            weights_sum = sum(weights_bp)
            if weights_sum != 10000:
                # Adjust last weight to ensure exact sum
                diff = 10000 - weights_sum
                weights_bp[-1] += diff
            
            # Get agent ID
            agent_id = self.chaos_agent.get_agent_id()
            if not agent_id or agent_id == 0:
                raise ContractError("Agent not registered. Call register_agent() first.")
            
            # ERC-8004 Jan 2026: feedbackAuth REMOVED - feedback is now permissionless
            # StudioProxy ABI for multi-agent submission (Jan 2026 compliant - NO feedbackAuth)
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "threadRoot", "type": "bytes32"},
                        {"name": "evidenceRoot", "type": "bytes32"},
                        {"name": "participants", "type": "address[]"},
                        {"name": "contributionWeights", "type": "uint16[]"},
                        {"name": "evidenceCID", "type": "string"}
                    ],
                    "name": "submitWorkMultiAgent",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Submitting multi-agent work to studio {studio_address}")
            rprint(f"[dim]   Participants: {len(participants)}[/dim]")
            for i, (p, w) in enumerate(zip(participants, weights_bp)):
                rprint(f"[dim]     {i+1}. {p[:10]}... → {w/100:.1f}% contribution[/dim]")
            rprint(f"[dim]   DataHash: {data_hash.hex() if isinstance(data_hash, bytes) else data_hash}[/dim]")
            if evidence_cid:
                rprint(f"[dim]   Evidence: ipfs://{evidence_cid}[/dim]")
            
            # Build transaction (Jan 2026: no feedbackAuth parameter!)
            tx = studio.functions.submitWorkMultiAgent(
                data_hash,
                thread_root,
                evidence_root,
                participants_checksummed,
                weights_bp,
                evidence_cid
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 800000,  # Higher gas for multi-agent
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Multi-agent work submission failed")
            
            rprint(f"[green]✓[/green] Multi-agent work submitted successfully")
            rprint(f"[green]  Rewards will be distributed based on DKG contribution weights![/green]")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to submit multi-agent work: {str(e)}")
    
    def register_feedback_auth(
        self,
        studio_address: str,
        data_hash: bytes
    ) -> str:
        """
        DEPRECATED: Register feedbackAuth for a multi-agent work submission.
        
        ERC-8004 Jan 2026 REMOVED the feedbackAuth requirement.
        Feedback submission is now permissionless - any clientAddress can submit directly.
        
        This method is kept for backward compatibility with existing contracts
        but is no longer required for Jan 2026 compliant systems.
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: The work dataHash (bytes32)
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If not a participant or already registered
        """
        import warnings
        warnings.warn(
            "register_feedback_auth is DEPRECATED. "
            "ERC-8004 Jan 2026 removed feedbackAuth - feedback is now permissionless.",
            DeprecationWarning,
            stacklevel=2
        )
        
        try:
            from rich import print as rprint
            
            # Checksum addresses
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # Get agent ID
            agent_id = self.chaos_agent.get_agent_id()
            if not agent_id or agent_id == 0:
                raise ContractError("Agent not registered. Call register_agent() first.")
            
            # Generate feedbackAuth signature (DEPRECATED)
            rewards_distributor = self.chaos_agent.contract_addresses.rewards_distributor
            if not rewards_distributor:
                raise ContractError("RewardsDistributor address not configured")
            
            rprint(f"[yellow]⚠️  DEPRECATED: feedbackAuth no longer required (Jan 2026 spec)[/yellow]")
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                feedback_auth = self.chaos_agent._generate_feedback_auth(
                    agent_id,
                    rewards_distributor
                )
            
            # StudioProxy ABI for registerFeedbackAuth (DEPRECATED)
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "feedbackAuth", "type": "bytes"}
                    ],
                    "name": "registerFeedbackAuth",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Registering feedbackAuth for work {data_hash.hex()[:16]}...")
            
            # Build transaction
            tx = studio.functions.registerFeedbackAuth(
                data_hash,
                feedback_auth
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 500000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()[:16]}...")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("FeedbackAuth registration failed")
            
            rprint(f"[green]✓[/green] FeedbackAuth registered (DEPRECATED - not needed in Jan 2026)")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to register feedbackAuth: {str(e)}")
    
    def submit_work_from_audit(
        self,
        studio_address: str,
        audit_result: 'AuditResult',
        evidence_cid: str
    ) -> str:
        """
        Submit work with contribution weights FROM audit result (convenience helper).
        
        This helper automatically extracts contribution weights from VerifierAgent audit,
        computes all necessary hashes, and submits the work.
        
        Args:
            studio_address: Address of the Studio proxy
            audit_result: Result from VerifierAgent.perform_causal_audit()
            evidence_cid: IPFS/Arweave CID of evidence package
            
        Returns:
            Transaction hash
            
        Example:
            # Verifier performs audit
            verifier = VerifierAgent(sdk)
            audit = verifier.perform_causal_audit(evidence_cid, studio_address)
            
            # Submit work (one line!)
            tx = sdk.submit_work_from_audit(
                studio_address,
                audit,  # Contains DKG contribution weights!
                evidence_cid
            )
        """
        try:
            from rich import print as rprint
            
            # Extract contribution weights FROM audit (FROM DKG!)
            contribution_weights = audit_result.contribution_weights
            if not contribution_weights:
                raise ValueError("Audit result does not contain contribution weights")
            
            # Get participants (sorted by address for consistency)
            participants = sorted(contribution_weights.keys())
            
            # Fetch evidence package to compute hashes
            rprint(f"[cyan]📦[/cyan] Fetching evidence package to compute hashes...")
            evidence = self.storage_client.fetch(evidence_cid)
            
            if not evidence:
                raise ValueError("Could not fetch evidence package")
            
            # Compute thread root from XMTP messages
            from chaoschain_sdk.xmtp_client import XMTPMessage
            messages = evidence.get("xmtp_messages", [])
            if messages and isinstance(messages[0], dict):
                messages = [XMTPMessage(**msg) if isinstance(msg, dict) else msg for msg in messages]
            
            thread_root = self.xmtp_manager.compute_thread_root(messages) if messages else bytes(32)
            
            # Compute evidence root from artifacts
            artifacts = evidence.get("artifacts", [])
            evidence_root = self._compute_evidence_root(artifacts) if artifacts else bytes(32)
            
            # Compute data hash
            data_hash = audit_result.data_hash
            
            rprint(f"[green]✓[/green] Hashes computed from evidence package")
            rprint(f"[dim]   Thread root: {thread_root.hex()}[/dim]")
            rprint(f"[dim]   Evidence root: {evidence_root.hex()}[/dim]")
            rprint(f"[dim]   Data hash: {data_hash.hex()}[/dim]")
            
            # Submit work
            return self.submit_work_multi_agent(
                studio_address,
                data_hash,
                thread_root,
                evidence_root,
                participants,
                contribution_weights,
                evidence_cid
            )
            
        except Exception as e:
            raise ContractError(f"Failed to submit work from audit: {str(e)}")
    
    def commit_score(
        self,
        studio_address: str,
        data_hash: bytes,
        score_commitment: bytes
    ) -> str:
        """
        Commit a score (commit phase of commit-reveal, §2.4 protocol spec).
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: DataHash of the work being scored
            score_commitment: keccak256(abi.encodePacked(scoreVector, salt, dataHash))
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If commit fails
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # StudioProxy ABI
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "commitment", "type": "bytes32"}
                    ],
                    "name": "commitScore",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Committing score to studio {studio_address}")
            
            # Build transaction
            tx = studio.functions.commitScore(
                data_hash,
                score_commitment
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 300000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Score commit transaction failed")
            
            rprint(f"[green]✓[/green] Score committed successfully")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to commit score: {str(e)}")
    
    def reveal_score(
        self,
        studio_address: str,
        data_hash: bytes,
        score_vector: List[int],
        salt: bytes
    ) -> str:
        """
        Reveal a score (reveal phase of commit-reveal, §2.4 protocol spec).
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: DataHash of the work being scored
            score_vector: Array of scores (must match commitment)
            salt: Random salt used in commitment
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If reveal fails
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # StudioProxy ABI
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "dataHash", "type": "bytes32"},
                        {"name": "scoreVector", "type": "bytes"},
                        {"name": "salt", "type": "bytes32"}
                    ],
                    "name": "revealScore",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Revealing score to studio {studio_address}")
            
            # Encode score vector as bytes
            from eth_abi import encode
            score_bytes = encode(['uint8[]'], [score_vector])
            
            # Build transaction
            tx = studio.functions.revealScore(
                data_hash,
                score_bytes,
                salt
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 500000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Score reveal transaction failed")
            
            rprint(f"[green]✓[/green] Score revealed successfully")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to reveal score: {str(e)}")
    
    def submit_score_vector(
        self,
        studio_address: str,
        data_hash: bytes,
        score_vector: List[int]
    ) -> str:
        """
        Submit score vector directly (simpler alternative to commit-reveal).
        
        This method submits scores directly without the commit-reveal protocol.
        Use this when:
        - Commit-reveal deadlines are not set by admin
        - Quick testing of verifier workflow
        - Studios that don't require commit-reveal protection
        
        Per ChaosChain_Implementation_Plan.md §3 (Verification & Attestation):
        - Verifier Agents monitor StudioProxy for new work submissions
        - VA fetches EvidencePackage from XMTP/Irys
        - VA performs causal audit and generates ScoreVector
        - VA submits ScoreVector to StudioProxy
        
        Multi-dimensional scoring dimensions (per protocol spec):
        - Initiative: Original contributions (non-derivative)
        - Collaboration: Building on others' work
        - Reasoning Depth: Complexity of analysis
        - Compliance: Following rules/requirements
        - Efficiency: Time and resource usage
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: DataHash of the work being scored (bytes32)
            score_vector: Multi-dimensional scores [0-100 each]
                         e.g., [initiative, collaboration, reasoning_depth, compliance, efficiency]
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If submission fails
            
        Example:
            ```python
            # After causal audit of worker's evidence
            scores = [85, 90, 88, 95, 82]  # Multi-dimensional PoA scores
            
            tx_hash = sdk.submit_score_vector(
                studio_address="0x67b76181...",
                data_hash=work_data_hash,
                score_vector=scores
            )
            ```
        """
        return self.chaos_agent.submit_score_vector(
            studio_address=studio_address,
            data_hash=data_hash,
            score_vector=score_vector
        )
    
    def submit_score_vector_for_worker(
        self,
        studio_address: str,
        data_hash: bytes,
        worker_address: str,
        scores: List[int]
    ) -> str:
        """
        Submit score vector for a SPECIFIC WORKER in multi-agent tasks (§3.1, §4.2).
        
        This is the CORRECT method for multi-agent work reputation:
        - Each verifier evaluates EACH WORKER from DKG causal analysis
        - Submits separate score vector for each worker
        - Contract calculates per-worker consensus
        - Each worker gets THEIR OWN reputation scores
        
        Why this matters:
        - Alice (research) gets different scores than Bob (dev) than Carol (QA)
        - Reputation reflects individual contribution, not team average
        - Enables fair agent selection based on actual performance
        
        Args:
            studio_address: Address of the Studio proxy
            data_hash: DataHash of the work being scored (bytes32)
            worker_address: Address of the worker being scored
            scores: Multi-dimensional scores for THIS worker [0-100 each]
                   e.g., [initiative, collaboration, reasoning_depth, compliance, efficiency]
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If submission fails
            
        Example:
            ```python
            # After DKG causal audit, score each worker separately
            
            # Alice's scores FROM DKG (high initiative = root node)
            sdk.submit_score_vector_for_worker(
                studio_address="0x67b...",
                data_hash=work_hash,
                worker_address="0xAlice...",
                scores=[85, 60, 70, 95, 80]  # High initiative
            )
            
            # Bob's scores FROM DKG (high collaboration = central node)
            sdk.submit_score_vector_for_worker(
                studio_address="0x67b...",
                data_hash=work_hash,
                worker_address="0xBob...",
                scores=[65, 90, 75, 95, 85]  # High collaboration
            )
            
            # Carol's scores FROM DKG (high reasoning = deep path)
            sdk.submit_score_vector_for_worker(
                studio_address="0x67b...",
                data_hash=work_hash,
                worker_address="0xCarol...",
                scores=[55, 70, 95, 95, 88]  # High reasoning depth
            )
            ```
        """
        return self.chaos_agent.submit_score_vector_for_worker(
            studio_address=studio_address,
            data_hash=data_hash,
            worker_address=worker_address,
            score_vector=scores
        )
    
    def close_epoch(
        self,
        studio_address: str,
        epoch: int,
        rewards_distributor_address: str = None
    ) -> str:
        """
        Close an epoch and trigger reward distribution (§7.2 protocol spec).
        
        Args:
            studio_address: Address of the Studio proxy
            epoch: Epoch number to close
            rewards_distributor_address: Address of RewardsDistributor (default: from contract addresses)
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If epoch closure fails
            
        Note:
            This calls RewardsDistributor.closeEpoch(), not StudioProxy.
            Only the owner of RewardsDistributor can call this.
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # Get RewardsDistributor address
            if rewards_distributor_address is None:
                rewards_distributor_address = self.chaos_agent.contract_addresses.rewards_distributor
            
            rewards_distributor_address = self.chaos_agent.w3.to_checksum_address(rewards_distributor_address)
            
            # RewardsDistributor ABI
            rewards_distributor_abi = [
                {
                    "inputs": [
                        {"name": "studio", "type": "address"},
                        {"name": "epoch", "type": "uint64"}
                    ],
                    "name": "closeEpoch",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            distributor = self.chaos_agent.w3.eth.contract(
                address=rewards_distributor_address,
                abi=rewards_distributor_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Closing epoch {epoch} for studio {studio_address}")
            rprint(f"[dim]   RewardsDistributor: {rewards_distributor_address}[/dim]")
            
            # Build transaction
            tx = distributor.functions.closeEpoch(
                studio_address,
                epoch
            ).build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 3000000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Epoch closure transaction failed")
            
            rprint(f"[green]✓[/green] Epoch closed successfully")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to close epoch: {str(e)}")
    
    def get_pending_rewards(
        self,
        studio_address: str
    ) -> int:
        """
        Get pending rewards for this agent in a Studio.
        
        Args:
            studio_address: Address of the Studio proxy
            
        Returns:
            Pending reward amount in wei
            
        Raises:
            ContractError: If query fails
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # StudioProxy ABI
            studio_proxy_abi = [
                {
                    "inputs": [
                        {"name": "account", "type": "address"}
                    ],
                    "name": "getWithdrawableBalance",
                    "outputs": [{"name": "balance", "type": "uint256"}],
                    "stateMutability": "view",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            # Query pending rewards
            pending = studio.functions.getWithdrawableBalance(account.address).call()
            
            return pending
            
        except Exception as e:
            raise ContractError(f"Failed to get pending rewards: {str(e)}")
    
    def withdraw_rewards(
        self,
        studio_address: str
    ) -> str:
        """
        Withdraw pending rewards from a Studio.
        
        Args:
            studio_address: Address of the Studio proxy
            
        Returns:
            Transaction hash
            
        Raises:
            ContractError: If withdrawal fails
        """
        try:
            from rich import print as rprint
            
            # Checksum address
            studio_address = self.chaos_agent.w3.to_checksum_address(studio_address)
            
            # StudioProxy ABI
            studio_proxy_abi = [
                {
                    "inputs": [],
                    "name": "withdrawRewards",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create contract instance
            studio = self.chaos_agent.w3.eth.contract(
                address=studio_address,
                abi=studio_proxy_abi
            )
            
            # Get wallet account
            account = self.wallet_manager.wallets[self.agent_name]
            
            rprint(f"[cyan]→[/cyan] Withdrawing rewards from studio {studio_address}")
            
            # Build transaction
            tx = studio.functions.withdrawRewards().build_transaction({
                'from': account.address,
                'nonce': self.chaos_agent.w3.eth.get_transaction_count(account.address),
                'gas': 300000,
                'gasPrice': self.chaos_agent.w3.eth.gas_price
            })
            
            # Sign and send
            signed_tx = self.chaos_agent.w3.eth.account.sign_transaction(tx, account.key)
            tx_hash = self.chaos_agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            rprint(f"[cyan]→[/cyan] Transaction sent: {tx_hash.hex()}")
            
            # Wait for receipt
            receipt = self.chaos_agent.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] != 1:
                raise ContractError("Reward withdrawal transaction failed")
            
            rprint(f"[green]✓[/green] Rewards withdrawn successfully")
            return tx_hash.hex()
            
        except Exception as e:
            raise ContractError(f"Failed to withdraw rewards: {str(e)}")
    
    @property
    def wallet_address(self) -> str:
        """Get the agent's wallet address."""
        return self.wallet_manager.get_wallet_address(self.agent_name)
    
    @property
    def is_registered(self) -> bool:
        """Check if the agent is registered on-chain."""
        return self.get_agent_id() is not None
    
    @property
    def network_info(self) -> Dict[str, Any]:
        """Get network information."""
        return {
            "network": self.network.value,
            "chain_id": self.wallet_manager.chain_id,
            "connected": self.wallet_manager.is_connected,
            "wallet_address": self.wallet_address
        }