"""
Basic tests for ChaosChain SDK functionality.

These tests verify that the SDK can be imported and basic functionality works
without requiring network connections or external services.
"""

import pytest
from unittest.mock import Mock, patch
from eth_account import Account

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
        """Test that enums have expected values (including legacy aliases)."""
        assert AgentRole.WORKER.value == "worker"
        assert AgentRole.VERIFIER.value == "verifier"
        assert AgentRole.CLIENT.value == "client"
        # Legacy aliases map to the worker/verifier values
        assert AgentRole.SERVER.value == AgentRole.WORKER.value
        assert AgentRole.VALIDATOR.value == AgentRole.VERIFIER.value
        
        assert NetworkConfig.BASE_SEPOLIA.value == "base-sepolia"
        assert NetworkConfig.ETHEREUM_SEPOLIA.value == "ethereum-sepolia"


class TestSDKInitialization:
    """Test SDK initialization without network connections."""
    
    @patch('chaoschain_sdk.core_sdk.WalletManager')
    def test_sdk_init_minimal(self, mock_wallet):
        """Test SDK initialization with mocked dependencies."""
        # Mock wallet manager
        mock_wallet_instance = Mock()
        mock_wallet_instance.get_wallet_address.return_value = "0x1234567890123456789012345678901234567890"
        mock_wallet_instance.chain_id = 84532
        mock_wallet_instance.is_connected = True
        mock_wallet_instance.w3 = Mock()
        mock_wallet.return_value = mock_wallet_instance
        
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
        roles = list(AgentRole)
        assert len(roles) == 4  # Includes WORKER/VERIFIER/CLIENT/ORCHESTRATOR
        assert AgentRole.WORKER in roles
        assert AgentRole.VERIFIER in roles
        assert AgentRole.CLIENT in roles
        assert AgentRole.ORCHESTRATOR in roles
    
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
        from chaoschain_sdk.types import IntegrityProof
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
            PaymentError,
            StorageError,
            NetworkError,
            ContractError,
            ValidationError,
        )
        
        assert issubclass(PaymentError, ChaosChainSDKError)
        assert issubclass(StorageError, ChaosChainSDKError)
        assert issubclass(NetworkError, ChaosChainSDKError)
        assert issubclass(ContractError, ChaosChainSDKError)
        assert issubclass(ValidationError, ChaosChainSDKError)


class TestMandatesIntegration:
    """Test mandates-core integration surfaces."""

    def test_mandate_signing_mutates_dict_and_verifies(self):
        """Ensure SDK mandate helpers mutate dicts and verify signatures."""
        # Mock wallet manager with deterministic chain id and account
        wallet = Mock()
        wallet.chain_id = 1
        server_account = Account.create()
        wallet.create_or_load_wallet.return_value = server_account
        wallet.get_wallet_address.return_value = server_account.address
        wallet.is_connected = True
        wallet.w3 = Mock()

        with patch('chaoschain_sdk.core_sdk.WalletManager', return_value=wallet):
            with patch('chaoschain_sdk.core_sdk.ChaosAgent') as mock_agent:
                mock_agent.return_value = Mock(get_agent_id=Mock(return_value=None))

                sdk = ChaosChainAgentSDK(
                    agent_name="ServerAgent",
                    agent_domain="server.example.com",
                    agent_role=AgentRole.WORKER,
                    network=NetworkConfig.BASE_SEPOLIA,
                    enable_process_integrity=False,
                    enable_payments=False,
                    enable_storage=False,
                    enable_ap2=False,
                )

        client_account = Account.create()
        client_caip10 = f"eip155:{wallet.chain_id}:{client_account.address}"

        mandate = sdk.create_mandate(
            intent="Test deterministic mandate",
            core={"kind": "test@1", "payload": {"foo": "bar"}},
            deadline="2025-12-31T00:00:00Z",
            client=client_caip10,
        )

        mandate_dict = mandate.to_dict()

        # Sign as server (default wallet) and client (explicit key)
        sdk.sign_mandate_as_server(mandate_dict)
        sdk.sign_mandate_as_client(mandate_dict, client_account.key.hex())

        signatures = mandate_dict.get("signatures", {})
        assert "serverSig" in signatures
        assert "clientSig" in signatures

        verification = sdk.verify_mandate(mandate_dict)
        assert verification["all_ok"] is True
        assert verification["mandate_hash"] == mandate.compute_mandate_hash()


if __name__ == "__main__":
    pytest.main([__file__])
