"""
Evidence Package implementation for ChaosChain agents.

This module defines the EvidencePackage structure for DKG compliance and 
Proof of Agency verification. This is the critical bridge between the agent's
private reasoning (Inner Loop) and public accountability (Outer Loop).
"""

from datetime import datetime
from typing import Dict, List, Any, Optional
from uuid import uuid4
import hashlib
import json
from pydantic import BaseModel, Field, validator
from enum import Enum
from dataclasses import dataclass


class TaskType(str, Enum):
    """Types of tasks that can generate evidence."""
    PREDICTION = "prediction"
    ANALYSIS = "analysis"
    VERIFICATION = "verification"
    COLLABORATION = "collaboration"


class EvidencePackage(BaseModel):
    """
    DKG-compliant evidence package for Proof of Agency verification.
    
    This is the standardized structure that transforms raw LLM outputs into
    verifiable, auditable evidence that underpins our entire PoA protocol.
    Every piece of agent work must be packaged in this format.
    """
    
    # Core Identity
    id: str = Field(default_factory=lambda: f"evidence_{uuid4().hex[:16]}")
    agent_id: str = Field(..., description="Unique identifier of the agent that created this evidence")
    studio_id: str = Field(..., description="Studio context where this evidence was created")
    task_type: TaskType = Field(default=TaskType.PREDICTION, description="Type of task this evidence represents")
    
    # Prediction Data (Core Output)
    prediction: Dict[str, Any] = Field(
        ..., 
        description="The agent's prediction/decision with confidence",
        example={"outcome": "YES", "confidence": 0.85, "reasoning_summary": "Market undervalues key factors"}
    )
    
    # LLM Reasoning Process
    justification: str = Field(
        ..., 
        description="The LLM's detailed narrative reasoning and analysis",
        min_length=50
    )
    
    # Data Provenance
    source_data_cids: List[str] = Field(
        default_factory=list,
        description="IPFS CIDs of source data used in analysis"
    )
    
    # Inference Context (Critical for Verification)
    inference_context: Dict[str, Any] = Field(
        ...,
        description="Complete context used for LLM inference including prompts",
        example={
            "role_prompt": "Studio mission briefing...",
            "character_prompt": "Agent personality...", 
            "system_prompt_hash": "sha256:...",
            "model_used": "gpt-4o-mini",
            "temperature": 0.7,
            "max_tokens": 2000
        }
    )
    
    # Temporal and Causal Information
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    sequence_number: int = Field(default=1, description="Sequence in agent's evidence chain")
    causal_predecessors: List[str] = Field(
        default_factory=list,
        description="IDs of evidence packages this builds upon"
    )
    
    # Metadata
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context and configuration data"
    )
    
    # Content Integrity
    content_hash: Optional[str] = Field(None, description="SHA-256 hash for integrity verification")
    dkg_version: str = Field(default="1.0", description="DKG specification version")
    
    class Config:
        """Pydantic configuration."""
        validate_assignment = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
    
    def __init__(self, **data):
        super().__init__(**data)
        # Compute content hash after initialization
        if not self.content_hash:
            self.content_hash = self._compute_content_hash()
    
    @validator('prediction')
    def validate_prediction_structure(cls, v):
        """Ensure prediction has required fields."""
        if not isinstance(v, dict):
            raise ValueError("Prediction must be a dictionary")
        
        required_fields = ['outcome', 'confidence']
        for field in required_fields:
            if field not in v:
                raise ValueError(f"Prediction must include '{field}' field")
        
        # Validate confidence is between 0 and 1
        confidence = v['confidence']
        if not isinstance(confidence, (int, float)) or not 0.0 <= confidence <= 1.0:
            raise ValueError("Confidence must be a number between 0.0 and 1.0")
        
        return v
    
    @validator('inference_context')
    def validate_inference_context(cls, v):
        """Ensure inference context has required LLM information."""
        required_fields = ['role_prompt', 'character_prompt', 'model_used']
        for field in required_fields:
            if field not in v:
                raise ValueError(f"Inference context must include '{field}' field")
        return v
    
    def _compute_content_hash(self) -> str:
        """Compute SHA-256 hash of core content for integrity verification."""
        # Hash the core content that shouldn't change
        core_content = {
            "prediction": self.prediction,
            "justification": self.justification,
            "inference_context": self.inference_context,
            "timestamp": self.timestamp.isoformat(),
            "agent_id": self.agent_id,
            "studio_id": self.studio_id
        }
        
        content_str = json.dumps(core_content, sort_keys=True)
        return hashlib.sha256(content_str.encode()).hexdigest()
    
    def add_source_data(self, ipfs_cid: str) -> None:
        """Add an IPFS CID reference to source data."""
        if ipfs_cid not in self.source_data_cids:
            self.source_data_cids.append(ipfs_cid)
    
    def add_causal_predecessor(self, evidence_id: str) -> None:
        """Add a reference to evidence this package builds upon."""
        if evidence_id not in self.causal_predecessors:
            self.causal_predecessors.append(evidence_id)
    
    def get_vector_clock(self) -> str:
        """Get vector clock string for temporal ordering."""
        return f"{self.agent_id}:{self.sequence_number}@{self.timestamp.isoformat()}"
    
    def verify_integrity(self) -> bool:
        """Verify the content hasn't been tampered with."""
        if not self.content_hash:
            return False
        
        computed_hash = self._compute_content_hash()
        return computed_hash == self.content_hash
    
    def get_provenance_summary(self) -> Dict[str, Any]:
        """Get a summary of data provenance for auditing."""
        return {
            "evidence_id": self.id,
            "agent_id": self.agent_id,
            "studio_id": self.studio_id,
            "timestamp": self.timestamp,
            "source_data_count": len(self.source_data_cids),
            "causal_predecessors_count": len(self.causal_predecessors),
            "model_used": self.inference_context.get("model_used"),
            "confidence": self.prediction.get("confidence"),
            "integrity_verified": self.verify_integrity()
        }
    
    def validate_dkg_compliance(self) -> Dict[str, bool]:
        """Validate full compliance with DKG specification."""
        validations = {
            "has_unique_id": bool(self.id),
            "has_agent_id": bool(self.agent_id),
            "has_studio_id": bool(self.studio_id),
            "has_prediction": bool(self.prediction),
            "has_justification": len(self.justification) >= 50,
            "has_inference_context": bool(self.inference_context),
            "has_timestamp": bool(self.timestamp),
            "has_content_hash": bool(self.content_hash),
            "prediction_valid": self._validate_prediction_format(),
            "inference_context_valid": self._validate_inference_context_format(),
            "integrity_verified": self.verify_integrity()
        }
        
        validations["dkg_compliant"] = all(validations.values())
        return validations
    
    def _validate_prediction_format(self) -> bool:
        """Internal validation of prediction format."""
        try:
            required_fields = ['outcome', 'confidence']
            return all(field in self.prediction for field in required_fields)
        except:
            return False
    
    def _validate_inference_context_format(self) -> bool:
        """Internal validation of inference context format."""
        try:
            required_fields = ['role_prompt', 'character_prompt', 'model_used']
            return all(field in self.inference_context for field in required_fields)
        except:
            return False
    
    def to_submission_payload(self) -> Dict[str, Any]:
        """Convert to payload suitable for ARN submission."""
        return {
            "evidence_package": self.dict(),
            "submission_metadata": {
                "vector_clock": self.get_vector_clock(),
                "content_hash": self.content_hash,
                "dkg_version": self.dkg_version,
                "submission_timestamp": datetime.utcnow().isoformat()
            }
        }
    
    def to_json(self) -> str:
        """Convert to JSON string for storage/transmission."""
        import json
        return json.dumps(self.dict(), indent=2, default=str)
    
    @classmethod
    def create_prediction_evidence(
        cls,
        agent_id: str,
        studio_id: str,
        prediction_outcome: str,
        confidence: float,
        justification: str,
        role_prompt: str,
        character_prompt: str,
        model_used: str,
        **kwargs
    ) -> "EvidencePackage":
        """
        Factory method to create prediction evidence packages.
        
        This is the primary method ScoutAgent will use to convert LLM outputs
        into structured evidence.
        """
        prediction = {
            "outcome": prediction_outcome,
            "confidence": confidence,
            "reasoning_summary": justification[:100] + "..." if len(justification) > 100 else justification
        }
        
        inference_context = {
            "role_prompt": role_prompt,
            "character_prompt": character_prompt,
            "system_prompt_hash": hashlib.sha256((role_prompt + character_prompt).encode()).hexdigest()[:16],
            "model_used": model_used,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2000)
        }
        
        return cls(
            agent_id=agent_id,
            studio_id=studio_id,
            task_type=TaskType.PREDICTION,
            prediction=prediction,
            justification=justification,
            inference_context=inference_context,
            **{k: v for k, v in kwargs.items() if k not in ['temperature', 'max_tokens']}
        )


# Legacy support for existing code
@dataclass  
class CausalLink:
    """Legacy causal link class for backward compatibility."""
    source_type: str
    source_id: str
    relationship: str
    confidence: float = 1.0
    description: str = ""


@dataclass
class TemporalMarker:
    """Legacy temporal marker class for backward compatibility."""
    logical_clock: int
    agent_id: int
    event_hash: str
    timestamp: datetime
    parent_events: List[str] = None
    
    def __post_init__(self):
        if self.parent_events is None:
            self.parent_events = [] 