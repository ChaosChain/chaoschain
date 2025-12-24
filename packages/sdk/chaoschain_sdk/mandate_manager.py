"""
Mandate builder and verifier for ChaosChain SDK.

Thin wrapper around `mandates-core` to create deterministic ERC-8004
mandates, build primitive `core` payloads from the mandate-specs registry,
sign with the agent wallet, and verify signatures.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union

# Mandates (optional - requires mandates-core package)
try:
    from mandates_core import Mandate
    from mandates_core.primitives import DEFAULT_BASE, build_core
    from mandates_core.utils import new_mandate_id
    _HAS_MANDATES_CORE = True
except ImportError:
    _HAS_MANDATES_CORE = False
    Mandate = None
    DEFAULT_BASE = None
    build_core = None
    new_mandate_id = None

from rich import print as rprint

from .wallet_manager import WalletManager


class MandateManager:
    """High-level helper to work with mandates-core from the SDK."""

    def __init__(self, agent_name: str, wallet_manager: WalletManager):
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            
            self.agent_name = agent_name
            self.wallet_manager = wallet_manager
            self._agent_account = self.wallet_manager.create_or_load_wallet(agent_name)
            self._agent_caip10 = self._to_caip10(self._agent_account.address)
            self._chain_id = self.wallet_manager.chain_id

            rprint("[green]📜 mandates-core ready (deterministic mandates)[/green]")
        except Exception as e:
            raise RuntimeError(f"Failed to initialize MandateManager: {e}") from e

    @property
    def agent_caip10(self) -> str:
        """CAIP-10 identifier for the current agent wallet."""
        return self._agent_caip10

    @property
    def chain_id(self) -> int:
        return self._chain_id

    def _to_caip10(self, identifier: str) -> str:
        """
        Convert an address or CAIP-10 string into CAIP-10 for the current chain.
        """
        if identifier.startswith("eip155:"):
            return identifier
        return f"eip155:{self.wallet_manager.chain_id}:{identifier}"

    # ---------- Core helpers ----------

    def build_core(
        self,
        kind: str,
        payload: Dict[str, Any],
        base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build a `core` payload from the mandate-specs registry.

        Args:
            kind: Primitive kind (e.g., "swap@1")
            payload: Primitive-specific payload
            base_url: Optional registry base override
        """
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            return build_core(kind, payload, base_url=base_url or DEFAULT_BASE)
        except Exception as e:
            raise RuntimeError(f"Failed to build core: {e}") from e

    # ---------- Mandate lifecycle ----------

    def create_mandate(
        self,
        *,
        intent: str,
        core: Dict[str, Any],
        deadline: str,
        client: str,
        server: Optional[str] = None,
        version: str = "0.1.0",
        mandate_id: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> Mandate:
        """
        Create a mandate with sensible defaults for the current agent.

        Args:
            intent: Natural-language description of the mandate
            core: Core payload built via `build_core`
            deadline: ISO timestamp deadline for the mandate
            client: Client CAIP-10 or address
            server: Server CAIP-10 or address (defaults to this agent)
            version: Mandate version string
            mandate_id: Optional custom mandate id
            created_at: Optional ISO timestamp (defaults to now)
        """
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            if Mandate is None:
                raise RuntimeError("Mandate class is not available")
            
            client_caip = self._to_caip10(client)
            server_caip = self._to_caip10(server) if server else self.agent_caip10

            created_at = created_at or datetime.now(timezone.utc).isoformat()

            return Mandate(
                mandateId=mandate_id or new_mandate_id(),
                version=version,
                client=client_caip,
                server=server_caip,
                createdAt=created_at,
                deadline=deadline,
                intent=intent,
                core=core,
            )
        except Exception as e:
            raise RuntimeError(f"Failed to create mandate: {e}") from e

    def mandate_from_dict(self, data: Union[Mandate, Dict[str, Any]]) -> Mandate:
        """Ensure we are working with a Mandate instance."""
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            if Mandate is None:
                raise RuntimeError("Mandate class is not available")
            
            if isinstance(data, Mandate):
                return data
            return Mandate(**data)
        except Exception as e:
            raise RuntimeError(f"Failed to create mandate from dict: {e}") from e

    def sign_as_server(
        self,
        mandate: Union[Mandate, Dict[str, Any]],
        private_key: Optional[str] = None,
    ):
        """
        Sign the mandate as server using the agent wallet by default.
        """
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            
            mandate_obj = self.mandate_from_dict(mandate)
            key_to_use = private_key or self._agent_account.key.hex()
            signature = mandate_obj.sign_as_server(key_to_use)

            # If caller passed a dict, mirror signatures back so it is mutated.
            if isinstance(mandate, dict):
                mandate["signatures"] = mandate_obj.signatures

            return signature.to_dict() if hasattr(signature, "to_dict") else signature
        except Exception as e:
            raise RuntimeError(f"Failed to sign mandate as server: {e}") from e

    def sign_as_client(
        self,
        mandate: Union[Mandate, Dict[str, Any]],
        private_key: str,
    ):
        """
        Sign the mandate as client. Caller must provide the client's private key.
        """
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            
            mandate_obj = self.mandate_from_dict(mandate)
            signature = mandate_obj.sign_as_client(private_key)

            # If caller passed a dict, mirror signatures back so it is mutated.
            if isinstance(mandate, dict):
                mandate["signatures"] = mandate_obj.signatures

            return signature.to_dict() if hasattr(signature, "to_dict") else signature
        except Exception as e:
            raise RuntimeError(f"Failed to sign mandate as client: {e}") from e

    def verify(self, mandate: Union[Mandate, Dict[str, Any]]) -> Dict[str, Any]:
        """
        Verify client + server signatures for a mandate.
        """
        try:
            if not _HAS_MANDATES_CORE:
                raise ImportError("mandates-core is not installed. Install with: pip install mandates-core")
            
            mandate_obj = self.mandate_from_dict(mandate)
            server_ok = mandate_obj.verify_server()
            client_ok = mandate_obj.verify_client()

            return {
                "client_ok": client_ok,
                "server_ok": server_ok,
                "all_ok": client_ok and server_ok,
                "mandate_hash": mandate_obj.compute_mandate_hash(),
            }
        except Exception as e:
            raise RuntimeError(f"Failed to verify mandate: {e}") from e


