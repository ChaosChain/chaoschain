# Credit Service

Production-ready credit execution for ChaosChain Credit Studio.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CREDIT EXECUTION FLOW                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Agent                CreditStudio        CreditExecutor    Circle Gateway│
│    │                      │                     │                  │      │
│    ├──requestCredit()────►│                     │                  │      │
│    │                      │                     │                  │      │
│    │  ┌──────────────────►│ CreditApproved     │                  │      │
│    │  │ Check ERC-8004    │     event          │                  │      │
│    │  │ reputation        ├────────────────────►│                  │      │
│    │  └──────────────────►│                     │                  │      │
│    │                      │                     │                  │      │
│    │                      │           ┌────────►│ 1. Get 4Mica    │      │
│    │                      │           │         │    BLS cert      │      │
│    │                      │           │         ├──────────────────►│     │
│    │                      │           │         │ 2. Transfer via  │      │
│    │                      │           │         │    Gateway API   │      │
│    │                      │           │         │◄─────attestation─┤      │
│    │                      │           │         │ 3. gatewayMint() │      │
│    │                      │           │         ├─────────────────►│      │
│    │                      │           │         │                  │      │
│    │◄───────────USDC arrives on destination chain─────────────────┘      │
│    │                      │                     │                         │
└────┴──────────────────────┴─────────────────────┴─────────────────────────┘
```

## Components

### 1. Circle Gateway Client (`circle-gateway-client.ts`)

Instant (<500ms) crosschain USDC transfers via unified balance model.

**Key Addresses (Same on ALL EVM chains):**
- Gateway Wallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- Gateway Minter: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`

**Supported Networks:**

| Network | Domain ID | USDC Address |
|---------|-----------|--------------|
| Ethereum Sepolia | 0 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Avalanche Fuji | 1 | `0x5425890298aed601595a70ab815c96711a31bc65` |
| Solana Devnet | 5 | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Base Sepolia | 6 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Sonic Testnet | 13 | `0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51` |
| Worldchain Sepolia | 14 | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` |
| Sei Testnet | 16 | `0x4fCF1784B31630811181f670Aea7A7bEF803eaED` |
| Hyperliquid Testnet | 19 | `0x2B3370eE501B4a559b57D449569354196457D8Ab` |
| Arc Testnet | 26 | `0x3600000000000000000000000000000000000000` |

**Usage:**

```typescript
import { 
  CircleGatewayClient, 
  createCircleGatewayClient 
} from './services/credit';

// Create client with providers for each chain
const client = createCircleGatewayClient(
  privateKey,
  new Map([
    [11155111, sepoliaProvider],
    [84532, baseSepoliaProvider],
  ]),
  true, // useTestnet
);

// ONE-TIME: Deposit USDC to create unified balance
// This needs to be done once per chain you want to fund from
await client.deposit('eip155:11155111', 1000_000000n); // 1000 USDC

// INSTANT: Transfer to any supported chain
const result = await client.transfer({
  amount: 100_000000n,  // 100 USDC
  sourceNetwork: 'eip155:11155111',      // Sepolia
  destinationNetwork: 'eip155:84532',    // Base Sepolia
  recipientAddress: '0x...',
});

// Result: { success: true, mintTxHash: '0x...' }
```

### 2. 4Mica Client (`four-mica-client.ts`)

x402 payment protocol for cryptographically-backed credit guarantees.

**Flow:**
1. Open a payment "tab" (credit line)
2. Sign payment claims via EIP-712
3. Settle to receive BLS certificate
4. Certificate used for on-chain remediation if default

**Usage:**

```typescript
import { FourMicaClient, createFourMicaConfig } from './services/credit';

const client = new FourMicaClient(createFourMicaConfig(
  signer,
  'eip155:11155111', // Network
));

// Get BLS certificate for credit guarantee
const certificate = await client.requestCreditGuarantee(
  recipientAddress,
  1000_000000n, // 1000 USDC
);

