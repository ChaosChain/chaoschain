"""
Storage provider base protocol.

Defines the interface that all storage providers must implement.
This unified protocol supports all storage backends: IPFS (local/Pinata), Irys, 0G, etc.
"""

from typing import Protocol, Optional, Dict, Tuple, List, Any
from dataclasses import dataclass, field
from enum import Enum


class StorageProvider(Enum):
    """Supported storage providers."""
    LOCAL_IPFS = "ipfs-local"
    PINATA = "ipfs-pinata"
    IRYS = "irys"
    ZEROG = "0g"
    ARIO = "ario"
    WEB3_STORAGE = "web3-storage"
    FLEEK = "fleek"
    INFURA_IPFS = "infura-ipfs"


@dataclass
class StorageResult:
    """Result of a storage operation."""
    success: bool
    uri: str  # Canonical URI (e.g., "0g://object/<id>", "ipfs://Qm...")
    hash: str  # KECCAK-256 hash for integrity verification (or content hash for IPFS)
    provider: str  # Provider name
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    view_url: Optional[str] = None  # Optional HTTPS URL for viewing (gateway URL)
    cid: Optional[str] = None  # For IPFS providers, the actual CID
    size: Optional[int] = None  # Size in bytes
    timestamp: Optional[str] = None  # Upload timestamp


@dataclass
class StorageConfig:
    """Configuration for storage providers."""
    provider: StorageProvider
    config: Dict[str, Any] = field(default_factory=dict)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self.config.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        """Set a configuration value."""
        self.config[key] = value


class StorageBackend(Protocol):
    """
    Protocol for storage backends.
    
    All storage providers must implement this interface to be compatible
    with the ChaosChain SDK storage system.
    
    This unified protocol supports:
    - 0G Storage (gRPC)
    - IPFS Local (HTTP API)
    - IPFS Pinata (REST API)
    - Irys (REST API)
    - Future providers
    """
    
    def put(
        self,
        blob: bytes,
        *,
        mime: Optional[str] = None,
        tags: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None
    ) -> StorageResult:
        """
        Store data.
        
        Args:
            blob: Data to store
            mime: MIME type (optional, e.g., "application/json")
            tags: Metadata tags (optional)
            idempotency_key: For retry safety (optional)
            
        Returns:
            StorageResult with URI and hash
        """
        ...
    
    def get(self, uri: str) -> Tuple[bytes, Optional[Dict]]:
        """
        Retrieve data.
        
        Args:
            uri: Storage URI (e.g., "ipfs://Qm...", "0g://object/<id>")
            
        Returns:
            Tuple of (data bytes, metadata dict)
        """
        ...
    
    def verify(self, uri: str, expected_hash: str) -> bool:
        """
        Verify data integrity.
        
        Args:
            uri: Storage URI
            expected_hash: Expected hash (KECCAK-256 for 0G, CID for IPFS)
            
        Returns:
            True if data matches expected hash
        """
        ...
    
    def delete(self, uri: str) -> bool:
        """
        Delete data (if supported by provider).
        
        Note: Some providers (Irys, IPFS) may not support deletion.
        
        Args:
            uri: Storage URI
            
        Returns:
            True if deleted successfully, False if not supported/failed
        """
        ...
    
    def pin(self, uri: str, name: Optional[str] = None) -> bool:
        """
        Pin content to ensure persistence (for IPFS providers).
        
        Args:
            uri: Storage URI
            name: Optional name for the pin
            
        Returns:
            True if pinned successfully or not applicable
        """
        ...
    
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List stored content (if supported by provider).
        
        Args:
            limit: Maximum number of items to return
            
        Returns:
            List of content information dicts
        """
        ...
    
    def get_gateway_url(self, uri: str) -> Optional[str]:
        """
        Get HTTPS gateway URL for viewing content.
        
        Args:
            uri: Storage URI
            
        Returns:
            HTTPS URL for viewing, or None if not applicable
        """
        ...
    
    @property
    def provider_name(self) -> str:
        """Get provider name (e.g., '0g', 'ipfs-pinata', 'ipfs-local', 'irys')."""
        ...
    
    @property
    def is_available(self) -> bool:
        """Check if provider is available and configured."""
        ...
    
    @property
    def is_free(self) -> bool:
        """Check if provider is free to use."""
        ...
    
    @property
    def requires_api_key(self) -> bool:
        """Check if provider requires an API key."""
        ...


