"""
Pinata IPFS pinning service storage provider.

Provides reliable IPFS storage through Pinata's managed service.
Excellent reliability and performance for production applications.

Migrated from chaoschain_sdk.storage.pinata_backend to use unified Protocol.
"""

import os
import json
import requests
from typing import Dict, Any, Optional, Tuple, List
from rich import print as rprint

from .base import StorageBackend, StorageResult, StorageProvider


class PinataStorage:
    """
    Pinata IPFS pinning service storage backend.
    
    Implements the unified StorageBackend Protocol for Pinata.
    Requires a Pinata account and JWT token.
    
    Features:
    - Reliable IPFS pinning
    - Global CDN distribution
    - Metadata support
    - Pin management
    
    Get API keys: https://app.pinata.cloud/keys
    """
    
    def __init__(self, jwt_token: Optional[str] = None, gateway_url: Optional[str] = None):
        """
        Initialize Pinata storage.
        
        Args:
            jwt_token: Pinata JWT token (default: PINATA_JWT env var)
            gateway_url: Gateway URL (default: PINATA_GATEWAY env var)
        """
        self.jwt_token = jwt_token or os.getenv("PINATA_JWT")
        self.gateway_url = gateway_url or os.getenv("PINATA_GATEWAY")
        
        # Ensure gateway URL has proper scheme
        if self.gateway_url and not self.gateway_url.startswith(('http://', 'https://')):
            self.gateway_url = f"https://{self.gateway_url}"
        
        self.base_url = "https://api.pinata.cloud"
        
        if self.jwt_token:
            self.headers = {
                "Authorization": f"Bearer {self.jwt_token}",
                "Content-Type": "application/json"
            }
            self._available = self._test_connection()
        else:
            self._available = False
            rprint("[yellow]⚠️  No Pinata JWT token. Set PINATA_JWT env var.[/yellow]")
    
    def _test_connection(self) -> bool:
        """Test connection to Pinata API."""
        if not self.jwt_token:
            return False
        
        try:
            response = requests.get(
                f"{self.base_url}/data/testAuthentication",
                headers=self.headers,
                timeout=10
            )
            if response.status_code == 200:
                rprint(f"[green]✅ Connected to Pinata[/green]")
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
        Store data on Pinata.
        
        Args:
            blob: Data to store
            mime: MIME type (optional)
            tags: Metadata tags (optional)
            idempotency_key: Ignored for Pinata (IPFS is content-addressable)
        
        Returns:
            StorageResult with ipfs:// URI and CID
        """
        if not self.jwt_token:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="ipfs-pinata",
                error="Pinata JWT token required (set PINATA_JWT)"
            )
        
        try:
            # Prepare filename from tags or use default
            filename = tags.get('filename', 'file.bin') if tags else 'file.bin'
            
            # Prepare the file for upload
            files = {
                'file': (filename, blob, mime or 'application/octet-stream')
            }
            
            # Prepare metadata if provided
            data_payload = {}
            if tags:
                pinata_metadata = {
                    "name": filename,
                    "keyvalues": tags
                }
                data_payload['pinataMetadata'] = json.dumps(pinata_metadata)
            
            # Remove Content-Type header for file upload
            upload_headers = {
                "Authorization": f"Bearer {self.jwt_token}"
            }
            
            # Upload to Pinata
            response = requests.post(
                f"{self.base_url}/pinning/pinFileToIPFS",
                files=files,
                data=data_payload,
                headers=upload_headers,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                cid = result.get('IpfsHash')
                size = result.get('PinSize', len(blob))
                timestamp = result.get('Timestamp')
                
                if cid:
                    uri = f"ipfs://{cid}"
                    view_url = f"{self.gateway_url}/ipfs/{cid}" if self.gateway_url else None
                    
                    rprint(f"[green]📁 Uploaded to Pinata: {cid[:12]}...[/green]")
                    
                    return StorageResult(
                        success=True,
                        uri=uri,
                        hash=cid,
                        provider="ipfs-pinata",
                        cid=cid,
                        view_url=view_url,
                        size=size,
                        timestamp=timestamp,
                        metadata=tags
                    )
                else:
                    return StorageResult(
                        success=False,
                        uri="",
                        hash="",
                        provider="ipfs-pinata",
                        error="No CID returned from Pinata"
                    )
            else:
                error_msg = f"Pinata upload failed: {response.status_code}"
                try:
                    error_data = response.json()
                    error_msg = f"{error_msg} - {error_data.get('error', {}).get('details', '')}"
                except:
                    pass
                
                return StorageResult(
                    success=False,
                    uri="",
                    hash="",
                    provider="ipfs-pinata",
                    error=error_msg
                )
        except Exception as e:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="ipfs-pinata",
                error=f"Upload error: {str(e)}"
            )
    
    def get(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from Pinata gateway.
        
        Args:
            uri: IPFS URI (ipfs://Qm... or just the CID)
        
        Returns:
            Tuple of (data bytes, metadata dict)
        """
        cid = uri.replace("ipfs://", "")
        
        if not self.gateway_url:
            # Fallback to public gateway
            url = f"https://gateway.pinata.cloud/ipfs/{cid}"
        else:
            url = f"{self.gateway_url}/ipfs/{cid}"
        
        try:
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                metadata = {
                    'content-type': response.headers.get('Content-Type'),
                    'content-length': response.headers.get('Content-Length'),
                }
                return response.content, metadata
            else:
                raise Exception(f"Failed to retrieve from Pinata: {response.status_code}")
        except Exception as e:
            raise Exception(f"Error retrieving from Pinata: {str(e)}")
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """
        Verify data integrity.
        
        For IPFS, the CID IS the hash, so we just compare CIDs.
        
        Args:
            uri: IPFS URI
            expected_hash: Expected CID
        
        Returns:
            True if CIDs match
        """
        cid = uri.replace("ipfs://", "")
        expected_cid = expected_hash.replace("ipfs://", "")
        return cid == expected_cid
    
    def delete(self, uri: str) -> bool:
        """
        Delete/unpin data from Pinata.
        
        Args:
            uri: IPFS URI
        
        Returns:
            True if unpinned successfully
        """
        if not self.jwt_token:
            return False
        
        cid = uri.replace("ipfs://", "")
        
        try:
            response = requests.delete(
                f"{self.base_url}/pinning/unpin/{cid}",
                headers=self.headers,
                timeout=10
            )
            return response.status_code == 200
        except Exception:
            return False
    
    def pin(self, uri: str, name: Optional[str] = None) -> bool:
        """
        Pin existing content by CID to Pinata.
        
        Args:
            uri: IPFS URI
            name: Optional name for the pin
        
        Returns:
            True if pinned successfully
        """
        if not self.jwt_token:
            return False
        
        cid = uri.replace("ipfs://", "")
        
        try:
            payload = {
                "hashToPin": cid,
                "pinataMetadata": {
                    "name": name or f"Pinned content {cid[:8]}..."
                }
            }
            
            response = requests.post(
                f"{self.base_url}/pinning/pinByHash",
                json=payload,
                headers=self.headers,
                timeout=30
            )
            
            if response.status_code == 200 and name:
                rprint(f"[green]📌 Pinned {name} to Pinata[/green]")
            
            return response.status_code == 200
        except Exception:
            return False
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List pinned content on Pinata.
        
        Args:
            limit: Maximum number of items to return
        
        Returns:
            List of content information dicts
        """
        if not self.jwt_token:
            return []
        
        try:
            params = {"pageLimit": limit}
            response = requests.get(
                f"{self.base_url}/data/pinList",
                params=params,
                headers=self.headers,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                pins = []
                
                for pin in result.get('rows', []):
                    cid = pin.get('ipfs_pin_hash')
                    if cid:
                        pins.append({
                            'cid': cid,
                            'uri': f"ipfs://{cid}",
                            'name': pin.get('metadata', {}).get('name'),
                            'size': pin.get('size'),
                            'timestamp': pin.get('date_pinned'),
                            'gateway_url': f"{self.gateway_url}/ipfs/{cid}" if self.gateway_url else None
                        })
                
                return pins
            return []
        except Exception:
            return []
    
    def get_gateway_url(self, uri: str) -> Optional[str]:
        """
        Get HTTPS gateway URL for viewing content.
        
        Args:
            uri: IPFS URI
        
        Returns:
            Gateway URL
        """
        cid = uri.replace("ipfs://", "")
        if self.gateway_url:
            return f"{self.gateway_url}/ipfs/{cid}"
        else:
            return f"https://gateway.pinata.cloud/ipfs/{cid}"
    
    @property
    def provider_name(self) -> str:
        """Get provider name."""
        return "ipfs-pinata"
    
    @property
    def is_available(self) -> bool:
        """Check if Pinata is available and configured."""
        return self._available
    
    @property
    def is_free(self) -> bool:
        """Pinata is a paid service (has free tier)."""
        return False
    
    @property
    def requires_api_key(self) -> bool:
        """Pinata requires a JWT token."""
        return True

