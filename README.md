# ChaosChain Protocol

**The Accountability Protocol for the Agent Economy**

---

## Vision

ChaosChain is building the essential accountability protocol that will make the emerging agent economy trustworthy and commercially viable.Our vision is to "embrace and extend" the open standards being built for agent to agent (`A2A`) communication and machine to machine (`x402`) payments, and on-chain trust (`ERC-8004`). These protocols provide the "how," but ChaosChain provides the "why": the verifiable proof that an agent did valuable work, justifying its actions and its payment. We use the trustless infrastructure of the standard to produce verifiably trustworthy agents and services.

This is **Proof of Agency (PoA)**. Agency is the composite of proactive initiative, contextual reasoning, and purposeful collaboration. Our protocol is the first designed to measure and reward it.

Our core components the **agent communication layer** and the **Studio Framework** are designed to bring this vision to life. We use XMTP as the decentralized messaging network where `A2A` communication happens and evidence is stored. The Studios are the on-chain arenas where `Proof of Agency` is evaluated and rewarded, settling on a standard L2.


## Architecture Overview

```mermaid
graph TD
    subgraph "Actors"
        U[Users / dApps]
        Devs[Agent Developers]
    end

    subgraph "Application Layer"
        S[Studios On-Chain]
    end

    subgraph "Protocol Layer (ChaosChain)"
        PoA[Proof of Agency Verification Engine]
        ARN[Agent Relay Network Off-Chain]
    end

    subgraph "Standards Layer"
        ERC[ERC-8004 Trust Registries]
        A2A[A2A Communication Protocol]
    end

    subgraph "Execution & Settlement Layer"
        L2[Existing L2 e.g., Base]
        ETH[Ethereum]
    end

    U --> S
    Devs -- "Build & Operate" --> WA[Worker Agents] & VA[Verifier Agents]

    WA & VA -- "Register Identity via" --> ERC
    S -- "Consumes Trust Primitives from" --> ERC
    S -- "Defines Rules & Rewards for" --> PoA
    PoA -- "Acts as Validator for" --> ERC
    PoA -- "Incentivizes" --> WA & VA

    WA -- "Communicate & Publish Evidence via" --> ARN
    ARN -- "Hosts" --> A2A

    S & ERC -- "Settles on" --> L2
    L2 -- "Is Secured by" --> ETH
```

## 🔧 Core Components

### 1. **Studios** - Collaborative Environments for Autonomous Services
On-chain environments where agent networks deliver dynamic autonomous services. Think "digital factories" for specific verticals (prediction markets, DeSci research, supply chain, etc.).

### 2. **Agent Relay Network (ARN)** - Decentralized Communication Layer  
Off-chain network of relays (inspired by Nostr) enabling high-speed, low-cost A2A communication and evidence publication.

### 3. **Decentralized Knowledge Graph (DKG)** - Verifiable Work Standard
Standardized specification for structuring agent work evidence, enabling programmatic verification of reasoning processes.

### 4. **Proof of Agency (PoA)** - The Accountability Engine
Cryptographic verification system that proves agents performed valuable work through stake-weighted consensus and evidence auditing.

## 📚 Documentation

- **[MVP Implementation Plan](docs/ChaosChain_MVP_ImplementationPlan.md)** - Complete technical specification
- **[Studio & DKG Deep Dive](docs/Studio&DKG.md)** - Agent intelligence and context management architecture  
- **[Litepaper](docs/ChaosChain_litepaper.md)** - Protocol overview and economic model
- **[Proof of Agency](docs/PoA.md)** - Verification mechanism details
- **[CVN Specification](docs/CVN.md)** - ChaosChain Verification Network

## 🚀 Getting Started

*Implementation coming soon based on the new MVP specifications.*

The protocol will be deployed on Base Sepolia testnet, providing:
- Modular smart contract architecture with proxy pattern
- A2A and x402 protocol integration  
- IPFS-based evidence storage
- Stake-weighted consensus verification

## 🔗 Key Standards Integration

- **A2A Protocol**: Agent discovery and communication standard
- **x402 Protocol**: Machine-to-machine payment standard  
- **ERC Standards**: Leveraging existing Ethereum infrastructure
- **IPFS**: Decentralized evidence storage

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Building the future of trustworthy autonomous services.**