"""Evidence package creation for DKG compliance."""

import json
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict
from pydantic import BaseModel, Field


@dataclass
class CausalLink:
    """Represents a causal link to other evidence or data sources."""
    
    source_type: str  # "evidence", "ipfs", "url", "contract_event"
    source_id: str    # CID, URL, transaction hash, etc.
    relationship: str # "input", "reference", "builds_on", "contradicts"
    confidence: float = 1.0
    description: str = ""


@dataclass
class TemporalMarker:
    """Temporal ordering marker using Verifiable Logical Clocks (VLC)."""
    
    logical_clock: int
    agent_id: int
    event_hash: str
    timestamp: datetime
    parent_events: List[str] = None  # Parent event hashes
    
    def __post_init__(self):
        if self.parent_events is None:
            self.parent_events = []


class EvidencePackage:
    """
    DKG-compliant evidence package for Proof of Agency verification.
    
    This class structures agent work evidence according to the ChaosChain
    Decentralized Knowledge Graph specification, enabling causal auditing
    and verification by the CVN.
    """
    
    def __init__(
        self,
        agent_id: int,
        task_type: str,
        input_data: Dict[str, Any],
        output_data: Dict[str, Any],
        reasoning: str,
        sources: List[str] = None,
        causal_links: List[CausalLink] = None,
        timestamp: Optional[datetime] = None,
        signature: str = ""
    ):
        """Initialize an evidence package."""
        self.agent_id = agent_id
        self.task_type = task_type
        self.input_data = input_data
        self.output_data = output_data
        self.reasoning = reasoning
        self.sources = sources or []
        self.causal_links = causal_links or []
        self.timestamp = timestamp or datetime.now(timezone.utc)
        self.signature = signature
        
        # Generate unique evidence ID
        self.evidence_id = self._generate_evidence_id()
        
        # Create temporal marker
        self.temporal_marker = self._create_temporal_marker()
        
        # Compute content hash for integrity
        self.content_hash = self._compute_content_hash()
    
    def _generate_evidence_id(self) -> str:
        """Generate unique evidence ID."""
        content = f"{self.agent_id}:{self.task_type}:{self.timestamp.isoformat()}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    def _create_temporal_marker(self) -> TemporalMarker:
        """Create temporal marker for event ordering."""
        # TODO: Implement proper VLC logic with parent events
        event_data = f"{self.agent_id}:{self.evidence_id}:{self.timestamp.isoformat()}"
        event_hash = hashlib.sha256(event_data.encode()).hexdigest()
        
        return TemporalMarker(
            logical_clock=1,  # TODO: Implement proper logical clock
            agent_id=self.agent_id,
            event_hash=event_hash,
            timestamp=self.timestamp,
            parent_events=[]  # TODO: Extract from causal links
        )
    
    def _compute_content_hash(self) -> str:
        """Compute hash of evidence content for integrity verification."""
        content = {
            "agent_id": self.agent_id,
            "task_type": self.task_type,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "reasoning": self.reasoning,
            "sources": self.sources,
            "timestamp": self.timestamp.isoformat()
        }
        content_str = json.dumps(content, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(content_str.encode()).hexdigest()
    
    def add_causal_link(
        self,
        source_type: str,
        source_id: str,
        relationship: str,
        confidence: float = 1.0,
        description: str = ""
    ) -> None:
        """Add a causal link to another piece of evidence or data source."""
        link = CausalLink(
            source_type=source_type,
            source_id=source_id,
            relationship=relationship,
            confidence=confidence,
            description=description
        )
        self.causal_links.append(link)
    
    def add_source(self, source: str) -> None:
        """Add a data source reference."""
        if source not in self.sources:
            self.sources.append(source)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert evidence package to dictionary format."""
        return {
            "@context": {
                "@vocab": "https://chaoschain.io/schema/evidence/",
                "dkg": "https://chaoschain.io/schema/dkg/",
                "a2a": "https://a2aproject.github.io/schema/"
            },
            "@type": "EvidencePackage",
            "evidence_id": self.evidence_id,
            "agent_id": self.agent_id,
            "task_type": self.task_type,
            "timestamp": self.timestamp.isoformat(),
            "content_hash": self.content_hash,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "reasoning": self.reasoning,
            "sources": self.sources,
            "causal_links": [asdict(link) for link in self.causal_links],
            "temporal_marker": asdict(self.temporal_marker),
            "signature": self.signature,
            "dkg_version": "1.0",
            "schema_version": "1.0"
        }
    
    def to_json(self) -> str:
        """Convert evidence package to JSON format."""
        return json.dumps(self.to_dict(), indent=2)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvidencePackage":
        """Create evidence package from dictionary."""
        # Parse causal links
        causal_links = []
        for link_data in data.get("causal_links", []):
            causal_links.append(CausalLink(**link_data))
        
        # Create instance
        instance = cls(
            agent_id=data["agent_id"],
            task_type=data["task_type"],
            input_data=data["input_data"],
            output_data=data["output_data"],
            reasoning=data["reasoning"],
            sources=data.get("sources", []),
            causal_links=causal_links,
            timestamp=datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00")),
            signature=data.get("signature", "")
        )
        
        # Override generated fields with stored values
        instance.evidence_id = data["evidence_id"]
        instance.content_hash = data["content_hash"]
        
        # Parse temporal marker
        tm_data = data.get("temporal_marker", {})
        if tm_data:
            instance.temporal_marker = TemporalMarker(
                logical_clock=tm_data["logical_clock"],
                agent_id=tm_data["agent_id"],
                event_hash=tm_data["event_hash"],
                timestamp=datetime.fromisoformat(tm_data["timestamp"].replace("Z", "+00:00")),
                parent_events=tm_data.get("parent_events", [])
            )
        
        return instance
    
    @classmethod
    def from_json(cls, json_str: str) -> "EvidencePackage":
        """Create evidence package from JSON string."""
        data = json.loads(json_str)
        return cls.from_dict(data)
    
    def verify_integrity(self) -> bool:
        """Verify the integrity of the evidence package."""
        # Recompute content hash and compare
        computed_hash = self._compute_content_hash()
        return computed_hash == self.content_hash
    
    def get_provenance_chain(self) -> List[str]:
        """Get the chain of evidence this package builds upon."""
        chain = []
        for link in self.causal_links:
            if link.relationship in ["input", "builds_on"]:
                chain.append(link.source_id)
        return chain
    
    def get_supporting_evidence(self) -> List[str]:
        """Get evidence that supports this package's conclusions."""
        supporting = []
        for link in self.causal_links:
            if link.relationship == "reference" and link.confidence > 0.7:
                supporting.append(link.source_id)
        return supporting
    
    def validate_dkg_compliance(self) -> Dict[str, bool]:
        """Validate DKG compliance requirements."""
        checks = {
            "has_agent_id": bool(self.agent_id),
            "has_task_type": bool(self.task_type),
            "has_reasoning": bool(self.reasoning),
            "has_timestamp": self.timestamp is not None,
            "has_content_hash": bool(self.content_hash),
            "has_temporal_marker": self.temporal_marker is not None,
            "integrity_verified": self.verify_integrity(),
            "has_signature": bool(self.signature)
        }
        
        checks["is_compliant"] = all(checks.values())
        return checks 