"""
Decentralized Knowledge Graph (DKG) for ChaosChain Protocol.

Implements Protocol Spec v0.1 §1 - Formal DKG & Causal Audit Model:
- §1.1: Graph Structure (DAG with nodes and edges)
- §1.2: Canonicalization (deterministic node hashing)
- §1.3: Verifiable Logical Clock (VLC)
- §1.4: DataHash commitment

The DKG is the core data structure for:
1. Causal audit - tracing cause-effect chains
2. Multi-agent attribution - who contributed what
3. Proof of Agency - measuring initiative, collaboration, reasoning depth

Key Concepts:
- **Node**: An event/message from an agent (XMTP message + artifacts)
- **Edge**: Causal link between nodes (parent → child relationship)
- **Path**: Sequence of nodes from root to terminal action
- **Critical Node**: Node that unlocked downstream value
- **Contribution Weight**: Measure of agent's importance in causal chain

Example:
    ```python
    from chaoschain_sdk.dkg import DKG, DKGNode
    
    # Create DKG from XMTP thread
    dkg = DKG.from_xmtp_thread(xmtp_messages, artifacts)
    
    # Trace causal chain
    chain = dkg.trace_causal_chain(from_node_id, to_node_id)
    
    # Find critical nodes (nodes that enabled downstream work)
    critical = dkg.find_critical_nodes()
    
    # Compute contribution weights (for multi-agent attribution)
    weights = dkg.compute_contribution_weights()
    # {agent_id: weight} where weights sum to 1.0
    ```
"""

from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field
from datetime import datetime
from eth_utils import keccak
import json
from collections import defaultdict, deque


@dataclass
class DKGNode:
    """
    A node in the Decentralized Knowledge Graph (§1.1).
    
    Represents a single event/message from an agent, including:
    - Agent identity
    - Timestamp and message ID
    - Artifacts (IPFS/Arweave references)
    - Causal links to parent nodes
    """
    # Core metadata (§1.1)
    author: str  # Agent address or ID
    sig: bytes  # Signature of canonical representation
    ts: int  # Unix timestamp
    xmtp_msg_id: str  # XMTP message ID
    artifact_ids: List[str]  # Arweave/IPFS artifact references (CIDs or tx IDs)
    payload_hash: bytes  # Hash of message content
    parents: List[str]  # Parent node IDs (for causal links)
    
    # Additional metadata
    content: str = ""  # Message content (for analysis)
    node_type: str = "message"  # message, artifact, result, etc.
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Computed fields (§1.3)
    vlc: Optional[bytes] = None  # Verifiable Logical Clock
    canonical_hash: Optional[bytes] = None  # Hash of canonical representation
    
    def compute_canonical_hash(self) -> bytes:
        """
        Compute canonical hash for this node (§1.2).
        
        Canon(v) = keccak256(author || ts || xmtp_msg_id || payload_hash || parents[])
        
        Returns:
            32-byte hash
        """
        # Sort parents for determinism
        sorted_parents = sorted(self.parents)
        
        # Canonical representation
        canonical = (
            f"{self.author}|"
            f"{self.ts}|"
            f"{self.xmtp_msg_id}|"
            f"{self.payload_hash.hex() if isinstance(self.payload_hash, bytes) else self.payload_hash}|"
            f"{'|'.join(sorted_parents)}"
        )
        
        return keccak(text=canonical)
    
    def compute_vlc(self, parent_vlcs: Dict[str, bytes]) -> bytes:
        """
        Compute Verifiable Logical Clock (§1.3).
        
        VLC(v) = keccak256(h(v) || max_{p ∈ parents(v)} VLC(p))
        
        Args:
            parent_vlcs: {parent_id: vlc_hash}
        
        Returns:
            VLC hash (32 bytes)
        """
        # Get canonical hash
        if self.canonical_hash is None:
            self.canonical_hash = self.compute_canonical_hash()
        
        # Find max parent VLC
        max_parent_vlc = bytes(32)  # Zero for root nodes
        if self.parents:
            parent_vlc_values = [parent_vlcs.get(p, bytes(32)) for p in self.parents]
            # Use lexicographically largest VLC
            max_parent_vlc = max(parent_vlc_values)
        
        # Compute VLC: keccak256(canonical_hash || max_parent_vlc)
        vlc = keccak(self.canonical_hash + max_parent_vlc)
        
        return vlc


