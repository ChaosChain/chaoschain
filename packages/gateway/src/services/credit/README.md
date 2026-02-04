# Credit Studio Service

ChaosChain Gateway integration implementing the **Studio Interplay** architecture:

- **4Mica** - Cryptographically-backed credit guarantees (BLS certificates)
- **Circle Gateway** - Instant (<500ms) unified crosschain USDC
- **ClawPay** - Private payments via Railgun

## Why This Lives in `services/`

The `services/` directory in the Gateway contains external integrations that:
1. **Orchestrate multiple systems** - 4Mica + Circle + ChaosChain contracts
2. **Handle async workflows** - Event-driven credit execution
3. **Abstract external APIs** - Clean interfaces for 4Mica/Circle/ClawPay

The Gateway is the **off-chain orchestrator** that:
- Watches on-chain events from CreditStudioLogic
- Coordinates with external payment systems
- Executes the credit flow end-to-end

## Circle Gateway vs CCTP

⚠️ **Important distinction for the Studio Interplay spec:**

| Attribute | CCTP ❌ | Gateway ✅ |
|-----------|---------|------------|
| **Use case** | Point-to-point transfers | **Unified crosschain balance** |
| **Speed** | 8-20 seconds | **Instant (<500ms)** |
| **Balance model** | Burn/mint per transfer | **Single balance, any chain** |
| **For Credit Studio?** | Too slow | **Perfect for instant credit** |

The Studio Interplay document specifies:
> "Circle Gateway: accepts 4Mica guarantees and provides **instant** USDC liquidity on destination chains"

This requires **Circle Gateway**, not CCTP.

## Studio Interplay Architecture

From the joint ChaosChain + 4Mica spec:

```
                    ┌─────────────────┐
                    │    AI Agent     │
                    │  Requests Credit│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  CreditStudioLogic │
                    │   (ChaosChain)   │
                    │ • Read ERC-8004  │
                    │ • Policy check   │
                    │ • Issue attestation│
                    └────────┬────────┘
                             │
                    CreditApproved event
                             │
                    ┌────────▼────────┐
                    │   ChaosChain    │
                    │    Gateway      │
                    │ (This Service)  │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │    4Mica     │   │   Circle     │   │   ClawPay    │
   │  x402 Credit │   │   Gateway    │   │   Railgun    │
   │              │   │              │   │              │
   │ BLS cert for │   │ Instant USDC │   │ Private      │
   │ guarantee    │   │ any chain    │   │ transfers    │
   └──────────────┘   └──────────────┘   └──────────────┘
```

### End-to-End Flow (from Studio Interplay spec)

1. **Agent issues credit request** to ChaosChain Credit Studio
2. **Credit Studio verifies** agent reputation via ERC-8004
3. **4Mica opens tab** and issues fair-exchange guarantee
4. **Circle Gateway provides** instant USDC on destination chain
5. **Agent receives** credit and executes task
6. **Happy Path**: Agent settles within TTL, 4Mica marks fulfilled
7. **Unhappy Path**: 4Mica liquidates from agent's vault

### Key Actors (from Studio Interplay)

| Actor | Role |
|-------|------|
| Agent | Requests credit, executes tasks |
| Agent Owner | Wallet with collateral in 4Mica vault |
| Circle Gateway | Instant USDC liquidity provider |
| 4Mica | Fair-exchange guarantee issuer |
| Credit Studio | Reputation verification + credit policy |
| ChaosChain | Verifiable attestations, reputation, payout |

## Components

### 4MicaClient

x402 payment protocol for cryptographically-backed credit.

```typescript
import { FourMicaClient, createFourMicaConfig } from './four-mica-client';

const config = createFourMicaConfig(signer, 'eip155:11155111');
const client = new FourMicaClient(config);

// Get BLS certificate for credit guarantee
const certificate = await client.requestCreditGuarantee(
  recipientAddress,
  BigInt(1000 * 1e6), // 1000 USDC
);
```

### CircleGatewayClient (PREFERRED)

Instant (<500ms) crosschain USDC via unified balance.

```typescript
import { createCircleGatewayClient } from './circle-gateway-client';

const client = createCircleGatewayClient(
  privateKey,
  sourceProviderUrl,
  destProviderUrl,
  'eip155:11155111',  // Source: Sepolia
  'eip155:84532',     // Dest: Base Sepolia
);

// One-time: Deposit to establish unified balance
await client.deposit(BigInt(10000 * 1e6), 'eip155:11155111', provider);

// Instant transfer (<500ms!)
const result = await client.transfer({
  amount: BigInt(1000 * 1e6),
  sourceNetwork: 'eip155:11155111',
  destinationNetwork: 'eip155:84532',
  recipientAddress: '0x...',
});
```

### ClawPayClient

Private payments for sensitive transactions.

```typescript
import { createClawPayClient } from './clawpay-client';

const client = createClawPayClient(privateKey);
await client.authenticate();

// Get invoice address for receiving
const invoiceAddress = await client.getInvoiceAddress();

// Private transfer
await client.transfer({
  recipient: invoiceAddress,
  amount: '100',
  token: 'USDT',
});
```

### CreditExecutor

Main orchestrator that ties everything together.

```typescript
import { createCreditExecutor } from './credit-executor';

const executor = createCreditExecutor(
  rpcUrl,
  privateKey,
  creditStudioAddress,
  identityRegistryAddress,
);

await executor.start(); // Watch for CreditApproved events
```

## Supported Networks

| Network | CAIP-2 | Gateway | 4Mica | CCTP |
|---------|--------|---------|-------|------|
| Ethereum Sepolia | eip155:11155111 | ✅ | ✅ | ✅ |
| Base Sepolia | eip155:84532 | ✅ | ✅ | ✅ |
| Arbitrum Sepolia | eip155:421614 | ✅ | ✅ | ✅ |
| Polygon Amoy | eip155:80002 | ⚠️ | ✅ | ⚠️ |

## Environment Variables

```bash
# Required
PRIVATE_KEY=0x...
ETH_SEPOLIA_RPC_URL=https://...

# Credit Studio Contract
CREDIT_STUDIO_ADDRESS=0x...
IDENTITY_REGISTRY_ADDRESS=0x...

# 4Mica
FOUR_MICA_URL=https://x402.4mica.xyz

# Circle Gateway (optional, defaults to testnet)
CIRCLE_GATEWAY_USE_TESTNET=true

# ClawPay
CLAWPAY_URL=https://clawpay.dev
```

## References

- [4Mica Technical Docs](https://4mica.xyz/resources/technical-docs)
- [Circle Gateway](https://developers.circle.com/gateway) - ✅ Instant transfers
- [Circle CCTP](https://developers.circle.com/stablecoins/docs/cctp-getting-started) - Fallback
- [ClawPay](https://clawpay.dev)
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)
