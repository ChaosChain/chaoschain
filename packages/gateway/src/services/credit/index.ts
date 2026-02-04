/**
 * Credit Studio Service
 * 
 * Production-ready credit execution with:
 * - **4Mica**: Cryptographically-backed credit guarantees (BLS certificates)
 * - **Circle Gateway**: Instant (<500ms) unified crosschain USDC transfers
 * - **ClawPay**: Private payments via Railgun
 * - **State Machine**: Idempotent, restart-safe execution
 * - **Persistence**: BLS certificate durability (DB + Arweave)
 * - **Retry Logic**: Exponential backoff for transient failures
 * 
 * Flow (per Studio Interplay spec):
 * 1. Agent requests credit via CreditStudioLogic
 * 2. ChaosChain verifies reputation via ERC-8004
 * 3. 4Mica issues fair-exchange guarantee (BLS certificate)
 * 4. Certificate persisted to DB + Arweave (CRITICAL for disputes!)
 * 5. Circle Gateway provides instant USDC on destination chain
 * 6. Gateway marks request as completed
 * 7. On repayment: CreditSettled event
 * 8. On TTL expiry: CreditDefaulted event + remediation
 * 
 * Why Circle Gateway (not CCTP):
 * - CCTP: Point-to-point transfers, 8-20 seconds
 * - Gateway: Unified balance, INSTANT (<500ms)
 * 
 * Components:
 * - FourMicaClient: x402 payment protocol integration
 * - CircleGatewayClient: Instant crosschain USDC
 * - ClawPayClient: Private payments via Railgun
 * - CreditExecutor: Main orchestrator (idempotent, retry-safe)
 * - ExecutionState: State machine for credit lifecycle
 * - Persistence: Durable storage for certificates and records
 */

export * from './four-mica-client.js';
export * from './credit-executor.js';
export * from './circle-gateway-client.js';
export * from './clawpay-client.js';
export * from './execution-state.js';
export * from './persistence.js';
export * from './types.js';
