"""DKG (Decentralized Knowledge Graph) utilities for ChaosChain."""

import json
import hashlib
from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import datetime, timezone
from dataclasses import dataclass
from loguru import logger

from .evidence import EvidencePackage, CausalLink


@dataclass 
class GraphNode:
    """Represents a node in the DKG."""
    
    node_id: str
    node_type: str  # "evidence", "data", "agent", "conclusion"
    content_hash: str
    timestamp: datetime
    agent_id: Optional[int] = None
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


@dataclass
class GraphEdge:
    """Represents an edge in the DKG."""
    
    from_node: str
    to_node: str
    edge_type: str  # "input", "output", "builds_on", "references", "contradicts"
    weight: float = 1.0
    confidence: float = 1.0
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class DKGUtils:
    """
    Utilities for working with the Decentralized Knowledge Graph.
    
    Provides functionality for:
    - Building DKG subgraphs from evidence packages
    - Analyzing causal relationships
    - Validating graph integrity
    - Computing graph metrics for PoA verification
    """
    
    def __init__(self):
        """Initialize DKG utilities."""
        self.nodes: Dict[str, GraphNode] = {}
        self.edges: List[GraphEdge] = []
        self.agent_contributions: Dict[int, List[str]] = {}
    
    def add_evidence_package(self, evidence: EvidencePackage) -> str:
        """
        Add an evidence package to the DKG and return the node ID.
        
        This creates nodes and edges representing the evidence and its
        relationships to other data sources and evidence packages.
        """
        # Create main evidence node
        evidence_node_id = f"evidence:{evidence.evidence_id}"
        evidence_node = GraphNode(
            node_id=evidence_node_id,
            node_type="evidence",
            content_hash=evidence.content_hash,
            timestamp=evidence.timestamp,
            agent_id=evidence.agent_id,
            metadata={
                "task_type": evidence.task_type,
                "reasoning": evidence.reasoning,
                "signature": evidence.signature
            }
        )
        
        self.nodes[evidence_node_id] = evidence_node
        
        # Track agent contributions
        if evidence.agent_id not in self.agent_contributions:
            self.agent_contributions[evidence.agent_id] = []
        self.agent_contributions[evidence.agent_id].append(evidence_node_id)
        
        # Create input data nodes
        for i, source in enumerate(evidence.sources):
            source_node_id = f"data:{hashlib.sha256(source.encode()).hexdigest()[:16]}"
            if source_node_id not in self.nodes:
                source_node = GraphNode(
                    node_id=source_node_id,
                    node_type="data",
                    content_hash=hashlib.sha256(source.encode()).hexdigest(),
                    timestamp=evidence.timestamp,
                    metadata={"source": source}
                )
                self.nodes[source_node_id] = source_node
            
            # Create edge from source to evidence
            self.edges.append(GraphEdge(
                from_node=source_node_id,
                to_node=evidence_node_id,
                edge_type="input",
                metadata={"source_index": i}
            ))
        
        # Create output data node
        if evidence.output_data:
            output_node_id = f"output:{evidence.evidence_id}"
            output_node = GraphNode(
                node_id=output_node_id,
                node_type="data",
                content_hash=hashlib.sha256(
                    json.dumps(evidence.output_data, sort_keys=True).encode()
                ).hexdigest(),
                timestamp=evidence.timestamp,
                agent_id=evidence.agent_id,
                metadata={"output_data": evidence.output_data}
            )
            self.nodes[output_node_id] = output_node
            
            # Create edge from evidence to output
            self.edges.append(GraphEdge(
                from_node=evidence_node_id,
                to_node=output_node_id,
                edge_type="output"
            ))
        
        # Process causal links
        for link in evidence.causal_links:
            self._add_causal_link(evidence_node_id, link)
        
        logger.debug(f"Added evidence package {evidence.evidence_id} to DKG")
        return evidence_node_id
    
    def _add_causal_link(self, evidence_node_id: str, link: CausalLink) -> None:
        """Add a causal link as an edge in the DKG."""
        # Create or reference target node
        target_node_id = f"{link.source_type}:{link.source_id}"
        
        if target_node_id not in self.nodes:
            # Create placeholder node for external reference
            target_node = GraphNode(
                node_id=target_node_id,
                node_type=link.source_type,
                content_hash=hashlib.sha256(link.source_id.encode()).hexdigest(),
                timestamp=datetime.now(timezone.utc),
                metadata={
                    "source_id": link.source_id,
                    "description": link.description,
                    "external": True
                }
            )
            self.nodes[target_node_id] = target_node
        
        # Create edge based on relationship type
        if link.relationship in ["input", "builds_on", "reference"]:
            # Edge from target to evidence (evidence uses/builds on target)
            edge = GraphEdge(
                from_node=target_node_id,
                to_node=evidence_node_id,
                edge_type=link.relationship,
                confidence=link.confidence,
                metadata={"description": link.description}
            )
        else:
            # Edge from evidence to target (evidence contradicts/challenges target)
            edge = GraphEdge(
                from_node=evidence_node_id,
                to_node=target_node_id,
                edge_type=link.relationship,
                confidence=link.confidence,
                metadata={"description": link.description}
            )
        
        self.edges.append(edge)
    
    def get_causal_chain(self, node_id: str) -> List[str]:
        """Get the causal chain leading to a specific node."""
        chain = []
        visited = set()
        
        def trace_backwards(current_node: str, depth: int = 0) -> None:
            if current_node in visited or depth > 10:  # Prevent infinite loops
                return
            
            visited.add(current_node)
            chain.append(current_node)
            
            # Find all nodes that this node builds upon
            for edge in self.edges:
                if (edge.to_node == current_node and 
                    edge.edge_type in ["input", "builds_on", "reference"]):
                    trace_backwards(edge.from_node, depth + 1)
        
        trace_backwards(node_id)
        return list(reversed(chain))  # Return in chronological order
    
    def get_agent_contribution_graph(self, agent_id: int) -> Dict[str, Any]:
        """Get a subgraph showing all contributions from a specific agent."""
        agent_nodes = self.agent_contributions.get(agent_id, [])
        
        # Get all nodes and edges involving this agent
        subgraph_nodes = {}
        subgraph_edges = []
        
        for node_id in agent_nodes:
            if node_id in self.nodes:
                subgraph_nodes[node_id] = self.nodes[node_id]
                
                # Add connected nodes
                for edge in self.edges:
                    if edge.from_node == node_id or edge.to_node == node_id:
                        subgraph_edges.append(edge)
                        
                        # Add the other node if not already included
                        other_node = edge.to_node if edge.from_node == node_id else edge.from_node
                        if other_node in self.nodes and other_node not in subgraph_nodes:
                            subgraph_nodes[other_node] = self.nodes[other_node]
        
        return {
            "agent_id": agent_id,
            "nodes": {k: v.__dict__ for k, v in subgraph_nodes.items()},
            "edges": [e.__dict__ for e in subgraph_edges],
            "contribution_count": len(agent_nodes),
            "total_connections": len(subgraph_edges)
        }
    
    def compute_agency_metrics(self, agent_id: int) -> Dict[str, float]:
        """
        Compute agency metrics for PoA verification.
        
        Metrics include:
        - Initiative: Evidence created without building on others
        - Collaboration: Evidence that builds on other agents' work  
        - Originality: Evidence with novel insights
        - Impact: Evidence that others build upon
        """
        agent_nodes = self.agent_contributions.get(agent_id, [])
        if not agent_nodes:
            return {
                "initiative": 0.0,
                "collaboration": 0.0, 
                "originality": 0.0,
                "impact": 0.0,
                "overall_score": 0.0
            }
        
        initiative_count = 0
        collaboration_count = 0
        impact_count = 0
        
        for node_id in agent_nodes:
            # Check for initiative (no input edges from other evidence)
            has_evidence_inputs = any(
                edge.to_node == node_id and 
                edge.edge_type in ["builds_on", "reference"] and
                self.nodes[edge.from_node].node_type == "evidence" and
                self.nodes[edge.from_node].agent_id != agent_id
                for edge in self.edges
            )
            
            if not has_evidence_inputs:
                initiative_count += 1
            else:
                collaboration_count += 1
            
            # Check for impact (other agents building on this evidence)
            has_impact = any(
                edge.from_node == node_id and
                edge.edge_type in ["builds_on", "reference"] and
                self.nodes[edge.to_node].node_type == "evidence" and
                self.nodes[edge.to_node].agent_id != agent_id
                for edge in self.edges
            )
            
            if has_impact:
                impact_count += 1
        
        total_contributions = len(agent_nodes)
        
        # Calculate normalized metrics
        initiative = initiative_count / total_contributions
        collaboration = collaboration_count / total_contributions  
        impact = impact_count / total_contributions
        
        # Originality based on unique reasoning patterns (simplified)
        originality = self._compute_originality_score(agent_id)
        
        # Overall score (weighted combination)
        overall_score = (
            0.3 * initiative +
            0.25 * collaboration +
            0.25 * originality +
            0.2 * impact
        )
        
        return {
            "initiative": initiative,
            "collaboration": collaboration,
            "originality": originality, 
            "impact": impact,
            "overall_score": overall_score
        }
    
    def _compute_originality_score(self, agent_id: int) -> float:
        """Compute originality score based on unique reasoning patterns."""
        agent_nodes = self.agent_contributions.get(agent_id, [])
        if not agent_nodes:
            return 0.0
        
        # Get reasoning patterns from this agent
        agent_reasonings = []
        for node_id in agent_nodes:
            node = self.nodes[node_id]
            if "reasoning" in node.metadata:
                agent_reasonings.append(node.metadata["reasoning"])
        
        # Compare with other agents' reasoning patterns
        other_reasonings = []
        for other_agent_id, other_nodes in self.agent_contributions.items():
            if other_agent_id == agent_id:
                continue
            for node_id in other_nodes:
                node = self.nodes[node_id]
                if "reasoning" in node.metadata:
                    other_reasonings.append(node.metadata["reasoning"])
        
        if not agent_reasonings or not other_reasonings:
            return 1.0  # No comparison possible, assume original
        
        # Simple similarity check (in practice, would use NLP)
        unique_patterns = 0
        for reasoning in agent_reasonings:
            is_unique = True
            for other_reasoning in other_reasonings:
                # Simple keyword overlap check
                agent_words = set(reasoning.lower().split())
                other_words = set(other_reasoning.lower().split())
                overlap = len(agent_words.intersection(other_words))
                similarity = overlap / len(agent_words.union(other_words))
                
                if similarity > 0.7:  # High similarity threshold
                    is_unique = False
                    break
            
            if is_unique:
                unique_patterns += 1
        
        return unique_patterns / len(agent_reasonings)
    
    def validate_graph_integrity(self) -> Dict[str, bool]:
        """Validate the integrity of the DKG."""
        checks = {
            "no_orphaned_nodes": True,
            "no_circular_dependencies": True,
            "all_evidence_has_sources": True,
            "temporal_consistency": True,
            "signature_validity": True
        }
        
        # Check for orphaned nodes (nodes with no connections)
        connected_nodes = set()
        for edge in self.edges:
            connected_nodes.add(edge.from_node)
            connected_nodes.add(edge.to_node)
        
        orphaned = set(self.nodes.keys()) - connected_nodes
        if orphaned:
            checks["no_orphaned_nodes"] = False
            logger.warning(f"Found orphaned nodes: {orphaned}")
        
        # Check for circular dependencies (simplified)
        checks["no_circular_dependencies"] = self._check_cycles()
        
        # Check that all evidence nodes have input sources
        for node_id, node in self.nodes.items():
            if node.node_type == "evidence":
                has_inputs = any(
                    edge.to_node == node_id and edge.edge_type == "input"
                    for edge in self.edges
                )
                if not has_inputs:
                    checks["all_evidence_has_sources"] = False
                    break
        
        # Check temporal consistency
        checks["temporal_consistency"] = self._check_temporal_consistency()
        
        return checks
    
    def _check_cycles(self) -> bool:
        """Check for circular dependencies in the graph."""
        # Simplified cycle detection using DFS
        visited = set()
        rec_stack = set()
        
        def has_cycle(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)
            
            # Get neighbors
            neighbors = [edge.to_node for edge in self.edges if edge.from_node == node]
            
            for neighbor in neighbors:
                if neighbor not in visited:
                    if has_cycle(neighbor):
                        return True
                elif neighbor in rec_stack:
                    return True
            
            rec_stack.remove(node)
            return False
        
        for node_id in self.nodes:
            if node_id not in visited:
                if has_cycle(node_id):
                    return False
        
        return True
    
    def _check_temporal_consistency(self) -> bool:
        """Check that temporal relationships are consistent."""
        for edge in self.edges:
            if edge.edge_type in ["builds_on", "reference"]:
                from_node = self.nodes[edge.from_node]
                to_node = self.nodes[edge.to_node]
                
                # Source should be created before or at same time as target
                if from_node.timestamp > to_node.timestamp:
                    logger.warning(
                        f"Temporal inconsistency: {edge.from_node} "
                        f"({from_node.timestamp}) -> {edge.to_node} "
                        f"({to_node.timestamp})"
                    )
                    return False
        
        return True
    
    def export_subgraph(self, node_ids: List[str]) -> Dict[str, Any]:
        """Export a subgraph containing specific nodes and their connections."""
        subgraph_nodes = {}
        subgraph_edges = []
        
        # Add requested nodes
        for node_id in node_ids:
            if node_id in self.nodes:
                subgraph_nodes[node_id] = self.nodes[node_id]
        
        # Add edges between included nodes
        for edge in self.edges:
            if edge.from_node in subgraph_nodes and edge.to_node in subgraph_nodes:
                subgraph_edges.append(edge)
        
        return {
            "nodes": {k: v.__dict__ for k, v in subgraph_nodes.items()},
            "edges": [e.__dict__ for e in subgraph_edges],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "dkg_version": "1.0"
        } 