"""
Local IPFS node storage backend.

This backend connects directly to a local IPFS node, providing free storage
without any third-party service dependencies. Perfect for developers who want
full control over their storage infrastructure.
"""

import os
import json
import requests
from typing import Dict, Any, Optional, Union, List
from rich.console import Console
from rich import print as rprint

from .base import StorageBackend, StorageProvider
from ..types import IPFSHash
from ..exceptions import StorageError, ConfigurationError

console = Console()


class LocalIPFSBackend(StorageBackend):
    """
    Local IPFS node storage backend.
    
    Connects directly to a local IPFS node API, providing free storage
    without vendor dependencies. Requires a running IPFS node.
    
    Default IPFS API: http://127.0.0.1:5001
    Default Gateway: http://127.0.0.1:8080
    """
    
    def __init__(self, api_url: str = None, gateway_url: str = None):
        """
        Initialize local IPFS backend.
        
        Args:
            api_url: IPFS API URL (defaults to http://127.0.0.1:5001)
            gateway_url: IPFS gateway URL (defaults to http://127.0.0.1:8080)
        """
        self.api_url = api_url or os.getenv("IPFS_API_URL", "http://127.0.0.1:5001")
        self.gateway_url = gateway_url or os.getenv("IPFS_GATEWAY_URL", "http://127.0.0.1:8080")
        
        # Test connection to IPFS node
        self._test_connection()
    
    def _test_connection(self) -> None:
        """Test connection to local IPFS node."""
        try:
            response = requests.get(f"{self.api_url}/api/v0/version", timeout=5)
            if response.status_code == 200:
                version_info = response.json()
                rprint(f"[green]✅ Connected to IPFS node v{version_info.get('Version', 'unknown')}[/green]")
            else:
                raise StorageError(f"IPFS node returned status {response.status_code}")
        except requests.RequestException as e:
            raise ConfigurationError(
                f"Cannot connect to local IPFS node at {self.api_url}",
                {
                    "error": str(e),
                    "quick_setup": "brew install ipfs && ipfs init && ipfs daemon",
                    "solution": "Start IPFS daemon with: ipfs daemon",
                    "install_guide": "https://docs.ipfs.tech/install/",
                    "alternative": "Set PINATA_JWT env var for cloud storage instead"
                }
            )
    
    def upload_json(self, data: Dict[Any, Any], filename: str, 
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """Upload JSON data to local IPFS node."""
        try:
            # Convert data to JSON string
            json_content = json.dumps(data, indent=2, default=str)
            
            # Upload to IPFS
            files = {'file': (filename, json_content, 'application/json')}
            response = requests.post(
                f"{self.api_url}/api/v0/add",
                files=files,
                params={'pin': 'true'},  # Auto-pin uploaded content
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                cid = result.get('Hash')
                
                if cid:
                    rprint(f"[green]📁 Successfully uploaded {filename} to local IPFS[/green]")
                    rprint(f"   CID: {cid}")
                    rprint(f"   Gateway URL: {self.gateway_url}/ipfs/{cid}")
                    
                    # Add metadata if provided
                    if metadata:
                        self._add_metadata(cid, metadata)
                    
                    return cid
                else:
                    raise StorageError("No CID returned from IPFS")
            else:
                raise StorageError(f"IPFS upload failed: {response.status_code}")
                
        except requests.RequestException as e:
            raise StorageError(f"Network error during IPFS upload: {str(e)}")
        except json.JSONEncodeError as e:
            raise StorageError(f"JSON serialization error: {str(e)}")
        except Exception as e:
            raise StorageError(f"Unexpected error during IPFS upload: {str(e)}")
    
    def upload_file(self, file_path: str, filename: str = None,
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """Upload a file to local IPFS node."""
        try:
            if not os.path.exists(file_path):
                raise StorageError(f"File not found: {file_path}")
            
            upload_filename = filename or os.path.basename(file_path)
            
            with open(file_path, 'rb') as file:
                files = {'file': (upload_filename, file)}
                response = requests.post(
                    f"{self.api_url}/api/v0/add",
                    files=files,
                    params={'pin': 'true'},
                    timeout=60
                )
                
                if response.status_code == 200:
                    result = response.json()
                    cid = result.get('Hash')
                    
                    if cid:
                        rprint(f"[green]📁 Successfully uploaded {upload_filename} to local IPFS[/green]")
                        rprint(f"   CID: {cid}")
                        
                        if metadata:
                            self._add_metadata(cid, metadata)
                        
                        return cid
                    else:
                        raise StorageError("No CID returned from IPFS")
                else:
                    raise StorageError(f"IPFS file upload failed: {response.status_code}")
                    
        except Exception as e:
            raise StorageError(f"File upload error: {str(e)}")
    
    def retrieve_json(self, cid: IPFSHash) -> Optional[Dict[Any, Any]]:
        """Retrieve JSON data from local IPFS node."""
        try:
            url = f"{self.gateway_url}/ipfs/{cid}"
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                return response.json()
            else:
                raise StorageError(f"Failed to retrieve data from IPFS: {response.status_code}")
                
        except requests.RequestException as e:
            raise StorageError(f"Network error retrieving from IPFS: {str(e)}")
        except json.JSONDecodeError as e:
            raise StorageError(f"Invalid JSON data from IPFS: {str(e)}")
        except Exception as e:
            raise StorageError(f"Unexpected error retrieving from IPFS: {str(e)}")
    
    def retrieve_file(self, cid: IPFSHash, save_path: str = None) -> Union[bytes, str]:
        """Retrieve file data from local IPFS node."""
        try:
            url = f"{self.gateway_url}/ipfs/{cid}"
            response = requests.get(url, timeout=60)
            
            if response.status_code == 200:
                if save_path:
                    with open(save_path, 'wb') as f:
                        f.write(response.content)
                    return save_path
                else:
                    return response.content
            else:
                raise StorageError(f"Failed to retrieve file from IPFS: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"File retrieval error: {str(e)}")
    
    def get_gateway_url(self, cid: IPFSHash) -> str:
        """Get gateway URL for content."""
        return f"{self.gateway_url}/ipfs/{cid}"
    
    def pin_content(self, cid: IPFSHash, name: str = None) -> bool:
        """Pin content to local IPFS node."""
        try:
            response = requests.post(
                f"{self.api_url}/api/v0/pin/add",
                params={'arg': cid},
                timeout=30
            )
            
            success = response.status_code == 200
            if success and name:
                rprint(f"[green]📌 Pinned {name} ({cid[:8]}...)[/green]")
            
            return success
            
        except Exception as e:
            rprint(f"[red]❌ Error pinning CID {cid}: {e}[/red]")
            return False
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List pinned content on local IPFS node."""
        try:
            response = requests.post(
                f"{self.api_url}/api/v0/pin/ls",
                params={'type': 'recursive'},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                pins = []
                
                # Convert IPFS pin format to our standard format
                for cid, pin_info in result.get('Keys', {}).items():
                    pins.append({
                        'cid': cid,
                        'type': pin_info.get('Type', 'unknown'),
                        'gateway_url': self.get_gateway_url(cid)
                    })
                    
                    if len(pins) >= limit:
                        break
                
                return pins
            else:
                raise StorageError(f"Failed to list pins: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"Error listing pins: {str(e)}")
    
    def _add_metadata(self, cid: IPFSHash, metadata: Dict[str, Any]) -> None:
        """Add metadata to uploaded content (stored locally)."""
        # For local IPFS, we can store metadata in a separate file
        # This is optional and doesn't affect the core functionality
        try:
            metadata_content = {
                'cid': cid,
                'metadata': metadata,
                'timestamp': json.dumps(None, default=str)  # Current timestamp
            }
            
            metadata_json = json.dumps(metadata_content, indent=2)
            files = {'file': (f"{cid}_metadata.json", metadata_json, 'application/json')}
            
            requests.post(
                f"{self.api_url}/api/v0/add",
                files=files,
                params={'pin': 'true'},
                timeout=10
            )
        except Exception:
            # Metadata storage is optional, don't fail the main operation
            pass
    
    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "Local IPFS"
    
    @property
    def is_free(self) -> bool:
        """Local IPFS is completely free."""
        return True
    
    @property
    def requires_api_key(self) -> bool:
        """Local IPFS doesn't require API keys."""
        return False
