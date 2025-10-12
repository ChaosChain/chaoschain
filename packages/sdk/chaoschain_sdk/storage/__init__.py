"""
ChaosChain SDK Storage Module

⚠️  DEPRECATED: This module has been migrated to chaoschain_sdk.providers.storage

This module provides backward compatibility for existing code.
New code should use:
    from chaoschain_sdk.providers.storage import LocalIPFSStorage, PinataStorage, IrysStorage

The old interface (upload_json, upload_file, etc.) is no longer supported.
Use the new unified Protocol (put, get, verify, delete).

Migration Guide:
    Old: storage.upload_json(data, "file.json")
    New: storage.put(json.dumps(data).encode(), mime="application/json")

This compatibility layer will be removed in v1.0.0.
"""

import warnings

warnings.warn(
    "chaoschain_sdk.storage is deprecated. "
    "Use chaoschain_sdk.providers.storage instead. "
    "The old interface (upload_json/upload_file) has been replaced with the unified Protocol (put/get). "
    "This compatibility layer will be removed in v1.0.0.",
    DeprecationWarning,
    stacklevel=2
)

# Re-export from new location for backward compatibility
from ..providers.storage import (
    StorageBackend,
    StorageResult,
    StorageProvider,
    StorageConfig,
    LocalIPFSStorage as LocalIPFSBackend,  # Alias old name
    PinataStorage as PinataBackend,  # Alias old name
    IrysStorage as IrysBackend,  # Alias old name
)

# Note: UnifiedStorageManager has been refactored.
# For backward compatibility, wrap the new providers
class UnifiedStorageManager:
    """
    Backward compatibility wrapper for storage providers.
    
    Prefer using providers directly:
        from chaoschain_sdk.providers.storage import LocalIPFSStorage, PinataStorage
        storage = LocalIPFSStorage()
    """
    def __init__(self, primary_provider=None, config=None):
        import warnings
        warnings.warn(
            "UnifiedStorageManager is deprecated. Use providers directly.",
            DeprecationWarning,
            stacklevel=2
        )
        
        # Import providers
        from ..providers.storage import (
            LocalIPFSStorage,
            PinataStorage,
            IrysStorage,
            StorageProvider
        )
        
        # Select provider based on config
        if primary_provider == StorageProvider.PINATA and config and 'pinata' in config:
            self._backend = PinataStorage(
                jwt_token=config['pinata']['jwt_token'],
                gateway_url=config['pinata']['gateway_url']
            )
        elif primary_provider == StorageProvider.IRYS and config and 'irys' in config:
            self._backend = IrysStorage(
                network=config['irys'].get('network'),
                token=config['irys'].get('token'),
                wallet_private_key=config['irys'].get('wallet_private_key')
            )
        else:
            # Default to local IPFS
            self._backend = LocalIPFSStorage()
    
    def get_provider_info(self):
        return {
            'name': self._backend.provider_name,
            'is_available': self._backend.is_available
        }

# Alias for backward compatibility
StorageManager = UnifiedStorageManager

def create_storage_manager(*args, **kwargs):
    """
    DEPRECATED: create_storage_manager has been replaced.
    
    Use providers directly instead:
        from chaoschain_sdk.providers.storage import LocalIPFSStorage
        storage = LocalIPFSStorage()
    """
    # For now, return a working storage backend instead of raising
    from ..providers.storage import LocalIPFSStorage
    import warnings
    warnings.warn(
        "create_storage_manager() is deprecated. Use LocalIPFSStorage() directly.",
        DeprecationWarning,
        stacklevel=2
    )
    return LocalIPFSStorage()

# Main exports for backward compatibility
__all__ = [
    # Base classes
    'StorageBackend',
    'StorageResult',
    'StorageProvider', 
    'StorageConfig',
    
    # Backends (old names as aliases)
    'LocalIPFSBackend',
    'PinataBackend', 
    'IrysBackend',
    
    # Deprecated managers (show errors)
    'UnifiedStorageManager',
    'StorageManager',
    'create_storage_manager',
]

# Version info
__version__ = '0.2.0'  # Bumped for breaking changes
