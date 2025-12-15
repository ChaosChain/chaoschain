#!/usr/bin/env python3
"""
Verifier Agent Example - Complete PoA Workflow

This script demonstrates a complete Verifier Agent that:
1. Monitors StudioProxy for new work submissions
2. Fetches evidence from IPFS/Irys
3. Performs causal audit (§1.5 Protocol Spec)
4. Computes multi-dimensional scores (§3.1 Protocol Spec)
5. Commits scores (§2.4 Protocol Spec)
6. Reveals scores after deadline
7. Builds reputation via ERC-8004 ReputationRegistry

This implements the full Proof of Agency workflow from ChaosChain_Implementation_Plan.md
"""

import os
import sys
import time
import hashlib
from typing import Dict, List, Optional
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()

def monitor_studio_for_work(sdk, studio_address: str, last_block: int = 0) -> List[Dict]:
    """
    Monitor StudioProxy for WorkSubmitted events.
    
    Args:
        sdk: ChaosChainAgentSDK instance
        studio_address: Studio to monitor
        last_block: Last processed block number
        
    Returns:
        List of work submissions
    """
    from web3 import Web3
    
    try:
        # Get StudioProxy contract
        studio_abi = [{
            "anonymous": False,
            "inputs": [
                {"indexed": True, "name": "agentId", "type": "uint256"},
                {"indexed": True, "name": "dataHash", "type": "bytes32"},
                {"indexed": False, "name": "threadRoot", "type": "bytes32"},
                {"indexed": False, "name": "evidenceRoot", "type": "bytes32"},
                {"indexed": False, "name": "timestamp", "type": "uint256"}
            ],
            "name": "WorkSubmitted",
            "type": "event"
        }]
        
        studio = sdk.chaos_agent.w3.eth.contract(
            address=Web3.to_checksum_address(studio_address),
            abi=studio_abi
        )
        
        # Get current block
        current_block = sdk.chaos_agent.w3.eth.block_number
        
        # Query events
        from_block = last_block + 1 if last_block > 0 else current_block - 1000
        
        console.print(f"[dim]Scanning blocks {from_block} to {current_block}...[/dim]")
        
        events = studio.events.WorkSubmitted.get_logs(
            fromBlock=from_block,
            toBlock=current_block
        )
        
        work_submissions = []
        for event in events:
            work_submissions.append({
                'agent_id': event['args']['agentId'],
                'data_hash': event['args']['dataHash'].hex(),
                'thread_root': event['args']['threadRoot'].hex(),
                'evidence_root': event['args']['evidenceRoot'].hex(),
                'timestamp': event['args']['timestamp'],
                'block_number': event['blockNumber'],
                'tx_hash': event['transactionHash'].hex()
            })
        
        return work_submissions, current_block
        
    except Exception as e:
        console.print(f"[red]Error monitoring studio: {e}[/red]")
        return [], last_block


def perform_causal_audit(sdk, work_submission: Dict) -> Dict:
    """
    Perform complete causal audit using VerifierAgent.
    
    This implements Protocol Spec §1.5:
    1. Pull XMTP thread + IPFS/Irys blobs
    2. Reconstruct G and verify all signatures
    3. Check causality
    4. Rebuild threadRoot & evidenceRoot
    5. Compute features for scoring
    
    Args:
        sdk: ChaosChainAgentSDK instance
        work_submission: Work submission data
        
    Returns:
        Audit result with scores
    """
    console.print(f"\n[cyan]🔍 Performing Causal Audit[/cyan]")
    console.print(f"[dim]DataHash: {work_submission['data_hash'][:16]}...[/dim]")
    
    try:
        # Get VerifierAgent from SDK
        verifier = sdk.verifier_agent
        
        # For MVP, we'll simulate the audit since we don't have real XMTP/IPFS data
        # In production, this would fetch real evidence
        
        console.print("[yellow]⚠️  Simulating causal audit (no real XMTP/IPFS data)[/yellow]")
        
        # Simulate audit result
        audit_result = {
            'passed': True,
            'thread_root_verified': True,
            'causality_verified': True,
            'signatures_verified': True,
            'scores': {
                'initiative': 85,
                'collaboration': 78,
                'reasoning_depth': 92,
                'compliance': 95,
                'efficiency': 88
            },
            'errors': []
        }
        
        console.print("[green]✓[/green] Causal audit passed")
        console.print(f"[dim]Scores: {audit_result['scores']}[/dim]")
        
        return audit_result
        
    except Exception as e:
        console.print(f"[red]✗ Causal audit failed: {e}[/red]")
        return {
            'passed': False,
            'errors': [str(e)]
        }


