"""
XMTP Client for ChaosChain Agent Communication

Provides agent-to-agent communication with causal DAG construction
as specified in Protocol Spec v0.1 (§1 - Formal DKG & Causal Audit Model).

MVP Mode (Default):
- Uses LOCAL message storage (no XMTP network dependency)
- DKG nodes built from local interaction logs
- Thread root computed locally (Merkle root)
- VLC computed locally (Verifiable Logical Clock)
- Full causal analysis support

Future Mode (XMTP Bridge):
- When XMTP bridge infrastructure is deployed, agents can use real XMTP
- Messages will be E2E encrypted via XMTP network
- See packages/xmtp-bridge/ for bridge implementation

Key Features (work in both modes):
- DKG node construction (§1.1)
- Thread root calculation (Merkle root over topologically sorted messages) (§1.2)
- Verifiable Logical Clock (VLC) computation (§1.3)
- Causality verification (parents exist, timestamps monotonic) (§1.5)

Usage:
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    
    sdk = ChaosChainAgentSDK(...)
    
    # Send message (creates DKG node locally)
    message_id, dkg_node = sdk.xmtp.send_message(
        to_agent="0x...",
        content={"task": "analyze market data"},
        parent_ids=[previous_message_id]  # Creates causal link
    )
    
    # Get thread for causal audit
    thread = sdk.xmtp.get_thread()
    
    # Compute thread root for DataHash
    thread_root = sdk.xmtp.compute_thread_root(thread["nodes"])
    ```

@author ChaosChain
"""

from typing import List, Optional, Dict, Any, Tuple, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import hashlib
import uuid
import os
from eth_utils import keccak
from rich import print as rprint


@dataclass
class DKGNode:
    """
    DKG Node structure (Protocol Spec §1.1).
    
    Represents a node in the Decentralized Knowledge Graph.
    Each message becomes a DKG node with causal links.
    
    Attributes:
        author: ERC-8004 agent address
        sig: Cryptographic signature over node contents
        ts: Unix timestamp in milliseconds
        xmtp_msg_id: Message ID (local UUID in MVP mode)
        artifact_ids: Array of artifact CIDs (IPFS/Arweave)
        payload_hash: keccak256 hash of the payload
        parents: Parent message IDs (for causal DAG)
        vlc: Verifiable Logical Clock value (§1.3)
        agent_id: ERC-8004 Agent ID (if registered)
    """
    author: str
    sig: str
    ts: int
    xmtp_msg_id: str
    artifact_ids: List[str]
    payload_hash: str
    parents: List[str]
    vlc: Optional[str] = None
    agent_id: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "author": self.author,
            "sig": self.sig,
            "ts": self.ts,
            "xmtp_msg_id": self.xmtp_msg_id,
            "artifact_ids": self.artifact_ids,
            "payload_hash": self.payload_hash,
            "parents": self.parents,
            "vlc": self.vlc,
            "agent_id": self.agent_id
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DKGNode':
        """Create from dictionary."""
        return cls(
            author=data.get("author", ""),
            sig=data.get("sig", ""),
            ts=data.get("ts", 0),
            xmtp_msg_id=data.get("xmtp_msg_id", ""),
            artifact_ids=data.get("artifact_ids", []),
            payload_hash=data.get("payload_hash", ""),
            parents=data.get("parents", []),
            vlc=data.get("vlc"),
            agent_id=data.get("agent_id")
        )
    
    def compute_hash(self) -> bytes:
        """Compute canonical hash for this node (§1.2)."""
        canonical = f"{self.author}|{self.ts}|{self.xmtp_msg_id}|{self.payload_hash}|{','.join(self.parents)}"
        return keccak(text=canonical)
    
    def to_full_dkg_node(self):
        """
        Convert to full DKGNode from dkg.py module.
        
        Use this when you need to add the node to a DKG graph for causal analysis.
        
        Returns:
            dkg.DKGNode instance
        """
        from .dkg import DKGNode as FullDKGNode
        
        # Convert string hashes to bytes
        payload_hash_bytes = bytes.fromhex(
            self.payload_hash[2:] if self.payload_hash.startswith('0x') else self.payload_hash
        ) if self.payload_hash else bytes(32)
        
        vlc_bytes = None
        if self.vlc:
            vlc_bytes = bytes.fromhex(
                self.vlc[2:] if self.vlc.startswith('0x') else self.vlc
            )
        
        sig_bytes = bytes.fromhex(
            self.sig[2:] if self.sig.startswith('0x') else self.sig
        ) if self.sig else bytes(65)
        
        return FullDKGNode(
            author=self.author,
            sig=sig_bytes,
            ts=self.ts,
            xmtp_msg_id=self.xmtp_msg_id,
            artifact_ids=self.artifact_ids,
            payload_hash=payload_hash_bytes,
            parents=self.parents,
            vlc=vlc_bytes,
            metadata={"agent_id": self.agent_id} if self.agent_id else {}
        )


