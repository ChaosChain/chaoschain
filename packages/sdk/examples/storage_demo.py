#!/usr/bin/env python3
"""
ChaosChain SDK Storage Demo

This demo shows how to use the new pluggable storage system with multiple providers.
No more vendor lock-in! Choose the storage solution that works for you.
"""

import os
import json
from rich.console import Console
from rich.table import Table
from rich import print as rprint

# Import the new storage system
from chaoschain_sdk.storage import (
    create_storage_manager, 
    UnifiedStorageManager,
    StorageProvider
)

console = Console()


def demo_auto_detection():
    """Demo automatic provider detection."""
    rprint("\n[bold blue]🎯 Demo 1: Auto-Detection[/bold blue]")
    rprint("The SDK automatically detects the best available storage provider:")
    
    try:
        # Auto-detect best provider
        storage = create_storage_manager()
        
        # Show what was detected
        info = storage.get_provider_info()
        rprint(f"✅ Auto-detected: {info['name']} ({'Free' if info['is_free'] else 'Paid'})")
        
        return storage
    except Exception as e:
        rprint(f"❌ Auto-detection failed: {e}")
        return None


def demo_local_ipfs():
    """Demo local IPFS (free option)."""
    rprint("\n[bold green]🆓 Demo 2: Local IPFS (Free!)[/bold green]")
    
    try:
        # Use local IPFS node
        storage = create_storage_manager("local_ipfs")
        
        # Upload some test data
        test_data = {
            "agent_id": "demo-agent",
            "evidence": "This is verifiable evidence",
            "timestamp": "2024-01-01T00:00:00Z",
            "cost": "FREE!"
        }
        
        cid = storage.upload_json(test_data, "demo_evidence.json")
        if cid:
            rprint(f"📁 Uploaded to IPFS: {cid}")
            rprint(f"🌐 Gateway URL: {storage.get_gateway_url(cid)}")
            
            # Retrieve it back
            retrieved = storage.retrieve_json(cid)
            rprint(f"✅ Retrieved: {retrieved['cost']}")
        
        return storage
    except Exception as e:
        rprint(f"❌ Local IPFS not available: {e}")
        rprint("💡 To set up: brew install ipfs && ipfs init && ipfs daemon")
        return None


def demo_multiple_providers():
    """Demo using multiple providers with fallback."""
    rprint("\n[bold yellow]🔄 Demo 3: Multiple Providers with Fallback[/bold yellow]")
    
    try:
        # Create storage with primary + fallback
        storage = UnifiedStorageManager(
            primary_provider=StorageProvider.LOCAL_IPFS,
            fallback_providers=[StorageProvider.PINATA]
        )
        
        # Upload will try local IPFS first, then Pinata if needed
        test_data = {"message": "Multi-provider upload test"}
        cid = storage.upload_json(test_data, "multi_test.json")
        
        if cid:
            rprint(f"📁 Uploaded with fallback support: {cid}")
        
        return storage
    except Exception as e:
        rprint(f"❌ Multi-provider setup failed: {e}")
        return None


def demo_provider_comparison():
    """Demo comparing different providers."""
    rprint("\n[bold magenta]📊 Demo 4: Provider Comparison[/bold magenta]")
    
    # Create a comparison table
    table = Table(title="Storage Provider Comparison")
    table.add_column("Provider", style="cyan")
    table.add_column("Cost", style="green")
    table.add_column("Setup", style="yellow")
    table.add_column("API Key", style="red")
    table.add_column("Status", style="blue")
    
    # Try to get info for each provider
    storage = create_storage_manager()
    providers = storage.list_available_providers()
    
    for provider in providers:
        cost = "🆓 Free" if provider['is_free'] else "💰 Paid"
        api_key = "✅ Required" if provider['requires_api_key'] else "❌ Not needed"
        status = "✅ Available" if provider['available'] else "❌ Unavailable"
        
        table.add_row(
            provider['name'],
            cost,
            "Easy" if provider['available'] else "Setup needed",
            api_key,
            status
        )
    
    console.print(table)


def demo_marketplace_use_case():
    """Demo marketplace-specific storage patterns."""
    rprint("\n[bold cyan]🏪 Demo 5: Marketplace Use Case[/bold cyan]")
    
    try:
        storage = create_storage_manager()
        
        # Marketplace data that needs to be stored
        marketplace_data = {
            "marketplace_id": "ai-services-hub",
            "services": [
                {
                    "service_id": "text-analysis",
                    "provider": "agent-123",
                    "price_usdc": 0.50,
                    "evidence_cid": None  # Will be filled
                },
                {
                    "service_id": "image-generation", 
                    "provider": "agent-456",
                    "price_usdc": 2.00,
                    "evidence_cid": None
                }
            ],
            "reputation_scores": {
                "agent-123": 4.8,
                "agent-456": 4.9
            }
        }
        
        # Store marketplace catalog
        catalog_cid = storage.upload_json(marketplace_data, "marketplace_catalog.json")
        
        # Store service evidence for each provider
        for service in marketplace_data["services"]:
            evidence = {
                "service_id": service["service_id"],
                "provider": service["provider"],
                "verification_proof": f"proof_for_{service['service_id']}",
                "quality_metrics": {"accuracy": 0.95, "speed": "fast"}
            }
            
            evidence_cid = storage.upload_json(evidence, f"evidence_{service['service_id']}.json")
            service["evidence_cid"] = evidence_cid
        
        # Update catalog with evidence CIDs
        updated_catalog_cid = storage.upload_json(marketplace_data, "marketplace_catalog_final.json")
        
        rprint(f"🏪 Marketplace catalog: {storage.get_gateway_url(updated_catalog_cid)}")
        rprint("✅ All service evidence stored with verifiable proofs!")
        
    except Exception as e:
        rprint(f"❌ Marketplace demo failed: {e}")


def main():
    """Run all storage demos."""
    rprint("[bold]🚀 ChaosChain SDK - New Pluggable Storage System Demo[/bold]")
    rprint("No more vendor lock-in! Choose your storage provider freely.\n")
    
    # Run demos
    demo_auto_detection()
    demo_local_ipfs()
    demo_multiple_providers()
    demo_provider_comparison()
    demo_marketplace_use_case()
    
    rprint("\n[bold green]🎉 Demo Complete![/bold green]")
    rprint("Key benefits:")
    rprint("✅ No vendor lock-in - choose any provider")
    rprint("✅ Free option available - local IPFS")
    rprint("✅ Fallback support - automatic provider switching")
    rprint("✅ Same API - easy migration from old system")
    rprint("✅ Marketplace-ready - perfect for AI service hubs")


if __name__ == "__main__":
    main()
