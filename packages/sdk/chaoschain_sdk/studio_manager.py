"""
Studio Manager for ChaosChain Task Assignment

Implements:
- Task broadcasting to registered workers
- Bid collection from workers
- Reputation-based worker selection
- Task assignment and tracking

Protocol Spec: Complete Workflow with Studios
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
import time
import logging
import uuid

logger = logging.getLogger(__name__)


@dataclass
class Task:
    """Task definition for Studio workflow."""
    task_id: str
    studio_id: str
    client_agent_id: str
    requirements: Dict[str, Any]
    budget: float
    deadline: int  # Unix timestamp
    status: str  # broadcasting, assigned, in_progress, completed, failed
    assigned_worker: Optional[str] = None
    created_at: int = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = int(datetime.now(timezone.utc).timestamp())


@dataclass
class WorkerBid:
    """Worker bid for a task."""
    bid_id: str
    task_id: str
    worker_address: str
    worker_agent_id: int
    proposed_price: float
    estimated_time: int  # seconds
    capabilities: List[str]
    reputation_score: float
    message_id: str  # XMTP message ID
    created_at: int = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = int(datetime.now(timezone.utc).timestamp())


class StudioManager:
    """
    Studio task assignment and orchestration.
    
    Handles:
    - Task broadcasting to workers
    - Bid collection from workers
    - Worker selection (reputation-based)
    - Task assignment and tracking
    """
    
    def __init__(self, sdk):
        """
        Initialize Studio Manager.
        
        Args:
            sdk: ChaosChainAgentSDK instance
        """
        self.sdk = sdk
        self.active_tasks = {}
        self.worker_bids = {}
        self.completed_tasks = {}
        
        logger.info("✅ Studio Manager initialized")
    
    def create_task(
        self,
        studio_id: str,
        client_agent_id: str,
        requirements: Dict[str, Any],
        budget: float,
        deadline_hours: int = 24
    ) -> Task:
        """
        Create a new task in the Studio.
        
        Args:
            studio_id: Studio identifier
            client_agent_id: Client agent ID
            requirements: Task requirements (description, capabilities, etc.)
            budget: Task budget in USDC
            deadline_hours: Deadline in hours from now
        
        Returns:
            Task object
        
        Example:
            ```python
            task = studio_manager.create_task(
                studio_id="studio_123",
                client_agent_id=42,
                requirements={
                    "description": "Analyze financial data",
                    "capabilities": ["data_analysis", "finance"],
                    "min_reputation": 70
                },
                budget=10.0,
                deadline_hours=24
            )
            ```
        """
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        deadline = int(datetime.now(timezone.utc).timestamp()) + (deadline_hours * 3600)
        
        task = Task(
            task_id=task_id,
            studio_id=studio_id,
            client_agent_id=client_agent_id,
            requirements=requirements,
            budget=budget,
            deadline=deadline,
            status="created"
        )
        
        self.active_tasks[task_id] = task
        logger.info(f"✅ Task created: {task_id} (budget: ${budget}, deadline: {deadline_hours}h)")
        
        return task
    
    def broadcast_task(
        self,
        task: Task,
        registered_workers: List[str],
        timeout_seconds: int = 300
    ) -> str:
        """
        Broadcast task to registered workers.
        
        Sends XMTP messages to all registered workers with task details.
        
        Args:
            task: Task object
            registered_workers: List of registered worker addresses
            timeout_seconds: Timeout for bid collection
        
        Returns:
            Task ID
        
        Raises:
            Exception: If XMTP not available
        """
        if not self.sdk.xmtp_manager:
            raise Exception("XMTP not available for task broadcasting")
        
        task.status = "broadcasting"
        self.active_tasks[task.task_id] = task
        
        # Broadcast to all workers
        broadcast_count = 0
        for worker_address in registered_workers:
            try:
                message_id = self.sdk.send_message(
                    to_agent=worker_address,
                    message_type="task_broadcast",
                    content={
                        "task_id": task.task_id,
                        "studio_id": task.studio_id,
                        "description": task.requirements.get("description", ""),
                        "capabilities_required": task.requirements.get("capabilities", []),
                        "budget": task.budget,
                        "deadline": task.deadline,
                        "min_reputation": task.requirements.get("min_reputation", 0)
                    }
                )
                broadcast_count += 1
                logger.debug(f"📤 Broadcast to {worker_address}: {message_id}")
            except Exception as e:
                logger.warning(f"⚠️  Failed to broadcast to {worker_address}: {e}")
        
        logger.info(f"✅ Task {task.task_id} broadcast to {broadcast_count} workers")
        return task.task_id
    
    def collect_bids(
        self,
        task_id: str,
        timeout_seconds: int = 300,
        min_bids: int = 3
    ) -> List[WorkerBid]:
        """
        Collect bids from workers.
        
        Listens for XMTP messages with type "bid" for the specified task.
        
        Args:
            task_id: Task ID
            timeout_seconds: Timeout for bid collection
            min_bids: Minimum number of bids to collect
        
        Returns:
            List of WorkerBid objects
        
        Note:
            In production, this would use XMTP's streaming API for real-time bid collection.
            For now, it polls conversations periodically.
        """
        if task_id not in self.active_tasks:
            raise ValueError(f"Task {task_id} not found")
        
        task = self.active_tasks[task_id]
        task.status = "collecting_bids"
        
        bids = []
        start_time = time.time()
        
        logger.info(f"📥 Collecting bids for task {task_id} (timeout: {timeout_seconds}s, min: {min_bids})")
        
        # Poll for bids
        while time.time() - start_time < timeout_seconds:
            # Check all conversations for bid messages
            if self.sdk.xmtp_manager:
                try:
                    conversations = self.sdk.get_all_conversations()
                    for worker_address in conversations:
                        messages = self.sdk.get_messages(worker_address)
                        
                        # Look for bid messages for this task
                        for msg in messages:
                            try:
                                import json
                                content = json.loads(msg.get("content", "{}"))
                                
                                if (content.get("type") == "bid" and 
                                    content.get("task_id") == task_id):
                                    
                                    # Check if we already have this bid
                                    if any(b.message_id == msg["id"] for b in bids):
                                        continue
                                    
                                    # Create WorkerBid
                                    bid = WorkerBid(
                                        bid_id=f"bid_{uuid.uuid4().hex[:8]}",
                                        task_id=task_id,
                                        worker_address=msg["author"],
                                        worker_agent_id=content.get("worker_agent_id", 0),
                                        proposed_price=content.get("proposed_price", 0),
                                        estimated_time=content.get("estimated_time", 0),
                                        capabilities=content.get("capabilities", []),
                                        reputation_score=content.get("reputation_score", 0),
                                        message_id=msg["id"]
                                    )
                                    
                                    bids.append(bid)
                                    logger.info(f"✅ Bid received from {bid.worker_address}: ${bid.proposed_price}")
                            except Exception as e:
                                logger.debug(f"⚠️  Failed to parse message: {e}")
                                continue
                    
                    # Check if we have enough bids
                    if len(bids) >= min_bids:
                        logger.info(f"✅ Collected {len(bids)} bids (minimum reached)")
                        break
                    
                except Exception as e:
                    logger.warning(f"⚠️  Error collecting bids: {e}")
            
            # Sleep before next poll
            time.sleep(5)
        
        # Store bids
        self.worker_bids[task_id] = bids
        
        logger.info(f"✅ Bid collection complete: {len(bids)} bids received")
        return bids
    
    def select_worker(
        self,
        task_id: str,
        bids: List[WorkerBid] = None,
        reputation_weight: float = 0.4,
        price_weight: float = 0.3,
        time_weight: float = 0.2,
        capability_weight: float = 0.1
    ) -> Optional[WorkerBid]:
        """
        Select best worker based on reputation, price, time, and capabilities.
        
        Implements reputation-based selection algorithm.
        
        Args:
            task_id: Task ID
            bids: List of bids (if None, uses cached bids)
            reputation_weight: Weight for reputation score (0-1)
            price_weight: Weight for price (0-1)
            time_weight: Weight for estimated time (0-1)
            capability_weight: Weight for capabilities match (0-1)
        
        Returns:
            Selected WorkerBid or None if no suitable worker
        
        Algorithm:
            score = (
                reputation_weight * norm_reputation +
                price_weight * norm_price +
                time_weight * norm_time +
                capability_weight * norm_capabilities
            )
        """
        if bids is None:
            bids = self.worker_bids.get(task_id, [])
        
        if not bids:
            logger.warning(f"⚠️  No bids available for task {task_id}")
            return None
        
        task = self.active_tasks.get(task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")
        
        # Normalize values
        max_reputation = max(b.reputation_score for b in bids) or 100
        max_price = max(b.proposed_price for b in bids) or task.budget
        max_time = max(b.estimated_time for b in bids) or 86400  # 24 hours
        
        required_capabilities = set(task.requirements.get("capabilities", []))
        
        best_score = -1
        best_bid = None
        
        for bid in bids:
            # Check budget constraint
            if bid.proposed_price > task.budget:
                logger.debug(f"⚠️  Bid from {bid.worker_address} exceeds budget: ${bid.proposed_price} > ${task.budget}")
                continue
            
            # Check minimum reputation
            min_reputation = task.requirements.get("min_reputation", 0)
            if bid.reputation_score < min_reputation:
                logger.debug(f"⚠️  Bid from {bid.worker_address} below min reputation: {bid.reputation_score} < {min_reputation}")
                continue
            
            # Normalize scores
            norm_reputation = bid.reputation_score / max_reputation
            norm_price = 1 - (bid.proposed_price / max_price)  # Lower price = higher score
            norm_time = 1 - (bid.estimated_time / max_time)  # Faster = higher score
            
            # Capability match
            worker_capabilities = set(bid.capabilities)
            capability_match = len(required_capabilities & worker_capabilities) / len(required_capabilities) if required_capabilities else 1.0
            
            # Weighted score
            score = (
                reputation_weight * norm_reputation +
                price_weight * norm_price +
                time_weight * norm_time +
                capability_weight * capability_match
            )
            
            logger.debug(
                f"Worker {bid.worker_address}: "
                f"score={score:.3f} "
                f"(rep={norm_reputation:.2f}, price={norm_price:.2f}, time={norm_time:.2f}, cap={capability_match:.2f})"
            )
            
            if score > best_score:
                best_score = score
                best_bid = bid
        
        if best_bid:
            logger.info(
                f"✅ Selected worker {best_bid.worker_address} "
                f"(score: {best_score:.3f}, price: ${best_bid.proposed_price}, rep: {best_bid.reputation_score})"
            )
        else:
            logger.warning(f"⚠️  No suitable worker found for task {task_id}")
        
        return best_bid
    
    def assign_task(
        self,
        task_id: str,
        worker_bid: WorkerBid
    ) -> str:
        """
        Assign task to selected worker.
        
        Sends XMTP message to worker with task assignment.
        
        Args:
            task_id: Task ID
            worker_bid: Selected worker bid
        
        Returns:
            Assignment message ID
        
        Raises:
            Exception: If XMTP not available or task not found
        """
        if task_id not in self.active_tasks:
            raise ValueError(f"Task {task_id} not found")
        
        if not self.sdk.xmtp_manager:
            raise Exception("XMTP not available for task assignment")
        
        task = self.active_tasks[task_id]
        task.status = "assigned"
        task.assigned_worker = worker_bid.worker_address
        
        # Send assignment message
        message_id = self.sdk.send_message(
            to_agent=worker_bid.worker_address,
            message_type="task_assignment",
            content={
                "task_id": task_id,
                "studio_id": task.studio_id,
                "budget": worker_bid.proposed_price,
                "deadline": task.deadline,
                "requirements": task.requirements
            },
            parent_id=worker_bid.message_id  # Reply to the bid
        )
        
        logger.info(f"✅ Task {task_id} assigned to {worker_bid.worker_address} (message: {message_id})")
        
        return message_id
    
    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """
        Get task status.
        
        Args:
            task_id: Task ID
        
        Returns:
            Task status dictionary
        """
        if task_id in self.active_tasks:
            task = self.active_tasks[task_id]
            return {
                "task_id": task.task_id,
                "studio_id": task.studio_id,
                "status": task.status,
                "assigned_worker": task.assigned_worker,
                "budget": task.budget,
                "deadline": task.deadline,
                "created_at": task.created_at
            }
        elif task_id in self.completed_tasks:
            task = self.completed_tasks[task_id]
            return {
                "task_id": task.task_id,
                "studio_id": task.studio_id,
                "status": "completed",
                "assigned_worker": task.assigned_worker,
                "budget": task.budget,
                "created_at": task.created_at
            }
        else:
            return {"error": f"Task {task_id} not found"}
    
    def complete_task(self, task_id: str):
        """
        Mark task as completed.
        
        Args:
            task_id: Task ID
        """
        if task_id in self.active_tasks:
            task = self.active_tasks.pop(task_id)
            task.status = "completed"
            self.completed_tasks[task_id] = task
            logger.info(f"✅ Task {task_id} marked as completed")
        else:
            logger.warning(f"⚠️  Task {task_id} not found in active tasks")
    
    def get_active_tasks(self) -> List[Dict[str, Any]]:
        """Get all active tasks."""
        return [
            {
                "task_id": task.task_id,
                "studio_id": task.studio_id,
                "status": task.status,
                "assigned_worker": task.assigned_worker,
                "budget": task.budget,
                "deadline": task.deadline
            }
            for task in self.active_tasks.values()
        ]
    
    def get_completed_tasks(self) -> List[Dict[str, Any]]:
        """Get all completed tasks."""
        return [
            {
                "task_id": task.task_id,
                "studio_id": task.studio_id,
                "assigned_worker": task.assigned_worker,
                "budget": task.budget
            }
            for task in self.completed_tasks.values()
        ]