// Certificate can be used for on-chain remuneration
console.log(certificate.claims, certificate.signature);
```

### 3. ClawPay Client (`clawpay-client.ts`)

Private payments via Railgun for confidential transactions.

### 4. Credit Executor (`credit-executor.ts`)

Main orchestrator with:
- **Idempotent execution** - Safe to restart at any point
- **State machine** - Tracks execution lifecycle
- **Retry logic** - Exponential backoff for transient failures
- **Event emission** - CreditSettled / CreditDefaulted

**States:**
```
APPROVED → PENDING_4MICA → CERT_ISSUED → PENDING_GATEWAY → TRANSFER_COMPLETE
                                                                ↓
                                                    SETTLED or DEFAULTED
```

## Setup for Production

### 1. Fund Gateway Balance

Before using Circle Gateway, you need to deposit USDC to create a unified balance:

```typescript
// Fund from Sepolia
await client.deposit('eip155:11155111', 10000_000000n);

// Fund from Base Sepolia (adds to same unified balance)
await client.deposit('eip155:84532', 5000_000000n);

// Total balance: 15000 USDC (accessible from ANY chain)
```

### 2. Configure Providers

```typescript
const providers = new Map([
  [11155111, new JsonRpcProvider(process.env.SEPOLIA_RPC_URL)],
  [84532, new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL)],
  [421614, new JsonRpcProvider(process.env.ARB_SEPOLIA_RPC_URL)],
]);
```

### 3. Start Executor

```typescript
import { createCreditExecutor } from './services/credit';

const executor = createCreditExecutor({
  provider: sepoliaProvider,
  signer: wallet,
  creditStudioAddress: CREDIT_STUDIO_ADDRESS,
  identityRegistryAddress: IDENTITY_REGISTRY_ADDRESS,
  fourMicaUrl: 'https://x402.4mica.xyz',
  defaultNetwork: 'eip155:11155111',
  gatewayProviders: providers,
});

// Start listening for CreditApproved events
await executor.start();
```

## Why Circle Gateway (not CCTP)?

| Feature | Circle CCTP | Circle Gateway |
|---------|-------------|----------------|
| Speed | 8-20 seconds | **< 500ms** |
| Model | Point-to-point | **Unified balance** |
| Multi-source | ❌ | ✅ Aggregate from multiple chains |
| Complexity | Burn → Attestation → Mint | Sign → API → Mint |

Circle Gateway provides **instant** transfers because:
1. You pre-fund a unified balance (one-time setup)
2. Transfers are just API calls + destination mint
3. No waiting for source chain finality

## API Reference

### Gateway API Endpoints

**Testnet:** `https://gateway-api-testnet.circle.com/v1`  
**Mainnet:** `https://gateway-api.circle.com/v1`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/transfer` | POST | Submit burn intents, get attestation |
| `/balances` | POST | Check unified balance |

### Transfer Request Format

```json
[
  {
    "burnIntent": {
      "maxBlockHeight": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      "maxFee": "2010000",
      "spec": {
        "version": 1,
        "sourceDomain": 0,
        "destinationDomain": 6,
        "sourceContract": "0x...",
        "destinationContract": "0x...",
        "sourceToken": "0x...",
        "destinationToken": "0x...",
        "sourceDepositor": "0x...",
        "destinationRecipient": "0x...",
        "sourceSigner": "0x...",
        "destinationCaller": "0x...",
        "value": "1000000",
        "salt": "0x...",
        "hookData": "0x"
      }
    },
    "signature": "0x..."
  }
]
```

## Testing

```bash
# Run all credit tests
cd packages/gateway
npm run test -- test/credit/

# Run stress tests
npm run test -- test/credit/executor-stress.test.ts
```

## References

- [Circle Gateway Docs](https://developers.circle.com/gateway)
- [4Mica x402 Spec](https://4mica.xyz/resources/technical-docs)
- [ERC-8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
