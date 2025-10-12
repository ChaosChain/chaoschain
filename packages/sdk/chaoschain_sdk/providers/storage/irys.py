"""
Irys programmable datachain storage provider.

Irys is the world's first programmable datachain that incentivizes storage.
Provides permanent data uploads with programmable data capabilities.

Migrated from chaoschain_sdk.storage.irys_backend to use unified Protocol.
"""

import os
import json
import requests
from typing import Dict, Any, Optional, Tuple, List
from rich import print as rprint

from .base import StorageBackend, StorageResult, StorageProvider


class IrysStorage:
    """
    Irys programmable datachain storage backend.
    
    Implements the unified StorageBackend Protocol for Irys.
    Provides permanent data storage on Irys datachain with programmable
    data capabilities. Supports both testnet and mainnet deployments.
    
    Features:
    - Permanent data uploads
    - Programmable data (smart contracts can access/manipulate data)
    - Composable storage layer
    - Native data validation and evolution
    
    Learn more: https://docs.irys.xyz/build/welcome-builders
    """
    
    def __init__(
        self,
        network: str = "testnet",
        wallet_key: Optional[str] = None,
        gateway_url: Optional[str] = None
    ):
        """
        Initialize Irys storage.
        
        Args:
            network: "testnet" or "mainnet" (default: testnet)
            wallet_key: Private key for signing transactions
            gateway_url: Custom gateway URL (optional)
        """
        self.network = network
        self.wallet_key = wallet_key or os.getenv("IRYS_WALLET_KEY")
        
        # Set network endpoints
        if network == "mainnet":
            self.api_url = "https://node1.irys.xyz"
            self.gateway_url = gateway_url or "https://gateway.irys.xyz"
        else:  # testnet
            self.api_url = "https://devnet.irys.xyz"
            self.gateway_url = gateway_url or "https://gateway.irys.xyz"
        
        if not self.wallet_key:
            rprint("[yellow]⚠️  No Irys wallet key. Read-only mode. Set IRYS_WALLET_KEY for uploads.[/yellow]")
            self._available = False
        else:
            self._available = self._test_connection()
    
    def _test_connection(self) -> bool:
        """Test connection to Irys network."""
        try:
            response = requests.get(f"{self.api_url}/info", timeout=10)
            if response.status_code == 200:
                info = response.json()
                rprint(f"[green]✅ Connected to Irys {self.network}[/green]")
                return True
            return False
        except Exception:
            return False
    
    def put(
        self,
        blob: bytes,
        *,
        mime: Optional[str] = None,
        tags: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None
    ) -> StorageResult:
        """
        Store data on Irys datachain.
        
        Args:
            blob: Data to store
            mime: MIME type (optional)
            tags: Metadata tags (optional)
            idempotency_key: Not used (Irys handles this internally)
        
        Returns:
            StorageResult with Irys URI and transaction ID
        """
        if not self.wallet_key:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="irys",
                error="Wallet key required for uploads (set IRYS_WALLET_KEY)"
            )
        
        try:
            # Prepare filename from tags or use default
            filename = tags.get('filename', 'file.bin') if tags else 'file.bin'
            
            # Prepare upload with binary data
            files = {'file': (filename, blob, mime or 'application/octet-stream')}
            
            # Prepare tags
            upload_tags = [
                {'name': 'filename', 'value': filename},
                {'name': 'App-Name', 'value': 'ChaosChain-SDK'},
                {'name': 'App-Version', 'value': '0.1.2'}
            ]
            
            if mime:
                upload_tags.append({'name': 'Content-Type', 'value': mime})
            
            if tags:
                for key, value in tags.items():
                    if key != 'filename':  # Already added
                        upload_tags.append({
                            'name': f'metadata-{key}',
                            'value': str(value)
                        })
            
            # Upload to Irys
            headers = {'Authorization': f'Bearer {self.wallet_key}'}
            data = {'tags': json.dumps(upload_tags)}
            
            response = requests.post(
                f"{self.api_url}/tx",
                files=files,
                data=data,
                headers=headers,
                timeout=60
            )
            
            if response.status_code == 200:
                result = response.json()
                tx_id = result.get('id')
                
                if tx_id:
                    uri = f"ar://{tx_id}"  # Arweave-compatible URI scheme
                    view_url = f"{self.gateway_url}/{tx_id}"
                    
                    rprint(f"[green]📁 Uploaded to Irys: {tx_id[:12]}...[/green]")
                    
                    return StorageResult(
                        success=True,
                        uri=uri,
                        hash=tx_id,  # Transaction ID serves as hash
                        provider="irys",
                        cid=tx_id,
                        view_url=view_url,
                        size=len(blob),
                        metadata=tags
                    )
                else:
                    return StorageResult(
                        success=False,
                        uri="",
                        hash="",
                        provider="irys",
                        error="No transaction ID returned from Irys"
                    )
            else:
                return StorageResult(
                    success=False,
                    uri="",
                    hash="",
                    provider="irys",
                    error=f"Irys upload failed: {response.status_code}"
                )
        except Exception as e:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="irys",
                error=f"Upload error: {str(e)}"
            )
    
    def get(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from Irys datachain.
        
        Args:
            uri: Irys URI (ar://... or just the transaction ID)
        
        Returns:
            Tuple of (data bytes, metadata dict)
        """
        # Extract transaction ID from URI
        tx_id = uri.replace("ar://", "")
        
        try:
            url = f"{self.gateway_url}/{tx_id}"
            response = requests.get(url, timeout=60)
            
            if response.status_code == 200:
                metadata = {
                    'content-type': response.headers.get('Content-Type'),
                    'content-length': response.headers.get('Content-Length'),
                }
                return response.content, metadata
            else:
                raise Exception(f"Failed to retrieve from Irys: {response.status_code}")
        except Exception as e:
            raise Exception(f"Error retrieving from Irys: {str(e)}")
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """
        Verify data integrity.
        
        For Irys, the transaction ID IS the hash.
        
        Args:
            uri: Irys URI
            expected_hash: Expected transaction ID
        
        Returns:
            True if transaction IDs match
        """
        tx_id = uri.replace("ar://", "")
        expected_tx_id = expected_hash.replace("ar://", "")
        return tx_id == expected_tx_id
    
    def delete(self, uri: str) -> bool:
        """
        Delete data from Irys.
        
        Note: Irys data is permanent by design and cannot be deleted.
        This method always returns False.
        
        Args:
            uri: Irys URI
        
        Returns:
            False (deletion not supported)
        """
        rprint("[yellow]⚠️  Irys data is permanent and cannot be deleted[/yellow]")
        return False
    
    def pin(self, uri: str, name: Optional[str] = None) -> bool:
        """
        Pin content (not applicable to Irys - data is permanently stored).
        
        On Irys, all uploaded data is permanent by design, so pinning
        is not necessary. This method always returns True for compatibility.
        
        Args:
            uri: Irys URI
            name: Optional name (ignored)
        
        Returns:
            True (always, as data is permanent)
        """
        tx_id = uri.replace("ar://", "")
        rprint(f"[green]📌 Content {tx_id[:12]}... is permanently stored on Irys[/green]")
        return True
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List uploaded content (requires wallet key).
        
        Args:
            limit: Maximum number of items to return
        
        Returns:
            List of content information dicts
        """
        if not self.wallet_key:
            return []
        
        try:
            # Query transactions by wallet address
            headers = {'Authorization': f'Bearer {self.wallet_key}'}
            params = {'limit': limit}
            
            response = requests.get(
                f"{self.api_url}/account/transactions",
                headers=headers,
                params=params,
                timeout=30
            )
            
            if response.status_code == 200:
                transactions = response.json()
                content_list = []
                
                for tx in transactions.get('transactions', []):
                    tx_id = tx.get('id')
                    if tx_id:
                        content_list.append({
                            'cid': tx_id,
                            'uri': f"ar://{tx_id}",
                            'timestamp': tx.get('timestamp'),
                            'size': tx.get('data_size'),
                            'gateway_url': f"{self.gateway_url}/{tx_id}",
                            'tags': tx.get('tags', [])
                        })
                
                return content_list
            return []
        except Exception:
            return []
    
    def get_gateway_url(self, uri: str) -> Optional[str]:
        """
        Get HTTPS gateway URL for viewing content.
        
        Args:
            uri: Irys URI
        
        Returns:
            Gateway URL
        """
        tx_id = uri.replace("ar://", "")
        return f"{self.gateway_url}/{tx_id}"
    
    @property
    def provider_name(self) -> str:
        """Get provider name."""
        return f"irys-{self.network}"
    
    @property
    def is_available(self) -> bool:
        """Check if Irys is available and configured."""
        return self._available
    
    @property
    def is_free(self) -> bool:
        """Irys requires payment for storage."""
        return False
    
    @property
    def requires_api_key(self) -> bool:
        """Irys requires a wallet key for uploads."""
        return True

