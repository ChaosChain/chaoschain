"""
Exception classes for the ChaosChain SDK.

This module defines all custom exceptions used throughout the SDK
to provide clear error handling and debugging information.
"""


class ChaosChainSDKError(Exception):
    """Base exception for all ChaosChain SDK errors."""
    
    def __init__(self, message: str, details: dict = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}
    
    def __str__(self):
        if self.details:
            return f"{self.message} | Details: {self.details}"
        return self.message


class AgentRegistrationError(ChaosChainSDKError):
    """Raised when agent registration fails."""
    pass


class PaymentError(ChaosChainSDKError):
    """Raised when payment operations fail."""
    pass


class StorageError(ChaosChainSDKError):
    """Raised when IPFS or storage operations fail."""
    pass


class IntegrityVerificationError(ChaosChainSDKError):
    """Raised when process integrity verification fails."""
    pass


class NetworkError(ChaosChainSDKError):
    """Raised when blockchain network operations fail."""
    pass


class ContractError(ChaosChainSDKError):
    """Raised when smart contract interactions fail."""
    pass


class ValidationError(ChaosChainSDKError):
    """Raised when validation operations fail."""
    pass


class ConfigurationError(ChaosChainSDKError):
    """Raised when SDK configuration is invalid."""
    pass


class AuthenticationError(ChaosChainSDKError):
    """Raised when authentication or authorization fails."""
    pass
