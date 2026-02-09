# E2E Testing

The E2E test suite runs the full ChaosChain stack — real smart contracts on Anvil, real Gateway with PostgreSQL, real SDK calls over HTTP — to verify that the system works end-to-end as a single integrated unit.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         E2E TEST ARCHITECTURE                               │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │                    Docker Compose (services)                          │ │
│   │                                                                       │ │
│   │  ┌────────────┐     ┌────────────┐     ┌──────────────────────────┐   │ │
│   │  │   Anvil    │     │  Postgres  │     │        Gateway           │   │ │
│   │  │   :8545    │     │   :5432    │     │         :3000            │   │ │
│   │  │            │     │            │     │                          │   │ │
│   │  │ Foundry    │     │ pg:16      │     │  Real WorkflowEngine     │   │ │
│   │  │ chain      │     │ alpine     │     │  Real EthersChainAdapter │   │ │
│   │  │ --block 1s │     │            │     │  Mock Arweave            │   │ │
│   │  └──────┬─────┘     └──────┬─────┘     └────────────┬─────────────┘   │ │
│   │         │                  │                        │                 │ │
│   │         │    RPC_URL=http://anvil:8545               │                 │ │
│   │         └────────────────────────────────────────────┘                 │ │
│   │                            │  DATABASE_URL                             │ │
│   │                            └──────────────────────────                 │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│         :8546 (host)                                    :3333 (host)       │
│            │                                               │               │
│   ┌────────┴───────────────────────────────────────────────┴─────────────┐ │
│   │                     Host (test runners)                               │ │
│   │                                                                       │ │
│   │  ┌─────────────────┐     ┌─────────────────────────┐                  │ │
│   │  │  e2e/setup.ts   │     │  Test Suites             │                  │ │
│   │  │                 │     │                           │                  │ │
│   │  │  1. Deploy      │     │  Gateway (vitest, 7)      │                  │ │
│   │  │     contracts   │     │  └ HTTP → Gateway → Chain  │                  │ │
│   │  │  2. Create      │     │                           │                  │ │
│   │  │     studio      │     │  Python SDK (pytest, 9)   │                  │ │
│   │  │  3. Register    │     │  └ SDK → HTTP → Gateway    │                  │ │
│   │  │     agents      │     │       → Chain              │                  │ │
│   │  │  4. Write       │     │                           │                  │ │
│   │  │     addresses   │     └─────────────────────────┘                  │ │
│   │  └─────────────────┘                                                  │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Docker Compose** starts three services: Anvil (local blockchain), PostgreSQL, and the Gateway
2. **`e2e/setup.ts`** runs on the host — deploys all ChaosChain contracts via `forge script`, creates a studio via ethers.js, registers 5 agents (3 workers + 2 verifiers), and writes `e2e/addresses.json`
3. The Gateway container reads `addresses.json` on startup (bind-mounted from host) and begins serving
4. **Test runners** on the host hit the Gateway over HTTP and verify end-to-end behavior

### Request Flow

```
Test (host)  →  HTTP :3333  →  Gateway (Docker)  →  WorkflowEngine  →  EthersChainAdapter  →  Anvil (Docker :8545)
                                     │
                                     ├── MockArweaveAdapter (instant, no network)
                                     └── PostgreSQL (workflow persistence)
```

---

## Running E2E Tests

```bash
# 1. Pre-compile contracts (one-time, avoids slow via-ir compilation in Docker)
cd packages/contracts
forge build --skip test

# 2. Start the Docker stack (Anvil + PostgreSQL + Gateway)
docker compose -f docker-compose.e2e.yml up -d

# 3. Deploy contracts, create studio, register agents
cd packages/gateway
yarn e2e:setup

# 4. Run tests
yarn test:e2e                                      # Gateway: 8 tests (~55s)
cd ../sdk && python3 -m pytest tests/e2e/ -v       # Python SDK: 9 tests (~110s)

# 5. Tear down
cd ../gateway && yarn e2e:down
```

### Fresh Restart

If tests behave unexpectedly (stale workflows, signer lock contention), do a full reset:

