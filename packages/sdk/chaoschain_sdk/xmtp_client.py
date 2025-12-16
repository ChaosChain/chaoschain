"""
XMTP Client Integration for ChaosChain Protocol.

Implements agent-to-agent communication with causal DAG construction
as specified in Protocol Spec v0.1 (§1 - Formal DKG & Causal Audit Model).

Key Features:
- XMTP message threading with parent references
- Causal DAG construction (§1.1)
- Verifiable Logical Clock (VLC) computation (§1.3)
- Thread root calculation (Merkle root over topologically sorted messages) (§1.2)
- Causality verification (parents exist, timestamps monotonic)

Usage:
    ```python
    from chaoschain_sdk import ChaosChainAgentSDK
    
    sdk = ChaosChainAgentSDK(...)
    
    # Send message (creates DAG node)
    message_id = sdk.send_message(
        to_agent="0x...",
        message_type="task_request",
        content={"task": "analyze market data"},
        parent_id=previous_message_id  # Creates causal link
    )
    
    # Fetch thread for causal audit
    thread = sdk.get_xmtp_thread(conversation_address)
    
    # Verify causality
    if sdk.xmtp_manager.verify_causality(thread):
        # Compute thread root for DataHash
        thread_root = sdk.xmtp_manager.compute_thread_root(thread)
    ```
"""

from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import hashlib
from eth_utils import keccak
from rich import print as rprint

@dataclass
class XMTPMessage:
    """
    XMTP message with causal DAG metadata.
    
    Represents a node in the causal DAG (§1.1).
    """
    id: str
    author: str  # Agent wallet address
    content: str  # JSON-encoded message content
    timestamp: int  # Unix timestamp
    parent_id: Optional[str] = None  # Parent message ID (for causal links)
    signature: Optional[str] = None  # Message signature (optional)
    vlc: Optional[str] = None  # Verifiable Logical Clock (§1.3)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "id": self.id,
            "author": self.author,
            "content": self.content,
            "timestamp": self.timestamp,
            "parent_id": self.parent_id,
            "signature": self.signature,
            "vlc": self.vlc
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'XMTPMessage':
        """Create from dictionary."""
        return cls(
            id=data["id"],
            author=data["author"],
            content=data["content"],
            timestamp=data["timestamp"],
            parent_id=data.get("parent_id"),
            signature=data.get("signature"),
            vlc=data.get("vlc")
        )


