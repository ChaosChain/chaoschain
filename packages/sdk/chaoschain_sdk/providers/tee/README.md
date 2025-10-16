# TEE Provider System

## Overview

TEE (Trusted Execution Environment) providers enable hardware-verified identity and signing for ERC-8004 agents. This is crucial for production deployments where agent actions need cryptographic proof of execution in a trusted environment.

## Available Providers

### Phala dstack (CVM-based)

**Status:** Community contribution by @HashWarlock
**Requirements:** `pip install chaoschain-sdk[phala-tee]`
**Platform:** Phala Cloud Confidential Virtual Machines

```python
from chaoschain_sdk.providers.tee import get_phala_dstack_tee

PhalaTEE = get_phala_dstack_tee()
tee = PhalaTEE()

# Generate TEE-attested keys
keypair = tee.generate_key()

# Sign with hardware attestation
signature = tee.sign(b"agent action data", keypair)

# Verify attestation
assert signature.verified == True
```

## Integration with ERC-8004

TEE providers integrate at multiple levels:

1. **Agent Registration**: Submit TEE attestation with on-chain identity
2. **Action Signing**: Every agent action includes TEE proof
3. **Validation**: Validators verify TEE attestations
4. **Reputation**: TEE-verified actions build stronger reputation

## Adding a New TEE Provider

1. Implement the `TEEProvider` protocol in `providers/tee/your_provider.py`
2. Add optional dependencies to `pyproject.toml`
3. Export from `__init__.py`
4. Add tests and documentation
5. Submit a PR!

## Benefits

- ✅ Hardware-verified agent identity
- ✅ Cryptographic proof of execution
- ✅ Enhanced ERC-8004 reputation
- ✅ Production-grade security
- ✅ CVM/TEE compliance

## Contributing

We welcome TEE provider contributions! See our contribution guidelines.