```bash
docker compose -f docker-compose.e2e.yml down
rm -f e2e/addresses.json
docker compose -f docker-compose.e2e.yml up -d
cd packages/gateway && yarn e2e:setup
```

---

## What the E2E Tests Cover

The tests exercise the real request flow: **SDK → HTTP → Gateway → Workflow Engine → On-Chain Tx → Anvil**.

Arweave is mocked (`MockArweaveAdapter`) since it's external infrastructure, but everything else is real — real contract calls, real nonce management, real PostgreSQL persistence.

### Gateway E2E (8 tests, vitest)

| Test | Flow | Verifies |
|------|------|----------|
| Health check | `GET /health` | Gateway is up and connected |
| Work submission + on-chain verify | `POST /workflows/work-submission` → poll → `getWorkSubmitter()` | Full golden path → COMPLETED; work + registration on-chain |
| Invalid input rejection | `POST` with missing `data_hash` | Returns 400, validates request schema |
| Score submission + on-chain verify | Work submission first → `POST /workflows/score-submission` → poll → `getScoreVectorsForWorker()` | Full golden path → COMPLETED; score + validator registration on-chain |
| Unsubmitted dataHash (negative) | `getWorkSubmitter(unknownHash)` | Returns zero address for data never submitted |
| Workflow status query | `POST` + `GET /workflows/:id` | Returns correct workflow details |
| Unknown workflow | `GET /workflows/00000000-...` | Returns 404 |
| Unregistered agent | `POST` with non-registered signer | Workflow FAILED/STALLED or rejected with 400 |

### Python SDK E2E (9 tests, pytest)

| Test | Flow | Verifies |
|------|------|----------|
| `is_healthy()` | `GatewayClient.is_healthy()` | SDK health check method |
| `health_check()` | `GatewayClient.health_check()` | Returns status + timestamp |
| Submit work | `client.submit_work(...)` | Returns workflow with CREATED state |
| Submit work + poll | `submit_work` → manual poll loop | Reaches STALLED/COMPLETED, has `arweave_tx_id` |
| Submit score (direct) | `client.submit_score(mode=DIRECT)` | Returns ScoreSubmission workflow |
| Direct mode validation | `submit_score` without `worker_address` | SDK raises `ValueError` client-side |
| Get workflow | `client.get_workflow(id)` | Returns matching workflow details |
| Nonexistent workflow | `client.get_workflow("0000...")` | Raises `GatewayError` |
| Unregistered signer | `submit_work` with unknown address | `GatewayError` or workflow FAILED/STALLED |

---

## What the E2E Tests Do NOT Cover (Yet)

