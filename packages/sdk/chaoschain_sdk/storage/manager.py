"""
Unified storage manager with pluggable backend support.

This module provides a unified interface for multiple storage providers,
allowing developers to choose their preferred storage solution without
vendor lock-in. Supports local IPFS, Pinata, Irys, and other providers.
"""

import os
from typing import Dict, Any, Optional, Union, List, Type
from rich.console import Console
from rich import print as rprint

from .base import StorageBackend, StorageProvider, StorageConfig
from .local_ipfs import LocalIPFSBackend
from .pinata_backend import PinataBackend
from .irys_backend import IrysBackend
from ..types import IPFSHash
from ..exceptions import StorageError, ConfigurationError

console = Console()


class UnifiedStorageManager:
    """
    Unified storage manager supporting multiple backends.
    
    This manager allows developers to choose their preferred storage provider
    without changing their code. It provides automatic fallback options and
    intelligent provider selection based on availability and cost.
    
    Supported providers:
    - Local IPFS (free, requires local node)
    - Pinata (paid, reliable cloud service)
    - Irys (paid, programmable datachain)
    - More providers can be added easily
    """
    
    # Registry of available storage backends
    _backends: Dict[StorageProvider, Type[StorageBackend]] = {
        StorageProvider.LOCAL_IPFS: LocalIPFSBackend,
        StorageProvider.PINATA: PinataBackend,
        StorageProvider.IRYS: IrysBackend,
    }
    
    def __init__(self, primary_provider: StorageProvider = None, 
                 fallback_providers: List[StorageProvider] = None,
                 config: Dict[str, Any] = None):
        """
        Initialize unified storage manager.
        
        Args:
            primary_provider: Primary storage provider to use
            fallback_providers: List of fallback providers if primary fails
            config: Configuration dictionary for providers
        """
        self.config = config or {}
        self.backends: Dict[StorageProvider, StorageBackend] = {}
        
        # Auto-detect available providers if none specified
        if primary_provider is None:
            primary_provider = self._auto_detect_provider()
        
        self.primary_provider = primary_provider
        self.fallback_providers = fallback_providers or []
        
        # Initialize primary provider
        self._initialize_provider(primary_provider)
        
        # Initialize fallback providers
        for provider in self.fallback_providers:
            try:
                self._initialize_provider(provider)
            except Exception as e:
                rprint(f"[yellow]⚠️  Fallback provider {provider.value} unavailable: {e}[/yellow]")
    
    def _auto_detect_provider(self) -> StorageProvider:
        """Auto-detect the best available storage provider."""
        
        # Check for local IPFS first (free option)
        try:
            LocalIPFSBackend()
            rprint("[green]🎯 Auto-detected: Local IPFS node available (free)[/green]")
            return StorageProvider.LOCAL_IPFS
        except:
            pass
        
        # Check for Pinata credentials
        if os.getenv("PINATA_JWT") and os.getenv("PINATA_GATEWAY"):
            rprint("[green]🎯 Auto-detected: Pinata credentials available[/green]")
            return StorageProvider.PINATA
        
        # Check for Irys credentials
        if os.getenv("IRYS_WALLET_KEY"):
            rprint("[green]🎯 Auto-detected: Irys wallet key available[/green]")
            return StorageProvider.IRYS
        
        # Default to local IPFS with helpful instructions
        rprint("[yellow]⚠️  No storage provider configured. Defaulting to Local IPFS (free option).[/yellow]")
        rprint("   🆓 Local IPFS is completely free and gives you full control!")
        rprint("   📖 Quick setup: https://docs.ipfs.tech/install/")
        rprint("   🚀 Or use: brew install ipfs && ipfs init && ipfs daemon")
        rprint("   💡 Alternative: Set PINATA_JWT for cloud storage")
        return StorageProvider.LOCAL_IPFS
    
    def _initialize_provider(self, provider: StorageProvider) -> None:
        """Initialize a storage provider backend."""
        if provider in self.backends:
            return  # Already initialized
        
        backend_class = self._backends.get(provider)
        if not backend_class:
            raise ConfigurationError(f"Unsupported storage provider: {provider}")
        
        # Get provider-specific config
        provider_config = self.config.get(provider.value, {})
        
        try:
            # Initialize backend with config
            if provider == StorageProvider.LOCAL_IPFS:
                backend = backend_class(
                    api_url=provider_config.get('api_url'),
                    gateway_url=provider_config.get('gateway_url')
                )
            elif provider == StorageProvider.PINATA:
                backend = backend_class(
                    jwt_token=provider_config.get('jwt_token'),
                    gateway_url=provider_config.get('gateway_url')
                )
            elif provider == StorageProvider.IRYS:
                backend = backend_class(
                    network=provider_config.get('network', 'testnet'),
                    wallet_key=provider_config.get('wallet_key'),
                    gateway_url=provider_config.get('gateway_url')
                )
            else:
                backend = backend_class(**provider_config)
            
            self.backends[provider] = backend
            
        except Exception as e:
            raise ConfigurationError(
                f"Failed to initialize {provider.value} backend: {str(e)}"
            )
    
    def _get_backend(self, provider: StorageProvider = None) -> StorageBackend:
        """Get a storage backend, with fallback support."""
        providers_to_try = []
        
        if provider:
            providers_to_try.append(provider)
        else:
            providers_to_try.append(self.primary_provider)
            providers_to_try.extend(self.fallback_providers)
        
        last_error = None
        for prov in providers_to_try:
            try:
                if prov not in self.backends:
                    self._initialize_provider(prov)
                return self.backends[prov]
            except Exception as e:
                last_error = e
                continue
        
        raise StorageError(
            f"No storage providers available. Last error: {last_error}"
        )
    
    def upload_json(self, data: Dict[Any, Any], filename: str, 
                   metadata: Dict[str, Any] = None,
                   provider: StorageProvider = None) -> Optional[IPFSHash]:
        """
        Upload JSON data using specified or primary provider.
        
        Args:
            data: JSON-serializable data to upload
            filename: Name for the uploaded file
            metadata: Optional metadata for the upload
            provider: Specific provider to use (optional)
            
        Returns:
            Content identifier if successful, None otherwise
        """
        backend = self._get_backend(provider)
        return backend.upload_json(data, filename, metadata)
    
    def upload_file(self, file_path: str, filename: str = None,
                   metadata: Dict[str, Any] = None,
                   provider: StorageProvider = None) -> Optional[IPFSHash]:
        """
        Upload a file using specified or primary provider.
        
        Args:
            file_path: Path to the file to upload
            filename: Optional custom filename
            metadata: Optional metadata for the upload
            provider: Specific provider to use (optional)
            
        Returns:
            Content identifier if successful, None otherwise
        """
        backend = self._get_backend(provider)
        return backend.upload_file(file_path, filename, metadata)
    
    def retrieve_json(self, cid: IPFSHash, 
                     provider: StorageProvider = None) -> Optional[Dict[Any, Any]]:
        """
        Retrieve JSON data using specified or primary provider.
        
        Args:
            cid: Content identifier
            provider: Specific provider to use (optional)
            
        Returns:
            Parsed JSON data if successful, None otherwise
        """
        backend = self._get_backend(provider)
        return backend.retrieve_json(cid)
    
    def retrieve_file(self, cid: IPFSHash, save_path: str = None,
                     provider: StorageProvider = None) -> Union[bytes, str]:
        """
        Retrieve file data using specified or primary provider.
        
        Args:
            cid: Content identifier
            save_path: Optional path to save the file
            provider: Specific provider to use (optional)
            
        Returns:
            File content as bytes, or saved file path if save_path provided
        """
        backend = self._get_backend(provider)
        return backend.retrieve_file(cid, save_path)
    
    def get_gateway_url(self, cid: IPFSHash, 
                       provider: StorageProvider = None) -> str:
        """
        Get gateway URL for content.
        
        Args:
            cid: Content identifier
            provider: Specific provider to use (optional)
            
        Returns:
            Gateway URL for the content
        """
        backend = self._get_backend(provider)
        return backend.get_gateway_url(cid)
    
    def pin_content(self, cid: IPFSHash, name: str = None,
                   provider: StorageProvider = None) -> bool:
        """
        Pin content to ensure persistence.
        
        Args:
            cid: Content identifier to pin
            name: Optional name for the pinned content
            provider: Specific provider to use (optional)
            
        Returns:
            True if successful, False otherwise
        """
        backend = self._get_backend(provider)
        return backend.pin_content(cid, name)
    
    def list_content(self, limit: int = 10,
                    provider: StorageProvider = None) -> List[Dict[str, Any]]:
        """
        List stored content.
        
        Args:
            limit: Maximum number of items to return
            provider: Specific provider to use (optional)
            
        Returns:
            List of content information
        """
        backend = self._get_backend(provider)
        return backend.list_content(limit)
    
    def get_provider_info(self, provider: StorageProvider = None) -> Dict[str, Any]:
        """
        Get information about a storage provider.
        
        Args:
            provider: Provider to get info for (defaults to primary)
            
        Returns:
            Provider information dictionary
        """
        if provider is None:
            provider = self.primary_provider
        
        backend = self._get_backend(provider)
        
        return {
            'provider': provider.value,
            'name': backend.provider_name,
            'is_free': backend.is_free,
            'requires_api_key': backend.requires_api_key,
            'available': True
        }
    
    def list_available_providers(self) -> List[Dict[str, Any]]:
        """List all available storage providers."""
        providers = []
        
        for provider in StorageProvider:
            try:
                info = self.get_provider_info(provider)
                providers.append(info)
            except Exception as e:
                providers.append({
                    'provider': provider.value,
                    'name': provider.value.replace('_', ' ').title(),
                    'is_free': False,
                    'requires_api_key': True,
                    'available': False,
                    'error': str(e)
                })
        
        return providers
    
    def switch_provider(self, provider: StorageProvider) -> None:
        """
        Switch to a different primary provider.
        
        Args:
            provider: New primary provider to use
        """
        self._initialize_provider(provider)
        self.primary_provider = provider
        rprint(f"[green]🔄 Switched to {provider.value} as primary provider[/green]")


# Backward compatibility alias
StorageManager = UnifiedStorageManager


# Factory function for easy initialization
def create_storage_manager(provider: str = None, **config) -> UnifiedStorageManager:
    """
    Factory function to create a storage manager with simple configuration.
    
    Args:
        provider: Provider name ("local_ipfs", "pinata", "irys")
        **config: Provider-specific configuration
        
    Returns:
        Configured UnifiedStorageManager instance
        
    Examples:
        # Auto-detect provider
        storage = create_storage_manager()
        
        # Use local IPFS
        storage = create_storage_manager("local_ipfs")
        
        # Use Pinata with custom config
        storage = create_storage_manager(
            "pinata",
            jwt_token="your_token",
            gateway_url="https://gateway.pinata.cloud"
        )
        
        # Use Irys testnet
        storage = create_storage_manager(
            "irys",
            network="testnet",
            wallet_key="your_wallet_key"
        )
    """
    if provider:
        try:
            storage_provider = StorageProvider(provider)
        except ValueError:
            raise ConfigurationError(f"Unknown provider: {provider}")
        
        return UnifiedStorageManager(
            primary_provider=storage_provider,
            config={provider: config}
        )
    else:
        return UnifiedStorageManager(config=config)
