# Contributing to ChaosChain

Thank you for your interest in contributing. This guide explains how we work and how to submit changes.

---

## Branching and pull requests

- **`main`** — Production branch. Deployed to gateway.chaoscha.in and used for releases. Do **not** open pull requests directly to `main`.
- **`develop`** — Integration branch. All contributions should target **`develop`**.

**What to do:**

1. Fork the repo and create a feature branch from **`develop`**:
   ```bash
   git fetch origin develop
   git checkout -b your-feature origin/develop
   ```
2. Make your changes, add tests where relevant, and run the test suites (see below).
3. Open a **pull request against `develop`** (not `main`).
4. After review, maintainers will merge into `develop`. We periodically merge `develop` into `main` for production deploys.

If your PR was opened against `main`, we may ask you to retarget the base branch to `develop`.

---

## Repository layout

| Path | Description |
|------|-------------|
| `packages/contracts/` | Solidity contracts (Foundry), LogicModules, RewardsDistributor, StudioProxy |
| `packages/gateway/` | Node.js gateway service (workflows, DKG, public API) |
| `packages/sdk/` | Python SDK |
| `chaoschain-sdk-ts/` or `packages/*` | TypeScript SDK (verifier integration, evidence scoring) |
| `chaoschain-skills/` | Agent skill definitions (Engineering Studio, etc.) |
| `docs/` | Protocol spec, Verifier Integration Guide, PUBLIC_API_SPEC |

---

## Setting up and running tests

### Contracts (Foundry)

```bash
# Install Foundry if needed
curl -L https://foundry.paradigm.xyz | bash
foundryup

cd packages/contracts
forge install   # install submodules (e.g. OpenZeppelin)
forge test
```

### Gateway (Node.js)

```bash
cd packages/gateway
npm ci
npm run build
npm test
```

### Python SDK

```bash
cd packages/sdk
pip install -e ".[dev]"
pytest
```

### TypeScript SDK

If the TypeScript SDK lives in-repo:

```bash
cd chaoschain-sdk-ts   # or the correct path
npm ci
npm test
```

---

## What we look for

- **Tests** — New behavior should have tests. Bug fixes should include a test that reproduces the bug (when feasible).
- **Docs** — Update `docs/` (e.g. `VERIFIER_INTEGRATION_GUIDE.md`, `PUBLIC_API_SPEC.md`) if you change APIs or flows.
- **No secrets** — Never commit `.env`, private keys, or API keys. Use `.env.example` and document required variables.
- **Protocol alignment** — Contract and scoring changes should stay consistent with [docs/protocol_spec_v0.1.md](docs/protocol_spec_v0.1.md). When in doubt, ask.

---

## Reporting bugs and suggesting features

- **Bugs** — Open an issue with steps to reproduce, environment (contracts/gateway/SDK), and expected vs actual behavior.
- **Contract or economic bugs** — Include a minimal test or script that demonstrates the issue; it speeds up review and can be merged as a regression test.
- **Features** — Open an issue first to discuss scope and design before large PRs.

---

## Getting help

- **Docs:** [docs.chaoscha.in](https://docs.chaoscha.in), [Protocol Spec v0.1](docs/protocol_spec_v0.1.md), [Verifier Integration Guide](docs/VERIFIER_INTEGRATION_GUIDE.md)
- **Contact:** Telegram [chaoschain](https://t.me/chaoschain) (mentioned in the Verifier Guide for API keys and support)

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