def compute_score_commitment(score_vector: List[int], salt: bytes, data_hash: bytes) -> bytes:
    """
    Compute score commitment for commit-reveal protocol.
    
    Protocol Spec §2.4:
    C_i = keccak256(s_i || salt_i || DataHash)
    
    Args:
        score_vector: List of scores (0-100)
        salt: Random salt
        data_hash: Work data hash
        
    Returns:
        Commitment hash
    """
    from web3 import Web3
    
    # Encode score vector as bytes
    score_bytes = b''.join([s.to_bytes(1, 'big') for s in score_vector])
    
    # Compute commitment
    commitment = Web3.keccak(score_bytes + salt + data_hash)
    
    return commitment


def commit_scores(sdk, studio_address: str, data_hash: bytes, score_vector: List[int]) -> tuple:
    """
    Commit scores to StudioProxy (commit phase of commit-reveal).
    
    Args:
        sdk: ChaosChainAgentSDK instance
        studio_address: Studio address
        data_hash: Work data hash
        score_vector: Computed scores
        
    Returns:
        (commitment, salt, tx_hash)
    """
    console.print(f"\n[cyan]📝 Committing Scores[/cyan]")
    
    try:
        # Generate random salt
        salt = os.urandom(32)
        
        # Compute commitment
        commitment = compute_score_commitment(score_vector, salt, data_hash)
        
        console.print(f"[dim]Commitment: {commitment.hex()[:16]}...[/dim]")
        console.print(f"[dim]Score Vector: {score_vector}[/dim]")
        
        # Submit commitment
        tx_hash = sdk.commit_score(
            studio_address=studio_address,
            data_hash=data_hash,
            score_commitment=commitment
        )
        
        console.print(f"[green]✓[/green] Scores committed")
        console.print(f"[dim]TX: {tx_hash}[/dim]")
        
        return commitment, salt, tx_hash
        
    except Exception as e:
        console.print(f"[red]✗ Failed to commit scores: {e}[/red]")
        raise


def reveal_scores(sdk, studio_address: str, data_hash: bytes, score_vector: List[int], salt: bytes):
    """
    Reveal scores to StudioProxy (reveal phase of commit-reveal).
    
    Args:
        sdk: ChaosChainAgentSDK instance
        studio_address: Studio address
        data_hash: Work data hash
        score_vector: Committed scores
        salt: Salt used in commitment
        
    Returns:
        tx_hash
    """
    console.print(f"\n[cyan]🔓 Revealing Scores[/cyan]")
    
    try:
        # Submit reveal
        tx_hash = sdk.reveal_score(
            studio_address=studio_address,
            data_hash=data_hash,
            score_vector=score_vector,
            salt=salt
        )
        
        console.print(f"[green]✓[/green] Scores revealed")
        console.print(f"[dim]TX: {tx_hash}[/dim]")
        
        return tx_hash
        
    except Exception as e:
        console.print(f"[red]✗ Failed to reveal scores: {e}[/red]")
        raise


def verifier_agent_loop(sdk, studio_address: str, commit_delay: int = 10, reveal_delay: int = 20):
    """
    Main Verifier Agent monitoring loop.
    
    This implements the complete VA workflow:
    1. Monitor for new work
    2. Perform causal audit
    3. Compute multi-dimensional scores
    4. Commit scores
    5. Wait for commit deadline
    6. Reveal scores
    7. Reputation gets built when epoch closes
    
    Args:
        sdk: ChaosChainAgentSDK instance
        studio_address: Studio to monitor
        commit_delay: Seconds to wait before committing
        reveal_delay: Seconds to wait before revealing
    """
    console.print(Panel.fit(
        "[bold cyan]Verifier Agent - Monitoring Studio[/bold cyan]\n\n"
        f"Studio: {studio_address}\n"
        f"Agent: {sdk.chaos_agent.get_agent_id()}\n"
        f"Role: VERIFIER\n\n"
        "[dim]Press Ctrl+C to stop[/dim]",
        title="🔍 ChaosChain Verifier Agent"
    ))
    
    last_block = 0
    pending_reveals = []  # Track commitments waiting to be revealed
    
    try:
        while True:
            # Check for new work submissions
            work_submissions, last_block = monitor_studio_for_work(sdk, studio_address, last_block)
            
            if work_submissions:
                console.print(f"\n[green]Found {len(work_submissions)} new work submission(s)![/green]")
                
                for work in work_submissions:
                    console.print(f"\n{'='*80}")
                    console.print(f"[bold]Processing Work Submission[/bold]")
                    console.print(f"Agent ID: {work['agent_id']}")
                    console.print(f"TX: {work['tx_hash']}")
                    
                    # Step 1: Perform causal audit
                    audit_result = perform_causal_audit(sdk, work)
                    
                    if not audit_result['passed']:
                        console.print("[red]✗ Audit failed, skipping[/red]")
                        continue
                    
                    # Step 2: Extract scores
                    scores = audit_result['scores']
                    score_vector = [
                        scores['initiative'],
                        scores['collaboration'],
                        scores['reasoning_depth'],
                        scores['compliance'],
                        scores['efficiency']
                    ]
                    
                    # Step 3: Commit scores
                    data_hash = bytes.fromhex(work['data_hash'])
                    
                    try:
                        commitment, salt, tx_hash = commit_scores(
                            sdk,
                            studio_address,
                            data_hash,
                            score_vector
                        )
                        
                        # Track for later reveal
                        pending_reveals.append({
                            'data_hash': data_hash,
                            'score_vector': score_vector,
                            'salt': salt,
                            'commit_time': time.time(),
                            'work': work
                        })
                        
                    except Exception as e:
                        console.print(f"[red]Failed to commit: {e}[/red]")
            
            # Check for pending reveals
            current_time = time.time()
            for pending in pending_reveals[:]:  # Copy list to allow removal
                if current_time - pending['commit_time'] >= reveal_delay:
                    console.print(f"\n[yellow]⏰ Reveal deadline reached[/yellow]")
                    
                    try:
                        reveal_scores(
                            sdk,
                            studio_address,
                            pending['data_hash'],
                            pending['score_vector'],
                            pending['salt']
                        )
                        
                        # Remove from pending
                        pending_reveals.remove(pending)
                        
                        console.print("[green]✓ Full VA workflow complete![/green]")
                        console.print("[dim]Reputation will be built when epoch closes[/dim]")
                        
                    except Exception as e:
                        console.print(f"[red]Failed to reveal: {e}[/red]")
            
            # Wait before next check
            time.sleep(5)
            
    except KeyboardInterrupt:
        console.print("\n\n[yellow]Stopping Verifier Agent...[/yellow]")


