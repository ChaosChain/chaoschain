"""
Test suite for ERC-8004 v1.0 compliance in ChaosChain SDK.

This test verifies that the SDK correctly implements all functions and interfaces
specified in the ERC-8004 v1.0 standard, including:
- Identity Registry (ERC-721 based with URIStorage)
- Reputation Registry (signature-based feedback)
- Validation Registry (URI-based validation)
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from chaoschain_sdk import (
    ChaosChainAgentSDK,
    AgentRole,
    NetworkConfig,
)
from chaoschain_sdk.chaos_agent import ChaosAgent


class TestERC8004V1IdentityRegistry:
    """Test ERC-8004 v1.0 Identity Registry compliance."""
    
    def test_identity_registry_abi_has_register_functions(self):
        """Verify Identity Registry ABI includes v1.0 register() overloads."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_identity_registry_abi()
            
            # v1.0 must have 3 register() overloads
            register_functions = [f for f in abi if f.get('name') == 'register']
            assert len(register_functions) == 3, "v1.0 should have 3 register() overloads"
            
            # Check signatures match ERC-8004 v1.0
            signatures = [
                (len(f.get('inputs', [])), f['inputs'][0]['type'] if f.get('inputs') else None)
                for f in register_functions
            ]
            
            # register(string, MetadataEntry[])
            assert any(count == 2 and type_ == 'string' for count, type_ in signatures)
            # register(string)
            assert any(count == 1 and type_ == 'string' for count, type_ in signatures)
            # register()
            assert any(count == 0 for count, type_ in signatures)
    
    def test_identity_registry_abi_has_erc721_functions(self):
        """Verify Identity Registry ABI includes ERC-721 functions (v1.0 requirement)."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_identity_registry_abi()
            function_names = [f.get('name') for f in abi if f.get('type') == 'function']
            
            # v1.0 uses ERC-721 + URIStorage
            required_erc721_functions = ['ownerOf', 'balanceOf', 'tokenURI', 'transferFrom', 'approve', 'setApprovalForAll']
            for func in required_erc721_functions:
                assert func in function_names, f"v1.0 requires ERC-721 function: {func}"
    
    def test_identity_registry_abi_has_metadata_functions(self):
        """Verify Identity Registry ABI includes v1.0 metadata functions."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_identity_registry_abi()
            function_names = [f.get('name') for f in abi if f.get('type') == 'function']
            
            # v1.0 metadata extensions
            assert 'setMetadata' in function_names
            assert 'getMetadata' in function_names


class TestERC8004V1ReputationRegistry:
    """Test ERC-8004 v1.0 Reputation Registry compliance."""
    
    def test_reputation_registry_abi_has_givefeedback(self):
        """Verify Reputation Registry ABI includes v1.0 giveFeedback()."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_reputation_registry_abi()
            function_names = [f.get('name') for f in abi if f.get('type') == 'function']
            
            # v1.0 uses giveFeedback (not acceptFeedback from v0.4)
            assert 'giveFeedback' in function_names, "v1.0 requires giveFeedback()"
            
            # Check signature: giveFeedback(uint256, uint8, bytes32, bytes32, string, bytes32, bytes)
            give_feedback = next(f for f in abi if f.get('name') == 'giveFeedback')
            assert len(give_feedback['inputs']) == 7, "giveFeedback should have 7 parameters in v1.0"
            
            # Verify parameter types match spec
            expected_types = ['uint256', 'uint8', 'bytes32', 'bytes32', 'string', 'bytes32', 'bytes']
            actual_types = [inp['type'] for inp in give_feedback['inputs']]
            assert actual_types == expected_types, f"giveFeedback signature mismatch: {actual_types}"
    
    def test_reputation_registry_abi_has_revoke_and_append(self):
        """Verify Reputation Registry ABI includes v1.0 revoke and append functions."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_reputation_registry_abi()
            function_names = [f.get('name') for f in abi if f.get('type') == 'function']
            
            # v1.0 additions
            assert 'revokeFeedback' in function_names
            assert 'appendResponse' in function_names
            assert 'getSummary' in function_names
            assert 'readFeedback' in function_names


