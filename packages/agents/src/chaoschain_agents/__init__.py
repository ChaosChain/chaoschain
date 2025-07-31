"""ChaosChain Agents package."""

from .base.agent import BaseAgent
from .scout.agent import ScoutAgent  
from .auditor.agent import AuditorAgent

__version__ = "0.1.0"
__all__ = ["BaseAgent", "ScoutAgent", "AuditorAgent"] 