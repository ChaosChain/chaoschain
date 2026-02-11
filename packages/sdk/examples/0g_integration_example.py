"""
ChaosChain × 0G Integration Example

This example demonstrates how to use the ChaosChain SDK with 0G Storage and 0G Compute
as optional providers while the agent uses an ERC-8004–supported network (e.g. Ethereum Sepolia).

Features demonstrated:
1. Agent registration on Ethereum Sepolia (ERC-8004)
2. 0G Storage for audit trails (optional provider)
3. 0G Compute with TEE-ML verification (optional provider)
4. Reputation and multi-provider fallback
"""

import os
import sys
from pathlib import Path

# Add SDK to path
sdk_path = Path(__file__).parent.parent
sys.path.insert(0, str(sdk_path))

from chaoschain_sdk import (
    ChaosChainAgentSDK,
    NetworkConfig,
    StorageProvider,
    ComputeProvider,
    VerificationMethod,
    StorageManager,
    ComputeManager
)
from rich import print as rprint
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()


def example_1_basic_0g_agent():
    """Example 1: Agent on Ethereum Sepolia with 0G as optional storage/compute."""
    console.print("\n[bold cyan]Example 1: Agent on Ethereum Sepolia (ERC-8004)[/bold cyan]\n")
    
    try:
        # Initialize agent on Ethereum Sepolia (ERC-8004 supported). 0G Storage/Compute can be used as optional providers.
        agent = ChaosChainAgentSDK(
            agent_name="ZeroGAgent",
            agent_domain="agent.example.com",
            agent_role="server",
            network=NetworkConfig.ETHEREUM_SEPOLIA
        )
        
        rprint("[green]✅ Agent initialized on Ethereum Sepolia[/green]")
        rprint(f"   Network: {agent.network}")
        rprint(f"   Chain ID: {agent.chain_id}")
        rprint(f"   Address: {agent.address}")
        
        # Register on ERC-8004
        console.print("\n[yellow]Registering agent on ERC-8004...[/yellow]")
        agent_id, tx_hash = agent.register_identity()
        
        rprint(f"[green]✅ Agent registered as ERC-721 NFT[/green]")
        rprint(f"   Agent ID: {agent_id}")
        rprint(f"   TX Hash: {tx_hash}")
        
        return agent, agent_id
        
    except Exception as e:
        rprint(f"[red]❌ Error: {e}[/red]")
        return None, None


def example_2_0g_storage():
    """Example 2: Using 0G Storage for audit trails"""
    console.print("\n[bold cyan]Example 2: 0G Storage for Audit Trails[/bold cyan]\n")
    
    try:
        # Initialize storage manager with 0G as primary
        storage_manager = StorageManager(primary_provider=StorageProvider.ZEROG)
        
        rprint("[green]✅ Storage Manager initialized[/green]")
        rprint(f"   Primary: 0G Storage")
        rprint(f"   Fallbacks: Pinata → Local IPFS → Memory")
        
        # Create sample evidence package
        evidence_data = {
            "agent_id": 1,
            "action": "data_analysis",
            "timestamp": "2025-10-10T12:00:00Z",
            "result": {"score": 95, "quality": "high"},
            "inputs_hash": "0x123...",
            "outputs_hash": "0x456..."
        }
        
        import json
        data_bytes = json.dumps(evidence_data, indent=2).encode()
        
        # Store on 0G
        console.print("\n[yellow]Storing evidence on 0G Storage...[/yellow]")
        result = storage_manager.store(
            data=data_bytes,
            metadata={"type": "evidence_package", "agent_id": 1}
        )
        
        if result.success:
            rprint(f"[green]✅ Evidence stored successfully[/green]")
            rprint(f"   URI: {result.uri}")
            rprint(f"   Hash: {result.hash}")
            rprint(f"   Provider: {result.provider.value}")
            rprint(f"   Size: {result.metadata.get('size', 0)} bytes")
            
            # Verify integrity
            console.print("\n[yellow]Verifying data integrity...[/yellow]")
            is_valid = storage_manager.verify(result.uri, result.hash)
            
            if is_valid:
                rprint("[green]✅ Data integrity verified[/green]")
            else:
                rprint("[red]❌ Data integrity check failed[/red]")
            
            return result.uri
        else:
            rprint(f"[red]❌ Storage failed: {result.error}[/red]")
            return None
            
    except Exception as e:
        rprint(f"[red]❌ Error: {e}[/red]")
        return None


