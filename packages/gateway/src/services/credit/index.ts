/**
 * Credit Studio Service
 * 
 * Integrates:
 * - **4Mica**: Cryptographically-backed credit guarantees (x402 protocol)
 * - **Circle Gateway**: Instant (<500ms) unified crosschain USDC transfers
 * - **ClawPay**: Private payments via Railgun
 * 
 * Flow (per Studio Interplay spec):
 * 1. Agent requests credit via CreditStudioLogic
 * 2. ChaosChain verifies reputation via ERC-8004
 * 3. 4Mica issues fair-exchange guarantee (BLS certificate)
 * 4. Circle Gateway provides instant USDC on destination chain
 * 5. Gateway marks request as completed
 * 
 * Why Circle Gateway (not CCTP):
 * - CCTP: Point-to-point transfers, 8-20 seconds
 * - Gateway: Unified balance, INSTANT (<500ms)
 * 
 * The Studio Interplay document specifies "instant credit lines"
 * which requires Gateway's unified balance model.
 * 
 * Components:
 * - FourMicaClient: x402 payment protocol integration
 * - CircleGatewayClient: Instant crosschain USDC (PREFERRED)
 * - CircleCCTPClient: Point-to-point USDC (fallback)
 * - ClawPayClient: Private payments via Railgun
 * - CreditExecutor: Main orchestrator
 */

export * from './four-mica-client.js';
export * from './credit-executor.js';
export * from './circle-gateway-client.js';
// export * from './circle-cctp-client.js';  // Deprecated - use Gateway instead
export * from './clawpay-client.js';
export * from './types.js';
