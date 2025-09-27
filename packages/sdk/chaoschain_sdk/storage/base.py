"""
Abstract base classes for pluggable storage providers.

This module defines the interface that all storage providers must implement,
enabling developers to choose their preferred storage solution without vendor lock-in.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Union, List
from enum import Enum

from ..types import IPFSHash


class StorageProvider(Enum):
    """Supported storage providers."""
    LOCAL_IPFS = "local_ipfs"
    PINATA = "pinata"
    IRYS = "irys"
    WEB3_STORAGE = "web3_storage"
    FLEEK = "fleek"
    INFURA = "infura"


class StorageBackend(ABC):
    """
    Abstract base class for all storage backends.
    
    This interface ensures all storage providers implement the same methods,
    allowing developers to switch between providers without code changes.
    """
    
    @abstractmethod
    def upload_json(self, data: Dict[Any, Any], filename: str, 
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """
        Upload JSON data and return the content identifier.
        
        Args:
            data: JSON-serializable data to upload
            filename: Name for the uploaded file
            metadata: Optional metadata for the upload
            
        Returns:
            Content identifier if successful, None otherwise
        """
        pass
    
    @abstractmethod
    def upload_file(self, file_path: str, filename: str = None,
                   metadata: Dict[str, Any] = None) -> Optional[IPFSHash]:
        """
        Upload a file and return the content identifier.
        
        Args:
            file_path: Path to the file to upload
            filename: Optional custom filename
            metadata: Optional metadata for the upload
            
        Returns:
            Content identifier if successful, None otherwise
        """
        pass
    
    @abstractmethod
    def retrieve_json(self, cid: IPFSHash) -> Optional[Dict[Any, Any]]:
        """
        Retrieve JSON data using the content identifier.
        
        Args:
            cid: Content identifier
            
        Returns:
            Parsed JSON data if successful, None otherwise
        """
        pass
    
    @abstractmethod
    def retrieve_file(self, cid: IPFSHash, save_path: str = None) -> Union[bytes, str]:
        """
        Retrieve file data using the content identifier.
        
        Args:
            cid: Content identifier
            save_path: Optional path to save the file
            
        Returns:
            File content as bytes, or saved file path if save_path provided
        """
        pass
    
    @abstractmethod
    def get_gateway_url(self, cid: IPFSHash) -> str:
        """
        Get a gateway URL for accessing the content.
        
        Args:
            cid: Content identifier
            
        Returns:
            Gateway URL for the content
        """
        pass
    
    @abstractmethod
    def pin_content(self, cid: IPFSHash, name: str = None) -> bool:
        """
        Pin content to ensure persistence (if supported by provider).
        
        Args:
            cid: Content identifier to pin
            name: Optional name for the pinned content
            
        Returns:
            True if successful, False otherwise
        """
        pass
    
    @abstractmethod
    def list_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List stored content (if supported by provider).
        
        Args:
            limit: Maximum number of items to return
            
        Returns:
            List of content information
        """
        pass
    
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the name of this storage provider."""
        pass
    
    @property
    @abstractmethod
    def is_free(self) -> bool:
        """Return True if this provider is free to use."""
        pass
    
    @property
    @abstractmethod
    def requires_api_key(self) -> bool:
        """Return True if this provider requires an API key."""
        pass


class StorageConfig:
    """Configuration for storage providers."""
    
    def __init__(self, provider: StorageProvider, **kwargs):
        """
        Initialize storage configuration.
        
        Args:
            provider: The storage provider to use
            **kwargs: Provider-specific configuration options
        """
        self.provider = provider
        self.config = kwargs
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self.config.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        """Set a configuration value."""
        self.config[key] = value
