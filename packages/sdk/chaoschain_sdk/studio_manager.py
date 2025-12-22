"""
Studio Manager for ChaosChain Task Assignment and Orchestration.

Implements Studio task workflow:
- Task broadcasting to registered workers
- Bid collection from workers
- Worker selection (reputation-based)
- Task assignment
- Work submission tracking

Usage:
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    from chaoschain_sdk.studio_manager import StudioManager
    
    # Initialize SDK as studio owner/client
    sdk = ChaosChainAgentSDK(
        agent_name="StudioClient",
        agent_domain="client.example.com",
        agent_role=AgentRole.CLIENT,
        network=NetworkConfig.ETHEREUM_SEPOLIA
    )
    
    # Create studio manager
    manager = StudioManager(sdk)
    
    # Get registered workers from StudioProxy
    studio_address = "0x..."
    workers = manager.get_registered_workers(studio_address)
    
    # Broadcast task
    task_id = manager.broadcast_task(
        studio_address=studio_address,
        task_requirements={
            "description": "Analyze market data",
            "budget": 100.0,  # USDC
            "deadline": datetime.now() + timedelta(hours=24)
        },
        registered_workers=workers
    )
    
    # Collect bids (timeout: 5 minutes)
    bids = manager.collect_bids(task_id, timeout_seconds=300)
    
    # Get worker reputations
    reputation_scores = manager.get_worker_reputations(
        [bid["worker_address"] for bid in bids]
    )
    
    # Select best worker
    selected_worker = manager.select_worker(bids, reputation_scores)
    
    # Assign task
    assignment_id = manager.assign_task(
        task_id=task_id,
        worker_address=selected_worker,
        budget=100.0
    )
    ```
"""

from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass
import uuid
import time
from rich import print as rprint
from rich.table import Table
from rich.console import Console

from .exceptions import ChaosChainSDKError

console = Console()


@dataclass
class Task:
    """Task definition."""
    task_id: str
    studio_address: str
    requirements: Dict[str, Any]
    status: str  # broadcasting, assigned, in_progress, completed, failed
    created_at: datetime
    assigned_to: Optional[str] = None
    assigned_at: Optional[datetime] = None


@dataclass
class WorkerBid:
    """Worker bid on a task."""
    bid_id: str
    task_id: str
    worker_address: str
    worker_agent_id: int
    proposed_price: float
    estimated_time_hours: float
    capabilities: List[str]
    reputation_score: float
    message: str
    submitted_at: datetime


