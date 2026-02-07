"""
E2E test fixtures for ChaosChain Python SDK.

Requires the Docker Compose E2E stack running:
    docker compose -f docker-compose.e2e.yml up -d --wait
    npx tsx e2e/setup.ts
"""

import json
import os
import hashlib
import time
from pathlib import Path
import pytest

from chaoschain_sdk.gateway_client import GatewayClient


# Gateway exposed on host port 3333
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:3333")

# Read deployed addresses from e2e/addresses.json
_ADDRESSES_FILE = Path(__file__).resolve().parents[4] / "e2e" / "addresses.json"
_ADDRESSES = json.loads(_ADDRESSES_FILE.read_text()) if _ADDRESSES_FILE.exists() else {}
STUDIO_PROXY = _ADDRESSES.get("STUDIO_PROXY", "")

# Anvil accounts registered in studio
WORKERS = [
    {"address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "agent_id": 1},
    {"address": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "agent_id": 2},
    {"address": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "agent_id": 3},
]

VALIDATORS = [
    {"address": "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", "agent_id": 4},
    {"address": "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", "agent_id": 5},
]

# Unregistered account (Anvil account 6)
UNREGISTERED_ADDRESS = "0x976EA74026E726554dB657fA54763abd0C3a0aa9"


def random_bytes32() -> str:
    """Generate a random bytes32 hex string."""
    data = f"e2e-{time.time()}-{os.urandom(8).hex()}"
    return "0x" + hashlib.sha256(data.encode()).hexdigest()


@pytest.fixture(scope="session")
def client() -> GatewayClient:
    """GatewayClient connected to the dockerized gateway."""
    return GatewayClient(
        gateway_url=GATEWAY_URL,
        timeout=30,
        max_poll_time=90,
        poll_interval=2,
    )
