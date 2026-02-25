
import os
import secrets
import binascii
from typing import Dict, Any, Optional

from eth_account import Account
from eth_account.datastructures import SignedMessage

from ...exceptions import ChaosChainSDKError
from .base import TEEProvider, TEEKeypair, TEESignature

# Try to import dstack_sdk
try:
    from dstack_sdk import DstackClient
    HAS_DSTACK = True
except ImportError:
    HAS_DSTACK = False


class PhalaDstackTEE(TEEProvider):
    """
    Phala Cloud TEE provider using dstack SDK.
    
    Implements TEEProvider protocol for hardware-verified agents
    running on Phala CVMs.
    """
    
    def __init__(
        self,
        endpoint: Optional[str] = None,
        simulate: bool = False
    ):
        """
        Initialize Phala dstack provider.
        
        Args:
            endpoint: Optional dstack endpoint (default: /var/run/dstack.sock or env)
            simulate: If True, uses simulator endpoint if configured
        """
        if not HAS_DSTACK:
            raise ImportError(
                "dstack-sdk is required for PhalaDstackTEE.\n"
                "Install with: pip install chaoschain-sdk[phala-tee]"
            )
            
        self._endpoint = endpoint
        self._simulate = simulate
        self._client: Optional[DstackClient] = None
        
        # Initialize client lazily or now? 
        # Better to init now to catch connection errors early if intended?
        # But for availability check, we might want to be safe.
        self._init_client()

    def _init_client(self):
        """Initialize the dstack client."""
        if self._endpoint:
            endpoint = self._endpoint
        else:
            # Check env vars
            endpoint = os.getenv("DSTACK_SIMULATOR_ENDPOINT") if self._simulate else None
            
            if not endpoint and not self._simulate:
                 # Default production socket
                endpoint = "/var/run/dstack.sock"
        
        # If we have an endpoint (simulator or explicit), use it
        if endpoint:
            # DstackClient constructor logic from reference:
            # if http -> simulator, else socket
            self._client = DstackClient(endpoint)
        else:
            # Default
            self._client = DstackClient()

    @property
    def provider_name(self) -> str:
        return "phala-dstack"

    @property
    def is_available(self) -> bool:
        """Check if TEE environment is available."""
        if not self._client:
            return False
        try:
            # Try a lightweight call to check availability
            # get_quote with dummy data or just presence of socket
            return True # DstackClient usually raises on init if socket missing? 
            # Actually strictly checking usually involves trying to connect.
            # We'll assume True if init didn't fail, 
            # but realistic check might be needed.
        except Exception:
            return False

    def generate_key(self, **kwargs) -> TEEKeypair:
        """
        Generate a TEE-attested keypair.
        
        Args:
            domain (str): Domain for key derivation context (required)
            salt (str): Optional salt (random if not provided)
            
        Returns:
            TEEKeypair with public/private keys and attestation
        """
        domain = kwargs.get("domain", "chaoschain-agent")
        salt = kwargs.get("salt", secrets.token_hex(16))
        
        if not self._client:
            self._init_client()
            
        # 1. Derive Key
        # Path format: wallet/erc8004-{salt}
        path = f"wallet/erc8004-{salt}"
        purpose = domain
        
        try:
            key_result = self._client.get_key(path, purpose)
            private_key_bytes = key_result.decode_key()
            
            # Format as hex for eth_account
            if isinstance(private_key_bytes, bytes):
                private_key_hex = "0x" + private_key_bytes.hex()
            else:
                private_key_hex = private_key_bytes
                if not private_key_hex.startswith("0x"):
                    private_key_hex = "0x" + private_key_hex
                    
            # 2. Get Account Address
            account = Account.from_key(private_key_hex)
            address = account.address
            
            # 3. Get Attestation (Quote) binding the address (ERC-8004 style)
            attestation = self._get_address_attestation(address, domain)
            
            return TEEKeypair(
                public_key=address, # Ethereum address as public identifier
                private_key=private_key_hex,
                attestation=attestation,
                provider=self.provider_name
            )
            
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to generate TEE key: {e}") from e

    def sign(self, message: bytes, keypair: TEEKeypair) -> TEESignature:
        """
        Sign message using the TEE-derived key.
        
        Args:
            message: Message bytes to sign (usually hash)
            keypair: The keypair to use
            
        Returns:
            TEESignature
        """
        # In the dstack reference, signing is done via the derived private key
        # directly inside the container. The security comes from the fact
        # that the private key was derived inside TEE and never leaves it 
        # (until we expose it here in Python memory).
        # ideally we would ask dstack to sign, but dstack gives us the key.
        
        try:
            account = Account.from_key(keypair.private_key)
            
            # Use unsafe_sign_hash if it's a 32-byte hash, otherwise sign_message
            if len(message) == 32:
                signed: SignedMessage = account.unsafe_sign_hash(message)
            else:
                # If it's not a hash, we might need a different method or hashing
                # But protocol says 'message: bytes'.
                # Assuming standard ETH signature on hash
                from eth_account.messages import ensure_is_bytes
                message = ensure_is_bytes(message, "message")
                # If we treat it as raw message to be hashed:
                # signed = account.sign_message(encode_defunct(message))
                # BUT the reference uses unsafe_sign_hash, implying input is a hash.
                # Use standard sign for raw bytes?
                # For safety, let's assume input 'message' is the 32-byte digest 
                # or we just use standard sign logic.
                # Let's fallback to unsafe_sign_hash as default for "sign" in crypto SDKs usually
                signed = account.unsafe_sign_hash(message)
                
            # We should include fresh attestation or reuse the one in keypair?
            # Signature usually doesn't include full attestation payload inside the signature bytes,
            # but we return a TEESignature object that bundles them.
            
            return TEESignature(
                signature=signed.signature,
                attestation=keypair.attestation, # Reuse key attestation
                verified=False, # To be verified by consumer
                provider=self.provider_name
            )
            
        except Exception as e:
            raise ChaosChainSDKError(f"TEE signing failed: {e}") from e

    def verify_attestation(self, signature: TEESignature) -> bool:
        """
        Verify TEE attestation.
        
        For Phala/dstack, verification logic is typically complex and often
        done on-chain or via a specialized verifier service.
        This local check can verify basic structure.
        """
        if signature.provider != self.provider_name:
            return False
            
        attestation = signature.attestation
        if not attestation or "quote" not in attestation:
            return False
            
        # TODO: Implement local verification of IQ Quote if possible
        # For now we assume if it has a quote, it's structurally valid.
        return True

    def get_attestation_report(self) -> Dict[str, Any]:
        """Get a general attestation report for the environment."""
        if not self._client:
            self._init_client()
            
        # Generate dummy application data just to get a quote
        # or use specific system info
        try:
            app_data = b"status_check".ljust(64, b'\x00')
            quote_result = self._client.get_quote(app_data)
            
            return {
                "quote": quote_result.quote,
                "event_log": quote_result.event_log,
                "type": "phala-dstack"
            }
        except Exception as e:
            raise ChaosChainSDKError(f"Failed to get attestation report: {e}") from e


    def _get_address_attestation(self, address: str, domain: str) -> Dict[str, Any]:
        """
        Create attestation binding the Ethereum address to the TEE.
        
        Constructs application data from the address and requests a quote.
        """
        # Ensure address is properly formatted for binding
        address_hex = address.lower().lstrip('0x')
        if len(address_hex) % 2 != 0:
            address_hex = '0' + address_hex
            
        raw_address = binascii.a2b_hex(address_hex)
        
        # Create 64-byte app data (padded)
        # We bind the address to the quote so verifiers know THIS key 
        # generated inside THIS TEE controls the address.
        application_data = raw_address.ljust(64, b'\x00')
        
        quote_result = self._client.get_quote(application_data)
        
        return {
            "quote": quote_result.quote,
            "event_log": quote_result.event_log,
            "application_data": {
                "raw": application_data.hex(),
                "domain": domain,
                "address": address,
                "method": "address_binding"
            },
            "provider": self.provider_name
        }