class XMTPManager:
    """
    XMTP integration for agent-to-agent communication.
    
    Implements Protocol Spec v0.1:
    - §1.1: Graph Structure (Causal DAG)
    - §1.2: Canonicalization (Merkle root computation)
    - §1.3: Verifiable Logical Clock (VLC)
    - §1.5: Causal Audit Algorithm
    
    The XMTP network provides:
    1. High-throughput A2A communication (off-chain)
    2. Evidence pointers (IPFS CIDs in messages)
    3. Auditable evidence store (causal DAG for verification)
    """
    
    def __init__(self, wallet_manager):
        """
        Initialize XMTP client with wallet.
        
        Args:
            wallet_manager: WalletManager instance with account
        """
        self.wallet_manager = wallet_manager
        self.client = None
        self.conversations = {}
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize XMTP client (lazy import to avoid dependency issues)."""
        try:
            from xmtp import Client
            from xmtp.crypto import PrivateKey
            
            # Get private key from wallet manager
            private_key_bytes = self.wallet_manager.account.key
            
            # Create XMTP client
            self.client = Client.create(private_key_bytes)
            
            rprint("[green]✅ XMTP client initialized[/green]")
        except ImportError:
            rprint("[yellow]⚠️  XMTP not available: pip install xmtp[/yellow]")
            self.client = None
        except Exception as e:
            rprint(f"[yellow]⚠️  XMTP initialization failed: {e}[/yellow]")
            self.client = None
    
    def send_message(
        self,
        to_address: str,
        content: Dict[str, Any],
        parent_id: Optional[str] = None
    ) -> str:
        """
        Send message to another agent (creates DAG node).
        
        Args:
            to_address: Recipient agent address
            content: Message content (JSON serializable)
            parent_id: Parent message ID (for causal DAG)
        
        Returns:
            Message ID
        
        Raises:
            Exception: If XMTP client not available
        """
        if not self.client:
            raise Exception("XMTP client not available. Install with: pip install xmtp")
        
        # Add metadata
        message_data = {
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "from": self.wallet_manager.address
        }
        
        # Add parent reference if provided
        if parent_id:
            message_data["parent_id"] = parent_id
        
        # Serialize content
        content_str = json.dumps(message_data)
        
        # Get or create conversation
        conversation = self.client.conversations.new_conversation(to_address)
        
        # Send message
        message = conversation.send(content_str)
        
        # Store conversation
        self.conversations[to_address] = conversation
        
        rprint(f"[green]📤 Sent XMTP message to {to_address[:8]}...[/green]")
        
        return message.id
    
    def get_thread(self, conversation_address: str) -> List[XMTPMessage]:
        """
        Fetch entire thread (reconstruct DAG).
        
        Args:
            conversation_address: Address of conversation partner
        
        Returns:
            List of XMTPMessage objects (sorted by timestamp)
        """
        if not self.client:
            rprint("[yellow]⚠️  XMTP not available, returning empty thread[/yellow]")
            return []
        
        # Get conversation
        conversation = self.conversations.get(conversation_address)
        if not conversation:
            conversation = self.client.conversations.get(conversation_address)
        
        if not conversation:
            return []
        
        # Fetch all messages
        try:
            raw_messages = conversation.messages()
        except Exception as e:
            rprint(f"[yellow]⚠️  Failed to fetch messages: {e}[/yellow]")
            return []
        
        # Convert to XMTPMessage objects
        messages = []
        for msg in raw_messages:
            try:
                content_data = json.loads(msg.content)
                parent_id = content_data.get("parent_id") if isinstance(content_data, dict) else None
                
                xmtp_msg = XMTPMessage(
                    id=msg.id,
                    author=msg.sender_address,
                    content=msg.content,
                    timestamp=int(msg.sent_at.timestamp()),
                    parent_id=parent_id
                )
                messages.append(xmtp_msg)
            except Exception as e:
                rprint(f"[yellow]⚠️  Failed to parse message: {e}[/yellow]")
                continue
        
        # Sort by timestamp
        messages.sort(key=lambda m: m.timestamp)
        
        return messages
    
    def compute_thread_root(self, messages: List[XMTPMessage]) -> bytes:
        """
        Compute Merkle root of XMTP DAG (for DataHash) (§1.2).
        
        Thread root is computed over topologically-sorted list of message hashes.
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            Thread root (32-byte hash)
        """
        if not messages:
            return bytes(32)  # Zero hash for empty thread
        
        # Sort messages topologically (by timestamp, then ID)
        sorted_messages = sorted(messages, key=lambda m: (m.timestamp, m.id))
        
        # Compute hash for each message (§1.2 - Canonicalization)
        message_hashes = []
        for msg in sorted_messages:
            msg_hash = self._compute_message_hash(msg)
            message_hashes.append(msg_hash)
        
        # Compute Merkle root
        return self._compute_merkle_root(message_hashes)
    
    def _compute_message_hash(self, msg: XMTPMessage) -> bytes:
        """
        Compute canonical hash for a message (§1.2).
        
        Canon(v) = RLP(author || ts || xmtp_msg_id || payload_hash || parents[])
        
        For simplicity, we use keccak256 instead of RLP.
        """
        # Canonical representation
        canonical = (
            f"{msg.author}|"
            f"{msg.timestamp}|"
            f"{msg.id}|"
            f"{msg.content}|"
            f"{msg.parent_id or ''}"
        )
        
        return keccak(text=canonical)
    
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
    
    def verify_causality(self, messages: List[XMTPMessage]) -> bool:
        """
        Verify parents exist and timestamps are monotonic (§1.5).
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            True if causality is valid
        """
        if not messages:
            return True
        
        message_map = {msg.id: msg for msg in messages}
        
        for msg in messages:
            # Check parent exists
            if msg.parent_id:
                if msg.parent_id not in message_map:
                    rprint(f"[red]❌ Parent {msg.parent_id} not found for message {msg.id}[/red]")
                    return False
                
                # Check timestamp monotonicity (with tolerance for network delays)
                parent = message_map[msg.parent_id]
                if msg.timestamp < parent.timestamp:
                    rprint(f"[red]❌ Timestamp not monotonic: {msg.id} < {parent.id}[/red]")
                    return False
        
        return True
    
    def compute_vlc(self, message: XMTPMessage, messages: List[XMTPMessage]) -> bytes:
        """
        Compute Verifiable Logical Clock (§1.3).
        
        VLC makes tampering with ancestry detectable:
        lc(v) = keccak256(h(v) || max_{p ∈ parents(v)} lc(p))
        
        Args:
            message: Message to compute VLC for
            messages: All messages in thread
        
        Returns:
            VLC hash (32 bytes)
        """
        # Compute message hash
        message_hash = self._compute_message_hash(message)
        
        # Find parent VLC
        parent_vlc = bytes(32)  # Zero for root messages
        if message.parent_id:
            for msg in messages:
                if msg.id == message.parent_id and msg.vlc:
                    parent_vlc = bytes.fromhex(msg.vlc[2:] if msg.vlc.startswith('0x') else msg.vlc)
                    break
        
        # Compute VLC: keccak256(message_hash || parent_vlc)
        vlc = keccak(message_hash + parent_vlc)
        
        return vlc
    
    def reconstruct_dag(self, messages: List[XMTPMessage]) -> Dict[str, List[str]]:
        """
        Reconstruct causal DAG from messages.
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            Adjacency list {message_id: [child_ids]}
        """
        dag = {msg.id: [] for msg in messages}
        
        for msg in messages:
            if msg.parent_id and msg.parent_id in dag:
                dag[msg.parent_id].append(msg.id)
        
        return dag
    
    def get_message_depth(self, message: XMTPMessage, messages: List[XMTPMessage]) -> int:
        """
        Compute depth of a message in the DAG (distance from root).
        
        Args:
            message: Message to compute depth for
            messages: All messages in thread
        
        Returns:
            Depth (1 for root messages)
        """
        if message.parent_id is None:
            return 1
        
        message_map = {msg.id: msg for msg in messages}
        parent = message_map.get(message.parent_id)
        
        if parent is None:
            return 1
        
        return 1 + self.get_message_depth(parent, messages)
