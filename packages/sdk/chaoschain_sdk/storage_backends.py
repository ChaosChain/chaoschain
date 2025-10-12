"""
Pluggable storage backends for the ChaosChain SDK.

This module provides a unified interface for different decentralized storage providers,
allowing developers to choose the best storage solution for their use case.
"""

import os
import json
import hashlib
from abc import ABC, abstractmethod
from typing import Dict, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum

from rich import print as rprint


class StorageProvider(str, Enum):
    """Supported storage providers."""
    PINATA = "pinata"
    ZEROG = "0g"  # 0G Storage
    IRYS = "irys"
    LOCAL_IPFS = "local-ipfs"
    MEMORY = "memory"  # For testing


@dataclass
class StorageConfig:
    """Configuration for storage backends."""
    provider: StorageProvider
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    gateway_url: Optional[str] = None
    node_url: Optional[str] = None
    indexer_url: Optional[str] = None
    extra_config: Optional[Dict[str, Any]] = None


@dataclass
class StorageResult:
    """Result of storage operation."""
    success: bool
    uri: str  # IPFS CID, 0G hash, or other identifier
    hash: str  # KECCAK-256 hash for integrity verification
    provider: StorageProvider
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class StorageBackend(ABC):
    """Abstract base class for storage backends."""
    
    def __init__(self, config: StorageConfig):
        self.config = config
        self.provider = config.provider
    
    @abstractmethod
    def store(self, data: bytes, metadata: Optional[Dict] = None) -> StorageResult:
        """
        Store data in the backend.
        
        Args:
            data: Raw bytes to store
            metadata: Optional metadata about the data
            
        Returns:
            StorageResult with URI and hash
        """
        pass
    
    @abstractmethod
    def retrieve(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from the backend.
        
        Args:
            uri: URI or identifier of the data
            
        Returns:
            Tuple of (data bytes, metadata)
        """
        pass
    
    @abstractmethod
    def verify(self, uri: str, expected_hash: str) -> bool:
        """
        Verify data integrity.
        
        Args:
            uri: URI or identifier of the data
            expected_hash: Expected KECCAK-256 hash
            
        Returns:
            True if data matches expected hash
        """
        pass
    
    def _compute_hash(self, data: bytes) -> str:
        """Compute KECCAK-256 hash of data."""
        return '0x' + hashlib.sha3_256(data).hexdigest()


class ZeroGStorageBackend(StorageBackend):
    """
    0G Storage backend - Purpose-built for AI and Web3.
    
    Features:
    - 95% lower costs than AWS
    - Instant retrieval (200 MBPS even at network congestion)
    - Both structured (KV) and unstructured (Log) data
    - Perfect for AI training datasets and agent evidence trails
    
    Uses official 0G Storage SDK (Python port of TypeScript SDK).
    Documentation: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
    
    Note: Currently, 0G provides TypeScript and Go SDKs. Python wrapper coming soon.
    For now, this uses subprocess to call the TypeScript SDK via CLI.
    """
    
    def __init__(self, config: StorageConfig):
        super().__init__(config)
        
        # 0G Storage configuration
        self.indexer_rpc = config.node_url or os.getenv('ZEROG_INDEXER_RPC', 'https://indexer-storage-testnet-turbo.0g.ai')
        self.evm_rpc = config.gateway_url or os.getenv('ZEROG_EVM_RPC', 'https://evmrpc-testnet.0g.ai')
        self.private_key = config.api_key or os.getenv('ZEROG_PRIVATE_KEY')
        
        self.available = False
        self.use_subprocess = False
        
        # Check if 0G TypeScript SDK is available (for subprocess fallback)
        try:
            import subprocess
            result = subprocess.run(['node', '--version'], capture_output=True, timeout=2)
            if result.returncode == 0:
                # Check if @0gfoundation/0g-ts-sdk is available
                check_pkg = subprocess.run(
                    ['node', '-e', 'require("@0gfoundation/0g-ts-sdk")'],
                    capture_output=True,
                    timeout=2
                )
                if check_pkg.returncode == 0:
                    self.use_subprocess = True
                    self.available = True
                    rprint(f"[green]✅ 0G Storage SDK available via TypeScript[/green]")
                else:
                    rprint(f"[yellow]⚠️  0G TypeScript SDK not found. Install with:[/yellow]")
                    rprint(f"[cyan]   npm install @0gfoundation/0g-ts-sdk[/cyan]")
            else:
                rprint(f"[yellow]⚠️  Node.js not found. Install Node.js to use 0G Storage.[/yellow]")
        except Exception as e:
            rprint(f"[yellow]⚠️  0G Storage not available: {e}[/yellow]")
            rprint(f"[cyan]📘 See: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk[/cyan]")
        
        if not self.available and not self.private_key:
            rprint(f"[yellow]⚠️  No private key configured for 0G Storage[/yellow]")
            rprint(f"[cyan]   Set ZEROG_PRIVATE_KEY environment variable[/cyan]")
    
    def store(self, data: bytes, metadata: Optional[Dict] = None) -> StorageResult:
        """
        Store data in 0G Storage network using the official SDK.
        
        Uses the Log Layer for immutable storage (perfect for audit trails).
        
        Based on official SDK: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
        """
        try:
            data_hash = self._compute_hash(data)
            
            if not self.available:
                return StorageResult(
                    success=False,
                    uri="",
                    hash="",
                    provider=StorageProvider.ZEROG,
                    error="0G Storage SDK not available. Install @0gfoundation/0g-ts-sdk via npm."
                )
            
            if not self.private_key:
                return StorageResult(
                    success=False,
                    uri="",
                    hash="",
                    provider=StorageProvider.ZEROG,
                    error="Private key not configured. Set ZEROG_PRIVATE_KEY environment variable."
                )
            
            # Create temporary file for upload
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            
            try:
                # Call 0G SDK via subprocess (TypeScript SDK)
                import subprocess
                import json
                
                # Create Node.js script to call 0G SDK
                upload_script = f"""
const {{ Indexer, ZgFile }} = require('@0gfoundation/0g-ts-sdk');
const {{ ethers }} = require('ethers');

async function upload() {{
    const provider = new ethers.JsonRpcProvider('{self.evm_rpc}');
    const wallet = new ethers.Wallet('{self.private_key}', provider);
    
    const indexer = new Indexer('{self.indexer_rpc}');
    const file = await ZgFile.fromFilePath('{tmp_path}');
    
    const [tx, err] = await indexer.upload(file, 0, '{self.evm_rpc}', wallet);
    
    if (err !== null) {{
        throw new Error(err);
    }}
    
    const rootHash = await file.merkleTree().then(tree => tree[0].rootHash());
    
    console.log(JSON.stringify({{
        success: true,
        rootHash: rootHash,
        tx: tx
    }}));
}}

upload().catch(err => {{
    console.error(JSON.stringify({{ success: false, error: err.message }}));
    process.exit(1);
}});
"""
                
                # Execute upload
                result = subprocess.run(
                    ['node', '-e', upload_script],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                
                if result.returncode != 0:
                    raise Exception(f"0G upload failed: {result.stderr}")
                
                # Parse result
                upload_result = json.loads(result.stdout.strip())
                
                if not upload_result.get('success'):
                    raise Exception(upload_result.get('error', 'Unknown error'))
                
                root_hash = upload_result['rootHash']
                tx_hash = upload_result.get('tx')
                
                rprint(f"[green]✅ Stored on 0G Storage: {root_hash[:16]}...[/green]")
                
                return StorageResult(
                    success=True,
                    uri=f"0g://{root_hash}",
                    hash=data_hash,
                    provider=StorageProvider.ZEROG,
                    metadata={
                        "root_hash": root_hash,
                        "tx_hash": tx_hash,
                        "size": len(data),
                        "indexer_rpc": self.indexer_rpc
                    }
                )
                
            finally:
                # Clean up temp file
                import os as os_module
                try:
                    os_module.unlink(tmp_path)
                except:
                    pass
            
        except Exception as e:
            rprint(f"[red]❌ 0G Storage error: {e}[/red]")
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider=StorageProvider.ZEROG,
                error=str(e)
            )
    
    def retrieve(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from 0G Storage using the official SDK.
        
        Based on official SDK: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
        """
        try:
            if not uri.startswith("0g://"):
                raise ValueError("Invalid 0G URI format. Expected '0g://root_hash'")
            
            root_hash = uri[5:]  # Remove "0g://" prefix
            
            if not self.available:
                raise Exception("0G Storage SDK not available. Install @0gfoundation/0g-ts-sdk via npm.")
            
            # Create temporary file for download
            import tempfile
            import subprocess
            import json
            
            tmp_path = tempfile.mktemp(suffix='.bin')
            
            try:
                # Create Node.js script to call 0G SDK
                download_script = f"""
const {{ Indexer }} = require('@0gfoundation/0g-ts-sdk');
const fs = require('fs');

async function download() {{
    const indexer = new Indexer('{self.indexer_rpc}');
    const data = await indexer.download('{root_hash}');
    
    fs.writeFileSync('{tmp_path}', Buffer.from(data));
    
    console.log(JSON.stringify({{
        success: true,
        size: data.length
    }}));
}}

download().catch(err => {{
    console.error(JSON.stringify({{ success: false, error: err.message }}));
    process.exit(1);
}});
"""
                
                # Execute download
                result = subprocess.run(
                    ['node', '-e', download_script],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                
                if result.returncode != 0:
                    raise Exception(f"0G download failed: {result.stderr}")
                
                # Parse result
                download_result = json.loads(result.stdout.strip())
                
                if not download_result.get('success'):
                    raise Exception(download_result.get('error', 'Unknown error'))
                
                # Read downloaded file
                with open(tmp_path, 'rb') as f:
                    data = f.read()
                
                metadata = {
                    "root_hash": root_hash,
                    "size": len(data),
                    "indexer_rpc": self.indexer_rpc
                }
                
                rprint(f"[green]✅ Retrieved from 0G Storage: {len(data)} bytes[/green]")
                
                return (data, metadata)
                
            finally:
                # Clean up temp file
                import os as os_module
                try:
                    os_module.unlink(tmp_path)
                except:
                    pass
            
        except Exception as e:
            raise Exception(f"Failed to retrieve from 0G Storage: {str(e)}")
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """Verify data integrity from 0G Storage."""
        try:
            data, _ = self.retrieve(uri)
            actual_hash = self._compute_hash(data)
            return actual_hash == expected_hash
        except:
            return False


class PinataStorageBackend(StorageBackend):
    """Pinata IPFS storage backend (existing implementation)."""
    
    def __init__(self, config: StorageConfig):
        super().__init__(config)
        self.jwt = config.api_key or os.getenv('PINATA_JWT')
        self.gateway = config.gateway_url or os.getenv('PINATA_GATEWAY', 'gateway.pinata.cloud')
        
        if not self.jwt:
            rprint("[yellow]⚠️  No Pinata JWT provided. Storage will use mock mode.[/yellow]")
    
    def store(self, data: bytes, metadata: Optional[Dict] = None) -> StorageResult:
        """Store data on Pinata IPFS."""
        try:
            if not self.jwt:
                # Mock mode
                mock_cid = f"Qm{hashlib.sha256(data).hexdigest()[:44]}"
                return StorageResult(
                    success=True,
                    uri=f"ipfs://{mock_cid}",
                    hash=self._compute_hash(data),
                    provider=StorageProvider.PINATA,
                    metadata={"mock": True, "size": len(data)}
                )
            
            import requests
            
            # Upload to Pinata
            url = "https://api.pinata.cloud/pinning/pinFileToIPFS"
            headers = {"Authorization": f"Bearer {self.jwt}"}
            
            files = {"file": ("data.bin", data)}
            
            if metadata:
                files["pinataMetadata"] = (None, json.dumps(metadata))
            
            response = requests.post(url, headers=headers, files=files, timeout=60)
            response.raise_for_status()
            
            result = response.json()
            cid = result['IpfsHash']
            
            return StorageResult(
                success=True,
                uri=f"ipfs://{cid}",
                hash=self._compute_hash(data),
                provider=StorageProvider.PINATA,
                metadata={"cid": cid, "size": len(data)}
            )
            
        except Exception as e:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider=StorageProvider.PINATA,
                error=str(e)
            )
    
    def retrieve(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """Retrieve data from Pinata IPFS."""
        try:
            if uri.startswith("ipfs://"):
                cid = uri[7:]
            else:
                cid = uri
            
            import requests
            
            # Try dedicated gateway first, then public
            gateways = [
                f"https://{self.gateway}/ipfs/{cid}",
                f"https://gateway.pinata.cloud/ipfs/{cid}",
                f"https://ipfs.io/ipfs/{cid}"
            ]
            
            for gateway_url in gateways:
                try:
                    response = requests.get(gateway_url, timeout=30)
                    response.raise_for_status()
                    return (response.content, None)
                except:
                    continue
            
            raise Exception("Failed to retrieve from any IPFS gateway")
            
        except Exception as e:
            raise Exception(f"Failed to retrieve from Pinata: {str(e)}")
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """Verify data integrity from Pinata."""
        try:
            data, _ = self.retrieve(uri)
            actual_hash = self._compute_hash(data)
            return actual_hash == expected_hash
        except:
            return False


class LocalIPFSBackend(StorageBackend):
    """Local IPFS node backend."""
    
    def __init__(self, config: StorageConfig):
        super().__init__(config)
        self.node_url = config.node_url or os.getenv('IPFS_API_URL', 'http://localhost:5001')
        
        try:
            import ipfshttpclient
            self.client = ipfshttpclient.connect(self.node_url)
            rprint(f"[green]✅ Connected to local IPFS node at {self.node_url}[/green]")
        except ImportError:
            self.client = None
            rprint("[yellow]⚠️  ipfshttpclient not installed. Run: pip install ipfshttpclient[/yellow]")
        except Exception as e:
            self.client = None
            rprint(f"[yellow]⚠️  Could not connect to IPFS node: {e}[/yellow]")
    
    def store(self, data: bytes, metadata: Optional[Dict] = None) -> StorageResult:
        """Store data in local IPFS node."""
        try:
            if not self.client:
                raise Exception("IPFS client not available")
            
            result = self.client.add_bytes(data)
            cid = result
            
            return StorageResult(
                success=True,
                uri=f"ipfs://{cid}",
                hash=self._compute_hash(data),
                provider=StorageProvider.LOCAL_IPFS,
                metadata={"cid": cid, "size": len(data)}
            )
            
        except Exception as e:
            return StorageResult(
                success=False,
                uri="",
                hash="",
                provider=StorageProvider.LOCAL_IPFS,
                error=str(e)
            )
    
    def retrieve(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """Retrieve data from local IPFS node."""
        try:
            if not self.client:
                raise Exception("IPFS client not available")
            
            if uri.startswith("ipfs://"):
                cid = uri[7:]
            else:
                cid = uri
            
            data = self.client.cat(cid)
            return (data, None)
            
        except Exception as e:
            raise Exception(f"Failed to retrieve from local IPFS: {str(e)}")
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """Verify data integrity from local IPFS."""
        try:
            data, _ = self.retrieve(uri)
            actual_hash = self._compute_hash(data)
            return actual_hash == expected_hash
        except:
            return False


class MemoryStorageBackend(StorageBackend):
    """In-memory storage backend for testing."""
    
    def __init__(self, config: StorageConfig):
        super().__init__(config)
        self.storage: Dict[str, bytes] = {}
        self.metadata_store: Dict[str, Dict] = {}
    
    def store(self, data: bytes, metadata: Optional[Dict] = None) -> StorageResult:
        """Store data in memory."""
        data_hash = self._compute_hash(data)
        uri = f"memory://{data_hash[2:10]}"
        
        self.storage[uri] = data
        if metadata:
            self.metadata_store[uri] = metadata
        
        return StorageResult(
            success=True,
            uri=uri,
            hash=data_hash,
            provider=StorageProvider.MEMORY,
            metadata={"size": len(data)}
        )
    
    def retrieve(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """Retrieve data from memory."""
        if uri not in self.storage:
            raise Exception(f"URI not found in memory: {uri}")
        
        data = self.storage[uri]
        metadata = self.metadata_store.get(uri)
        return (data, metadata)
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """Verify data integrity from memory."""
        try:
            data, _ = self.retrieve(uri)
            actual_hash = self._compute_hash(data)
            return actual_hash == expected_hash
        except:
            return False


class StorageManager:
    """
    Unified storage manager with pluggable backends.
    
    Automatically selects the best available storage backend based on configuration.
    Supports fallback chains for reliability.
    """
    
    def __init__(self, primary_provider: StorageProvider = StorageProvider.ZEROG):
        self.primary_provider = primary_provider
        self.backends: Dict[StorageProvider, StorageBackend] = {}
        self._init_backends()
    
    def _init_backends(self):
        """Initialize available storage backends."""
        # 0G Storage - Primary for ChaosChain x 0G integration
        try:
            zerog_config = StorageConfig(provider=StorageProvider.ZEROG)
            self.backends[StorageProvider.ZEROG] = ZeroGStorageBackend(zerog_config)
        except Exception as e:
            rprint(f"[yellow]⚠️  0G Storage not available: {e}[/yellow]")
        
        # Pinata - IPFS pinning service
        try:
            pinata_config = StorageConfig(provider=StorageProvider.PINATA)
            self.backends[StorageProvider.PINATA] = PinataStorageBackend(pinata_config)
        except Exception as e:
            rprint(f"[yellow]⚠️  Pinata not available: {e}[/yellow]")
        
        # Local IPFS - For self-hosted nodes
        try:
            local_config = StorageConfig(provider=StorageProvider.LOCAL_IPFS)
            self.backends[StorageProvider.LOCAL_IPFS] = LocalIPFSBackend(local_config)
        except Exception as e:
            rprint(f"[yellow]⚠️  Local IPFS not available: {e}[/yellow]")
        
        # Memory - Always available for testing
        memory_config = StorageConfig(provider=StorageProvider.MEMORY)
        self.backends[StorageProvider.MEMORY] = MemoryStorageBackend(memory_config)
    
    def store(
        self,
        data: bytes,
        metadata: Optional[Dict] = None,
        provider: Optional[StorageProvider] = None
    ) -> StorageResult:
        """
        Store data using specified or primary backend.
        
        Args:
            data: Data to store
            metadata: Optional metadata
            provider: Specific provider to use, or None for primary
            
        Returns:
            StorageResult with URI and hash
        """
        target_provider = provider or self.primary_provider
        
        if target_provider not in self.backends:
            rprint(f"[yellow]⚠️  {target_provider} not available, using fallback[/yellow]")
            # Fallback chain: 0G -> Pinata -> Local IPFS -> Memory
            for fallback in [StorageProvider.ZEROG, StorageProvider.PINATA, 
                           StorageProvider.LOCAL_IPFS, StorageProvider.MEMORY]:
                if fallback in self.backends:
                    target_provider = fallback
                    break
        
        backend = self.backends[target_provider]
        result = backend.store(data, metadata)
        
        if result.success:
            rprint(f"[green]✅ Stored on {target_provider}: {result.uri}[/green]")
        else:
            rprint(f"[red]❌ Failed to store on {target_provider}: {result.error}[/red]")
        
        return result
    
    def retrieve(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data from appropriate backend based on URI.
        
        Args:
            uri: URI of the data (0g://, ipfs://, memory://)
            
        Returns:
            Tuple of (data, metadata)
        """
        # Determine provider from URI
        if uri.startswith("0g://"):
            provider = StorageProvider.ZEROG
        elif uri.startswith("ipfs://"):
            # Try Pinata first, then local IPFS
            for provider in [StorageProvider.PINATA, StorageProvider.LOCAL_IPFS]:
                if provider in self.backends:
                    try:
                        return self.backends[provider].retrieve(uri)
                    except:
                        continue
            raise Exception("No IPFS backend available")
        elif uri.startswith("memory://"):
            provider = StorageProvider.MEMORY
        else:
            raise ValueError(f"Unknown URI scheme: {uri}")
        
        if provider not in self.backends:
            raise Exception(f"Backend not available for {provider}")
        
        return self.backends[provider].retrieve(uri)
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """Verify data integrity."""
        try:
            data, _ = self.retrieve(uri)
            backend = list(self.backends.values())[0]  # Use any backend for hash computation
            actual_hash = backend._compute_hash(data)
            return actual_hash == expected_hash
        except:
            return False

