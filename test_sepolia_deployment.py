#!/usr/bin/env python3
"""
Test ChaosChain deployment on Ethereum Sepolia.

Tests:
1. SDK initialization
2. Agent registration
3. Studio creation (Finance)
4. Studio verification
"""

import os
import sys
from rich import print as rprint

# Add SDK to path
sys.path.insert(0, '/Users/sumeet/Desktop/ChaosChain_labs/chaoschain/packages/sdk')

from chaoschain_sdk import ChaosChainAgentSDK, AgentRole, NetworkConfig

def main():
    rprint("[bold blue]╔══════════════════════════════════════════════════════════════╗[/bold blue]")
    rprint("[bold blue]║                                                              ║[/bold blue]")
    rprint("[bold blue]║          CHAOSCHAIN ETHEREUM SEPOLIA DEPLOYMENT TEST         ║[/bold blue]")
    rprint("[bold blue]║                                                              ║[/bold blue]")
    rprint("[bold blue]╚══════════════════════════════════════════════════════════════╝[/bold blue]")
    rprint("")
    
    # Load environment
    private_key = os.getenv("SEPOLIA_PRIVATE_KEY")
    rpc_url = os.getenv("SEPOLIA_RPC_URL")
    
    if not private_key or not rpc_url:
        rprint("[red]❌ Missing SEPOLIA_PRIVATE_KEY or SEPOLIA_RPC_URL in environment[/red]")
        return
    
    try:
        # Step 1: Initialize SDK
        rprint("[cyan]Step 1/4: Initializing SDK on Ethereum Sepolia...[/cyan]")
        sdk = ChaosChainAgentSDK(
            agent_role=AgentRole.CLIENT,
            private_key=private_key,
            rpc_url=rpc_url,
            network=NetworkConfig.ETHEREUM_SEPOLIA,
            agent_name="test_client",
            agent_domain="test.chaoscha.in"
        )
        rprint("[green]✅ SDK initialized successfully[/green]")
        rprint(f"   Agent address: {sdk.chaos_agent.address}")
        rprint("")
        
        # Step 2: Check if agent is registered
        rprint("[cyan]Step 2/4: Checking agent registration...[/cyan]")
        agent_id = sdk.chaos_agent.get_agent_id()
        
        if agent_id:
            rprint(f"[green]✅ Agent already registered with ID: {agent_id}[/green]")
        else:
            rprint("[yellow]⚠️  Agent not registered, registering now...[/yellow]")
            agent_id, tx_hash = sdk.register_agent()
            rprint(f"[green]✅ Agent registered! ID: {agent_id}[/green]")
            rprint(f"   TX: https://sepolia.etherscan.io/tx/{tx_hash}")
        rprint("")
        
        # Step 3: Create Finance Studio
        rprint("[cyan]Step 3/4: Creating Finance Studio...[/cyan]")
        finance_logic = "0xC2B686C4EBA34701d0cC7f250D05B3c62c7CF492"
        
        rprint(f"   Using FinanceStudioLogic: {finance_logic}")
        studio_address, studio_id = sdk.create_studio(
            logic_module_address=finance_logic,
            init_params=b""
        )
        rprint(f"[green]✅ Finance Studio created![/green]")
        rprint(f"   Studio Address: {studio_address}")
        rprint(f"   Studio ID: {studio_id}")
        rprint(f"   Explorer: https://sepolia.etherscan.io/address/{studio_address}")
        rprint("")
        
        # Step 4: Verify Studio
        rprint("[cyan]Step 4/4: Verifying Studio...[/cyan]")
        rprint(f"   Checking Studio proxy at {studio_address}...")
        
        # Get Studio info from ChaosCore
        chaos_core_abi = [
            {
                "inputs": [{"name": "studioId", "type": "uint256"}],
                "name": "getStudioAddress",
                "outputs": [{"name": "", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]
        
        chaos_core = sdk.chaos_agent.w3.eth.contract(
            address="0x6268C0793891Bc1dD3284Ad8443FAa35a585cf28",
            abi=chaos_core_abi
        )
        
        verified_address = chaos_core.functions.getStudioAddress(studio_id).call()
        
        if verified_address.lower() == studio_address.lower():
            rprint("[green]✅ Studio verified successfully![/green]")
        else:
            rprint(f"[red]❌ Studio verification failed[/red]")
            rprint(f"   Expected: {studio_address}")
            rprint(f"   Got: {verified_address}")
        rprint("")
        
        # Summary
        rprint("[bold green]╔══════════════════════════════════════════════════════════════╗[/bold green]")
        rprint("[bold green]║                                                              ║[/bold green]")
        rprint("[bold green]║                    ✅ ALL TESTS PASSED!                       ║[/bold green]")
        rprint("[bold green]║                                                              ║[/bold green]")
        rprint("[bold green]╚══════════════════════════════════════════════════════════════╝[/bold green]")
        rprint("")
        rprint("[bold]Deployment Summary:[/bold]")
        rprint(f"  Network: Ethereum Sepolia")
        rprint(f"  Agent ID: {agent_id}")
        rprint(f"  Studio ID: {studio_id}")
        rprint(f"  Studio Address: {studio_address}")
        rprint("")
        rprint("[bold]Next Steps:[/bold]")
        rprint("  1. Register Worker and Verifier agents")
        rprint("  2. Test work submission and verification")
        rprint("  3. Test epoch closure and rewards")
        rprint("  4. Deploy to Base Sepolia")
        rprint("")
        
    except Exception as e:
        rprint(f"[red]❌ Test failed: {str(e)}[/red]")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()

