#!/usr/bin/env python3
"""
Basic ChaosChain Agent Example

This example demonstrates how to create a simple agent using the ChaosChain SDK
that can register on ERC-8004, execute work with process integrity, and handle payments.
"""

import asyncio
import json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from chaoschain_sdk import (
    ChaosChainAgentSDK,
    AgentRole,
    NetworkConfig,
    GoogleAP2IntegrationResult
)

async def main():
    """Main example function demonstrating basic SDK usage."""
    
    print("🚀 ChaosChain SDK Basic Agent Example")
    print("=" * 50)
    
    # Initialize the agent
    print("\n1. Initializing Agent...")
    sdk = ChaosChainAgentSDK(
        agent_name="ExampleAgent",
        agent_domain="example-agent.chaoschain.com",
        agent_role=AgentRole.SERVER,
        network=NetworkConfig.BASE_SEPOLIA
    )
    
    print(f"   Agent: {sdk.agent_name}")
    print(f"   Domain: {sdk.agent_domain}")
    print(f"   Wallet: {sdk.wallet_address}")
    print(f"   Network: {sdk.network.value}")
    
    # Register agent identity
    print("\n2. Registering Agent Identity...")
    try:
        agent_id, tx_hash = sdk.register_identity()
        print(f"   ✅ Agent registered with ID: {agent_id}")
        print(f"   Transaction: {tx_hash}")
    except Exception as e:
        print(f"   ⚠️  Registration failed: {e}")
        print("   (This is normal if agent is already registered)")
    
    # Define a work function with process integrity
    print("\n3. Registering Work Function...")
    
    def analyze_data(input_data: str, analysis_type: str = "basic") -> dict:
        """Example analysis function that will be integrity-checked."""
        import time
        import random
        
        # Simulate some work
        time.sleep(0.1)
        
        result = {
            "input": input_data,
            "analysis_type": analysis_type,
            "result": f"Analyzed '{input_data}' using {analysis_type} method",
            "confidence": round(random.uniform(0.8, 0.99), 3),
            "timestamp": datetime.now().isoformat(),
            "agent": "ExampleAgent"
        }
        
        return result
    
    # Register the function for integrity checking
    code_hash = sdk.register_integrity_checked_function(analyze_data, "analyze_data")
    print(f"   ✅ Function registered with code hash: {code_hash[:16]}...")
    
    # Execute work with process integrity proof
    print("\n4. Executing Work with Process Integrity...")
    try:
        result, integrity_proof = await sdk.execute_with_integrity_proof(
            "analyze_data",
            {
                "input_data": "market_sentiment_data_2024", 
                "analysis_type": "advanced"
            }
        )
        
        print(f"   ✅ Work completed successfully")
        print(f"   Result: {result['result']}")
        print(f"   Confidence: {result['confidence']}")
        print(f"   Integrity Proof ID: {integrity_proof.proof_id}")
        if integrity_proof.ipfs_cid:
            print(f"   IPFS CID: {integrity_proof.ipfs_cid}")
        
    except Exception as e:
        print(f"   ❌ Work execution failed: {e}")
        return
    
    # Store evidence on IPFS
    print("\n5. Storing Evidence Package...")
    try:
        evidence_data = {
            "work_result": result,
            "integrity_proof": {
                "proof_id": integrity_proof.proof_id,
                "function_name": integrity_proof.function_name,
                "code_hash": integrity_proof.code_hash,
                "execution_hash": integrity_proof.execution_hash,
                "timestamp": integrity_proof.timestamp.isoformat(),
                "verification_status": integrity_proof.verification_status
            },
            "agent_info": {
                "name": sdk.agent_name,
                "domain": sdk.agent_domain,
                "wallet": sdk.wallet_address,
                "agent_id": sdk.get_agent_id()
            }
        }
        
        evidence_cid = sdk.store_evidence(evidence_data, "example_work")
        if evidence_cid:
            print(f"   ✅ Evidence stored on IPFS")
            print(f"   CID: {evidence_cid}")
        else:
            print(f"   ⚠️  Evidence storage not available (IPFS not configured)")
        
    except Exception as e:
        print(f"   ❌ Evidence storage failed: {e}")
    
    # Demonstrate Google AP2 Integration
    print("\n6. Google AP2 Integration...")
    try:
        # Create Intent Mandate
        intent_result = sdk.create_intent_mandate(
            user_description="Find me a good AI analysis service under $5",
            merchants=["ChaosChain", "ExampleAgent"],
            requires_refundability=False,
            expiry_minutes=60
        )
        
        if intent_result.success:
            print(f"   ✅ Intent Mandate created")
            print(f"   Description: {intent_result.intent_mandate.natural_language_description}")
            print(f"   Expires: {intent_result.intent_mandate.intent_expiry}")
            
            # Create Cart Mandate
            cart_result = sdk.create_cart_mandate(
                cart_id="cart_example_123",
                items=[
                    {"name": "AI Data Analysis", "price": 3.0},
                    {"name": "Processing Fee", "price": 0.5}
                ],
                total_amount=3.5,
                currency="USD",
                expiry_minutes=15
            )
            
            if cart_result.success:
                print(f"   ✅ Cart Mandate created with JWT")
                print(f"   Cart ID: {cart_result.cart_mandate.contents.id}")
                print(f"   JWT: {cart_result.jwt_token[:50]}...")
                
                # Verify the JWT
                payload = sdk.verify_jwt_token(cart_result.jwt_token)
                if payload:
                    print(f"   ✅ JWT verified successfully")
        
    except Exception as e:
        print(f"   ❌ AP2 integration demo failed: {e}")
    
    # Demonstrate A2A-x402 Multi-Payment Capabilities
    print("\n7. A2A-x402 Multi-Payment Capabilities...")
    try:
        # Create x402 payment request
        x402_request = sdk.create_x402_payment_request(
            cart_id="x402_demo_cart",
            total_amount=2.5,
            currency="USDC",
            items=[
                {"name": "Smart Analysis Service", "price": 2.0},
                {"name": "Network Fee", "price": 0.5}
            ]
        )
        
        print(f"   ✅ x402 Payment Request created")
        print(f"   Request ID: {x402_request.id}")
        print(f"   Settlement Address: {x402_request.settlement_address}")
        print(f"   Supported Networks: {x402_request.x402_methods[0].supported_networks}")
        
        # Show supported payment methods
        supported_methods = sdk.get_supported_payment_methods()
        print(f"   Supported W3C Payment Methods: {len(supported_methods)}")
        for method in supported_methods[:3]:
            method_name = method.split('/')[-1] if '/' in method else method
            print(f"     • {method_name}")
        if len(supported_methods) > 3:
            print(f"     • ... and {len(supported_methods) - 3} more")
        
    except Exception as e:
        print(f"   ❌ x402 multi-payment demo failed: {e}")
    
    # Create comprehensive evidence package
    print("\n8. Creating Evidence Package...")
    try:
        evidence_package = sdk.create_evidence_package(
            work_proof={
                "service_type": "data_analysis",
                "input_params": {"input_data": "market_sentiment_data_2024", "analysis_type": "advanced"},
                "output_data": result,
                "execution_time": "0.1s",
                "confidence": result['confidence']
            },
            integrity_proof=integrity_proof,
            payment_proofs=[],  # No actual payments in this example
            validation_results=[]  # No validations in this example
        )
        
        print(f"   ✅ Evidence package created")
        print(f"   Package ID: {evidence_package.package_id}")
        print(f"   Agent ID: {evidence_package.agent_identity.agent_id}")
        if evidence_package.ipfs_cid:
            print(f"   IPFS CID: {evidence_package.ipfs_cid}")
        
    except Exception as e:
        print(f"   ❌ Evidence package creation failed: {e}")
    
    print("\n" + "=" * 50)
    print("🎉 Basic Agent Example Completed Successfully!")
    print("\nNext steps:")
    print("• Fund your agent's wallet to enable real transactions")
    print("• Configure IPFS storage for evidence persistence") 
    print("• Implement validation workflows with other agents")
    print("• Build your custom agent logic using this foundation")
    print(f"\nAgent wallet address: {sdk.wallet_address}")
    print("Fund this address with Base Sepolia ETH to enable transactions.")

if __name__ == "__main__":
    asyncio.run(main())
