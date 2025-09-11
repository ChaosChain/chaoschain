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
        IRYS/IPFS -- "Stores Permanent Data for" --> DKG
    end

    subgraph "Standards Layer (Primitives)"
        ERC[ERC-8004 Registries]
        A2A[A2A Protocol Standard]
    end

    subgraph "Settlement Layer"
        L2[Base]
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

## On-Chain Architecture: A Modular, Factory-Based Approach

```mermaid
graph TD
    subgraph "ERC-8004 Standard Layer (External Singleton Contracts)"
        ERC_ID["ERC8004_IdentityRegistry.sol"]
        ERC_REP["ERC8004_ReputationRegistry.sol"]
        ERC_VAL["ERC8004_ValidationRegistry.sol"]
    end

    subgraph "ChaosChain Core Layer (Our Singleton Contracts)"
        ChaosRegistry["ChaosChainRegistry.sol (Address Book)"]
        ChaosCore["ChaosCore.sol (Studio Factory)"]
        Rewards["RewardsDistributor.sol"]
    end

    subgraph "ChaosChain Application Layer (Our Deployed Instances)"
        StudioA["Studio A (Proxy)"]
        StudioB["Studio B (Proxy)"]
    end

    subgraph "Deployed Logic Modules (Our Singleton Contracts)"
        Logic1["LogicModule.sol"]
    end

    ChaosCore -- "Reads addresses from" --> ChaosRegistry
    Rewards -- "Reads addresses from" --> ChaosRegistry
    ChaosRegistry -- "Stores addresses of" --> ERC_ID & ERC_REP & ERC_VAL

    ChaosCore -- "Deploys" --> StudioA & StudioB
    StudioA -.-> |DELEGATECALLs to| Logic1

    StudioA -- "step 3 Calls validationResponse" --> ERC_VAL
    Rewards -- "step 1 Reads events from" --> ERC_VAL
    Rewards -- "step 2 Instructs" --> StudioA

    style ERC_ID fill:#50fa7b,stroke:#282a36,color:#282a36
    style ERC_REP fill:#50fa7b,stroke:#282a36,color:#282a36
    style ERC_VAL fill:#50fa7b,stroke:#282a36,color:#282a36
    style ChaosRegistry fill:#ffb86c,stroke:#282a36,color:#282a36
    style ChaosCore fill:#6272a4,stroke:#f8f8f2,color:#fff
    style Rewards fill:#6272a4,stroke:#f8f8f2,color:#fff
    style StudioA fill:#8be9fd,stroke:#282a36,color:#282a36

```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Building the future of trustworthy autonomous services.**