# Gateway E2E Tests

End-to-end tests that run the full ChaosChain stack (Anvil + PostgreSQL + Gateway) via Docker Compose and execute real workflow submissions against deployed smart contracts.

## Prerequisites

- Docker and Docker Compose
- Foundry (`forge`, `cast`, `anvil`) — for contract compilation and close-epoch standalone test
- Yarn

## Quick Start

```bash
cd packages/gateway

# Start the E2E environment (Anvil + PostgreSQL + Gateway)
yarn e2e:up

# Deploy contracts, create studio, register agents
yarn e2e:setup

# Run all E2E tests (37 tests)
yarn test:e2e

# Tear down
yarn e2e:down
```

## Test Suites

| File | Tests | Description |
|------|-------|-------------|
| `e2e.test.ts` | 11 | Workflow golden paths: work submission (single + multi-agent), score submission (direct + commit-reveal), negative cases |
| `public-api.test.ts` | 15 | All public read endpoints: work, evidence, studio/work, agent/reputation, agent/history, health |
| `admin-api.test.ts` | 11 | Admin key management: create, list, revoke, validation, seed-demo |
| `close-epoch.test.ts` | 1 (skipped) | Full reputation loop: work -> score -> closeEpoch -> consensus -> reputation |
| `helpers.ts` | — | Shared utilities: DKG evidence builder, Anvil time control, on-chain verifier, polling |

**Total: 38 tests, 37 passed, 1 skipped**

## Close-Epoch Test (standalone)

`close-epoch.test.ts` is skipped in the main suite because it causes OOM when run alongside the other tests. It spawns its own Anvil instance, deploys 8 contracts via `forge create`, and executes ~18 transactions.

To run it standalone (requires `forge build` first):

```bash
cd packages/gateway
NODE_OPTIONS="--max-old-space-size=4096" npx vitest run test/e2e/close-epoch.test.ts --pool=forks
```

This requires the Docker environment to be running (`yarn e2e:up && yarn e2e:setup`).

## Environment

The Docker Compose stack (`docker-compose.e2e.yml` at repo root) includes:

| Service | Port | Description |
|---------|------|-------------|
| Anvil | 8546 | Local Ethereum node with deterministic accounts |
| PostgreSQL | 5433 | Workflow and API key persistence |
| Gateway | 3333 | The gateway API under test |

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://localhost:3333` | Gateway base URL |
| `RPC_URL` | `http://localhost:8546` | Anvil RPC endpoint |
| `ADMIN_KEY` | `e2e-admin-test-key` | Admin key for `/admin/*` routes |

## Test Accounts

Anvil deterministic accounts (keys in `e2e/.env.anvil`):

| Role | Account | Address |
|------|---------|---------|
| Deployer | 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Worker 1 | 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Worker 2 | 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Worker 3 | 3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| Validator 1 | 4 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |
| Validator 2 | 5 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` |
| Unregistered | 6 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` |

## Helpers (`helpers.ts`)

| Export | Description |
|--------|-------------|
| `randomDataHash()` | Generate a unique bytes32 hash |
| `createDkgEvidence(authors)` | Build minimal DKG evidence array for work submission |
| `getAddresses()` | Read deployed contract addresses from `e2e/addresses.json` |
| `postWorkflow(path, body)` | POST a workflow and return `{ status, data }` |
| `getWorkflow(id)` | GET workflow by ID |
| `pollUntilTerminal(id)` | Poll until workflow reaches COMPLETED, FAILED, or STALLED |
| `pollUntilProgress(id, field)` | Poll until a specific progress field is truthy |
| `advanceAnvilTime(seconds)` | Advance Anvil block timestamp (for commit-reveal tests) |
| `createOnChainVerifier(address)` | Direct on-chain reads: `getWorkSubmitter`, `getScoreVectorsForWorker`, `setCommitRevealDeadlines` |

## Endpoint Coverage

| Endpoint | E2E Tests | Auth |
|----------|-----------|------|
| POST /workflows/work-submission | 5 | API Key (if configured) |
| POST /workflows/score-submission | 6 | API Key (if configured) |
| POST /workflows/close-epoch | 1 (skipped) | API Key (if configured) |
| GET /health | 1 | None |
| GET /v1/work/:hash | 3 | None |
| GET /v1/studio/:address/work | 3 | None |
| GET /v1/work/:hash/evidence | 2 | API Key (if configured) |
| GET /v1/agent/:id/reputation | 3 | None |
| GET /v1/agent/:id/history | 3 | API Key (if configured) |
| POST /admin/keys | 4 | Admin Key |
| GET /admin/keys | 2 | Admin Key |
| DELETE /admin/keys/:key | 2 | Admin Key |
| POST /admin/seed-demo | 1 | Admin Key |
