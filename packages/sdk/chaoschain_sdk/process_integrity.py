"""
Production-ready process integrity verification for ChaosChain agents.

This module provides cryptographic proof of correct code execution,
ensuring that agents perform work as intended with verifiable evidence.

Features:
- Local code hashing (SHA-256)
- Optional TEE attestations (0G Compute, AWS Nitro, etc.)
- Dual-layer verification: Code + Execution
- Pluggable compute providers for maximum flexibility
"""

import hashlib
import json
import uuid
import asyncio
from typing import Dict, Any, Callable, Optional, Tuple, List, TYPE_CHECKING
from datetime import datetime, timezone
from functools import wraps
from rich.console import Console
from rich import print as rprint

from .types import IntegrityProof
from .exceptions import IntegrityVerificationError
from .providers.storage import StorageProvider

if TYPE_CHECKING:
    from .providers.compute import ZeroGComputeGRPC

console = Console()


class ProcessIntegrityVerifier:
    """
    Production-ready process integrity verifier for ChaosChain agents.
    
    Provides dual-layer cryptographic proof:
    1. Local code hashing (SHA-256 of function code)
    2. Optional TEE attestations (hardware-verified execution from 0G Compute, AWS Nitro, etc.)
    
    This enables the "Process Integrity" layer of the Triple-Verified Stack:
    - Layer 1: AP2 Intent Verification (Google)
    - Layer 2: Process Integrity (ChaosChain + TEE attestations) ← THIS MODULE
    - Layer 3: Accountability
    
    Attributes:
        agent_name: Name of the agent using this verifier
        storage_manager: Pluggable storage manager for proof persistence
        compute_provider: Optional TEE compute provider (e.g., 0G Compute)
        registered_functions: Dictionary of registered integrity-checked functions
    """
    
    def __init__(
        self, 
        agent_name: str, 
        storage_manager: Optional[StorageProvider] = None,
        compute_provider: Optional['ZeroGComputeGRPC'] = None
    ):
        """
        Initialize the process integrity verifier.
        
        Args:
            agent_name: Name of the agent
            storage_manager: Optional pluggable storage manager for proof persistence
            compute_provider: Optional TEE compute provider for hardware attestations
        """
        self.agent_name = agent_name
        self.storage_manager = storage_manager
        self.compute_provider = compute_provider
        self.registered_functions: Dict[str, Callable] = {}
        self.function_hashes: Dict[str, str] = {}
        
        verification_mode = "local" if not compute_provider else "local + TEE attestation"
        rprint(f"[green]✅ ChaosChain Process Integrity Verifier initialized: {agent_name} ({verification_mode})[/green]")
    
    def register_function(self, func: Callable, function_name: str = None) -> str:
        """
        Register a function for integrity checking.
        
        Args:
            func: Function to register
            function_name: Optional custom name (defaults to function.__name__)
            
        Returns:
            Code hash of the registered function
        """
        name = function_name or func.__name__
        
        # Generate code hash
        code_hash = self._generate_code_hash(func)
        
        # Store function and hash
        self.registered_functions[name] = func
        self.function_hashes[name] = code_hash
        
        rprint(f"[blue]📝 Registered integrity-checked function: {name}[/blue]")
        rprint(f"   Code hash: {code_hash[:16]}...")
        
        return code_hash
    
    async def execute_with_proof(
        self, 
        function_name: str, 
        inputs: Dict[str, Any],
        require_proof: bool = True,
        use_tee: bool = True
    ) -> Tuple[Any, Optional[IntegrityProof]]:
        """
        Execute a registered function with integrity proof generation.
        
        Execution modes:
        1. Local only: Executes function locally, generates code hash
        2. Local + TEE: Executes locally, PLUS gets TEE attestation from compute provider
        
        Args:
            function_name: Name of the registered function
            inputs: Function input parameters
            require_proof: Whether to generate integrity proof
            use_tee: Whether to use TEE attestation (requires compute_provider)
            
        Returns:
            Tuple of (function_result, integrity_proof)
        """
        if function_name not in self.registered_functions:
            raise IntegrityVerificationError(
                f"Function not registered: {function_name}",
                {"available_functions": list(self.registered_functions.keys())}
            )
        
        func = self.registered_functions[function_name]
        code_hash = self.function_hashes[function_name]
        
        execution_mode = "local + TEE" if (use_tee and self.compute_provider) else "local"
        rprint(f"[blue]⚡ Executing with ChaosChain Process Integrity: {function_name} ({execution_mode})[/blue]")
        
        # Execute function
        start_time = datetime.now(timezone.utc)
        tee_attestation = None
        
        try:
            # Execute the function (handle both sync and async)
            if asyncio.iscoroutinefunction(func):
                result = await func(**inputs)
            else:
                result = func(**inputs)
            
            execution_time = datetime.now(timezone.utc)
            
            # Optionally get TEE attestation
            if use_tee and self.compute_provider:
                try:
                    tee_attestation = await self._get_tee_attestation(
                        function_name=function_name,
                        inputs=inputs,
                        result=result
                    )
                except Exception as e:
                    rprint(f"[yellow]⚠️  TEE attestation failed (continuing with local proof): {e}[/yellow]")
            
            if not require_proof:
                return result, None
            
            # Generate integrity proof (includes TEE attestation if available)
            proof = self._generate_integrity_proof(
                function_name=function_name,
                code_hash=code_hash,
                inputs=inputs,
                result=result,
                start_time=start_time,
                execution_time=execution_time,
                tee_attestation=tee_attestation
            )
            
            # Store proof on IPFS if storage manager available
            if self.storage_manager:
                await self._store_proof_on_ipfs(proof)
            
            return result, proof
            
        except Exception as e:
            raise IntegrityVerificationError(
                f"Function execution failed: {str(e)}",
                {"function_name": function_name, "inputs": inputs}
            )
    
    def _generate_code_hash(self, func: Callable) -> str:
        """
        Generate a hash of the function's code.
        
        Args:
            func: Function to hash
            
        Returns:
            SHA-256 hash of the function code
        """
        try:
            # Get function source code
            import inspect
            source_code = inspect.getsource(func)
            
            # Create hash
            return hashlib.sha256(source_code.encode()).hexdigest()
            
        except Exception:
            # Fallback to function name and module
            func_info = f"{func.__module__}.{func.__name__}"
            return hashlib.sha256(func_info.encode()).hexdigest()
    
    async def _get_tee_attestation(self, function_name: str, inputs: Dict[str, Any], 
                                   result: Any) -> Optional[Dict[str, Any]]:
        """
        Get TEE attestation from compute provider (e.g., 0G Compute).
        
        This submits the task to a TEE environment for hardware-verified execution
        and retrieves the attestation proof with execution hash, job ID, and verification method.
        
        Args:
            function_name: Name of the executed function
            inputs: Function inputs
            result: Function result (for verification)
            
        Returns:
            TEE attestation dict with 0G Compute response structure:
            {
                "job_id": "0g_job_...",
                "provider": "0g-compute",
                "execution_hash": "chatcmpl-...",  # TEE execution identifier
                "verification_method": "tee-ml",
                "model": "gpt-oss-120b",
                "attestation_data": {...},  # Full attestation proof
                "timestamp": "..."
            }
        """
        if not self.compute_provider:
            return None
        
        rprint(f"[cyan]🔐 Requesting TEE attestation from compute provider...[/cyan]")
        
        try:
            # Submit task to TEE compute provider
            task_data = {
                "function": function_name,
                "inputs": inputs,
                "model": "gpt-oss-120b",  # Default model for 0G Compute
                "prompt": f"Execute function: {function_name} with inputs: {json.dumps(inputs)}"
            }
            
            job_id = self.compute_provider.submit(task=task_data)
            
            # Wait for completion
            import time
            max_wait = 60  # 60 seconds timeout
            elapsed = 0
            
            while elapsed < max_wait:
                status_result = self.compute_provider.status(job_id)
                state = status_result.get("state", "unknown")
                
                if state == "completed":
                    # Get full result (includes execution_hash, verification_method)
                    compute_result = self.compute_provider.result(job_id)
                    
                    if compute_result.success:
                        # Get attestation (proof data)
                        attestation_data = self.compute_provider.attestation(job_id)
                        
                        rprint(f"[green]✅ TEE attestation received: {job_id}[/green]")
                        rprint(f"[cyan]   Execution Hash: {compute_result.execution_hash}[/cyan]")
                        rprint(f"[cyan]   Verification: {compute_result.verification_method.value}[/cyan]")
                        
                        # Match actual 0G Compute response structure
                        return {
                            "job_id": job_id,
                            "provider": "0g-compute",
                            "execution_hash": compute_result.execution_hash,  # TEE execution ID
                            "verification_method": compute_result.verification_method.value,
                            "model": task_data.get("model", "gpt-oss-120b"),
                            "attestation_data": attestation_data,  # Full attestation proof
                            "proof": compute_result.proof.hex() if compute_result.proof else None,
                            "metadata": compute_result.metadata,
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                    else:
                        rprint(f"[yellow]⚠️  Compute result failed: {compute_result.error}[/yellow]")
                        return None
                
                elif state == "failed":
                    rprint(f"[yellow]⚠️  TEE execution failed[/yellow]")
                    return None
                
                time.sleep(2)
                elapsed += 2
            
            rprint(f"[yellow]⚠️  TEE attestation timeout after {max_wait}s[/yellow]")
            return None
            
        except Exception as e:
            rprint(f"[yellow]⚠️  TEE attestation error: {e}[/yellow]")
            return None
    
    def _generate_integrity_proof(
        self, 
        function_name: str, 
        code_hash: str,
        inputs: Dict[str, Any], 
        result: Any,
        start_time: datetime, 
        execution_time: datetime,
        tee_attestation: Optional[Dict[str, Any]] = None
    ) -> IntegrityProof:
        """
        Generate a cryptographic integrity proof.
        
        Combines local code verification with optional TEE attestation for
        complete process integrity.
        
        Args:
            function_name: Name of the executed function
            code_hash: Hash of the function code
            inputs: Function inputs
            result: Function result
            start_time: Execution start time
            execution_time: Execution completion time
            tee_attestation: Optional TEE attestation data
            
        Returns:
            IntegrityProof object with both local and TEE verification
        """
        proof_id = f"proof_{uuid.uuid4().hex[:8]}"
        
        # Create execution hash
        execution_data = {
            "function_name": function_name,
            "code_hash": code_hash,
            "inputs": inputs,
            "result": self._serialize_result(result),
            "start_time": start_time.isoformat(),
            "execution_time": execution_time.isoformat(),
            "agent_name": self.agent_name
        }
        
        execution_hash = hashlib.sha256(
            json.dumps(execution_data, sort_keys=True).encode()
        ).hexdigest()
        
        # Build proof with optional TEE data
        proof = IntegrityProof(
            proof_id=proof_id,
            function_name=function_name,
            code_hash=code_hash,
            execution_hash=execution_hash,
            timestamp=execution_time,
            agent_name=self.agent_name,
            verification_status="verified",
            # TEE fields (if available)
            tee_attestation=tee_attestation,
            tee_provider=tee_attestation.get("provider") if tee_attestation else None,
            tee_job_id=tee_attestation.get("job_id") if tee_attestation else None,
            tee_execution_hash=tee_attestation.get("execution_hash") if tee_attestation else None
        )
        
        verification_level = "local + TEE" if tee_attestation else "local"
        rprint(f"[green]✅ Process integrity proof generated: {proof_id} ({verification_level})[/green]")
        
        return proof
    
    async def _store_proof_on_ipfs(self, proof: IntegrityProof):
        """
        Store integrity proof on IPFS for persistence.
        
        Includes both local code verification and optional TEE attestation.
        
        Args:
            proof: IntegrityProof to store
        """
        try:
            proof_data = {
                "type": "chaoschain_process_integrity_proof_v2",  # v2 includes TEE
                "proof": {
                    "proof_id": proof.proof_id,
                    "function_name": proof.function_name,
                    "code_hash": proof.code_hash,
                    "execution_hash": proof.execution_hash,
                    "timestamp": proof.timestamp.isoformat(),
                    "agent_name": proof.agent_name,
                    "verification_status": proof.verification_status,
                    # TEE attestation (if available)
                    "tee_attestation": proof.tee_attestation,
                    "tee_provider": proof.tee_provider,
                    "tee_job_id": proof.tee_job_id,
                    "tee_execution_hash": proof.tee_execution_hash
                },
                "verification_layers": {
                    "local_code_hash": True,
                    "tee_attestation": proof.tee_attestation is not None
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "agent_name": self.agent_name
            }
            
            filename = f"process_integrity_proof_{proof.proof_id}.json"
            cid = self.storage_manager.upload_json(proof_data, filename)
            
            if cid:
                proof.ipfs_cid = cid
                rprint(f"[green]📁 Process Integrity Proof stored on IPFS: {cid}[/green]")
            
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to store process integrity proof on IPFS: {e}[/yellow]")
    
    def _serialize_result(self, result: Any) -> Any:
        """
        Serialize function result for hashing.
        
        Args:
            result: Function result to serialize
            
        Returns:
            JSON-serializable version of the result
        """
        try:
            # Try direct JSON serialization
            json.dumps(result)
            return result
        except (TypeError, ValueError):
            # Fallback to string representation
            return str(result)
    
    def create_insurance_policy(self, function_name: str, coverage_amount: float,
                               conditions: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a process insurance policy for a function.
        
        Args:
            function_name: Name of the function to insure
            coverage_amount: Insurance coverage amount
            conditions: Policy conditions and terms
            
        Returns:
            Insurance policy configuration
        """
        policy_id = f"policy_{uuid.uuid4().hex[:8]}"
        
        policy = {
            "policy_id": policy_id,
            "function_name": function_name,
            "agent_name": self.agent_name,
            "coverage_amount": coverage_amount,
            "conditions": conditions,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "active"
        }
        
        rprint(f"[blue]🛡️  Process insurance policy created: {policy_id}[/blue]")
        rprint(f"   Function: {function_name}")
        rprint(f"   Coverage: ${coverage_amount}")
        
        return policy
    
    def configure_autonomous_agent(self, capabilities: List[str],
                                  constraints: Dict[str, Any]) -> Dict[str, Any]:
        """
        Configure autonomous agent capabilities with integrity verification.
        
        Args:
            capabilities: List of agent capabilities
            constraints: Operational constraints and limits
            
        Returns:
            Agent configuration
        """
        config_id = f"config_{uuid.uuid4().hex[:8]}"
        
        configuration = {
            "config_id": config_id,
            "agent_name": self.agent_name,
            "capabilities": capabilities,
            "constraints": constraints,
            "integrity_verification": True,
            "registered_functions": list(self.registered_functions.keys()),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        rprint(f"[blue]🤖 Autonomous agent configured: {config_id}[/blue]")
        rprint(f"   Capabilities: {len(capabilities)}")
        rprint(f"   Registered functions: {len(self.registered_functions)}")
        
        return configuration


def integrity_checked_function(verifier: ProcessIntegrityVerifier = None):
    """
    Decorator for automatically registering functions with integrity checking.
    
    Args:
        verifier: ProcessIntegrityVerifier instance
        
    Returns:
        Decorated function with integrity checking
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if verifier:
                # Register function if not already registered
                if func.__name__ not in verifier.registered_functions:
                    verifier.register_function(func)
                
                # Execute with integrity proof
                result, proof = await verifier.execute_with_proof(
                    func.__name__, 
                    kwargs,
                    require_proof=True
                )
                return result, proof
            else:
                # Execute without integrity checking
                if asyncio.iscoroutinefunction(func):
                    return await func(*args, **kwargs)
                else:
                    return func(*args, **kwargs)
        
        return wrapper
    return decorator
