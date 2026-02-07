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

// 4Mica client
export * from './four-mica-client.js';

// Circle Gateway client (correct addresses)
export {
  CircleGatewayClient,
  createCircleGatewayClient,
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_MINTER_ADDRESS,
  GATEWAY_API,
  GATEWAY_DOMAINS,
  USDC_ADDRESSES,
  CHAIN_ID_TO_NETWORK,
  type NetworkId as GatewayNetworkId,
  type TransferSpec,
  type BurnIntent,
  type GatewayTransferRequest,
  type GatewayTransferResult,
  type GatewayDepositResult,
  type GatewayBalance,
  type CircleGatewayConfig,
} from './circle-gateway-client.js';

// ClawPay client
export * from './clawpay-client.js';

// Execution state machine
export {
  ExecutionState,
  type CreditIntent as ExecutionCreditIntent,
  type ExecutionRecord,
  type CreditSettledEvent,
  type CreditDefaultedEvent,
  type RetryConfig as ExecutionRetryConfig,
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  VALID_TRANSITIONS,
  isValidTransition,
  isTerminalState,
  hasExpired,
} from './execution-state.js';

// Persistence
export * from './persistence.js';

// Types (main type definitions)
export {
  type NetworkId,
  FOUR_MICA_SCHEME,
  type TabRequest,
  type TabResponse,
  type PaymentClaims,
  type PaymentPayload,
  type PaymentRequirements,
  type VerifyRequest,
  type VerifyResponse,
  type SettleRequest,
  type SettleResponse,
  type BLSCertificate,
  type HealthResponse,
  type SupportedKind,
  type SupportedResponse,
  type CreditDecision,
  type CreditPolicy,
  type CreditExecutionRequest,
  type CreditExecutionResult,
  type ClawPayTransferRequest,
  type ClawPayTransferResult,
} from './types.js';

// Credit executor (main orchestrator)
// Note: Import after types to ensure correct resolution
export * from './credit-executor.js';
