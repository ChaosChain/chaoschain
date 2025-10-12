#!/usr/bin/env python3
"""
End-to-End Test: Python SDK → gRPC Server → 0G Network

This demonstrates how the ChaosChain Python SDK communicates with
the 0G Bridge gRPC server WITHOUT using grpcurl (pure Python gRPC).

Prerequisites:
1. gRPC server running: ./sdk/sidecar-specs/start_server.sh start
2. Python dependencies: pip install grpcio grpcio-tools
"""

import sys
import os
import time
import json
from rich import print as rprint
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from chaoschain_sdk.providers.compute.zerog_grpc import ZeroGComputeGRPC
    from chaoschain_sdk.providers.compute.base import VerificationMethod
    IMPORTS_OK = True
except ImportError as e:
    IMPORTS_OK = False
    import_error = str(e)

console = Console()


def test_connection():
    """Test 1: Check if gRPC server is accessible"""
    console.print("\n[bold cyan]═══ Test 1: Connection Test ═══[/bold cyan]\n")
    
    if not IMPORTS_OK:
        console.print(f"[red]❌ Import failed: {import_error}[/red]")
        console.print("\n[yellow]Run: cd sdk && pip install -e .[/yellow]")
        return False
    
    try:
        compute = ZeroGComputeGRPC(grpc_url='localhost:50052')
        
        if compute.is_available:
            console.print("[green]✅ Successfully connected to gRPC server[/green]")
            console.print(f"[cyan]   Provider: {compute.provider_name}[/cyan]")
            console.print(f"[cyan]   Endpoint: localhost:50052[/cyan]")
            return compute
        else:
            console.print("[red]❌ gRPC server not available[/red]")
            console.print("\n[yellow]Start server:[/yellow]")
            console.print("[cyan]  cd sdk/sidecar-specs[/cyan]")
            console.print("[cyan]  ZEROG_PRIVATE_KEY=<key> ./start_server.sh start[/cyan]")
            return None
            
    except Exception as e:
        console.print(f"[red]❌ Connection failed: {e}[/red]")
        return None


def test_submit_job(compute):
    """Test 2: Submit a compute job"""
    console.print("\n[bold cyan]═══ Test 2: Submit Compute Job ═══[/bold cyan]\n")
    
    # Example task: AI inference
    task = {
        "model": "llama2-7b",
        "prompt": "Explain how blockchain consensus works in 3 sentences.",
        "max_tokens": 150,
        "temperature": 0.7
    }
    
    console.print("[yellow]📤 Submitting task...[/yellow]")
    console.print(f"[dim]{json.dumps(task, indent=2)}[/dim]")
    
    try:
        job_id = compute.submit(
            task=task,
            verification=VerificationMethod.TEE_ML,
            idempotency_key=f"test-{int(time.time())}"
        )
        
        console.print(f"\n[green]✅ Job submitted successfully![/green]")
        console.print(f"[cyan]   Job ID: {job_id}[/cyan]")
        return job_id
        
    except Exception as e:
        console.print(f"[red]❌ Submission failed: {e}[/red]")
        return None


def test_check_status(compute, job_id):
    """Test 3: Check job status"""
    console.print("\n[bold cyan]═══ Test 3: Check Job Status ═══[/bold cyan]\n")
    
    try:
        status = compute.status(job_id)
        
        # Create status table
        table = Table(title="Job Status")
        table.add_column("Property", style="cyan")
        table.add_column("Value", style="yellow")
        
        table.add_row("State", status.get("state", "unknown"))
        table.add_row("Progress", f"{status.get('progress', 0)}%")
        
        if status.get("metadata"):
            for key, value in status["metadata"].items():
                table.add_row(f"Metadata.{key}", str(value))
        
        console.print(table)
        console.print("\n[green]✅ Status retrieved successfully[/green]")
        
        return status
        
    except Exception as e:
        console.print(f"[red]❌ Status check failed: {e}[/red]")
        return None


