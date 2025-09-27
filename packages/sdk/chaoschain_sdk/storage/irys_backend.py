"""
Irys programmable datachain storage backend.

Irys is the world's first programmable datachain that incentivizes storage.
It provides permanent data uploads with programmable data capabilities,
making it ideal for verifiable agent evidence and marketplace data.

Based on: https://docs.irys.xyz/build/welcome-builders
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


class IrysBackend(StorageBackend):
    """
    Irys programmable datachain storage backend.
    
    Provides permanent data storage on Irys datachain with programmable
    data capabilities. Supports both testnet and mainnet deployments.
    
    Features:
    - Permanent data uploads
    - Programmable data (smart contracts can access/manipulate data)
    - Composable storage layer
    - Native data validation and evolution
    """
    
    def __init__(self, network: str = "testnet", wallet_key: str = None, 
                 gateway_url: str = None):
        """
        Initialize Irys backend.
        
        Args:
            network: "testnet" or "mainnet" (defaults to testnet)
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
            rprint("[yellow]⚠️  No Irys wallet key provided. Read-only mode enabled.[/yellow]")
            rprint("   Set IRYS_WALLET_KEY environment variable for uploads.")
        
        self._test_connection()
    
    def _test_connection(self) -> None:
        """Test connection to Irys network."""
        try:
            response = requests.get(f"{self.api_url}/info", timeout=10)
            if response.status_code == 200:
                info = response.json()
                rprint(f"[green]✅ Connected to Irys {self.network}[/green]")
                rprint(f"   Network: {info.get('network', 'unknown')}")
            else:
                raise StorageError(f"Irys node returned status {response.status_code}")
        except requests.RequestException as e:
            raise ConfigurationError(
                f"Cannot connect to Irys {self.network} at {self.api_url}",
                {
                    "error": str(e),
                    "network": self.network,
                    "docs": "https://docs.irys.xyz/build/welcome-builders"
                }
            )
    
    def upload_json(self, data: Dict[Any, Any], filename: str, 
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """Upload JSON data to Irys datachain."""
        if not self.wallet_key:
            raise ConfigurationError(
                "Wallet key required for uploads",
                {"required_env_var": "IRYS_WALLET_KEY"}
            )
        
        try:
            # Convert data to JSON string
            json_content = json.dumps(data, indent=2, default=str)
            
            # Prepare upload payload
            upload_data = {
                'data': json_content,
                'tags': [
                    {'name': 'Content-Type', 'value': 'application/json'},
                    {'name': 'filename', 'value': filename},
                    {'name': 'App-Name', 'value': 'ChaosChain-SDK'},
                    {'name': 'App-Version', 'value': '0.1.2'}
                ]
            }
            
            # Add metadata as tags
            if metadata:
                for key, value in metadata.items():
                    upload_data['tags'].append({
                        'name': f'metadata-{key}',
                        'value': str(value)
                    })
            
            # Upload to Irys
            headers = {
                'Authorization': f'Bearer {self.wallet_key}',
                'Content-Type': 'application/json'
            }
            
            response = requests.post(
                f"{self.api_url}/tx",
                json=upload_data,
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                tx_id = result.get('id')
                
                if tx_id:
                    rprint(f"[green]📁 Successfully uploaded {filename} to Irys[/green]")
                    rprint(f"   Transaction ID: {tx_id}")
                    rprint(f"   Gateway URL: {self.gateway_url}/{tx_id}")
                    return tx_id
                else:
                    raise StorageError("No transaction ID returned from Irys")
            else:
                raise StorageError(f"Irys upload failed: {response.status_code}")
                
        except requests.RequestException as e:
            raise StorageError(f"Network error during Irys upload: {str(e)}")
        except json.JSONEncodeError as e:
            raise StorageError(f"JSON serialization error: {str(e)}")
        except Exception as e:
            raise StorageError(f"Unexpected error during Irys upload: {str(e)}")
    
    def upload_file(self, file_path: str, filename: str = None,
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """Upload a file to Irys datachain."""
        if not self.wallet_key:
            raise ConfigurationError(
                "Wallet key required for uploads",
                {"required_env_var": "IRYS_WALLET_KEY"}
            )
        
        try:
            if not os.path.exists(file_path):
                raise StorageError(f"File not found: {file_path}")
            
            upload_filename = filename or os.path.basename(file_path)
            
            with open(file_path, 'rb') as file:
                file_content = file.read()
            
            # Prepare upload with binary data
            files = {'file': (upload_filename, file_content)}
            
            # Prepare tags
            tags = [
                {'name': 'filename', 'value': upload_filename},
                {'name': 'App-Name', 'value': 'ChaosChain-SDK'},
                {'name': 'App-Version', 'value': '0.1.2'}
            ]
            
            if metadata:
                for key, value in metadata.items():
                    tags.append({
                        'name': f'metadata-{key}',
                        'value': str(value)
                    })
            
            # Upload to Irys
            headers = {'Authorization': f'Bearer {self.wallet_key}'}
            data = {'tags': json.dumps(tags)}
            
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
                    rprint(f"[green]📁 Successfully uploaded {upload_filename} to Irys[/green]")
                    rprint(f"   Transaction ID: {tx_id}")
                    return tx_id
                else:
                    raise StorageError("No transaction ID returned from Irys")
            else:
                raise StorageError(f"Irys file upload failed: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"File upload error: {str(e)}")
    
    def retrieve_json(self, cid: IPFSHash) -> Optional[Dict[Any, Any]]:
        """Retrieve JSON data from Irys datachain."""
        try:
            url = f"{self.gateway_url}/{cid}"
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                return response.json()
            else:
                raise StorageError(f"Failed to retrieve data from Irys: {response.status_code}")
                
        except requests.RequestException as e:
            raise StorageError(f"Network error retrieving from Irys: {str(e)}")
        except json.JSONDecodeError as e:
            raise StorageError(f"Invalid JSON data from Irys: {str(e)}")
        except Exception as e:
            raise StorageError(f"Unexpected error retrieving from Irys: {str(e)}")
    
    def retrieve_file(self, cid: IPFSHash, save_path: str = None) -> Union[bytes, str]:
        """Retrieve file data from Irys datachain."""
        try:
            url = f"{self.gateway_url}/{cid}"
            response = requests.get(url, timeout=60)
            
            if response.status_code == 200:
                if save_path:
                    with open(save_path, 'wb') as f:
                        f.write(response.content)
                    return save_path
                else:
                    return response.content
            else:
                raise StorageError(f"Failed to retrieve file from Irys: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"File retrieval error: {str(e)}")
    
    def get_gateway_url(self, cid: IPFSHash) -> str:
        """Get gateway URL for content."""
        return f"{self.gateway_url}/{cid}"
    
    def pin_content(self, cid: IPFSHash, name: str = None) -> bool:
        """
        Pin content (not applicable to Irys - data is permanently stored).
        
        On Irys, all uploaded data is permanent by design, so pinning
        is not necessary. This method always returns True for compatibility.
        """
        rprint(f"[green]📌 Content {cid[:8]}... is permanently stored on Irys[/green]")
        return True
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List uploaded content (requires wallet key)."""
        if not self.wallet_key:
            raise ConfigurationError(
                "Wallet key required to list content",
                {"required_env_var": "IRYS_WALLET_KEY"}
            )
        
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
                            'timestamp': tx.get('timestamp'),
                            'size': tx.get('data_size'),
                            'gateway_url': self.get_gateway_url(tx_id),
                            'tags': tx.get('tags', [])
                        })
                
                return content_list
            else:
                raise StorageError(f"Failed to list content: {response.status_code}")
                
        except Exception as e:
            raise StorageError(f"Error listing content: {str(e)}")
    
    def get_balance(self) -> Optional[float]:
        """Get wallet balance for storage payments."""
        if not self.wallet_key:
            return None
        
        try:
            headers = {'Authorization': f'Bearer {self.wallet_key}'}
            response = requests.get(
                f"{self.api_url}/account/balance",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                return float(result.get('balance', 0))
            
        except Exception as e:
            rprint(f"[yellow]⚠️  Could not fetch balance: {e}[/yellow]")
        
        return None
    
    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return f"Irys ({self.network})"
    
    @property
    def is_free(self) -> bool:
        """Irys requires payment for storage."""
        return False
    
    @property
    def requires_api_key(self) -> bool:
        """Irys requires a wallet key for uploads."""
        return True
