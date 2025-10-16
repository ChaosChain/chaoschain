"""
Local IPFS node storage provider.

Connects directly to a local IPFS node, providing free storage without
any third-party service dependencies. Perfect for developers who want
full control over their storage infrastructure.

Migrated from chaoschain_sdk.storage.local_ipfs to use unified Protocol.
"""

import os
import json
import hashlib
import requests
from typing import Dict, Any, Optional, Tuple, List
from rich import print as rprint

from .base import StorageBackend, StorageResult, StorageProvider


class LocalIPFSStorage:
    """
    Local IPFS node storage backend.
    
    Implements the unified StorageBackend Protocol for local IPFS nodes.
    Connects to IPFS HTTP API (default: http://127.0.0.1:5001).
    
    Features:
    - Free, no API keys required
    - Full control over storage
    - Content-addressable storage via CID
    - Auto-pinning on upload
    
    Requirements:
    - Running IPFS daemon
    - Quick setup: brew install ipfs && ipfs init && ipfs daemon
    """
    
    def __init__(self, api_url: Optional[str] = None, gateway_url: Optional[str] = None):
        """
        Initialize local IPFS storage.
        
        Args:
            api_url: IPFS API URL (default: http://127.0.0.1:5001)
            gateway_url: IPFS gateway URL (default: http://127.0.0.1:8080)
        """
        self.api_url = api_url or os.getenv("IPFS_API_URL", "http://127.0.0.1:5001")
        self.gateway_url = gateway_url or os.getenv("IPFS_GATEWAY_URL", "http://127.0.0.1:8080")
        self._available = None  # Lazy check on first use
        self._check_attempted = False
    
    def _test_connection(self) -> bool:
        """Test connection to local IPFS node (fast, non-blocking)."""
        try:
            response = requests.get(f"{self.api_url}/api/v0/version", timeout=0.5)
            if response.status_code == 200:
                version_info = response.json()
                rprint(f"[green]✅ Connected to IPFS node v{version_info.get('Version', 'unknown')}[/green]")
                return True
            return False
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            # IPFS daemon not running - fail silently
            return False
        except Exception:
            # Other errors - also fail silently
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
        Store data on local IPFS node.
        
        Args:
            blob: Data to store
            mime: MIME type (optional)
            tags: Metadata tags (optional)
            idempotency_key: Ignored for IPFS (content-addressable)
        
        Returns:
            StorageResult with ipfs:// URI and CID
        """
        try:
            # Prepare filename from tags or use default
            filename = tags.get('filename', 'file.bin') if tags else 'file.bin'
            
            # Upload to IPFS
            files = {'file': (filename, blob, mime or 'application/octet-stream')}
            response = requests.post(
                f"{self.api_url}/api/v0/add",
                files=files,
                params={'pin': 'true'},  # Auto-pin uploaded content
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                cid = result.get('Hash')
                size = result.get('Size', len(blob))
                
                if cid:
                    uri = f"ipfs://{cid}"
                    view_url = f"{self.gateway_url}/ipfs/{cid}"
                    
                    rprint(f"[green]📁 Uploaded to local IPFS: {cid[:12]}...[/green]")
                    
                    return StorageResult(
                        success=True,
                        uri=uri,
                        hash=cid,  # CID is the hash for IPFS
                        provider="ipfs-local",
                        cid=cid,
                        view_url=view_url,
                        size=size,
                        metadata=tags
                    )
                else:
                    return StorageResult(
                        success=False,
                        uri="",
                        hash="",
                        provider="ipfs-local",
                        error="No CID returned from IPFS"
                    )
            else:
                return StorageResult(
                    success=False,
                    uri="",
                    hash="",
                    provider="ipfs-local",
                    error=f"IPFS upload failed: {response.status_code}"
                )
        except Exception as e:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider="ipfs-local",
                error=f"Upload error: {str(e)}"
            )
    
    def get(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from local IPFS node.
        
        Args:
            uri: IPFS URI (ipfs://Qm... or just the CID)
        
        Returns:
            Tuple of (data bytes, metadata dict)
        """
        # Extract CID from URI
        cid = uri.replace("ipfs://", "")
        
        try:
            url = f"{self.gateway_url}/ipfs/{cid}"
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                # Try to extract metadata from headers
                metadata = {
                    'content-type': response.headers.get('Content-Type'),
                    'content-length': response.headers.get('Content-Length'),
                }
                return response.content, metadata
            else:
                raise Exception(f"Failed to retrieve from IPFS: {response.status_code}")
        except Exception as e:
            raise Exception(f"Error retrieving from IPFS: {str(e)}")
    
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
        Delete/unpin data from local IPFS node.
        
        Note: This unpins the content but doesn't remove it from IPFS.
        Garbage collection is handled by IPFS daemon.
        
        Args:
            uri: IPFS URI
        
        Returns:
            True if unpinned successfully
        """
        cid = uri.replace("ipfs://", "")
        
        try:
            response = requests.post(
                f"{self.api_url}/api/v0/pin/rm",
                params={'arg': cid},
                timeout=10
            )
            return response.status_code == 200
        except Exception:
            return False
    
    def pin(self, uri: str, name: Optional[str] = None) -> bool:
        """
        Pin content to local IPFS node.
        
        Args:
            uri: IPFS URI
            name: Optional name for the pin (not used by IPFS HTTP API)
        
        Returns:
            True if pinned successfully
        """
        cid = uri.replace("ipfs://", "")
        
        try:
            response = requests.post(
                f"{self.api_url}/api/v0/pin/add",
                params={'arg': cid},
                timeout=30
            )
            
            if response.status_code == 200 and name:
                rprint(f"[green]📌 Pinned {name} ({cid[:12]}...)[/green]")
            
            return response.status_code == 200
        except Exception:
            return False
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List pinned content on local IPFS node.
        
        Args:
            limit: Maximum number of items to return
        
        Returns:
            List of content information dicts
        """
        try:
            response = requests.post(
                f"{self.api_url}/api/v0/pin/ls",
                params={'type': 'recursive'},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                pins = []
                
                for cid, pin_info in result.get('Keys', {}).items():
                    pins.append({
                        'cid': cid,
                        'uri': f"ipfs://{cid}",
                        'type': pin_info.get('Type', 'unknown'),
                        'gateway_url': f"{self.gateway_url}/ipfs/{cid}"
                    })
                    
                    if len(pins) >= limit:
                        break
                
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
        return f"{self.gateway_url}/ipfs/{cid}"
    
    @property
    def provider_name(self) -> str:
        """Get provider name."""
        return "ipfs-local"
    
    @property
    def is_available(self) -> bool:
        """Check if local IPFS node is available."""
        return self._available
    
    @property
    def is_free(self) -> bool:
        """Local IPFS is completely free."""
        return True
    
    @property
    def requires_api_key(self) -> bool:
        """Local IPFS doesn't require API keys."""
        return False