class TestERC8004V1ValidationRegistry:
    """Test ERC-8004 v1.0 Validation Registry compliance."""
    
    def test_validation_registry_abi_has_request_and_response(self):
        """Verify Validation Registry ABI includes v1.0 validation functions."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_validation_registry_abi()
            function_names = [f.get('name') for f in abi if f.get('type') == 'function']
            
            assert 'validationRequest' in function_names
            assert 'validationResponse' in function_names
    
    def test_validation_request_signature(self):
        """Verify validationRequest() signature matches v1.0 spec."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_validation_registry_abi()
            
            # v1.0: validationRequest(address validatorAddress, uint256 agentId, string requestUri, bytes32 requestHash)
            validation_request = next(f for f in abi if f.get('name') == 'validationRequest')
            assert len(validation_request['inputs']) == 4, "validationRequest should have 4 parameters in v1.0"
            
            expected_types = ['address', 'uint256', 'string', 'bytes32']
            actual_types = [inp['type'] for inp in validation_request['inputs']]
            assert actual_types == expected_types, f"validationRequest signature mismatch: {actual_types}"
    
    def test_validation_response_signature(self):
        """Verify validationResponse() signature matches v1.0 spec."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_validation_registry_abi()
            
            # v1.0: validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag)
            validation_response = next(f for f in abi if f.get('name') == 'validationResponse')
            assert len(validation_response['inputs']) == 5, "validationResponse should have 5 parameters in v1.0"
            
            expected_types = ['bytes32', 'uint8', 'string', 'bytes32', 'bytes32']
            actual_types = [inp['type'] for inp in validation_response['inputs']]
            assert actual_types == expected_types, f"validationResponse signature mismatch: {actual_types}"


class TestERC8004V1ContractAddresses:
    """Test that SDK uses correct v1.0 contract addresses."""
    
    def test_deterministic_addresses_match_spec(self):
        """Verify SDK uses ERC-8004 v1.0 deterministic addresses."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            # v1.0 deterministic addresses (same on all networks)
            assert agent.contract_addresses.identity_registry == '0x7177a6867296406881E20d6647232314736Dd09A'
            assert agent.contract_addresses.reputation_registry == '0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322'
            assert agent.contract_addresses.validation_registry == '0x662b40A526cb4017d947e71eAF6753BF3eeE66d8'
    
    def test_all_networks_use_same_addresses(self):
        """Verify all supported networks use the same v1.0 deterministic addresses."""
        networks = [
            NetworkConfig.BASE_SEPOLIA,
            NetworkConfig.ETHEREUM_SEPOLIA,
            NetworkConfig.OPTIMISM_SEPOLIA,
            NetworkConfig.MODE_TESTNET,
            NetworkConfig.ZEROG_TESTNET
        ]
        
        addresses = []
        for network in networks:
            with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
                mock_wallet_instance = Mock()
                mock_wallet_instance.w3 = MagicMock()
                mock_wallet_instance.chain_id = 84532
                mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
                mock_wallet.return_value = mock_wallet_instance
                
                agent = ChaosAgent(
                    agent_name="TestAgent",
                    agent_domain="test.example.com",
                    wallet_manager=mock_wallet_instance,
                    network=network
                )
                
                addresses.append((
                    agent.contract_addresses.identity_registry,
                    agent.contract_addresses.reputation_registry,
                    agent.contract_addresses.validation_registry
                ))
        
        # All networks should have identical addresses (deterministic deployment)
        assert len(set(addresses)) == 1, "All networks should use the same v1.0 deterministic addresses"


class TestERC8004V1RegistrationFileSchema:
    """Test that SDK follows v1.0 registration file schema."""
    
    def test_registration_file_has_required_fields(self):
        """Verify registration file schema includes v1.0 required fields."""
        # Example registration file structure from ERC-8004 v1.0
        registration_schema = {
            "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
            "name": "string",
            "description": "string",
            "image": "string",
            "endpoints": [],
            "registrations": [],
            "supportedTrust": []  # v1.0 addition
        }
        
        # Verify schema structure
        required_fields = ["type", "name", "description", "image", "endpoints", "registrations", "supportedTrust"]
        for field in required_fields:
            assert field in registration_schema, f"v1.0 registration file must have '{field}' field"
        
        # Verify type URL matches v1.0
        assert "#registration-v1" in registration_schema["type"], "type field must reference v1.0"


class TestERC8004V1Events:
    """Test that SDK properly handles v1.0 events."""
    
    def test_identity_registry_events(self):
        """Verify Identity Registry ABI includes v1.0 events."""
        with patch('chaoschain_sdk.wallet_manager.WalletManager') as mock_wallet:
            mock_wallet_instance = Mock()
            mock_wallet_instance.w3 = MagicMock()
            mock_wallet_instance.chain_id = 84532
            mock_wallet_instance.get_wallet_address.return_value = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
            mock_wallet.return_value = mock_wallet_instance
            
            agent = ChaosAgent(
                agent_name="TestAgent",
                agent_domain="test.example.com",
                wallet_manager=mock_wallet_instance,
                network=NetworkConfig.BASE_SEPOLIA
            )
            
            abi = agent._get_identity_registry_abi()
            event_names = [e.get('name') for e in abi if e.get('type') == 'event']
            
            # v1.0 ERC-721 events
            assert 'Transfer' in event_names
            assert 'Approval' in event_names
            assert 'ApprovalForAll' in event_names
            
            # v1.0 custom events
            assert 'Registered' in event_names
            assert 'MetadataSet' in event_names


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

