"""
Pinata IPFS pinning service backend.

This backend uses Pinata's IPFS pinning service for reliable storage.
While not free, it provides excellent reliability and performance for
production applications that need guaranteed uptime.
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


class PinataBackend(StorageBackend):
    """
    Pinata IPFS pinning service backend.
    
    Provides reliable IPFS storage through Pinata's managed service.
    Requires a Pinata account and JWT token.
    
    Features:
    - Reliable IPFS pinning
    - Global CDN distribution
    - Metadata support
    - Pin management
    """
    
    def __init__(self, jwt_token: str = None, gateway_url: str = None):
        """
        Initialize Pinata backend.
        
        Args:
            jwt_token: Pinata JWT token (defaults to PINATA_JWT env var)
            gateway_url: IPFS gateway URL (defaults to PINATA_GATEWAY env var)
        """
        self.jwt_token = jwt_token or os.getenv("PINATA_JWT")
        self.gateway_url = gateway_url or os.getenv("PINATA_GATEWAY")
        
        if not self.jwt_token:
            raise ConfigurationError(
                "Pinata JWT token is required",
                {
                    "required_env_var": "PINATA_JWT",
                    "get_token": "https://app.pinata.cloud/keys"
                }
            )
        if not self.gateway_url:
            raise ConfigurationError(
                "Pinata gateway URL is required", 
                {
                    "required_env_var": "PINATA_GATEWAY",
                    "example": "https://gateway.pinata.cloud"
                }
            )
        
        # Ensure gateway URL has proper scheme
        if not self.gateway_url.startswith(('http://', 'https://')):
            self.gateway_url = f"https://{self.gateway_url}"
        
        self.base_url = "https://api.pinata.cloud"
        self.headers = {
            "Authorization": f"Bearer {self.jwt_token}",
            "Content-Type": "application/json"
        }
        
        self._test_connection()
    
    def _test_connection(self) -> None:
        """Test connection to Pinata API."""
        try:
            response = requests.get(
                f"{self.base_url}/data/testAuthentication",
                headers=self.headers,
                timeout=10
            )
            if response.status_code == 200:
                result = response.json()
                rprint(f"[green]✅ Connected to Pinata[/green]")
                rprint(f"   Message: {result.get('message', 'Authentication successful')}")
            else:
                raise StorageError(f"Pinata authentication failed: {response.status_code}")
        except requests.RequestException as e:
            raise ConfigurationError(
                f"Cannot connect to Pinata API",
                {
                    "error": str(e),
                    "check_token": "Verify your PINATA_JWT token is valid"
                }
            )
    
    def upload_json(self, data: Dict[Any, Any], filename: str, 
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """Upload JSON data to Pinata."""
        try:
            # Convert data to JSON string
            json_content = json.dumps(data, indent=2, default=str)
            
            # Prepare the file for upload
            files = {
                'file': (filename, json_content, 'application/json')
            }
            
            # Prepare metadata if provided
            pinata_metadata = {}
            if metadata:
                pinata_metadata = {
                    "name": filename,
                    "keyvalues": metadata
                }
            
            # Remove Content-Type header for file upload
            upload_headers = {
                "Authorization": f"Bearer {self.jwt_token}"
            }
            
            # Add metadata to the request if provided
            data_payload = {}
            if pinata_metadata:
                data_payload['pinataMetadata'] = json.dumps(pinata_metadata)
            
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
                
                if cid:
                    rprint(f"[green]📁 Successfully uploaded {filename} to Pinata[/green]")
                    rprint(f"   CID: {cid}")
                    rprint(f"   Gateway URL: {self.gateway_url}/ipfs/{cid}")
                    return cid
                else:
                    raise StorageError("No CID returned from Pinata")
            else:
                raise StorageError(
                    f"Pinata upload failed: {response.status_code}",
                    {"response": response.text}
                )
                
        except requests.RequestException as e:
            raise StorageError(f"Network error during upload: {str(e)}")
        except json.JSONEncodeError as e:
            raise StorageError(f"JSON serialization error: {str(e)}")
        except Exception as e:
            raise StorageError(f"Unexpected error during upload: {str(e)}")
    
    def upload_file(self, file_path: str, filename: str = None,
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """Upload a file to Pinata."""
        try:
            if not os.path.exists(file_path):
                raise StorageError(f"File not found: {file_path}")
            
            upload_filename = filename or os.path.basename(file_path)
            
            with open(file_path, 'rb') as file:
                files = {
                    'file': (upload_filename, file, 'application/octet-stream')
                }
                
                # Prepare metadata if provided
                pinata_metadata = {}
                if metadata:
                    pinata_metadata = {
                        "name": upload_filename,
                        "keyvalues": metadata
                    }
                
                upload_headers = {
                    "Authorization": f"Bearer {self.jwt_token}"
                }
                
                data_payload = {}
                if pinata_metadata:
                    data_payload['pinataMetadata'] = json.dumps(pinata_metadata)
                
                response = requests.post(
                    f"{self.base_url}/pinning/pinFileToIPFS",
                    files=files,
                    data=data_payload,
                    headers=upload_headers,
                    timeout=60
                )
                
                if response.status_code == 200:
                    result = response.json()
                    cid = result.get('IpfsHash')
                    
                    if cid:
                        rprint(f"[green]📁 Successfully uploaded {upload_filename} to Pinata[/green]")
                        rprint(f"   CID: {cid}")
                        return cid
                    else:
                        raise StorageError("No CID returned from Pinata")
                else:
                    raise StorageError(
                        f"File upload failed: {response.status_code}",
                        {"response": response.text}
                    )
                    
        except Exception as e:
            raise StorageError(f"File upload error: {str(e)}")
    
    def retrieve_json(self, cid: IPFSHash) -> Optional[Dict[Any, Any]]:
        """Retrieve JSON data from Pinata gateway."""
        try:
            url = f"{self.gateway_url}/ipfs/{cid}"
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                return response.json()
            else:
                raise StorageError(
                    f"Failed to retrieve data from IPFS: {response.status_code}",
                    {"cid": cid, "url": url}
                )
                
        except requests.RequestException as e:
            raise StorageError(f"Network error retrieving from IPFS: {str(e)}")
        except json.JSONDecodeError as e:
            raise StorageError(f"Invalid JSON data from IPFS: {str(e)}")
        except Exception as e:
            raise StorageError(f"Unexpected error retrieving from IPFS: {str(e)}")
    
    def retrieve_file(self, cid: IPFSHash, save_path: str = None) -> Union[bytes, str]:
        """Retrieve file data from Pinata gateway."""
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
                raise StorageError(
                    f"Failed to retrieve file from IPFS: {response.status_code}",
                    {"cid": cid, "url": url}
                )
                
        except Exception as e:
            raise StorageError(f"File retrieval error: {str(e)}")
    
    def get_gateway_url(self, cid: IPFSHash) -> str:
        """Get Pinata gateway URL for content."""
        return f"{self.gateway_url}/ipfs/{cid}"
    
    def pin_content(self, cid: IPFSHash, name: str = None) -> bool:
        """Pin existing content by CID to Pinata."""
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
            
            success = response.status_code == 200
            if success and name:
                rprint(f"[green]📌 Pinned {name} to Pinata[/green]")
            
            return success
            
        except Exception as e:
            rprint(f"[red]❌ Error pinning CID {cid}: {e}[/red]")
            return False
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List pinned content on Pinata."""
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
                    pins.append({
                        'cid': pin.get('ipfs_pin_hash'),
                        'name': pin.get('metadata', {}).get('name'),
                        'size': pin.get('size'),
                        'timestamp': pin.get('date_pinned'),
                        'gateway_url': self.get_gateway_url(pin.get('ipfs_pin_hash'))
                    })
                
                return pins
            else:
                raise StorageError(f"Failed to list pins: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"Error listing pins: {str(e)}")
    
    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "Pinata"
    
    @property
    def is_free(self) -> bool:
        """Pinata is a paid service."""
        return False
    
    @property
    def requires_api_key(self) -> bool:
        """Pinata requires a JWT token."""
        return True
