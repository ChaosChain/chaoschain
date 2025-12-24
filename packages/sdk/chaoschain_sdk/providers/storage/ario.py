"""
Ario (AR.IO) storage provider using Turbo Upload service.

AR.IO provides permanent data storage on Arweave via the Turbo Upload service.
Supports both Ethereum and Arweave signers for authentication.

Uses turbo-sdk: https://pypi.org/project/turbo-sdk/

Install: pip install chaoschain-sdk[ario]
"""

import os
from typing import Dict, Any, Optional, Tuple, List

# Get SDK version for tagging uploads
try:
    from chaoschain_sdk import __version__ as SDK_VERSION
except ImportError:
    SDK_VERSION = "0.3.1"

try:
    from turbo_sdk import Turbo, EthereumSigner, ArweaveSigner
    _turbo_available = True
except ImportError:
    _turbo_available = False
    Turbo = None
    EthereumSigner = None
    ArweaveSigner = None

try:
    from rich import print as rprint
except ImportError:
    rprint = print

import requests

from .base import StorageBackend, StorageResult, StorageProvider


class ArioStorage:
    """
    AR.IO storage backend using Turbo Upload service.

    Implements the unified StorageBackend Protocol for AR.IO/Arweave.
    Provides permanent data storage on Arweave via the Turbo service
    with support for both Ethereum and Arweave wallet authentication.

    Features:
    - Permanent data storage on Arweave
    - Ethereum wallet support (ECDSA signatures)
    - Arweave wallet support (RSA-PSS signatures)
    - Fast uploads via Turbo service
    - Gateway URL support for content access

    Learn more: https://ar.io/
    """

    GATEWAY_URL = "https://turbo-gateway.com"

    def __init__(
        self,
        private_key: Optional[str] = None,
        jwk: Optional[Dict[str, Any]] = None,
        network: str = "mainnet",
        gateway_url: Optional[str] = None
    ):
        """
        Initialize AR.IO storage.

        Args:
            private_key: Ethereum private key (hex string, with or without 0x prefix)
            jwk: Arweave JWK wallet (dict)
            network: "mainnet" or "devnet" (default: mainnet)
            gateway_url: Custom gateway URL (optional)

        Note: Provide either private_key (Ethereum) OR jwk (Arweave), not both.
        Environment variables: ARIO_PRIVATE_KEY, ARIO_JWK, ARIO_NETWORK
        """
        if not _turbo_available:
            rprint("[red]❌ turbo-sdk not installed. Run: pip install turbo-sdk[/red]")
            self._available = False
            self._turbo = None
            self._signer = None
            return

        self.network = network or os.getenv("ARIO_NETWORK", "mainnet")
        self.gateway_url = gateway_url or self.GATEWAY_URL

        # Try to get credentials from params or environment
        eth_key = private_key or os.getenv("ARIO_PRIVATE_KEY")
        arweave_jwk = jwk

        # Try loading JWK from environment if not provided
        if not arweave_jwk and os.getenv("ARIO_JWK"):
            import json
            try:
                arweave_jwk = json.loads(os.getenv("ARIO_JWK"))
            except json.JSONDecodeError:
                pass

        # Initialize signer
        self._signer = None
        self._turbo = None
        self._wallet_address = None

        if eth_key:
            try:
                self._signer = EthereumSigner(eth_key)
                self._wallet_address = self._signer.get_wallet_address()
                rprint(f"[green]✅ AR.IO initialized with Ethereum wallet: {self._wallet_address[:10]}...[/green]")
            except Exception as e:
                rprint(f"[red]❌ Failed to initialize Ethereum signer: {e}[/red]")
        elif arweave_jwk:
            try:
                self._signer = ArweaveSigner(arweave_jwk)
                self._wallet_address = self._signer.get_wallet_address()
                rprint(f"[green]✅ AR.IO initialized with Arweave wallet: {self._wallet_address[:10]}...[/green]")
            except Exception as e:
                rprint(f"[red]❌ Failed to initialize Arweave signer: {e}[/red]")
        else:
            rprint("[yellow]⚠️  No AR.IO credentials. Read-only mode. Set ARIO_PRIVATE_KEY or ARIO_JWK.[/yellow]")

        if self._signer:
            try:
                self._turbo = Turbo(self._signer, network=self.network)
                self._available = True
            except Exception as e:
                rprint(f"[red]❌ Failed to initialize Turbo client: {e}[/red]")
                self._available = False
        else:
            self._available = False

    def put(
        self,
        blob: bytes,
        *,
        mime: Optional[str] = None,
        tags: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None
    ) -> StorageResult:
        """
        Store data on Arweave via Turbo.

        Args:
            blob: Data to store
            mime: MIME type (optional)
            tags: Metadata tags (optional)
            idempotency_key: Not used (Turbo handles internally)

        Returns:
            StorageResult with Arweave URI and transaction ID
        """
        if not self._turbo:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="ario",
                error="AR.IO not configured. Set ARIO_PRIVATE_KEY or ARIO_JWK."
            )

        try:
            # Build tags list for Turbo
            upload_tags = [
                {"name": "App-Name", "value": "ChaosChain-SDK"},
                {"name": "App-Version", "value": SDK_VERSION}
            ]

            if mime:
                upload_tags.append({"name": "Content-Type", "value": mime})

            if tags:
                for key, value in tags.items():
                    upload_tags.append({"name": key, "value": str(value)})

            # Upload via Turbo
            result = self._turbo.upload(blob, tags=upload_tags)

            # Extract transaction ID from result
            tx_id = result.id if hasattr(result, 'id') else str(result)

            uri = f"ar://{tx_id}"
            view_url = f"{self.gateway_url}/{tx_id}"

            rprint(f"[green]📁 Uploaded to AR.IO: {tx_id[:16]}...[/green]")

            return StorageResult(
                success=True,
                uri=uri,
                hash=tx_id,
                provider="ario",
                cid=tx_id,
                view_url=view_url,
                size=len(blob),
                metadata=tags
            )
        except Exception as e:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="ario",
                error=f"Upload error: {str(e)}"
            )

    def get(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from Arweave.

        Args:
            uri: Arweave URI (ar://... or just the transaction ID)

        Returns:
            Tuple of (data bytes, metadata dict)
        """
        tx_id = uri.replace("ar://", "")

        try:
            url = f"{self.gateway_url}/{tx_id}"
            response = requests.get(url, timeout=60)

            if response.status_code == 200:
                metadata = {
                    "content-type": response.headers.get("Content-Type"),
                    "content-length": response.headers.get("Content-Length"),
                }
                return response.content, metadata
            else:
                raise Exception(f"Failed to retrieve from Arweave: {response.status_code}")
        except Exception as e:
            raise Exception(f"Error retrieving from Arweave: {str(e)}")

    def verify(self, uri: str, expected_hash: str) -> bool:
        """
        Verify data integrity.

        For Arweave, the transaction ID IS the content hash.

        Args:
            uri: Arweave URI
            expected_hash: Expected transaction ID

        Returns:
            True if transaction IDs match
        """
        tx_id = uri.replace("ar://", "")
        expected_tx_id = expected_hash.replace("ar://", "")
        return tx_id == expected_tx_id

    def delete(self, uri: str) -> bool:
        """
        Delete data from Arweave.

        Note: Arweave data is permanent by design and cannot be deleted.
        This method always returns False.

        Args:
            uri: Arweave URI

        Returns:
            False (deletion not supported)
        """
        rprint("[yellow]⚠️  Arweave data is permanent and cannot be deleted[/yellow]")
        return False

    def pin(self, uri: str, name: Optional[str] = None) -> bool:
        """
        Pin content (not applicable to Arweave - data is permanently stored).

        On Arweave, all uploaded data is permanent by design, so pinning
        is not necessary. This method always returns True for compatibility.

        Args:
            uri: Arweave URI
            name: Optional name (ignored)

        Returns:
            True (always, as data is permanent)
        """
        tx_id = uri.replace("ar://", "")
        rprint(f"[green]📌 Content {tx_id[:16]}... is permanently stored on Arweave[/green]")
        return True

    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List uploaded content.

        Note: Arweave doesn't provide a direct listing API.
        This would require GraphQL queries to arweave.net/graphql.

        Args:
            limit: Maximum number of items to return

        Returns:
            Empty list (not implemented)
        """
        # TODO: Implement via Arweave GraphQL API
        rprint("[yellow]⚠️  Content listing not yet implemented for AR.IO[/yellow]")
        return []

    def get_gateway_url(self, uri: str) -> Optional[str]:
        """
        Get HTTPS gateway URL for viewing content.

        Args:
            uri: Arweave URI

        Returns:
            Gateway URL
        """
        tx_id = uri.replace("ar://", "")
        return f"{self.gateway_url}/{tx_id}"

    def get_balance(self) -> Optional[int]:
        """
        Get Turbo credit balance in Winston.

        Returns:
            Balance in Winston credits, or None if unavailable
        """
        if not self._turbo:
            return None

        try:
            balance = self._turbo.get_balance()
            return balance.winc if hasattr(balance, 'winc') else int(balance)
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to get balance: {e}[/yellow]")
            return None

    def get_upload_price(self, byte_count: int) -> Optional[int]:
        """
        Get the price to upload data of a given size.

        Args:
            byte_count: Size of data in bytes

        Returns:
            Price in Winston credits, or None if unavailable
        """
        if not self._turbo:
            return None

        try:
            price = self._turbo.get_upload_price(byte_count)
            return price.winc if hasattr(price, 'winc') else int(price)
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to get price: {e}[/yellow]")
            return None

    @property
    def provider_name(self) -> str:
        """Get provider name."""
        return f"ario-{self.network}"

    @property
    def is_available(self) -> bool:
        """Check if AR.IO is available and configured."""
        return self._available

    @property
    def is_free(self) -> bool:
        """AR.IO/Turbo requires payment for storage."""
        return False

    @property
    def requires_api_key(self) -> bool:
        """AR.IO requires a wallet (private key or JWK) for uploads."""
        return True

    @property
    def wallet_address(self) -> Optional[str]:
        """Get the configured wallet address."""
        return self._wallet_address