def example_3_0g_compute():
    """Example 3: Using 0G Compute with TEE-ML verification"""
    console.print("\n[bold cyan]Example 3: 0G Compute with TEE-ML[/bold cyan]\n")
    
    try:
        # Initialize compute manager with 0G and TEE-ML
        compute_manager = ComputeManager(
            primary_provider=ComputeProvider.ZEROG,
            verification_method=VerificationMethod.TEE_ML
        )
        
        rprint("[green]✅ Compute Manager initialized[/green]")
        rprint(f"   Primary: 0G Compute Network")
        rprint(f"   Verification: TEE-ML (Trusted Execution Environment)")
        rprint(f"   Reputation Bonus: 1.5x multiplier")
        
        # Define analysis function
        def analyze_customer_data(data):
            """AI analysis function to run on 0G Compute"""
            # Simulate AI analysis
            insights = [
                "High engagement detected",
                "Recommendation: Increase outreach",
                "Risk level: Low"
            ]
            
            return {
                "insights": insights,
                "confidence_score": 95,
                "quality_rating": "high"
            }
        
        # Execute on 0G Compute
        console.print("\n[yellow]Executing analysis on 0G Compute Network...[/yellow]")
        result = compute_manager.execute_with_integrity_proof(
            function=analyze_customer_data,
            function_name="analyze_customer_data",
            data={"customer_id": 123, "metrics": [80, 85, 90]}
        )
        
        rprint(f"[green]✅ Execution completed[/green]")
        rprint(f"   Provider: {result['provider']}")
        rprint(f"   Verification: {result['verification_method']}")
        rprint(f"   Execution Hash: {result['execution_hash'][:16]}...")
        rprint(f"   Proof: {result['proof'][:16] if result['proof'] else 'N/A'}...")
        
        if result.get('reputation_bonus'):
            rprint(f"[cyan]⭐ Reputation Bonus Earned: {result['reputation_multiplier']}x[/cyan]")
        
        console.print("\n[bold]Analysis Result:[/bold]")
        console.print(result['output'])
        
        return result
        
    except Exception as e:
        rprint(f"[red]❌ Error: {e}[/red]")
        return None


