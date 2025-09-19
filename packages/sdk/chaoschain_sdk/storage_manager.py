"""
Production-ready storage management for ChaosChain agents.

This module provides IPFS storage capabilities for verifiable evidence,
proofs, and other data that needs to be permanently stored and accessible.
"""

import os
import json
import requests
from typing import Dict, Any, Optional, Union, List
from rich.console import Console
from rich import print as rprint

from .types import IPFSHash
from .exceptions import StorageError, ConfigurationError

console = Console()


class StorageManager:
    """
    Production-ready IPFS storage manager for ChaosChain agents.
    
    Handles uploading and retrieving data from IPFS using Pinata as the
    pinning service, with support for JSON data, files, and metadata.
    
    Attributes:
        gateway_url: IPFS gateway URL for retrieving content
        base_url: Pinata API base URL
    """
    
    def __init__(self, jwt_token: str = None, gateway_url: str = None):
        """
        Initialize the storage manager.
        
        Args:
            jwt_token: Pinata JWT token (defaults to PINATA_JWT env var)
            gateway_url: IPFS gateway URL (defaults to PINATA_GATEWAY env var)
        """
        self.jwt_token = jwt_token or os.getenv("PINATA_JWT")
        self.gateway_url = gateway_url or os.getenv("PINATA_GATEWAY")
        
        if not self.jwt_token:
            raise ConfigurationError(
                "Pinata JWT token is required",
                {"required_env_var": "PINATA_JWT"}
            )
        if not self.gateway_url:
            raise ConfigurationError(
                "Pinata gateway URL is required", 
                {"required_env_var": "PINATA_GATEWAY"}
            )
        
        # Ensure gateway URL has proper scheme
        if not self.gateway_url.startswith(('http://', 'https://')):
            self.gateway_url = f"https://{self.gateway_url}"
        
        self.base_url = "https://api.pinata.cloud"
        self.headers = {
            "Authorization": f"Bearer {self.jwt_token}",
            "Content-Type": "application/json"
        }
    
    def upload_json(self, data: Dict[Any, Any], filename: str, 
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """
        Upload JSON data to IPFS and return the CID.
        
        Args:
            data: JSON-serializable data to upload
            filename: Name for the uploaded file
            metadata: Optional metadata for the upload
            
        Returns:
            IPFS CID (Content Identifier) if successful, None otherwise
        """
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
                    rprint(f"[green]📁 Successfully uploaded {filename} to IPFS[/green]")
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
        """
        Upload a file to IPFS and return the CID.
        
        Args:
            file_path: Path to the file to upload
            filename: Optional custom filename (defaults to original filename)
            metadata: Optional metadata for the upload
            
        Returns:
            IPFS CID if successful, None otherwise
        """
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
                        rprint(f"[green]📁 Successfully uploaded {upload_filename} to IPFS[/green]")
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
        """
        Retrieve JSON data from IPFS using the CID.
        
        Args:
            cid: IPFS Content Identifier
            
        Returns:
            Parsed JSON data if successful, None otherwise
        """
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
        """
        Retrieve file data from IPFS using the CID.
        
        Args:
            cid: IPFS Content Identifier
            save_path: Optional path to save the file
            
        Returns:
            File content as bytes, or saved file path if save_path provided
        """
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
    
    def get_clickable_link(self, cid: IPFSHash) -> str:
        """
        Get a clickable IPFS gateway link for a CID.
        
        Args:
            cid: IPFS Content Identifier
            
        Returns:
            Full gateway URL for the content
        """
        return f"{self.gateway_url}/ipfs/{cid}"
    
    def pin_by_cid(self, cid: IPFSHash, name: str = None) -> bool:
        """
        Pin existing content by CID to ensure persistence.
        
        Args:
            cid: IPFS Content Identifier to pin
            name: Optional name for the pinned content
            
        Returns:
            True if successful, False otherwise
        """
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
            
            return response.status_code == 200
            
        except Exception as e:
            rprint(f"[red]❌ Error pinning CID {cid}: {e}[/red]")
            return False
    
    def list_pins(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List pinned content.
        
        Args:
            limit: Maximum number of pins to return
            
        Returns:
            List of pinned content information
        """
        try:
            params = {"pageLimit": limit}
            response = requests.get(
                f"{self.base_url}/data/pinList",
                params=params,
                headers=self.headers,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json().get('rows', [])
            else:
                raise StorageError(f"Failed to list pins: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"Error listing pins: {str(e)}")


# Alias for backward compatibility
class GenesisIPFSManager:
    """Legacy alias for StorageManager."""
    
    def __init__(self):
        self.storage = StorageManager()
