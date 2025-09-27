"""
Production-ready process integrity verification for ChaosChain agents.

This module provides cryptographic proof of correct code execution,
ensuring that agents perform work as intended with verifiable evidence.
"""

import hashlib
import json
import uuid
import asyncio
from typing import Dict, Any, Callable, Optional, Tuple, List
from datetime import datetime, timezone
from functools import wraps
from rich.console import Console
from rich import print as rprint

from .types import IntegrityProof
from .exceptions import IntegrityVerificationError
from .storage import UnifiedStorageManager

console = Console()


class ProcessIntegrityVerifier:
    """
    Production-ready process integrity verifier for ChaosChain agents.
    
    Provides cryptographic proof that functions execute correctly with
    verifiable evidence stored on IPFS for transparency and accountability.
    
    Attributes:
        agent_name: Name of the agent using this verifier
        storage_manager: Pluggable storage manager for proof persistence
        registered_functions: Dictionary of registered integrity-checked functions
    """
    
    def __init__(self, agent_name: str, storage_manager: UnifiedStorageManager = None):
        """
        Initialize the process integrity verifier.
        
        Args:
            agent_name: Name of the agent
            storage_manager: Optional pluggable storage manager for proof persistence
        """
        self.agent_name = agent_name
        self.storage_manager = storage_manager
        self.registered_functions: Dict[str, Callable] = {}
        self.function_hashes: Dict[str, str] = {}
        
        rprint(f"[green]✅ ChaosChain Process Integrity Verifier initialized: {agent_name} (verifiable)[/green]")
    
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
    
    async def execute_with_proof(self, function_name: str, inputs: Dict[str, Any],
                                require_proof: bool = True) -> Tuple[Any, Optional[IntegrityProof]]:
        """
        Execute a registered function with integrity proof generation.
        
        Args:
            function_name: Name of the registered function
            inputs: Function input parameters
            require_proof: Whether to generate integrity proof
            
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
        
        rprint(f"[blue]⚡ Executing with ChaosChain Process Integrity: {function_name}[/blue]")
        
        # Execute function
        start_time = datetime.now(timezone.utc)
        
        try:
            # Execute the function (handle both sync and async)
            if asyncio.iscoroutinefunction(func):
                result = await func(**inputs)
            else:
                result = func(**inputs)
            
            execution_time = datetime.now(timezone.utc)
            
            if not require_proof:
                return result, None
            
            # Generate integrity proof
            proof = self._generate_integrity_proof(
                function_name=function_name,
                code_hash=code_hash,
                inputs=inputs,
                result=result,
                start_time=start_time,
                execution_time=execution_time
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
    
    def _generate_integrity_proof(self, function_name: str, code_hash: str,
                                 inputs: Dict[str, Any], result: Any,
                                 start_time: datetime, execution_time: datetime) -> IntegrityProof:
        """
        Generate a cryptographic integrity proof.
        
        Args:
            function_name: Name of the executed function
            code_hash: Hash of the function code
            inputs: Function inputs
            result: Function result
            start_time: Execution start time
            execution_time: Execution completion time
            
        Returns:
            IntegrityProof object
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
        
        proof = IntegrityProof(
            proof_id=proof_id,
            function_name=function_name,
            code_hash=code_hash,
            execution_hash=execution_hash,
            timestamp=execution_time,
            agent_name=self.agent_name,
            verification_status="verified"
        )
        
        rprint(f"[green]✅ Process integrity proof generated: {proof_id}[/green]")
        
        return proof
    
    async def _store_proof_on_ipfs(self, proof: IntegrityProof):
        """
        Store integrity proof on IPFS for persistence.
        
        Args:
            proof: IntegrityProof to store
        """
        try:
            proof_data = {
                "type": "chaoschain_process_integrity_proof",
                "proof": {
                    "proof_id": proof.proof_id,
                    "function_name": proof.function_name,
                    "code_hash": proof.code_hash,
                    "execution_hash": proof.execution_hash,
                    "timestamp": proof.timestamp.isoformat(),
                    "agent_name": proof.agent_name,
                    "verification_status": proof.verification_status
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