class StudioManager:
    """
    Studio task assignment and orchestration.
    
    Handles:
    - Task broadcasting to registered workers
    - Bid collection
    - Worker selection (reputation-based)
    - Task assignment
    - Work tracking
    
    Worker Selection Algorithm:
    Score = 0.4 * norm_reputation + 0.3 * norm_price + 0.2 * norm_time + 0.1 * capability_match
    """
    
    def __init__(self, sdk):
        """
        Initialize Studio Manager.
        
        Args:
            sdk: ChaosChainAgentSDK instance (with XMTP enabled for messaging)
        """
        self.sdk = sdk
        self.active_tasks: Dict[str, Task] = {}
        self.worker_bids: Dict[str, List[WorkerBid]] = {}  # {task_id: [bids]}
        
        if not self.sdk.xmtp_manager:
            rprint("[yellow]⚠️  XMTP not available. Task broadcasting will be limited.[/yellow]")
    
    def get_registered_workers(self, studio_address: str) -> List[str]:
        """
        Get all registered workers from StudioProxy.
        
        Args:
            studio_address: Studio contract address
        
        Returns:
            List of worker addresses
        """
        try:
            # Query StudioProxy for registered workers
            # This requires reading the contract's state
            proxy_contract = self.sdk.w3.eth.contract(
                address=studio_address,
                abi=self.sdk.chaos_agent._load_abi("StudioProxy")
            )
            
            # Get worker count (if contract has this method)
            # For now, return empty list - contract needs getter method
            rprint("[yellow]⚠️  StudioProxy needs getRegisteredWorkers() method[/yellow]")
            return []
            
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to fetch registered workers: {e}[/yellow]")
            return []
    
    def broadcast_task(
        self,
        studio_address: str,
        task_requirements: Dict[str, Any],
        registered_workers: List[str]
    ) -> str:
        """
        Broadcast task to registered workers via XMTP.
        
        Args:
            studio_address: Studio contract address
            task_requirements: Task details (description, budget, deadline, etc.)
            registered_workers: List of registered worker addresses
        
        Returns:
            Task ID
        
        Raises:
            ChaosChainSDKError: If XMTP not available
        """
        if not self.sdk.xmtp_manager:
            raise ChaosChainSDKError(
                "XMTP not available. Install with: pip install xmtp"
            )
        
        # Generate task ID
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        
        # Create task
        task = Task(
            task_id=task_id,
            studio_address=studio_address,
            requirements=task_requirements,
            status="broadcasting",
            created_at=datetime.now(timezone.utc)
        )
        
        # Store task
        self.active_tasks[task_id] = task
        self.worker_bids[task_id] = []
        
        # Broadcast to all workers via XMTP
        rprint(f"[cyan]📢 Broadcasting task {task_id} to {len(registered_workers)} workers...[/cyan]")
        
        for worker_address in registered_workers:
            try:
                message_id = self.sdk.send_message(
                    to_agent=worker_address,
                    message_type="task_broadcast",
                    content={
                        "task_id": task_id,
                        "studio_address": studio_address,
                        **task_requirements
                    }
                )
                rprint(f"[green]✅ Sent to {worker_address[:8]}...[/green]")
            except Exception as e:
                rprint(f"[yellow]⚠️  Failed to send to {worker_address[:8]}...: {e}[/yellow]")
        
        return task_id
    
    def collect_bids(
        self,
        task_id: str,
        timeout_seconds: int = 300
    ) -> List[WorkerBid]:
        """
        Collect bids from workers.
        
        Args:
            task_id: Task ID
            timeout_seconds: Timeout for bid collection (default: 5 minutes)
        
        Returns:
            List of worker bids
        """
        if task_id not in self.active_tasks:
            raise ChaosChainSDKError(f"Task {task_id} not found")
        
        rprint(f"[cyan]⏳ Collecting bids for {timeout_seconds}s...[/cyan]")
        
        start_time = time.time()
        
        # In production, this would use XMTP's streaming API to listen for bid messages
        # For now, we poll periodically
        while time.time() - start_time < timeout_seconds:
            # Check for new messages (bid responses)
            # This is a simplified implementation
            # In production, parse incoming XMTP messages for "task_bid" type
            
            time.sleep(5)  # Poll every 5 seconds
            
            # Check if we have minimum bids
            bids = self.worker_bids.get(task_id, [])
            if len(bids) >= 3:
                rprint(f"[green]✅ Received {len(bids)} bids[/green]")
                break
        
        bids = self.worker_bids.get(task_id, [])
        
        if len(bids) == 0:
            rprint("[yellow]⚠️  No bids received[/yellow]")
        else:
            self._display_bids(bids)
        
        return bids
    
    def submit_bid(
        self,
        task_id: str,
        worker_address: str,
        worker_agent_id: int,
        proposed_price: float,
        estimated_time_hours: float,
        capabilities: List[str],
        message: str = ""
    ) -> str:
        """
        Submit a bid for a task (called by worker agent).
        
        Args:
            task_id: Task ID
            worker_address: Worker's wallet address
            worker_agent_id: Worker's ERC-8004 agent ID
            proposed_price: Proposed price in USDC
            estimated_time_hours: Estimated completion time
            capabilities: List of relevant capabilities
            message: Optional message to client
        
        Returns:
            Bid ID
        """
        if task_id not in self.active_tasks:
            raise ChaosChainSDKError(f"Task {task_id} not found")
        
        bid = WorkerBid(
            bid_id=f"bid_{uuid.uuid4().hex[:8]}",
            task_id=task_id,
            worker_address=worker_address,
            worker_agent_id=worker_agent_id,
            proposed_price=proposed_price,
            estimated_time_hours=estimated_time_hours,
            capabilities=capabilities,
            reputation_score=0.0,  # Will be fetched later
            message=message,
            submitted_at=datetime.now(timezone.utc)
        )
        
        # Store bid
        if task_id not in self.worker_bids:
            self.worker_bids[task_id] = []
        
        self.worker_bids[task_id].append(bid)
        
        rprint(f"[green]✅ Bid {bid.bid_id} submitted for task {task_id}[/green]")
        
        return bid.bid_id
    
    def get_worker_reputations(self, worker_addresses: List[str]) -> Dict[str, float]:
        """
        Get reputation scores for workers from ERC-8004 ReputationRegistry.
        
        Args:
            worker_addresses: List of worker addresses
        
        Returns:
            {worker_address: reputation_score}
        """
        reputation_scores = {}
        
        for address in worker_addresses:
            try:
                # Query ERC-8004 ReputationRegistry
                # For now, use a mock score
                # In production, query contract for latest reputation
                reputation_scores[address] = 75.0  # Mock score
                
            except Exception as e:
                rprint(f"[yellow]⚠️  Failed to fetch reputation for {address[:8]}...: {e}[/yellow]")
                reputation_scores[address] = 0.0
        
        return reputation_scores
    
    def select_worker(
        self,
        bids: List[WorkerBid],
        reputation_scores: Dict[str, float],
        weights: Optional[Dict[str, float]] = None
    ) -> str:
        """
        Select best worker based on reputation, price, time, and capabilities.
        
        Selection Algorithm:
        Score = w1 * norm_reputation + w2 * norm_price + w3 * norm_time + w4 * capability_match
        
        Default weights: {reputation: 0.4, price: 0.3, time: 0.2, capabilities: 0.1}
        
        Args:
            bids: List of worker bids
            reputation_scores: Reputation scores for workers
            weights: Optional custom weights for selection criteria
        
        Returns:
            Selected worker address
        
        Raises:
            ChaosChainSDKError: If no bids provided
        """
        if not bids:
            raise ChaosChainSDKError("No bids to select from")
        
        # Default weights
        if weights is None:
            weights = {
                "reputation": 0.4,
                "price": 0.3,
                "time": 0.2,
                "capabilities": 0.1
            }
        
        # Normalize values
        max_price = max(bid.proposed_price for bid in bids)
        max_time = max(bid.estimated_time_hours for bid in bids)
        max_reputation = max(reputation_scores.values()) if reputation_scores else 100.0
        
        best_score = -1
        best_worker = None
        
        for bid in bids:
            # Get reputation
            reputation = reputation_scores.get(bid.worker_address, 0.0)
            
            # Normalize values (0-1 scale)
            norm_reputation = reputation / max_reputation if max_reputation > 0 else 0
            norm_price = 1 - (bid.proposed_price / max_price) if max_price > 0 else 1  # Lower price is better
            norm_time = 1 - (bid.estimated_time_hours / max_time) if max_time > 0 else 1  # Faster is better
            capability_match = len(bid.capabilities) / 10  # Assume max 10 capabilities
            
            # Weighted score
            score = (
                weights["reputation"] * norm_reputation +
                weights["price"] * norm_price +
                weights["time"] * norm_time +
                weights["capabilities"] * capability_match
            )
            
            rprint(f"[cyan]Worker {bid.worker_address[:8]}...: score={score:.2f} "
                   f"(rep={norm_reputation:.2f}, price={norm_price:.2f}, "
                   f"time={norm_time:.2f}, caps={capability_match:.2f})[/cyan]")
            
            if score > best_score:
                best_score = score
                best_worker = bid.worker_address
        
        rprint(f"[green]✅ Selected worker: {best_worker[:8]}... (score={best_score:.2f})[/green]")
        
        return best_worker
    
    def assign_task(
        self,
        task_id: str,
        worker_address: str,
        budget: float
    ) -> str:
        """
        Assign task to selected worker.
        
        Sends assignment message via XMTP and updates task status.
        
        Args:
            task_id: Task ID
            worker_address: Selected worker address
            budget: Task budget in USDC
        
        Returns:
            Assignment message ID
        
        Raises:
            ChaosChainSDKError: If task not found or XMTP unavailable
        """
        if task_id not in self.active_tasks:
            raise ChaosChainSDKError(f"Task {task_id} not found")
        
        if not self.sdk.xmtp_manager:
            raise ChaosChainSDKError("XMTP not available")
        
        # Update task status
        task = self.active_tasks[task_id]
        task.status = "assigned"
        task.assigned_to = worker_address
        task.assigned_at = datetime.now(timezone.utc)
        
        # Send assignment message via XMTP
        message_id = self.sdk.send_message(
            to_agent=worker_address,
            message_type="task_assignment",
            content={
                "task_id": task_id,
                "studio_address": task.studio_address,
                "budget": budget,
                "deadline": task.requirements.get("deadline", "").isoformat() if isinstance(task.requirements.get("deadline"), datetime) else task.requirements.get("deadline", ""),
                "requirements": task.requirements
            }
        )
        
        rprint(f"[green]✅ Task {task_id} assigned to {worker_address[:8]}...[/green]")
        
        return message_id
    
    def _display_bids(self, bids: List[WorkerBid]):
        """Display bids in a nice table."""
        if not bids:
            return
        
        table = Table(title="Worker Bids")
        table.add_column("Worker", style="cyan")
        table.add_column("Price (USDC)", justify="right", style="green")
        table.add_column("Time (hrs)", justify="right", style="yellow")
        table.add_column("Capabilities", style="magenta")
        table.add_column("Reputation", justify="right", style="blue")
        
        for bid in bids:
            worker_short = bid.worker_address[:8] + "..."
            caps = ", ".join(bid.capabilities[:3]) if bid.capabilities else "N/A"
            
            table.add_row(
                worker_short,
                f"${bid.proposed_price:.2f}",
                f"{bid.estimated_time_hours:.1f}",
                caps,
                f"{bid.reputation_score:.1f}"
            )
        
        console.print(table)
