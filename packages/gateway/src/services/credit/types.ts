/**
 * Credit Service Types
 * 
 * Based on 4Mica x402 protocol specification
 * https://4mica.xyz/resources/technical-docs
 */

// ═══════════════════════════════════════════════════════════════════════════
// 4MICA TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supported network identifiers (CAIP-2 format)
 */
export type NetworkId = 
  | 'eip155:1'        // Ethereum Mainnet
  | 'eip155:11155111' // Sepolia
  | 'eip155:80002'    // Polygon Amoy
  | 'eip155:8453'     // Base
  | 'eip155:84532'    // Base Sepolia
  | 'eip155:42161'    // Arbitrum One
  | 'eip155:421614';  // Arbitrum Sepolia

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
  erc20Token?: string | null; // null for native ETH
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
  amount: string; // hex encoded
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
  maxAmountRequired?: string; // x402 v1
  amount?: string;           // x402 v2
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
  claims: string; // hex
  signature: string; // hex
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

// ═══════════════════════════════════════════════════════════════════════════
// CREDIT STUDIO TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Credit decision from CreditStudioLogic contract
 */
export interface CreditDecision {
  requestId: string;
  agentId: bigint;
  approvedAmount: bigint;
  interestRateBps: bigint;
  ttlSeconds: bigint;
  destinationChain: string;
  approved: boolean;
  rejectionReason: string;
  timestamp: bigint;
}

/**
 * Credit execution request
 */
export interface CreditExecutionRequest {
  decision: CreditDecision;
  recipientAddress: string;
  sourceNetwork: NetworkId;
  destinationNetwork?: NetworkId; // For cross-chain
}

/**
 * Credit execution result
 */
export interface CreditExecutionResult {
  requestId: string;
  success: boolean;
  certificate?: BLSCertificate;
  txHash?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCLE CCTP TYPES (for cross-chain)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CCTP transfer request
 */
export interface CCTPTransferRequest {
  amount: bigint;
  sourceNetwork: NetworkId;
  destinationNetwork: NetworkId;
  recipientAddress: string;
}

/**
 * CCTP transfer result
 */
export interface CCTPTransferResult {
  success: boolean;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAWPAY TYPES (for private payments)
// ═══════════════════════════════════════════════════════════════════════════

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
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
}