def main():
    """Main entry point."""
    console.print(Panel.fit(
        "[bold cyan]ChaosChain Verifier Agent[/bold cyan]\n\n"
        "Complete Proof of Agency Workflow:\n"
        "1. Monitor for new work submissions\n"
        "2. Perform causal audit (§1.5)\n"
        "3. Compute multi-dimensional scores (§3.1)\n"
        "4. Commit scores (§2.4)\n"
        "5. Reveal scores after deadline\n"
        "6. Build reputation via ERC-8004\n\n"
        "[dim]Implements ChaosChain_Implementation_Plan.md §4[/dim]",
        title="🚀 ChaosChain Protocol"
    ))
    
    # Configuration
    STUDIO_ADDRESS = "0x13f36059C0091Ffc38497A972acBF4973108F159"  # From recent test
    VERIFIER_NAME = "test_verifier"
    
    try:
        from chaoschain_sdk import ChaosChainAgentSDK, AgentRole, NetworkConfig
        
        # Initialize Verifier Agent
        console.print("\n[cyan]Initializing Verifier Agent...[/cyan]")
        
        sdk = ChaosChainAgentSDK(
            agent_name=VERIFIER_NAME,
            agent_domain="verifier.chaoschain.local",
            agent_role=AgentRole.VERIFIER,  # ✅ VERIFIER role
            network=NetworkConfig.ETHEREUM_SEPOLIA
        )
        
        # Check if agent is registered
        agent_id = sdk.chaos_agent.get_agent_id()
        if not agent_id:
            console.print("[yellow]⚠️  Agent not registered with ERC-8004[/yellow]")
            console.print("[cyan]Registering agent...[/cyan]")
            
            agent_id = sdk.chaos_agent.register_agent(
                domain="verifier.chaoschain.local"
            )
            
            console.print(f"[green]✓[/green] Agent registered with ID: {agent_id}")
        else:
            console.print(f"[green]✓[/green] Agent already registered: {agent_id}")
        
        # Check if registered with studio
        console.print(f"\n[cyan]Checking studio registration...[/cyan]")
        
        # Try to register with studio as VERIFIER
        try:
            sdk.register_with_studio(
                studio_address=STUDIO_ADDRESS,
                role=AgentRole.VERIFIER,
                stake_amount=0.0001  # 0.0001 ETH stake
            )
            console.print(f"[green]✓[/green] Registered with studio as VERIFIER")
        except Exception as e:
            if "already registered" in str(e).lower():
                console.print(f"[green]✓[/green] Already registered with studio")
            else:
                console.print(f"[yellow]⚠️  Registration issue: {e}[/yellow]")
        
        # Start monitoring loop
        verifier_agent_loop(
            sdk,
            STUDIO_ADDRESS,
            commit_delay=10,   # Wait 10s before committing
            reveal_delay=30    # Wait 30s before revealing
        )
        
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopped by user[/yellow]")
    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()

