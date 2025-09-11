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

    subgraph "Application Layer (On-Chain on Base L2)"
        S["Studios (Proxies)"]
    end

    subgraph "ChaosChain Protocol (On-Chain on Base L2)"
        PoA["Proof of Agency Engine<br/>(RewardsDistributor.sol)"]
    end

    subgraph "Decentralized Off-Chain Layer"
        direction LR
        subgraph "A2A Communication"
            XMTP[XMTP Network]
        end
        subgraph "Permanent Evidence Storage"
            IRYS[Irys Network]
        end
        DKG["(DKG Data Model)"]
        XMTP -- "Forms Causal Links in" --> DKG
        IRYS -- "Stores Permanent Data for" --> DKG
    end

    subgraph "Standards Layer (Primitives)"
        ERC[ERC-8004 Registries]
        A2A[A2A Protocol Standard]
    end

    subgraph "Settlement Layer"
        L2[Base L2]
        ETH[Ethereum]
    end

    %% ACTOR INTERACTIONS
    U -- "Interact with & Fund" --> S
    Devs -- "Build & Operate" --> WA[Worker Agents] & VA[Verifier Agents]

    %% AGENT & OFF-CHAIN INTERACTIONS
    WA & VA -- "Register Identity on" --> ERC
    WA & VA -- "Communicate via A2A on" --> XMTP
    WA -- "Store EvidencePackage on" --> IRYS
    WA -- "Build" --> DKG

    %% AGENT & ON-CHAIN INTERACTIONS
    WA -- "Submit Work Proof to" --> S
    VA -- "Submit Audits to" --> S

    %% ON-CHAIN PROTOCOL FLOW
    S -- "Consumes Trust Primitives from" --> ERC
    S -- "Provides Audit Data to" --> PoA
    PoA -- "Calculates Consensus & Instructs" --> S
    PoA -- "Publishes Final Validation to" --> ERC

    %% TECHNOLOGY DEPENDENCIES
    XMTP -- "Implements" --> A2A

    %% SETTLEMENT HIERARCHY
    S & PoA & ERC -- "Deployed on" --> L2
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