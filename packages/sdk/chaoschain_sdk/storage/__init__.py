"""
ChaosChain SDK Storage Module

Pluggable storage architecture supporting multiple providers:
- Local IPFS (free, requires local node)
- Pinata (paid, reliable cloud service) 
- Irys (paid, programmable datachain)
- Easy to add more providers

Choose the storage solution that works for you.
"""

from .base import StorageBackend, StorageProvider, StorageConfig
from .manager import UnifiedStorageManager, StorageManager, create_storage_manager
from .local_ipfs import LocalIPFSBackend
from .pinata_backend import PinataBackend
from .irys_backend import IrysBackend

# Main exports for easy importing
__all__ = [
    # Main storage manager (recommended)
    'UnifiedStorageManager',
    'StorageManager',  # Backward compatibility alias
    'create_storage_manager',  # Factory function
    
    # Base classes for extending
    'StorageBackend',
    'StorageProvider', 
    'StorageConfig',
    
    # Individual backends (for advanced use)
    'LocalIPFSBackend',
    'PinataBackend', 
    'IrysBackend',
]

# Version info
__version__ = '0.1.0'