class DKG:
    """
    Decentralized Knowledge Graph - DAG of agent interactions.
    
    The DKG captures the complete causal history of a task:
    - Who did what (nodes with author metadata)
    - When they did it (timestamps)
    - What they built on (parent links)
    - What artifacts they created (IPFS/Arweave refs)
    
    This enables:
    1. Causal audit - verify causality constraints
    2. Attribution - compute fair contribution weights
    3. Scoring - measure initiative, collaboration, reasoning depth
    """
    
    def __init__(self):
        """Initialize empty DKG."""
        self.nodes: Dict[str, DKGNode] = {}  # {node_id: node}
        self.edges: Dict[str, List[str]] = defaultdict(list)  # {parent_id: [child_ids]}
        self.roots: Set[str] = set()  # Root nodes (no parents)
        self.terminals: Set[str] = set()  # Terminal nodes (no children)
        self.agents: Set[str] = set()  # All agent IDs
    
    def add_node(self, node: DKGNode) -> str:
        """
        Add a node to the DKG.
        
        Args:
            node: DKGNode to add
        
        Returns:
            Node ID (xmtp_msg_id)
        """
        node_id = node.xmtp_msg_id
        
        # Store node
        self.nodes[node_id] = node
        self.agents.add(node.author)
        
        # Update edges
        if not node.parents:
            self.roots.add(node_id)
        else:
            for parent_id in node.parents:
                self.edges[parent_id].append(node_id)
                # Remove parent from terminals if it was there
                if parent_id in self.terminals:
                    self.terminals.remove(parent_id)
        
        # Add to terminals (will be removed if children added later)
        self.terminals.add(node_id)
        
        return node_id
    
    @classmethod
    def from_xmtp_thread(
        cls,
        xmtp_messages: List[Any],
        artifacts: Optional[Dict[str, List[str]]] = None
    ) -> 'DKG':
        """
        Create DKG from XMTP thread.
        
        Args:
            xmtp_messages: List of XMTPMessage objects
            artifacts: Optional {message_id: [artifact_cids]}
        
        Returns:
            DKG instance
        """
        dkg = cls()
        artifacts = artifacts or {}
        
        for msg in xmtp_messages:
            # Get artifacts for this message
            msg_artifacts = artifacts.get(msg.id, [])
            
            # Compute payload hash
            payload_hash = keccak(text=msg.content)
            
            # Create node
            node = DKGNode(
                author=msg.author,
                sig=bytes.fromhex(msg.signature[2:]) if msg.signature and msg.signature.startswith('0x') else bytes(65),
                ts=msg.timestamp,
                xmtp_msg_id=msg.id,
                artifact_ids=msg_artifacts,
                payload_hash=payload_hash,
                parents=[msg.parent_id] if msg.parent_id else [],
                content=msg.content
            )
            
            # Compute canonical hash and VLC
            node.canonical_hash = node.compute_canonical_hash()
            
            dkg.add_node(node)
        
        # Compute VLCs for all nodes (topological order)
        dkg._compute_all_vlcs()
        
        return dkg
    
    def _compute_all_vlcs(self):
        """Compute VLCs for all nodes in topological order."""
        # Topologically sort nodes
        sorted_nodes = self._topological_sort()
        
        # Compute VLC for each node
        vlc_map = {}
        for node_id in sorted_nodes:
            node = self.nodes[node_id]
            node.vlc = node.compute_vlc(vlc_map)
            vlc_map[node_id] = node.vlc
    
    def _topological_sort(self) -> List[str]:
        """
        Topologically sort nodes (parents before children).
        
        Returns:
            List of node IDs in topological order
        """
        # Kahn's algorithm
        in_degree = {node_id: len(node.parents) for node_id, node in self.nodes.items()}
        queue = deque([node_id for node_id in self.roots])
        sorted_nodes = []
        
        while queue:
            node_id = queue.popleft()
            sorted_nodes.append(node_id)
            
            # Process children
            for child_id in self.edges.get(node_id, []):
                in_degree[child_id] -= 1
                if in_degree[child_id] == 0:
                    queue.append(child_id)
        
        return sorted_nodes
    
    def trace_causal_chain(self, from_node_id: str, to_node_id: str) -> List[DKGNode]:
        """
        Trace causal chain from one node to another.
        
        Finds the shortest path from from_node to to_node, showing
        the causal dependencies (A enabled B enabled C).
        
        Args:
            from_node_id: Starting node ID
            to_node_id: Target node ID
        
        Returns:
            List of nodes in the causal chain (shortest path)
        """
        # BFS to find shortest path
        queue = deque([(from_node_id, [from_node_id])])
        visited = {from_node_id}
        
        while queue:
            node_id, path = queue.popleft()
            
            if node_id == to_node_id:
                # Found path!
                return [self.nodes[nid] for nid in path]
            
            # Explore children
            for child_id in self.edges.get(node_id, []):
                if child_id not in visited:
                    visited.add(child_id)
                    queue.append((child_id, path + [child_id]))
        
        # No path found
        return []
    
    def find_critical_nodes(self, terminal_nodes: Optional[List[str]] = None) -> List[DKGNode]:
        """
        Find critical nodes - nodes that are on paths to valuable terminal nodes.
        
        A node is "critical" if removing it would disconnect roots from terminals.
        These nodes represent key contributions that enabled downstream work.
        
        Args:
            terminal_nodes: Optional list of terminal node IDs to consider.
                           If None, uses all terminal nodes.
        
        Returns:
            List of critical DKGNodes
        """
        if terminal_nodes is None:
            terminal_nodes = list(self.terminals)
        
        critical = set()
        
        # For each terminal, find all nodes on paths from roots
        for terminal_id in terminal_nodes:
            # BFS backwards from terminal to roots
            nodes_on_path = self._find_all_ancestors(terminal_id)
            critical.update(nodes_on_path)
        
        return [self.nodes[nid] for nid in critical]
    
    def _find_all_ancestors(self, node_id: str) -> Set[str]:
        """Find all ancestor nodes (nodes that lead to this node)."""
        ancestors = set()
        queue = deque([node_id])
        
        while queue:
            current_id = queue.popleft()
            ancestors.add(current_id)
            
            # Add parents
            node = self.nodes.get(current_id)
            if node:
                for parent_id in node.parents:
                    if parent_id not in ancestors:
                        queue.append(parent_id)
        
        return ancestors
    
    def compute_contribution_weights(self, method: str = "betweenness") -> Dict[str, float]:
        """
        Compute contribution weights for each agent.
        
        This is for multi-agent attribution (§4.2). Measures how important
        each agent's work was in the overall task completion.
        
        Methods:
        - "betweenness": Based on graph betweenness centrality
        - "path_count": Based on number of paths through agent's nodes
        - "shapley": Approximate Shapley value (more expensive)
        
        Args:
            method: Attribution method
        
        Returns:
            {agent_id: weight} where weights sum to ~1.0
        """
        if method == "betweenness":
            return self._compute_betweenness_weights()
        elif method == "path_count":
            return self._compute_path_count_weights()
        else:
            return self._compute_betweenness_weights()  # Default
    
    def _compute_betweenness_weights(self) -> Dict[str, float]:
        """
        Compute contribution weights based on betweenness centrality.
        
        Betweenness = fraction of shortest paths that pass through agent's nodes.
        High betweenness = agent's work was critical for connecting other work.
        """
        # Compute betweenness for each node
        betweenness = defaultdict(float)
        
        # For each pair of (root, terminal), compute shortest paths
        for root_id in self.roots:
            for terminal_id in self.terminals:
                if root_id == terminal_id:
                    continue
                
                # Find all shortest paths
                paths = self._find_all_shortest_paths(root_id, terminal_id)
                
                if not paths:
                    continue
                
                # Each node on a path gets credit
                num_paths = len(paths)
                for path in paths:
                    for node_id in path[1:-1]:  # Exclude root and terminal
                        betweenness[node_id] += 1.0 / num_paths
        
        # Aggregate by agent
        agent_weights = defaultdict(float)
        for node_id, score in betweenness.items():
            agent_id = self.nodes[node_id].author
            agent_weights[agent_id] += score
        
        # Normalize
        total = sum(agent_weights.values())
        if total > 0:
            agent_weights = {agent: weight / total for agent, weight in agent_weights.items()}
        
        return dict(agent_weights)
    
    def _compute_path_count_weights(self) -> Dict[str, float]:
        """
        Compute contribution weights based on path counts.
        
        For each agent, count how many paths from roots to terminals
        include at least one of that agent's nodes.
        """
        agent_path_counts = defaultdict(int)
        total_paths = 0
        
        # Count paths through each agent's nodes
        for root_id in self.roots:
            for terminal_id in self.terminals:
                if root_id == terminal_id:
                    continue
                
                paths = self._find_all_paths(root_id, terminal_id, max_paths=100)
                total_paths += len(paths)
                
                # For each path, credit agents whose nodes appear
                for path in paths:
                    agents_in_path = set()
                    for node_id in path:
                        agent_id = self.nodes[node_id].author
                        agents_in_path.add(agent_id)
                    
                    for agent_id in agents_in_path:
                        agent_path_counts[agent_id] += 1
        
        # Normalize to sum to 1.0
        agent_weights = {}
        total_count = sum(agent_path_counts.values())
        if total_count > 0:
            for agent_id, count in agent_path_counts.items():
                agent_weights[agent_id] = count / total_count
        
        return agent_weights
    
    def _find_all_shortest_paths(self, from_node_id: str, to_node_id: str) -> List[List[str]]:
        """Find all shortest paths between two nodes."""
        # BFS to find shortest path length
        queue = deque([(from_node_id, [from_node_id], 0)])
        visited = {from_node_id: 0}
        all_paths = []
        min_length = float('inf')
        
        while queue:
            node_id, path, length = queue.popleft()
            
            if node_id == to_node_id:
                if length < min_length:
                    min_length = length
                    all_paths = [path]
                elif length == min_length:
                    all_paths.append(path)
                continue
            
            if length >= min_length:
                continue
            
            # Explore children
            for child_id in self.edges.get(node_id, []):
                child_length = length + 1
                if child_id not in visited or visited[child_id] >= child_length:
                    visited[child_id] = child_length
                    queue.append((child_id, path + [child_id], child_length))
        
        return all_paths
    
    def _find_all_paths(
        self,
        from_node_id: str,
        to_node_id: str,
        max_paths: int = 100
    ) -> List[List[str]]:
        """Find all paths (up to max_paths) between two nodes."""
        all_paths = []
        
        def dfs(node_id, path, visited):
            if len(all_paths) >= max_paths:
                return
            
            if node_id == to_node_id:
                all_paths.append(path[:])
                return
            
            for child_id in self.edges.get(node_id, []):
                if child_id not in visited:
                    visited.add(child_id)
                    path.append(child_id)
                    dfs(child_id, path, visited)
                    path.pop()
                    visited.remove(child_id)
        
        dfs(from_node_id, [from_node_id], {from_node_id})
        return all_paths
    
    def get_agent_nodes(self, agent_id: str) -> List[DKGNode]:
        """Get all nodes authored by an agent."""
        return [node for node in self.nodes.values() if node.author == agent_id]
    
    def compute_thread_root(self) -> bytes:
        """
        Compute thread root (Merkle root over topologically sorted nodes) (§1.2).
        
        Returns:
            32-byte Merkle root
        """
        # Get nodes in topological order
        sorted_node_ids = self._topological_sort()
        
        # Get canonical hashes
        hashes = []
        for node_id in sorted_node_ids:
            node = self.nodes[node_id]
            if node.canonical_hash is None:
                node.canonical_hash = node.compute_canonical_hash()
            hashes.append(node.canonical_hash)
        
        # Compute Merkle root
        return self._compute_merkle_root(hashes)
    
    def _compute_merkle_root(self, hashes: List[bytes]) -> bytes:
        """Compute Merkle root from list of hashes."""
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
                    combined = current_level[i] + current_level[i]
                next_level.append(keccak(combined))
            current_level = next_level
        
        return current_level[0]
    
    def verify_causality(self) -> Tuple[bool, List[str]]:
        """
        Verify causality constraints (§1.5).
        
        Checks:
        1. All parent nodes exist
        2. No cycles in the DAG
        3. Timestamps are monotonic (child > parent)
        
        Returns:
            (is_valid, errors)
        """
        errors = []
        
        # Check all parent nodes exist
        for node_id, node in self.nodes.items():
            for parent_id in node.parents:
                if parent_id not in self.nodes:
                    errors.append(f"Node {node_id} references non-existent parent {parent_id}")
        
        # Check for cycles (DAG property)
        if not self._is_acyclic():
            errors.append("Graph contains cycles (not a DAG)")
        
        # Check timestamp monotonicity
        for node_id, node in self.nodes.items():
            for parent_id in node.parents:
                parent = self.nodes.get(parent_id)
                if parent and node.ts <= parent.ts:
                    errors.append(f"Timestamp not monotonic: {node_id} ({node.ts}) <= {parent_id} ({parent.ts})")
        
        return len(errors) == 0, errors
    
    def _is_acyclic(self) -> bool:
        """Check if graph is acyclic (DAG property)."""
        # Use DFS with three colors: white (unvisited), gray (in progress), black (done)
        WHITE, GRAY, BLACK = 0, 1, 2
        colors = {node_id: WHITE for node_id in self.nodes}
        
        def has_cycle(node_id):
            colors[node_id] = GRAY
            for child_id in self.edges.get(node_id, []):
                if colors[child_id] == GRAY:
                    return True  # Back edge = cycle
                if colors[child_id] == WHITE and has_cycle(child_id):
                    return True
            colors[node_id] = BLACK
            return False
        
        for node_id in self.nodes:
            if colors[node_id] == WHITE:
                if has_cycle(node_id):
                    return False
        
        return True
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize DKG to dictionary."""
        return {
            "nodes": {
                node_id: {
                    "author": node.author,
                    "ts": node.ts,
                    "xmtp_msg_id": node.xmtp_msg_id,
                    "artifact_ids": node.artifact_ids,
                    "payload_hash": node.payload_hash.hex() if isinstance(node.payload_hash, bytes) else node.payload_hash,
                    "parents": node.parents,
                    "content": node.content,
                    "node_type": node.node_type
                }
                for node_id, node in self.nodes.items()
            },
            "roots": list(self.roots),
            "terminals": list(self.terminals),
            "agents": list(self.agents)
        }

