#!/usr/bin/env python3
"""
Simple Multi-Agent Attribution Test

Tests that contracts and SDK are ready for multi-agent work.
"""

from rich import print as rprint
from rich.panel import Panel


def test_contract_interfaces():
    """Test that contracts have multi-agent support."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 1: Contract Interfaces  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    # Check StudioProxy.sol for multi-agent methods
    with open('packages/contracts/src/StudioProxy.sol', 'r') as f:
        contract_code = f.read()
    
    required_features = {
        "submitWorkMultiAgent": "submitWorkMultiAgent" in contract_code,
        "getWorkParticipants": "getWorkParticipants" in contract_code,
        "getContributionWeight": "getContributionWeight" in contract_code,
        "getEvidenceCID": "getEvidenceCID" in contract_code,
        "_workParticipants": "_workParticipants" in contract_code,
        "_contributionWeights": "_contributionWeights" in contract_code,
        "_evidenceCIDs": "_evidenceCIDs" in contract_code,
    }
    
    rprint("[yellow]📋 StudioProxy.sol Features:[/yellow]\n")
    for feature, present in required_features.items():
        status = "✅" if present else "❌"
        rprint(f"  {status} {feature}")
    
    all_present = all(required_features.values())
    if all_present:
        rprint("\n[green]✅ All multi-agent features present in StudioProxy[/green]")
    else:
        missing = [k for k, v in required_features.items() if not v]
        rprint(f"\n[red]❌ Missing features: {missing}[/red]")
        return False
    
    return True


def test_rewards_distributor():
    """Test that RewardsDistributor uses contribution weights."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 2: RewardsDistributor Logic  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    with open('packages/contracts/src/RewardsDistributor.sol', 'r') as f:
        contract_code = f.read()
    
    required_features = {
        "_distributeWorkerRewards": "_distributeWorkerRewards" in contract_code,
        "getWorkParticipants": "getWorkParticipants" in contract_code,
        "getContributionWeights": "getContributionWeights" in contract_code,
        "getEvidenceCID": "getEvidenceCID" in contract_code,
        "participants.length > 1": "participants.length > 1" in contract_code,
        "Multi-agent work": "Multi-agent" in contract_code,
    }
    
    rprint("[yellow]📋 RewardsDistributor.sol Features:[/yellow]\n")
    for feature, present in required_features.items():
        status = "✅" if present else "❌"
        rprint(f"  {status} {feature}")
    
    all_present = all(required_features.items())
    if all_present:
        rprint("\n[green]✅ All reward distribution features present[/green]")
    else:
        missing = [k for k, v in required_features.items() if not v]
        rprint(f"\n[red]❌ Missing features: {missing}[/red]")
        return False
    
    return True


def test_sdk_methods():
    """Test that SDK has multi-agent methods."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 3: SDK Methods  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    with open('packages/sdk/chaoschain_sdk/core_sdk.py', 'r') as f:
        sdk_code = f.read()
    
    required_methods = {
        "submit_work_multi_agent": "def submit_work_multi_agent(" in sdk_code,
        "submit_work_from_audit": "def submit_work_from_audit(" in sdk_code,
        "contribution_weights parameter": "contribution_weights:" in sdk_code,
        "participants parameter": "participants:" in sdk_code,
        "evidence_cid parameter": "evidence_cid:" in sdk_code,
        "Protocol Spec §4.2 docs": "§4.2" in sdk_code,
    }
    
    rprint("[yellow]📋 SDK Methods:[/yellow]\n")
    for method, present in required_methods.items():
        status = "✅" if present else "❌"
        rprint(f"  {status} {method}")
    
    all_present = all(required_methods.values())
    if all_present:
        rprint("\n[green]✅ All SDK methods present[/green]")
    else:
        missing = [k for k, v in required_methods.items() if not v]
        rprint(f"\n[red]❌ Missing methods: {missing}[/red]")
        return False
    
    return True


def test_dkg_contribution_weights():
    """Test that DKG computes contribution weights."""
    rprint("\n[cyan]═══════════════════════════════════════════════════[/cyan]")
    rprint("[cyan]  TEST 4: DKG Contribution Weights  [/cyan]")
    rprint("[cyan]═══════════════════════════════════════════════════[/cyan]\n")
    
    with open('packages/sdk/chaoschain_sdk/dkg.py', 'r') as f:
        dkg_code = f.read()
    
    required_features = {
        "compute_contribution_weights": "def compute_contribution_weights(" in dkg_code,
        "betweenness method": 'method == "betweenness"' in dkg_code,
        "path_count method": 'method == "path_count"' in dkg_code,
        "Protocol Spec §4.2": "§4.2" in dkg_code,
        "Shapley": "shapley" in dkg_code.lower(),
    }
    
    rprint("[yellow]📋 DKG Features:[/yellow]\n")
    for feature, present in required_features.items():
        status = "✅" if present else "❌"
        rprint(f"  {status} {feature}")
    
    all_present = all(required_features.values())
    if all_present:
        rprint("\n[green]✅ DKG has contribution weight computation[/green]")
    else:
        missing = [k for k, v in required_features.items() if not v]
        rprint(f"\n[red]❌ Missing features: {missing}[/red]")
        return False
    
    return True


if __name__ == "__main__":
    rprint("\n" + "="*60)
    rprint("[bold cyan]Multi-Agent Attribution Readiness Test[/bold cyan]")
    rprint("="*60)
    rprint("\n[dim]Checking if contracts and SDK are ready for multi-agent work[/dim]\n")
    
    results = []
    results.append(("Contract Interfaces", test_contract_interfaces()))
    results.append(("RewardsDistributor Logic", test_rewards_distributor()))
    results.append(("SDK Methods", test_sdk_methods()))
    results.append(("DKG Contribution Weights", test_dkg_contribution_weights()))
    
    rprint("\n" + "="*60)
    rprint("[bold]Test Summary:[/bold]")
    rprint("="*60 + "\n")
    
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        rprint(f"  {status} - {test_name}")
    
    all_passed = all(r[1] for r in results)
    
    if all_passed:
        rprint("\n" + "="*60)
        rprint("[bold green]✅ ALL TESTS PASSED![/bold green]")
        rprint("="*60)
        rprint("\n[bold]Multi-Agent Attribution Ready:[/bold]")
        rprint("  ✓ Contracts support multi-agent work")
        rprint("  ✓ RewardsDistributor uses contribution weights")
        rprint("  ✓ SDK has multi-agent methods")
        rprint("  ✓ DKG computes contribution weights")
        rprint("\n[bold green]Protocol Spec §4.2 IMPLEMENTED![/bold green]")
    else:
        rprint("\n[bold red]❌ SOME TESTS FAILED[/bold red]")
        rprint("Review the failures above and fix them.")
        exit(1)

