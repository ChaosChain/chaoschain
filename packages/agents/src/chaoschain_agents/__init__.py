"""ChaosChain Agents package."""

from .base.agent import BaseAgent, AgentConfig
from .base.context import StudioContext
from .scout.agent import ScoutAgent
# from .auditor.agent import AuditorAgent  # TODO: Implement AuditorAgent

__version__ = "0.1.0"
__all__ = ["BaseAgent", "AgentConfig", "StudioContext", "ScoutAgent"] 