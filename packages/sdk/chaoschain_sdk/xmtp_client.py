"""
XMTP Client for ChaosChain Agent Communication

Implements:
- Real-time agent-to-agent messaging
- Causal DAG construction (parents[], timestamps, signatures)
- Thread root computation (Merkle root)
- Verifiable Logical Clock (VLC)
- Causality verification

Protocol Spec: §1 (Formal DKG & Causal Audit Model)
"""

from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone
from eth_utils import keccak
from eth_account.messages import encode_defunct
import json
import logging

logger = logging.getLogger(__name__)


@dataclass
class XMTPMessage:
    """
    XMTP message with causal DAG metadata.
    
    Represents a node in the causal DAG (§1.1).
    """
    id: str
    author: str
    content: str
    timestamp: int
    parent_id: Optional[str] = None
    signature: Optional[str] = None
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
    
    Creates causal DAG of agent interactions for:
    - Multi-dimensional scoring (§3.1)
    - Causal audit (§1.5)
    - Proof of Agency
    
    Protocol Spec: §1 (Formal DKG & Causal Audit Model)
    """
    
    def __init__(self, wallet_manager):
        """
        Initialize XMTP client with wallet.
        
        Args:
            wallet_manager: WalletManager instance with account
        """
        self.wallet = wallet_manager.account
        self.wallet_address = wallet_manager.account.address
        self.conversations = {}
        self.message_cache = {}
        
        # Initialize XMTP client
        try:
            from xmtp import Client
            self.client = Client.create(self.wallet)
            logger.info(f"✅ XMTP client initialized for {self.wallet_address}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize XMTP client: {e}")
            raise
    
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
            Exception: If message send fails
        """
        try:
            # Add metadata
            message_data = {
                "from": self.wallet_address,
                "timestamp": int(datetime.now(timezone.utc).timestamp()),
                "content": content,
                "parent_id": parent_id
            }
            
            # Serialize
            message_str = json.dumps(message_data, sort_keys=True)
            
            # Sign message
            message_hash = keccak(text=message_str)
            signature = self.wallet.sign_message(encode_defunct(message_hash))
            
            # Add signature
            message_data["signature"] = signature.signature.hex()
            final_message_str = json.dumps(message_data, sort_keys=True)
            
            # Get or create conversation
            if to_address not in self.conversations:
                self.conversations[to_address] = self.client.conversations.new_conversation(to_address)
            
            conversation = self.conversations[to_address]
            
            # Send message
            xmtp_message = conversation.send(final_message_str)
            
            # Cache message
            self.message_cache[xmtp_message.id] = XMTPMessage(
                id=xmtp_message.id,
                author=self.wallet_address,
                content=final_message_str,
                timestamp=message_data["timestamp"],
                parent_id=parent_id,
                signature=message_data["signature"]
            )
            
            logger.info(f"✅ Message sent to {to_address}: {xmtp_message.id}")
            return xmtp_message.id
            
        except Exception as e:
            logger.error(f"❌ Failed to send message: {e}")
            raise
    
    def get_thread(
        self,
        conversation_address: str,
        force_refresh: bool = False
    ) -> List[XMTPMessage]:
        """
        Fetch entire thread (reconstruct DAG).
        
        Args:
            conversation_address: Address of conversation partner
            force_refresh: Force refresh from XMTP network
        
        Returns:
            List of XMTPMessage objects sorted by timestamp
            
        Raises:
            Exception: If thread fetch fails
        """
        try:
            # Check cache
            cache_key = f"thread_{conversation_address}"
            if not force_refresh and cache_key in self.message_cache:
                return self.message_cache[cache_key]
            
            # Get conversation
            conversation = self.client.conversations.get(conversation_address)
            if not conversation:
                logger.warning(f"⚠️  No conversation found with {conversation_address}")
                return []
            
            # Fetch all messages
            raw_messages = conversation.messages()
            
            # Convert to XMTPMessage objects
            messages = []
            for msg in raw_messages:
                try:
                    message_data = json.loads(msg.content)
                    
                    xmtp_msg = XMTPMessage(
                        id=msg.id,
                        author=message_data.get("from", msg.sender_address),
                        content=msg.content,
                        timestamp=message_data.get("timestamp", int(msg.sent_at.timestamp())),
                        parent_id=message_data.get("parent_id"),
                        signature=message_data.get("signature")
                    )
                    
                    # Compute VLC
                    xmtp_msg.vlc = self.compute_vlc(xmtp_msg, messages)
                    
                    messages.append(xmtp_msg)
                    
                except Exception as e:
                    logger.warning(f"⚠️  Failed to parse message {msg.id}: {e}")
                    continue
            
            # Sort by timestamp
            messages.sort(key=lambda m: m.timestamp)
            
            # Cache
            self.message_cache[cache_key] = messages
            
            logger.info(f"✅ Fetched {len(messages)} messages from {conversation_address}")
            return messages
            
        except Exception as e:
            logger.error(f"❌ Failed to fetch thread: {e}")
            raise
    
    def compute_thread_root(self, messages: List[XMTPMessage]) -> str:
        """
        Compute Merkle root of XMTP DAG (for DataHash).
        
        Protocol Spec: §1.2 (Canonicalization), §1.4 (On-chain Commitment)
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            Thread root (Merkle root) as hex string
        """
        if not messages:
            return "0x" + "0" * 64
        
        # Sort messages topologically (by timestamp, then ID)
        sorted_messages = sorted(messages, key=lambda m: (m.timestamp, m.id))
        
        # Compute canonical hash for each message (§1.2)
        message_hashes = []
        for msg in sorted_messages:
            canonical = self._canonicalize_message(msg)
            msg_hash = keccak(text=canonical)
            message_hashes.append(msg_hash)
        
        # Compute Merkle root
        root = self._compute_merkle_root(message_hashes)
        
        logger.info(f"✅ Computed thread root: {root}")
        return root
    
    def _canonicalize_message(self, message: XMTPMessage) -> str:
        """
        Compute canonical byte string for a message node.
        
        Protocol Spec: §1.2 (Canonicalization)
        canon(v) = RLP(author || ts || xmtp_msg_id || payload_hash || parents[])
        
        Args:
            message: XMTPMessage object
        
        Returns:
            Canonical string representation
        """
        # Simplified canonical form (RLP encoding would be more complex)
        # For production, use proper RLP encoding
        canonical = (
            f"{message.author}|"
            f"{message.timestamp}|"
            f"{message.id}|"
            f"{keccak(text=message.content).hex()}|"
            f"{message.parent_id or ''}"
        )
        return canonical
    
    def _compute_merkle_root(self, hashes: List[bytes]) -> str:
        """
        Compute Merkle root from list of hashes.
        
        Args:
            hashes: List of message hashes
        
        Returns:
            Merkle root as hex string
        """
        if len(hashes) == 0:
            return "0x" + "0" * 64
        if len(hashes) == 1:
            return "0x" + hashes[0].hex()
        
        # Build Merkle tree
        current_level = hashes
        while len(current_level) > 1:
            next_level = []
            for i in range(0, len(current_level), 2):
                if i + 1 < len(current_level):
                    combined = current_level[i] + current_level[i + 1]
                else:
                    # Odd number of hashes, duplicate the last one
                    combined = current_level[i] + current_level[i]
                next_level.append(keccak(combined))
            current_level = next_level
        
        return "0x" + current_level[0].hex()
    
    def verify_causality(self, messages: List[XMTPMessage]) -> bool:
        """
        Verify parents exist and timestamps are monotonic.
        
        Protocol Spec: §1.5 (Causal Audit Algorithm)
        Check causality: parents exist; timestamps monotonic within tolerance
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            True if causality is valid, False otherwise
        """
        message_map = {msg.id: msg for msg in messages}
        
        for msg in messages:
            # Check parent exists
            if msg.parent_id:
                if msg.parent_id not in message_map:
                    logger.error(f"❌ Parent {msg.parent_id} not found for message {msg.id}")
                    return False
                
                # Check timestamp monotonicity
                parent = message_map[msg.parent_id]
                if msg.timestamp <= parent.timestamp:
                    logger.error(
                        f"❌ Timestamp not monotonic: "
                        f"message {msg.id} ({msg.timestamp}) <= "
                        f"parent {parent.id} ({parent.timestamp})"
                    )
                    return False
        
        logger.info("✅ Causality verification passed")
        return True
    
    def compute_vlc(
        self,
        message: XMTPMessage,
        messages: List[XMTPMessage]
    ) -> str:
        """
        Compute Verifiable Logical Clock (VLC).
        
        Protocol Spec: §1.3 (Verifiable Logical Clock)
        lc(v) = keccak256(h(v) || max(lc(p) for p in parents(v)))
        
        Args:
            message: Message to compute VLC for
            messages: All messages in thread (for parent lookup)
        
        Returns:
            VLC hash as hex string
        """
        # Compute message hash
        canonical = self._canonicalize_message(message)
        message_hash = keccak(text=canonical)
        
        # Find parent VLC
        parent_vlc = bytes(32)  # Zero bytes if no parent
        if message.parent_id:
            for msg in messages:
                if msg.id == message.parent_id and msg.vlc:
                    parent_vlc = bytes.fromhex(msg.vlc[2:])
                    break
        
        # Compute VLC: keccak256(h(v) || max(lc(parent)))
        vlc = keccak(message_hash + parent_vlc)
        
        return "0x" + vlc.hex()
    
    def verify_signatures(self, messages: List[XMTPMessage]) -> bool:
        """
        Verify all message signatures.
        
        Protocol Spec: §1.5 (Causal Audit Algorithm)
        Verify all signatures
        
        Args:
            messages: List of XMTP messages
        
        Returns:
            True if all signatures are valid, False otherwise
        """
        from eth_account.messages import encode_defunct
        from eth_account import Account
        
        for msg in messages:
            if not msg.signature:
                logger.error(f"❌ No signature for message {msg.id}")
                return False
            
            try:
                # Parse message content to get the signed data
                message_data = json.loads(msg.content)
                
                # Remove signature for verification
                message_data_copy = message_data.copy()
                message_data_copy.pop("signature", None)
                
                # Recreate the signed message
                signed_message = json.dumps(message_data_copy, sort_keys=True)
                message_hash = keccak(text=signed_message)
                
                # Recover signer
                recovered_address = Account.recover_message(
                    encode_defunct(message_hash),
                    signature=msg.signature
                )
                
                # Verify signer matches author
                if recovered_address.lower() != msg.author.lower():
                    logger.error(
                        f"❌ Signature mismatch for message {msg.id}: "
                        f"expected {msg.author}, got {recovered_address}"
                    )
                    return False
                    
            except Exception as e:
                logger.error(f"❌ Failed to verify signature for message {msg.id}: {e}")
                return False
        
        logger.info("✅ All signatures verified")
        return True
    
    def get_conversation_addresses(self) -> List[str]:
        """
        Get all conversation addresses.
        
        Returns:
            List of conversation addresses
        """
        try:
            conversations = self.client.conversations.list()
            return [conv.peer_address for conv in conversations]
        except Exception as e:
            logger.error(f"❌ Failed to get conversations: {e}")
            return []
    
    def close(self):
        """Close XMTP client and cleanup."""
        try:
            # Clear caches
            self.conversations.clear()
            self.message_cache.clear()
            logger.info("✅ XMTP client closed")
        except Exception as e:
            logger.error(f"❌ Failed to close XMTP client: {e}")

