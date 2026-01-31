# ChaosChain OpenClaw Skills

This package contains OpenClaw-compatible skills for ChaosChain integration.

## Skills

### `chaoschain/`

**Trust & Reputation Verification Tool**

Provides READ-ONLY access to ERC-8004 registries for verifying agent identity and reputation.

| Command | Description |
|---------|-------------|
| `/chaoschain verify <id>` | Check agent registration |
| `/chaoschain reputation <id>` | View reputation scores |
| `/chaoschain whoami` | Check your identity |
| `/chaoschain register` | Register on ERC-8004 |

## Installation

### ClawHub (Recommended)

```bash
clawhub install chaoschain
```

### Manual

Copy the skill folder to your OpenClaw skills directory:

```bash
cp -r chaoschain ~/.openclaw/skills/
```

## What This Is NOT

This is a **trust visualization tool**, not a workflow execution system.

- ❌ No protocol execution
- ❌ No Gateway usage
- ❌ No payments
- ❌ No background agents
- ❌ No custody by default

## Learn More

- [SKILL.md](./chaoschain/SKILL.md) - OpenClaw skill definition
- [README.md](./chaoschain/README.md) - Detailed documentation
- [ChaosChain Docs](https://docs.chaoscha.in)