| Gap | Reason | Tracked In |
|-----|--------|------------|
| Full golden path to COMPLETED | `registerWork`/`registerValidator` are `onlyOwner` — workflows STALL at `REGISTER_WORK` step | [#26](https://github.com/ChaosChain/chaoschain/issues/26) |
| Commit-reveal score submission | Only direct mode tested; commit-reveal needs two-phase interaction | Future |
| CloseEpoch workflow | Depends on full golden path (work + scores must complete first) | Future |
| Multi-agent work submission | `submitWorkMultiAgent` with DKG weights not exercised | Future |
| DKG construction | DKG engine is pure-function; tested in unit tests, not E2E | Unit tests |
| Real XMTP | Mocked — XMTP bridge is separate infrastructure | Integration |
| Real Arweave | `MockArweaveAdapter` used (instant, no HTTP) | Integration |
| Credit Studio / Executor | Separate service, own test suite | `test/credit/` |
| Concurrent workflow stress | Single sequential workflows only | Future |
| Gateway restart / reconciliation | No crash-recovery scenarios | Future |

---

## File Structure

```
chaoschain/
├── docker-compose.e2e.yml              # Anvil + PostgreSQL + Gateway services
├── e2e/
│   ├── .env.anvil                      # Anvil deterministic keys (single source)
│   ├── setup.ts                        # Deploy + studio + agents (TypeScript)
│   ├── addresses.json                  # Generated by setup.ts (gitignored)
│   ├── anvil-entrypoint.sh             # Minimal: just starts Anvil
│   └── gateway-entrypoint.sh           # Reads addresses.json, migrates, starts
├── packages/gateway/
│   ├── Dockerfile                      # Multi-stage build for gateway image
│   ├── .dockerignore
│   ├── vitest.e2e.config.ts            # E2E vitest config (120s timeout)
│   └── test/e2e/
│       ├── e2e.test.ts                 # 8 gateway tests via HTTP + on-chain verification
│       └── helpers.ts                  # Addresses, polling, fetch wrappers, on-chain verifier
├── packages/sdk/
│   └── tests/e2e/
│       ├── conftest.py                 # Fixtures: GatewayClient, addresses
│       ├── test_e2e.py                 # 9 SDK tests
│       └── __init__.py
└── packages/contracts/
    └── script/
        └── DeployE2ETestEnv.s.sol      # Foundry deploy script for test environment
```

---

## Setup Script (`e2e/setup.ts`)

The setup script replaces what would otherwise be complex shell scripting. It runs on the host and uses ethers.js to interact with Anvil:

```
setup.ts execution flow:

  Wait for Anvil (poll RPC)
         │
         ▼
  Deploy contracts (forge script DeployE2ETestEnv.s.sol)
  → MockIdentityRegistry, ChaosChainRegistry, RewardsDistributor,
    StudioProxyFactory, ChaosCore, PredictionMarketLogic
         │
         ▼
  Create studio (ChaosCore.createStudio via ethers.js)
  → Deploys StudioProxy
         │
         ▼
  Register 5 agents (IdentityRegistry.register + StudioProxy.registerAgent)
  → Accounts 1-3: WORKER role
  → Accounts 4-5: VERIFIER role
  → Each stakes 1 ETH
         │
         ▼
  Write e2e/addresses.json
  → Gateway reads this on startup
  → Tests read this for STUDIO_PROXY, etc.
         │
         ▼
  Wait for Gateway (poll /health)
```

All private keys are read from `e2e/.env.anvil` (single source of truth). These are Anvil's well-known deterministic test accounts — not secrets.

---

## Admin Signer Architecture

The Gateway uses a **two-signer model** to handle the different ownership requirements of on-chain contracts:

| Step | Who signs | Why |
|------|-----------|-----|
| `submitWork` | Agent (worker) | The worker submits their own work to StudioProxy |
| `submitScoreVectorForWorker` | Agent (validator) | The validator submits their own score to StudioProxy |
| `registerWork` | Admin (owner) | Bookkeeping in RewardsDistributor — `onlyOwner` by contract design |
| `registerValidator` | Admin (owner) | Bookkeeping in RewardsDistributor — `onlyOwner` by contract design |

The admin signer address is configured via `ADMIN_SIGNER_ADDRESS` env var (set from the deployer address in `addresses.json`). The deployer key is already loaded as `SIGNER_PRIVATE_KEY`.

### WorkSubmission (6 steps → COMPLETED)

```
UPLOAD_EVIDENCE         ── arweave_tx_id = "mock-ar-..."            ── PASS
       │
       ▼
AWAIT_ARWEAVE_CONFIRM   ── arweave_confirmed = true                 ── PASS
       │
       ▼
SUBMIT_WORK_ONCHAIN     ── signs with agent (worker) signer         ── PASS
       │
       ▼
AWAIT_TX_CONFIRM        ── onchain_confirmed = true, onchain_block  ── PASS
       │
       ▼
REGISTER_WORK           ── signs with admin (owner) signer          ── PASS
       │
       ▼
AWAIT_REGISTER_CONFIRM  ── register_confirmed = true                ── PASS → COMPLETED
```

### ScoreSubmission — direct mode (4 steps → COMPLETED)

```
SUBMIT_SCORE_DIRECT           ── signs with agent (validator) signer      ── PASS
       │
       ▼
AWAIT_SCORE_CONFIRM           ── score_confirmed = true                   ── PASS
       │
       ▼
REGISTER_VALIDATOR            ── signs with admin (owner) signer          ── PASS
       │
       ▼
AWAIT_REGISTER_VALIDATOR_CONFIRM ── register_validator_confirmed = true   ── PASS → COMPLETED
```

---

## Resolved Issues

- **`registerWork` / `registerValidator` onlyOwner** — Resolved by adding `adminSignerAddress` config. The Gateway now uses the deployer/owner wallet for these specific calls while using the agent wallet for `submitWork`/`submitScoreVectorForWorker`. See [#26](https://github.com/ChaosChain/chaoschain/issues/26).
- **Precondition bug in `RegisterValidatorStep`** — Direct mode sets `score_confirmed` but the step checked `reveal_confirmed` (commit-reveal only). Fixed to accept either flag.

---

## Status Checklist

### E2E Infrastructure

- [x] Docker Compose (Anvil + PostgreSQL + Gateway)
- [x] Setup script TypeScript (`e2e/setup.ts`)
- [x] Deploy contracts (`DeployE2ETestEnv.s.sol`)
- [x] Create studio + register agents
- [x] Keys centralized in `.env.anvil`
- [x] Addresses dynamic via `addresses.json`

### Blockchain Interaction

- [x] Deploy: MockIdentityRegistry, ChaosChainRegistry, RewardsDistributor, StudioProxyFactory, ChaosCore, PredictionMarketLogic
- [x] Studio creation via `ChaosCore.createStudio()`
- [x] Agent registration via `IdentityRegistry.register()` + `StudioProxy.registerAgent()`
- [x] Work submission on-chain via `StudioProxy.submitWork()` — tx confirmed
- [x] Score submission on-chain via `StudioProxy.submitScoreVectorForWorker()` — tx confirmed
- [x] On-chain state verification via `getWorkSubmitter()`
- [x] On-chain state verification via `getScoreVectorsForWorker()`

### Workflow Steps

- [x] Evidence upload (Arweave mock)
- [x] Arweave confirmation
- [x] Work submission tx (`StudioProxy.submitWork`)
- [x] Work tx confirmation (block finality)
- [x] Register work (`RewardsDistributor.registerWork`) — admin signer
- [x] Score submission tx (`StudioProxy.submitScoreVectorForWorker`)
- [x] Score tx confirmation (block finality)
- [x] Register validator (`RewardsDistributor.registerValidator`) — admin signer

### Workflows — Completion Status

- [x] WorkSubmission → COMPLETED
- [x] ScoreSubmission (direct) → COMPLETED
- [ ] ScoreSubmission (commit-reveal) — not tested
- [ ] CloseEpoch — not tested (depends on work + scores completing)

### Gateway Features

- [x] Health check endpoint
- [x] Input validation (400 on missing fields)
- [x] Workflow creation (`POST` → 201)
- [x] Workflow status query (`GET /workflows/:id`)
- [x] 404 for unknown workflow
- [x] Unregistered agent rejection

### SDK Features (Python)

- [x] `GatewayClient.is_healthy()`
- [x] `GatewayClient.health_check()`
- [x] `GatewayClient.submit_work()`
- [x] `GatewayClient.submit_score()` (direct mode)
- [x] `GatewayClient.get_workflow()`
- [x] Error handling (`GatewayError`, `ValueError`)

### Pending — Gateway Source

- [x] `adminSignerAddress` for REGISTER_WORK / REGISTER_VALIDATOR
- [x] Fix precondition bug (`reveal_confirmed` → `score_confirmed` for direct mode)
- [x] Full golden path tests (WorkSubmission + ScoreSubmission → COMPLETED)
- [ ] `progressUpdates` in reconciliation ADVANCE_TO_STEP
- [ ] CloseEpoch workflow tests

### Pending — Future

- [ ] Commit-reveal score submission
- [ ] Multi-agent work submission (`submitWorkMultiAgent`)
- [ ] Real Arweave integration
- [ ] Real XMTP integration
- [ ] Concurrent workflow stress tests
- [ ] Gateway restart / reconciliation tests
- [ ] Credit Studio E2E
