"""
Basic tests for ChaosChain SDK functionality.

These tests verify that the SDK can be imported and basic functionality works
without requiring network connections or external services.
"""

import pytest
import asyncio
from unittest.mock import Mock, patch

from chaoschain_sdk import (
    ChaosChainAgentSDK,
    AgentRole,
    NetworkConfig,
    ChaosChainSDKError
)


class TestSDKImports:
    """Test that all SDK components can be imported."""
    
    def test_main_imports(self):
        """Test that main SDK classes can be imported."""
        from chaoschain_sdk import (
            ChaosChainAgentSDK,
            AgentRole,
            NetworkConfig,
            ChaosChainSDKError
        )
        
        assert ChaosChainAgentSDK is not None
        assert AgentRole is not None
        assert NetworkConfig is not None
        assert ChaosChainSDKError is not None
    
    def test_enum_values(self):
        """Test that enums have expected values."""
        assert AgentRole.SERVER.value == "server"
        assert AgentRole.VALIDATOR.value == "validator"
        assert AgentRole.CLIENT.value == "client"
        
        assert NetworkConfig.BASE_SEPOLIA.value == "base-sepolia"
        assert NetworkConfig.ETHEREUM_SEPOLIA.value == "ethereum-sepolia"


class TestSDKInitialization:
    """Test SDK initialization without network connections."""
    
    @patch('chaoschain_sdk.core_sdk.WalletManager')
    @patch('chaoschain_sdk.core_sdk.StorageManager')
    def test_sdk_init_minimal(self, mock_storage, mock_wallet):
        """Test SDK initialization with mocked dependencies."""
        # Mock wallet manager
        mock_wallet_instance = Mock()
        mock_wallet_instance.get_wallet_address.return_value = "0x1234567890123456789012345678901234567890"
        mock_wallet_instance.chain_id = 84532
        mock_wallet_instance.is_connected = True
        mock_wallet_instance.w3 = Mock()
        mock_wallet.return_value = mock_wallet_instance
        
        # Mock storage manager
        mock_storage_instance = Mock()
        mock_storage.return_value = mock_storage_instance
        
        # Mock ChaosAgent to avoid contract loading
        with patch('chaoschain_sdk.core_sdk.ChaosAgent') as mock_chaos_agent:
            mock_agent_instance = Mock()
            mock_agent_instance.get_agent_id.return_value = None
            mock_chaos_agent.return_value = mock_agent_instance
            
            # Initialize SDK
            sdk = ChaosChainAgentSDK(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                agent_role=AgentRole.SERVER,
                network=NetworkConfig.BASE_SEPOLIA,
                enable_process_integrity=False,  # Disable to avoid complex mocking
                enable_payments=False,
                enable_storage=False
            )
            
            assert sdk.agent_name == "TestAgent"
            assert sdk.agent_domain == "test.example.com"
            assert sdk.agent_role == AgentRole.SERVER
            assert sdk.network == NetworkConfig.BASE_SEPOLIA
    
    def test_agent_role_enum(self):
        """Test AgentRole enum functionality."""
        assert len(list(AgentRole)) == 3
        assert AgentRole.SERVER in AgentRole
        assert AgentRole.VALIDATOR in AgentRole
        assert AgentRole.CLIENT in AgentRole
    
    def test_network_config_enum(self):
        """Test NetworkConfig enum functionality."""
        networks = list(NetworkConfig)
        assert len(networks) >= 4  # At least 4 networks supported
        assert NetworkConfig.BASE_SEPOLIA in networks
        assert NetworkConfig.ETHEREUM_SEPOLIA in networks
        assert NetworkConfig.OPTIMISM_SEPOLIA in networks
        assert NetworkConfig.LOCAL in networks


class TestSDKTypes:
    """Test SDK type definitions."""
    
    def test_payment_method_enum(self):
        """Test PaymentMethod enum."""
        from chaoschain_sdk import PaymentMethod
        
        methods = list(PaymentMethod)
        assert len(methods) >= 5  # At least 5 payment methods
        assert PaymentMethod.A2A_X402 in methods
        assert PaymentMethod.BASIC_CARD in methods
    
    def test_integrity_proof_dataclass(self):
        """Test IntegrityProof dataclass."""
        from chaoschain_sdk import IntegrityProof
        from datetime import datetime
        
        proof = IntegrityProof(
            proof_id="test_proof_123",
            function_name="test_function",
            code_hash="abc123def456",
            execution_hash="def456ghi789",
            timestamp=datetime.now(),
            agent_name="TestAgent",
            verification_status="verified"
        )
        
        assert proof.proof_id == "test_proof_123"
        assert proof.function_name == "test_function"
        assert proof.verification_status == "verified"


class TestSDKExceptions:
    """Test SDK exception handling."""
    
    def test_base_exception(self):
        """Test base ChaosChainSDKError."""
        error = ChaosChainSDKError("Test error", {"key": "value"})
        
        assert str(error) == "Test error | Details: {'key': 'value'}"
        assert error.message == "Test error"
        assert error.details == {"key": "value"}
    
    def test_exception_inheritance(self):
        """Test that all SDK exceptions inherit from base."""
        from chaoschain_sdk import (
            AgentRegistrationError,
            PaymentError,
            StorageError,
            IntegrityVerificationError
        )
        
        assert issubclass(AgentRegistrationError, ChaosChainSDKError)
        assert issubclass(PaymentError, ChaosChainSDKError)
        assert issubclass(StorageError, ChaosChainSDKError)
        assert issubclass(IntegrityVerificationError, ChaosChainSDKError)


if __name__ == "__main__":
    pytest.main([__file__])