@dataclass
class XMTPMessage:
    """
    Message with DKG metadata.
    """
    id: str
    sender: str
    recipient: str
    content: Dict[str, Any]
    timestamp: int
    dkg_node: DKGNode
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'XMTPMessage':
        """Create from dictionary."""
        return cls(
            id=data.get("id", ""),
            sender=data.get("sender", ""),
            recipient=data.get("recipient", ""),
            content=data.get("content", {}),
            timestamp=data.get("timestamp", 0),
            dkg_node=DKGNode.from_dict(data.get("dkg_node", {}))
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "sender": self.sender,
            "recipient": self.recipient,
            "content": self.content,
            "timestamp": self.timestamp,
            "dkg_node": self.dkg_node.to_dict()
        }


class XMTPManager:
    """
    XMTP-compatible message manager for agent communication.
    
    MVP Mode (Default):
    - Stores messages locally (in-memory + optional file persistence)
    - Builds DKG nodes with proper causal links
    - Computes thread roots and VLCs locally
    - No external XMTP dependency
    
    This allows full Protocol Spec §1 compliance without XMTP infrastructure.
    When XMTP bridge is available, this can be upgraded to use real XMTP.
    
    Protocol Spec v0.1 Compliance:
    - §1.1: Graph Structure (Causal DAG)
    - §1.2: Canonicalization (Merkle root computation)
    - §1.3: Verifiable Logical Clock (VLC)
    - §1.5: Causal Audit Algorithm
    """
    
    def __init__(
        self,
        address: str,
        agent_id: Optional[int] = None,
        persistence_file: Optional[str] = None
    ):
        """
        Initialize XMTP Manager.
        
        Args:
            address: Agent's wallet address
            agent_id: Optional ERC-8004 agent ID
            persistence_file: Optional file path for message persistence
        """
        self.address = address
        self.agent_id = agent_id
        self.persistence_file = persistence_file
        
        # In-memory message storage
        self._messages: Dict[str, XMTPMessage] = {}
        self._conversations: Dict[str, List[str]] = {}  # peer -> [msg_ids]
        
        # Load persisted messages if file exists
        if persistence_file and os.path.exists(persistence_file):
            self._load_messages()
        
        rprint(f"[green]✅ XMTP Manager initialized (local mode)[/green]")
    
    def send_message(
        self,
        to_address: str,
        content: Dict[str, Any],
        parent_ids: Optional[List[str]] = None,
        artifact_ids: Optional[List[str]] = None,
        sign_func: Optional[Callable[[bytes], str]] = None
    ) -> Tuple[str, DKGNode]:
        """
        Send a message (creates DKG node).
        
        Args:
            to_address: Recipient agent address
            content: Message content (JSON serializable)
            parent_ids: Parent message IDs (for causal DAG)
            artifact_ids: Artifact CIDs (IPFS/Arweave)
            sign_func: Optional signing function for the node
        
        Returns:
            Tuple of (message_id, dkg_node)
        """
        # Generate message ID
        message_id = f"msg_{uuid.uuid4().hex[:16]}"
        timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
        
        # Compute payload hash
        payload_hash = keccak(text=json.dumps(content, sort_keys=True)).hex()
        
        # Create signature (placeholder or real)
        sig = ""
        if sign_func:
            node_data = f"{self.address}|{timestamp}|{message_id}|{payload_hash}"
            sig = sign_func(node_data.encode())
        
        # Create DKG node
        dkg_node = DKGNode(
            author=self.address,
            sig=sig,
            ts=timestamp,
            xmtp_msg_id=message_id,
            artifact_ids=artifact_ids or [],
            payload_hash=payload_hash,
            parents=parent_ids or [],
            agent_id=self.agent_id
        )
        
        # Compute VLC (§1.3)
        dkg_node.vlc = self._compute_vlc(dkg_node)
        
        # Create message
        message = XMTPMessage(
            id=message_id,
            sender=self.address,
            recipient=to_address,
            content=content,
            timestamp=timestamp,
            dkg_node=dkg_node
        )
        
        # Store message
        self._messages[message_id] = message
        
        # Track conversation
        if to_address not in self._conversations:
            self._conversations[to_address] = []
        self._conversations[to_address].append(message_id)
        
        # Persist if configured
        if self.persistence_file:
            self._save_messages()
        
        rprint(f"[green]📤 Message sent to {to_address[:10]}... (ID: {message_id})[/green]")
        
        return message_id, dkg_node
    
    def receive_message(
        self,
        from_address: str,
        message_id: str,
        content: Dict[str, Any],
        timestamp: int,
        parent_ids: Optional[List[str]] = None,
        artifact_ids: Optional[List[str]] = None,
        agent_id: Optional[int] = None
    ) -> DKGNode:
        """
        Record a received message (creates DKG node).
        
        Use this to log messages received from other agents.
        
        Args:
            from_address: Sender agent address
            message_id: Message ID
            content: Message content
            timestamp: Message timestamp (ms)
            parent_ids: Parent message IDs
            artifact_ids: Artifact CIDs
            agent_id: Sender's ERC-8004 agent ID
        
        Returns:
            DKG node for the received message
        """
        # Compute payload hash
        payload_hash = keccak(text=json.dumps(content, sort_keys=True)).hex()
        
        # Create DKG node
        dkg_node = DKGNode(
            author=from_address,
            sig="",  # We don't have the sender's signature
            ts=timestamp,
            xmtp_msg_id=message_id,
            artifact_ids=artifact_ids or [],
            payload_hash=payload_hash,
            parents=parent_ids or [],
            agent_id=agent_id
        )
        
        # Compute VLC
        dkg_node.vlc = self._compute_vlc(dkg_node)
        
        # Create message
        message = XMTPMessage(
            id=message_id,
            sender=from_address,
            recipient=self.address,
            content=content,
            timestamp=timestamp,
            dkg_node=dkg_node
        )
        
        # Store message
        self._messages[message_id] = message
        
        # Track conversation
        if from_address not in self._conversations:
            self._conversations[from_address] = []
        self._conversations[from_address].append(message_id)
        
        # Persist if configured
        if self.persistence_file:
            self._save_messages()
        
        return dkg_node
    
    def get_thread(
        self,
        peer_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get message thread as DKG structure.
        
        Args:
            peer_address: Filter to specific conversation (None = all messages)
        
        Returns:
            Dict with:
            - nodes: List[DKGNode]
            - thread_root: str (Merkle root, §1.2)
            - edges: List[{from, to}] (causal edges)
        """
        # Get relevant messages
        if peer_address:
            msg_ids = self._conversations.get(peer_address, [])
            messages = [self._messages[mid] for mid in msg_ids if mid in self._messages]
        else:
            messages = list(self._messages.values())
        
        # Extract DKG nodes
        nodes = [msg.dkg_node for msg in messages]
        
        # Build edges from parent relationships
        edges = []
        for node in nodes:
            for parent_id in node.parents:
                edges.append({"from": parent_id, "to": node.xmtp_msg_id})
        
        # Compute thread root
        thread_root = self.compute_thread_root(nodes)
        
        return {
            "nodes": nodes,
            "thread_root": thread_root.hex() if isinstance(thread_root, bytes) else thread_root,
            "edges": edges
        }
    
    def get_all_nodes(self) -> List[DKGNode]:
        """Get all DKG nodes."""
        return [msg.dkg_node for msg in self._messages.values()]
    
    def get_node(self, message_id: str) -> Optional[DKGNode]:
        """Get a specific DKG node by message ID."""
        msg = self._messages.get(message_id)
        return msg.dkg_node if msg else None
    
    def compute_thread_root(self, nodes: List[DKGNode]) -> bytes:
        """
        Compute Merkle root of thread (for DataHash) (§1.2).
        
        Thread root is computed over topologically-sorted list of node hashes.
        
        Args:
            nodes: List of DKG nodes
        
        Returns:
            Thread root (32-byte hash)
        """
        if not nodes:
            return bytes(32)  # Zero hash for empty thread
        
        # Sort nodes topologically (by timestamp, then ID)
        sorted_nodes = sorted(nodes, key=lambda n: (n.ts, n.xmtp_msg_id))
        
        # Compute hash for each node (§1.2 - Canonicalization)
        node_hashes = [node.compute_hash() for node in sorted_nodes]
        
        # Compute Merkle root
        return self._compute_merkle_root(node_hashes)
    
    def _compute_merkle_root(self, hashes: List[bytes]) -> bytes:
        """
        Compute Merkle root from list of hashes.
        
        Args:
            hashes: List of 32-byte hashes
        
        Returns:
            Merkle root (32 bytes)
        """
        if len(hashes) == 0:
            return bytes(32)
        if len(hashes) == 1:
            return hashes[0]
        
        # Build Merkle tree
        current_level = hashes[:]
        while len(current_level) > 1:
            next_level = []
            for i in range(0, len(current_level), 2):
                if i + 1 < len(current_level):
                    combined = current_level[i] + current_level[i + 1]
                else:
                    # Odd number of nodes - hash with itself
                    combined = current_level[i] + current_level[i]
                next_level.append(keccak(combined))
            current_level = next_level
        
        return current_level[0]
    
    def verify_causality(self, nodes: Optional[List[DKGNode]] = None) -> bool:
        """
        Verify parents exist and timestamps are monotonic (§1.5).
        
        Args:
            nodes: List of DKG nodes (None = use all stored nodes)
        
        Returns:
            True if causality is valid
        """
        if nodes is None:
            nodes = self.get_all_nodes()
        
        if not nodes:
            return True
        
        node_map = {n.xmtp_msg_id: n for n in nodes}
        
        for node in nodes:
            # Check each parent exists and has earlier timestamp
            for parent_id in node.parents:
                if parent_id not in node_map:
                    rprint(f"[red]❌ Parent {parent_id} not found for node {node.xmtp_msg_id}[/red]")
                    return False
                
                parent = node_map[parent_id]
                if node.ts < parent.ts:
                    rprint(f"[red]❌ Timestamp not monotonic: {node.xmtp_msg_id} < {parent.xmtp_msg_id}[/red]")
                    return False
        
        return True
    
    def _compute_vlc(self, node: DKGNode) -> str:
        """
        Compute Verifiable Logical Clock (§1.3).
        
        VLC makes tampering with ancestry detectable:
        lc(v) = keccak256(h(v) || max_{p ∈ parents(v)} lc(p))
        
        Args:
            node: Node to compute VLC for
        
        Returns:
            VLC hash (hex string)
        """
        # Compute node hash
        node_hash = node.compute_hash()
        
        # Find max parent VLC
        max_parent_vlc = bytes(32)  # Zero for root nodes
        for parent_id in node.parents:
            parent_msg = self._messages.get(parent_id)
            if parent_msg and parent_msg.dkg_node.vlc:
                parent_vlc_bytes = bytes.fromhex(
                    parent_msg.dkg_node.vlc[2:] if parent_msg.dkg_node.vlc.startswith('0x') 
                    else parent_msg.dkg_node.vlc
                )
                if parent_vlc_bytes > max_parent_vlc:
                    max_parent_vlc = parent_vlc_bytes
        
        # VLC = keccak256(node_hash || max_parent_vlc)
        vlc = keccak(node_hash + max_parent_vlc)
        
        return '0x' + vlc.hex()
    
    def reconstruct_dag(self, nodes: Optional[List[DKGNode]] = None) -> Dict[str, List[str]]:
        """
        Reconstruct causal DAG from nodes.
        
        Args:
            nodes: List of DKG nodes (None = use all stored nodes)
        
        Returns:
            Adjacency list {node_id: [child_ids]}
        """
        if nodes is None:
            nodes = self.get_all_nodes()
        
        dag = {n.xmtp_msg_id: [] for n in nodes}
        
        for node in nodes:
            for parent_id in node.parents:
                if parent_id in dag:
                    dag[parent_id].append(node.xmtp_msg_id)
        
        return dag
    
    def get_node_depth(self, node: DKGNode, nodes: Optional[List[DKGNode]] = None) -> int:
        """
        Compute depth of a node in the DAG (distance from root).
        
        Args:
            node: Node to compute depth for
            nodes: All nodes in thread (None = use stored)
        
        Returns:
            Depth (1 for root nodes)
        """
        if nodes is None:
            nodes = self.get_all_nodes()
        
        if not node.parents:
            return 1
        
        node_map = {n.xmtp_msg_id: n for n in nodes}
        max_parent_depth = 0
        
        for parent_id in node.parents:
            parent = node_map.get(parent_id)
            if parent:
                parent_depth = self.get_node_depth(parent, nodes)
                max_parent_depth = max(max_parent_depth, parent_depth)
        
        return max_parent_depth + 1
    
    def to_dkg(self):
        """
        Convert all stored messages to a DKG graph for causal analysis.
        
        This creates a full DKG object that can be used for:
        - Contribution weight calculation
        - Causal chain verification
        - Multi-dimensional scoring
        
        Returns:
            DKG instance with all nodes added
        
        Example:
            ```python
            xmtp = XMTPManager(address="0x...")
            xmtp.send_message(to="0xBob", content={...})
            xmtp.receive_message(from_address="0xBob", ...)
            
            # Convert to DKG for analysis
            dkg = xmtp.to_dkg()
            weights = dkg.compute_contribution_weights()
            ```
        """
        from .dkg import DKG
        
        dkg = DKG()
        
        # Add all nodes
        for msg in self._messages.values():
            full_node = msg.dkg_node.to_full_dkg_node()
            dkg.add_node(full_node)
        
        return dkg
    
    def clear(self) -> None:
        """Clear all stored messages."""
        self._messages.clear()
        self._conversations.clear()
        
        if self.persistence_file and os.path.exists(self.persistence_file):
            os.remove(self.persistence_file)
    
    def _save_messages(self) -> None:
        """Save messages to persistence file."""
        if not self.persistence_file:
            return
        
        data = {
            "address": self.address,
            "agent_id": self.agent_id,
            "messages": {mid: msg.to_dict() for mid, msg in self._messages.items()},
            "conversations": self._conversations
        }
        
        with open(self.persistence_file, 'w') as f:
            json.dump(data, f, indent=2)
    
    def _load_messages(self) -> None:
        """Load messages from persistence file."""
        if not self.persistence_file or not os.path.exists(self.persistence_file):
            return
        
        try:
            with open(self.persistence_file, 'r') as f:
                data = json.load(f)
            
            self._messages = {
                mid: XMTPMessage.from_dict(msg_data) 
                for mid, msg_data in data.get("messages", {}).items()
            }
            self._conversations = data.get("conversations", {})
            
            rprint(f"[dim]Loaded {len(self._messages)} messages from {self.persistence_file}[/dim]")
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to load messages: {e}[/yellow]")


# Alias for backward compatibility
XMTPBridgeClient = XMTPManager