def test_get_result(compute, job_id):
    """Test 4: Get job result"""
    console.print("\n[bold cyan]═══ Test 4: Get Job Result ═══[/bold cyan]\n")
    
    try:
        result = compute.result(job_id)
        
        if result.success:
            # Create result table
            table = Table(title="Compute Result")
            table.add_column("Property", style="cyan")
            table.add_column("Value", style="yellow")
            
            table.add_row("Success", "✅ True")
            table.add_row("Provider", result.provider)
            table.add_row("Verification", result.verification_method.value)
            table.add_row("Execution Hash", result.execution_hash[:32] + "..." if result.execution_hash else "N/A")
            
            if result.proof:
                table.add_row("Proof Size", f"{len(result.proof)} bytes")
            
            if result.output:
                output_str = json.dumps(result.output, indent=2)
                table.add_row("Output", output_str[:100] + "..." if len(output_str) > 100 else output_str)
            
            console.print(table)
            console.print("\n[green]✅ Result retrieved successfully[/green]")
            
            return result
        else:
            console.print(f"[red]❌ Job failed: {result.error}[/red]")
            return None
            
    except Exception as e:
        console.print(f"[red]❌ Result retrieval failed: {e}[/red]")
        return None


def test_get_attestation(compute, job_id):
    """Test 5: Get attestation proof"""
    console.print("\n[bold cyan]═══ Test 5: Get Attestation Proof ═══[/bold cyan]\n")
    
    try:
        attestation = compute.attestation(job_id)
        
        if attestation:
            # Create attestation table
            table = Table(title="Attestation Proof")
            table.add_column("Property", style="cyan")
            table.add_column("Value", style="yellow")
            
            for key, value in attestation.items():
                if key == "signature" and isinstance(value, bytes):
                    table.add_row(key, f"<{len(value)} bytes>")
                else:
                    value_str = str(value)
                    table.add_row(key, value_str[:100] + "..." if len(value_str) > 100 else value_str)
            
            console.print(table)
            console.print("\n[green]✅ Attestation retrieved successfully[/green]")
            
            return attestation
        else:
            console.print("[yellow]⚠️  No attestation available[/yellow]")
            return None
            
    except Exception as e:
        console.print(f"[red]❌ Attestation retrieval failed: {e}[/red]")
        return None


def main():
    """Run all tests"""
    console.print(Panel.fit(
        "[bold]0G Bridge gRPC - Python SDK End-to-End Test[/bold]\n"
        "[dim]Testing Python → gRPC → 0G Network integration[/dim]",
        border_style="cyan"
    ))
    
    # Test 1: Connection
    compute = test_connection()
    if not compute:
        console.print("\n[red]⛔ Cannot proceed without connection[/red]")
        return 1
    
    # Test 2: Submit job
    job_id = test_submit_job(compute)
    if not job_id:
        console.print("\n[red]⛔ Cannot proceed without job ID[/red]")
        return 1
    
    # Test 3: Check status
    status = test_check_status(compute, job_id)
    
    # Test 4: Get result
    result = test_get_result(compute, job_id)
    
    # Test 5: Get attestation
    attestation = test_get_attestation(compute, job_id)
    
    # Summary
    console.print("\n" + "═" * 60)
    console.print("[bold cyan]📊 Test Summary[/bold cyan]")
    console.print("═" * 60)
    
    tests = [
        ("Connection", compute is not None),
        ("Submit Job", job_id is not None),
        ("Check Status", status is not None),
        ("Get Result", result is not None),
        ("Get Attestation", attestation is not None)
    ]
    
    passed = sum(1 for _, result in tests if result)
    total = len(tests)
    
    for test_name, test_result in tests:
        status_icon = "✅" if test_result else "❌"
        console.print(f"{status_icon} {test_name}")
    
    console.print("═" * 60)
    console.print(f"\n[bold]Results: {passed}/{total} tests passed[/bold]")
    
    if passed == total:
        console.print("[green]🎉 All tests passed! Python SDK ↔ gRPC working perfectly![/green]")
        return 0
    else:
        console.print(f"[yellow]⚠️  {total - passed} test(s) failed[/yellow]")
        return 1


if __name__ == "__main__":
    sys.exit(main())

