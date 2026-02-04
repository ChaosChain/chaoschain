/**
 * Credit Service Types
 * 
 * Types for:
 * - 4Mica x402 protocol (credit guarantees)
 * - Circle Gateway (instant cross-chain USDC)
 * - ClawPay (private payments)
 * - Credit Studio (policy engine)
 * 
 * NOTE: Execution state types are in execution-state.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Supported network identifiers (CAIP-2 format)
 */
export type NetworkId = 
  // Mainnet
  | 'eip155:1'        // Ethereum Mainnet
  | 'eip155:43114'    // Avalanche C-Chain
  | 'eip155:8453'     // Base
  | 'eip155:42161'    // Arbitrum One
  | 'eip155:146'      // Sonic
  | 'eip155:480'      // Worldchain
  | 'eip155:1329'     // Sei
  // Testnet
  | 'eip155:11155111' // Sepolia
  | 'eip155:43113'    // Avalanche Fuji
  | 'eip155:84532'    // Base Sepolia
  | 'eip155:421614'   // Arbitrum Sepolia
  | 'eip155:57054'    // Sonic Testnet
  | 'eip155:4801'     // Worldchain Sepolia
  | 'eip155:1328'     // Sei Testnet
  | 'eip155:998'      // Hyperliquid EVM Testnet
  | 'eip155:1301'     // Arc Testnet
  // Solana
  | 'solana:mainnet'
  | 'solana:devnet';

// ═══════════════════════════════════════════════════════════════════════════════
// 4MICA TYPES (Credit Guarantees)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 4Mica payment scheme
 */
export const FOUR_MICA_SCHEME = '4mica-credit';

/**
 * Tab request for opening a payment channel
 */
export interface TabRequest {
  userAddress: string;
  recipientAddress: string;
  network?: NetworkId;
  erc20Token?: string | null;
  ttlSeconds?: number;
}

/**
 * Tab response from 4Mica
 */
export interface TabResponse {
  tabId: string;
  userAddress: string;
  recipientAddress: string;
  assetAddress: string;
  startTimestamp: number;
  ttlSeconds: number;
  nextReqId: string;
}

/**
 * Payment claims for EIP-712 signature
 */
export interface PaymentClaims {
  user_address: string;
  recipient_address: string;
  tab_id: string;
  req_id: string;
  amount: bigint;
  asset_address: string;
  timestamp: number;
  version: number;
}

/**
 * Payment payload structure
 */
export interface PaymentPayload {
  x402Version: 1 | 2;
  scheme: typeof FOUR_MICA_SCHEME;
  network: NetworkId;
  payload: {
    claims: PaymentClaims;
    signature: string;
    scheme: 'eip712';
  };
}

/**
 * Payment requirements returned by protected resource
 */
export interface PaymentRequirements {
  scheme: typeof FOUR_MICA_SCHEME;
  network: NetworkId;
  maxAmountRequired?: bigint;
  amount?: bigint;
  payTo: string;
  asset: string;
  extra?: {
    tabEndpoint?: string;
  };
}

/**
 * Verify request
 */
export interface VerifyRequest {
  x402Version?: 1 | 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/**
 * Verify response
 */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  certificate?: BLSCertificate;
}

/**
 * Settle request
 */
export interface SettleRequest {
  x402Version?: 1 | 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/**
 * Settle response
 */
export interface SettleResponse {
  success: boolean;
  error?: string;
  txHash?: string;
  networkId?: NetworkId;
  certificate?: BLSCertificate;
}

/**
 * BLS certificate for on-chain remuneration
 */
export interface BLSCertificate {
  claims: string;
  signature: string;
}

/**
 * 4Mica health response
 */
export interface HealthResponse {
  status: 'ok' | 'error';
}

/**
 * 4Mica supported kinds
 */
export interface SupportedKind {
  scheme: string;
  network: NetworkId;
  x402Version?: 1 | 2;
  extra?: Record<string, unknown>;
}

/**
 * 4Mica supported response
 */
export interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: unknown[];
  signers: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT STUDIO TYPES (Policy Engine)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Credit decision from CreditStudioLogic contract
 */
export interface CreditDecision {
  requestId: string;
  agentId: bigint;
  approvedAmount: bigint;
  interestRateBps: bigint;
  ttlSeconds: bigint;
  destinationChain: bigint;
  approved: boolean;
  rejectionReason: string;
  timestamp: bigint;
}

/**
 * Credit policy parameters
 */
export interface CreditPolicy {
  minReputationScore: bigint;
  minFeedbackCount: bigint;
  maxCreditAmount: bigint;
  baseInterestRateBps: bigint;
  maxTtlSeconds: bigint;
  active: boolean;
}

/**
 * Credit execution request
 */
export interface CreditExecutionRequest {
  decision: CreditDecision;
  recipientAddress: string;
  sourceNetwork: NetworkId;
  destinationNetwork?: NetworkId;
}

/**
 * Credit execution result
 */
export interface CreditExecutionResult {
  requestId: string;
  success: boolean;
  certificate?: BLSCertificate;
  gatewayTxHash?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAWPAY TYPES (Private Payments)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ClawPay transfer request
 */
export interface ClawPayTransferRequest {
  recipient: string;
  amount: string;
  token: 'USDT' | 'USDC';
}

/**
 * ClawPay transfer result
 */
export interface ClawPayTransferResult {
  transferId: string;
  status: 'pending' | 'broadcasting' | 'confirmed' | 'failed';
  txHash?: string;
  error?: string;
}
