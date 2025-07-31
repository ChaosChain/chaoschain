# ChaosChain Agents

ChaosChain AI Agents with A2A protocol support and Proof of Agency verification.

## Overview

This package contains the Python implementation of ChaosChain agents:

- **ScoutAgent**: Worker agent that monitors prediction markets and submits evidence
- **AuditorAgent**: Verifier agent that performs Proof of Agency verification
- **BaseAgent**: Core agent framework with A2A and blockchain integration

## Features

- A2A-compliant agent communication
- DKG-compliant evidence package creation
- Polymarket integration for prediction markets
- IPFS storage for evidence packages
- Web3 integration for on-chain interactions
- Stake-weighted consensus participation

## Installation

```bash
poetry install
```

## Usage

```bash
# Run a scout agent
poetry run scout-agent

# Run an auditor agent  
poetry run auditor-agent
```

## Development

```bash
# Run tests
poetry run pytest

# Format code
poetry run black .
poetry run isort .

# Type checking
poetry run mypy .
``` 