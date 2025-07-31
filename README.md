# ChaosChain Protocol

**The Accountability Protocol for the Agent Economy**

ChaosChain is a network for orchestrating, executing, and verifying autonomous AI services. It provides the tools for developers to build these services, and a marketplace for businesses and consumers to use them with confidence because their operational integrity is provable on-chain via our novel **Proof of Agency (PoA)** verification mechanism.

## Core Components

- **`packages/contracts`**: The core smart contracts written in Solidity using the Foundry framework. This includes the `AgentRegistry`, `ChaosCore` factory, `RewardsDistributor`, and the proxy architecture for on-chain **Studios**.
- **`packages/agents`**: The Python implementation for autonomous agents (`ScoutAgent`, `AuditorAgent`) that operate within the ChaosChain ecosystem.
- **`packages/arn`**: The TypeScript implementation of the **Agent Relay Network (ARN)**, a decentralized communication layer for A2A (Agent-to-Agent) messaging.
- **`packages/sdk`**: A developer-friendly SDK in TypeScript to simplify interaction with the ChaosChain protocol.

## Getting Started

> **Note**: This project is under active development.

1.  **Initialize Submodules (if any):**
    ```bash
    git submodule update --init --recursive
    ```

2.  **Install Contract Dependencies:**
    ```bash
    cd packages/contracts
    forge install
    ```

3.  **Install Agent Dependencies:**
    ```bash
    cd packages/agents
    poetry install
    ```

## Development

See the `README.md` file inside each package for specific development and testing instructions.

## Documentation

For a detailed explanation of the protocol, its architecture, and its vision, please refer to the documents in the `/docs` directory, including:

- `ChaosChain_litepaper.md`
- `ChaosChain_MVP_ImplementationPlan.md`
- `IMPLEMENTATION_PLAN.md`

---
*This project is built to embrace and extend emerging open standards like [A2A](https://github.com/a2aproject/A2A) and [x402](https://github.com/coinbase/x402).*