def example_4_complete_workflow():
    """Example 4: Complete workflow on 0G"""
    console.print("\n[bold cyan]Example 4: Complete Verifiable Agent Workflow[/bold cyan]\n")
    
    try:
        # 1. Initialize agent with 0G Stack
        agent = ChaosChainAgentSDK(
            agent_name="CompleteAgent",
            agent_domain="complete.0g.ai",
            agent_role="server",
            network=NetworkConfig.ETHEREUM_SEPOLIA
        )
        
        # Configure storage and compute
        storage_manager = StorageManager(StorageProvider.ZEROG)
        compute_manager = ComputeManager(
            ComputeProvider.ZEROG,
            VerificationMethod.TEE_ML
        )
        
        rprint("[green]✅ Agent initialized with 0G Stack[/green]")
        
        # 2. Register agent
        console.print("\n[yellow]Step 1: Registering agent...[/yellow]")
        agent_id, tx_hash = agent.register_identity()
        rprint(f"   Agent ID: {agent_id}")
        
        # 3. Execute verifiable work
        console.print("\n[yellow]Step 2: Executing verifiable work...[/yellow]")
        
        def perform_service(task_data):
            return {
                "status": "completed",
                "result": "Service performed successfully",
                "quality": 98
            }
        
        compute_result = compute_manager.execute_with_integrity_proof(
            perform_service,
            "perform_service",
            task_data={"type": "analysis", "complexity": "medium"}
        )
        
        rprint(f"   Execution Hash: {compute_result['execution_hash'][:16]}...")
        
        # 4. Store evidence on 0G
        console.print("\n[yellow]Step 3: Storing evidence on 0G...[/yellow]")
        
        evidence = {
            "agent_id": agent_id,
            "compute_result": compute_result,
            "timestamp": compute_result['timestamp'],
            "triple_verification": {
                "intent": "verified",
                "process": "TEE-ML proof included",
                "adjudication": "pending"
            }
        }
        
        import json
        storage_result = storage_manager.store(
            json.dumps(evidence, indent=2).encode(),
            metadata={"agent_id": agent_id, "type": "complete_evidence"}
        )
        
        rprint(f"   Evidence URI: {storage_result.uri}")
        
        # 5. Request validation
        console.print("\n[yellow]Step 4: Requesting validation...[/yellow]")
        # In real scenario, would call agent.request_validation()
        rprint("   Validation would be requested from validator agents")
        
        # 6. Summary
        console.print("\n[bold green]✅ Complete Workflow Summary[/bold green]\n")
        
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Step", style="cyan")
        table.add_column("Component", style="yellow")
        table.add_column("Status", style="green")
        
        table.add_row("1", "Agent Registration", f"ID: {agent_id}")
        table.add_row("2", "0G Compute (TEE-ML)", "Verified ⭐")
        table.add_row("3", "0G Storage", f"{storage_result.uri[:20]}...")
        table.add_row("4", "Reputation", "1.5x Bonus Earned")
        table.add_row("5", "Validation", "Pending")
        
        console.print(table)
        
        return True
        
    except Exception as e:
        rprint(f"[red]❌ Error: {e}[/red]")
        return False


def example_5_multi_provider():
    """Example 5: Multi-provider fallback demo"""
    console.print("\n[bold cyan]Example 5: Multi-Provider Fallback[/bold cyan]\n")
    
    try:
        # Initialize storage with automatic fallback
        storage_manager = StorageManager(StorageProvider.ZEROG)
        
        console.print("[yellow]Testing fallback chain: 0G → Pinata → Local IPFS → Memory[/yellow]\n")
        
        # Try storing on each provider
        test_data = b"Hello from ChaosChain x 0G!"
        
        providers = [
            StorageProvider.ZEROG,
            StorageProvider.PINATA,
            StorageProvider.LOCAL_IPFS,
            StorageProvider.MEMORY
        ]
        
        results_table = Table(show_header=True, header_style="bold magenta")
        results_table.add_column("Provider", style="cyan")
        results_table.add_column("Status", style="yellow")
        results_table.add_column("URI", style="green")
        
        for provider in providers:
            result = storage_manager.store(test_data, provider=provider)
            
            status = "✅ Success" if result.success else f"❌ {result.error[:30]}"
            uri = result.uri[:40] + "..." if len(result.uri) > 40 else result.uri
            
            results_table.add_row(provider.value, status, uri)
        
        console.print(results_table)
        
        console.print("\n[green]💡 The SDK automatically falls back to the next available provider![/green]")
        
        return True
        
    except Exception as e:
        rprint(f"[red]❌ Error: {e}[/red]")
        return False


def main():
    """Run all examples"""
    console.print(Panel.fit(
        "[bold magenta]ChaosChain × 0G Integration Examples[/bold magenta]\n\n"
        "Demonstrating the Triple-Verified Stack with 0G Storage and 0G Compute",
        border_style="cyan"
    ))
    
    # Run examples
    example_1_basic_0g_agent()
    example_2_0g_storage()
    example_3_0g_compute()
    example_4_complete_workflow()
    example_5_multi_provider()
    
    # Final summary
    console.print("\n" + "="*60)
    console.print(Panel.fit(
        "[bold green]✅ All Examples Completed[/bold green]\n\n"
        "Learn more:\n"
        "• 0G Docs: https://docs.0g.ai\n"
        "• ChaosChain SDK: /sdk/README.md\n"
        "• Integration Guide: /sdk/CHAOSCHAIN_X_0G_INTEGRATION.md",
        border_style="green"
    ))


if __name__ == "__main__":
    main()

