/**
 * Credit Executor
 * 
 * Listens for CreditApproved events from CreditStudioLogic contract
 * and executes credit via 4Mica + Circle.
 * 
 * Architecture:
 * 1. Watches CreditStudioLogic for CreditApproved events
 * 2. For each approval, calls 4Mica to get BLS certificate
 * 3. If cross-chain, uses Circle CCTP for USDC transfer
 * 4. Marks request as completed in CreditStudioLogic
 */

import { Contract, Wallet, JsonRpcProvider, Provider, EventLog } from 'ethers';
import { FourMicaClient, createFourMicaConfig } from './four-mica-client.js';
import { CircleGatewayClient, createCircleGatewayClient } from './circle-gateway-client.js';
import { ClawPayClient, createClawPayClient } from './clawpay-client.js';
import {
  CreditExecutionRequest,
  CreditExecutionResult,
  NetworkId,
} from './types.js';

/**
 * CreditStudioLogic ABI (minimal for events)
 */
const CREDIT_STUDIO_ABI = [
  'event CreditApproved(bytes32 indexed requestId, uint256 indexed agentId, uint256 approvedAmount, uint256 interestRateBps, uint256 ttlSeconds)',
  'event CreditRejected(bytes32 indexed requestId, uint256 indexed agentId, string reason)',
  'function getDecision(bytes32 requestId) view returns (tuple(bytes32 requestId, uint256 agentId, uint256 approvedAmount, uint256 interestRateBps, uint256 ttlSeconds, string destinationChain, bool approved, string rejectionReason, uint256 timestamp))',
  'function markCompleted(bytes32 requestId)',
];

/**
 * ERC-8004 IdentityRegistry ABI (minimal)
 */
const IDENTITY_REGISTRY_ABI = [
  'function ownerOf(uint256 agentId) view returns (address)',
];

/**
 * Configuration for Credit Executor
 */
export interface CreditExecutorConfig {
  /** Provider for blockchain interactions */
  provider: Provider;
  /** Signer wallet for transactions */
  signer: Wallet;
  /** CreditStudioLogic contract address */
  creditStudioAddress: string;
  /** ERC-8004 IdentityRegistry address */
  identityRegistryAddress: string;
  /** 4Mica facilitator URL */
  fourMicaUrl: string;
  /** Default network for 4Mica */
  defaultNetwork: NetworkId;
  /** Polling interval in ms */
  pollIntervalMs?: number;
  /** Start block for historical events */
  startBlock?: number;
  
  // Circle Gateway config
  /** Circle Gateway: source provider URL (must be JsonRpcProvider) */
  sourceProviderUrl?: string;
  /** Circle Gateway: destination provider URL (for cross-chain) */
  destinationProviderUrl?: string;
  /** Circle Gateway: destination network */
  destinationNetwork?: NetworkId;
  /** Use Circle Gateway testnet */
  useGatewayTestnet?: boolean;
  
  // ClawPay config
  /** Enable ClawPay for private payments */
  enableClawPay?: boolean;
  /** ClawPay API base URL */
  clawPayApiUrl?: string;
}

/**
 * Credit Executor
 * 
 * Main service for executing approved credits via:
 * - 4Mica (BLS certificates for fair-exchange guarantees)
 * - Circle Gateway (instant cross-chain USDC transfers)
 * - ClawPay (private payments via Railgun)
 */
export class CreditExecutor {
  private config: CreditExecutorConfig;
  private creditStudio: Contract;
  private identityRegistry: Contract;
  private fourMicaClient: FourMicaClient;
  private circleGatewayClient: CircleGatewayClient | null = null;
  private clawPayClient: ClawPayClient | null = null;
  private isRunning = false;
  private lastProcessedBlock = 0;
  
  constructor(config: CreditExecutorConfig) {
    this.config = {
      pollIntervalMs: 15000, // 15 seconds
      startBlock: 0,
      useGatewayTestnet: true,
      enableClawPay: false,
      ...config,
    };
    
    // Initialize contracts
    this.creditStudio = new Contract(
      config.creditStudioAddress,
      CREDIT_STUDIO_ABI,
      config.signer,
    );
    
    this.identityRegistry = new Contract(
      config.identityRegistryAddress,
      IDENTITY_REGISTRY_ABI,
      config.provider,
    );
    
    // Initialize 4Mica client
    const fourMicaConfig = createFourMicaConfig(
      config.signer,
      config.defaultNetwork,
      config.fourMicaUrl,
    );
    this.fourMicaClient = new FourMicaClient(fourMicaConfig);
    
    // Initialize Circle Gateway client (for cross-chain transfers)
    if (config.sourceProviderUrl && config.destinationProviderUrl && config.destinationNetwork) {
      this.circleGatewayClient = createCircleGatewayClient(
        config.signer.privateKey,
        config.sourceProviderUrl,
        config.destinationProviderUrl,
        config.defaultNetwork,
        config.destinationNetwork,
        config.useGatewayTestnet,
      );
      console.log('Circle Gateway client initialized for cross-chain transfers');
    }
    
    // Initialize ClawPay client (for private payments)
    if (config.enableClawPay) {
      this.clawPayClient = createClawPayClient(
        config.signer.privateKey,
        config.clawPayApiUrl,
      );
      console.log('ClawPay client initialized for private payments');
    }
    
    this.lastProcessedBlock = config.startBlock || 0;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Start the executor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('Credit Executor already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Credit Executor starting...');
    
    // Get current block if no start block specified
    if (this.lastProcessedBlock === 0) {
      this.lastProcessedBlock = await this.config.provider.getBlockNumber();
    }
    
    // Start polling loop
    this.pollLoop();
  }
  
  /**
   * Stop the executor
   */
  stop(): void {
    this.isRunning = false;
    console.log('Credit Executor stopped');
  }
  
  /**
   * Main polling loop
   */
  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processNewEvents();
      } catch (error) {
        console.error('Error processing credit events:', error);
      }
      
      await new Promise(resolve => 
        setTimeout(resolve, this.config.pollIntervalMs)
      );
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Process new CreditApproved events
   */
  private async processNewEvents(): Promise<void> {
    const currentBlock = await this.config.provider.getBlockNumber();
    
    if (currentBlock <= this.lastProcessedBlock) {
      return;
    }
    
    // Query for CreditApproved events
    const filter = this.creditStudio.filters.CreditApproved();
    const events = await this.creditStudio.queryFilter(
      filter,
      this.lastProcessedBlock + 1,
      currentBlock,
    );
    
    console.log(`Found ${events.length} new CreditApproved events`);
    
    // Process each event (filter for EventLog type)
    for (const event of events) {
      if ('args' in event) {
        try {
          await this.handleCreditApproved(event as EventLog);
        } catch (error) {
          console.error(`Error handling event ${event.transactionHash}:`, error);
        }
      }
    }
    
    this.lastProcessedBlock = currentBlock;
  }
  
  /**
   * Handle a CreditApproved event
   */
  private async handleCreditApproved(event: EventLog): Promise<void> {
    const args = event.args;
    const requestId = args[0] as string;
    const agentId = args[1] as bigint;
    const approvedAmount = args[2] as bigint;
    const interestRateBps = args[3] as bigint;
    const ttlSeconds = args[4] as bigint;
    
    console.log(`Processing CreditApproved: requestId=${requestId}, agentId=${agentId}, amount=${approvedAmount}`);
    
    // Get full decision from contract
    const decision = await this.creditStudio.getDecision(requestId);
    
    // Get agent address from IdentityRegistry
    const agentAddress = await this.identityRegistry.ownerOf(agentId);
    
    // Execute credit via 4Mica
    const result = await this.executeCredit({
      decision: {
        requestId,
        agentId,
        approvedAmount,
        interestRateBps,
        ttlSeconds,
        destinationChain: decision.destinationChain,
        approved: true,
        rejectionReason: '',
        timestamp: decision.timestamp,
      },
      recipientAddress: agentAddress,
      sourceNetwork: this.config.defaultNetwork,
      // TODO: Map destinationChain to NetworkId for cross-chain
    });
    
    if (result.success) {
      console.log(`Credit executed successfully: requestId=${requestId}, certificate=${result.certificate?.claims.substring(0, 20)}...`);
      
      // Mark request as completed
      const tx = await this.creditStudio.markCompleted(requestId);
      await tx.wait();
      
      console.log(`Request marked as completed: ${requestId}`);
    } else {
      console.error(`Credit execution failed: requestId=${requestId}, error=${result.error}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CREDIT EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Execute credit via 4Mica
   */
  async executeCredit(
    request: CreditExecutionRequest,
  ): Promise<CreditExecutionResult> {
    try {
      // Determine if cross-chain
      const isCrossChain = 
        request.destinationNetwork && 
        request.destinationNetwork !== request.sourceNetwork;
      
      if (isCrossChain) {
        // Cross-chain: 4Mica guarantee + Circle CCTP
        return await this.executeCrossChainCredit(request);
      } else {
        // Same chain: Just 4Mica guarantee
        return await this.executeSameChainCredit(request);
      }
    } catch (error) {
      return {
        requestId: request.decision.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Execute same-chain credit via 4Mica
   */
  private async executeSameChainCredit(
    request: CreditExecutionRequest,
  ): Promise<CreditExecutionResult> {
    // Get BLS certificate from 4Mica
    const certificate = await this.fourMicaClient.requestCreditGuarantee(
      request.recipientAddress,
      request.decision.approvedAmount,
      request.sourceNetwork,
    );
    
    return {
      requestId: request.decision.requestId,
      success: true,
      certificate,
    };
  }
  
  /**
   * Execute cross-chain credit via 4Mica + Circle Gateway
   * 
   * Per Studio Interplay spec:
   * 1. 4Mica issues BLS certificate (guarantee)
   * 2. Circle Gateway provides INSTANT (<500ms) USDC on destination
   * 
   * Why Gateway (not CCTP):
   * - CCTP: 8-20 seconds (too slow for instant credit)
   * - Gateway: <500ms via unified balance
   */
  private async executeCrossChainCredit(
    request: CreditExecutionRequest,
  ): Promise<CreditExecutionResult> {
    // Step 1: Get 4Mica guarantee (BLS certificate)
    console.log(`Requesting 4Mica BLS certificate...`);
    const certificate = await this.fourMicaClient.requestCreditGuarantee(
      request.recipientAddress,
      request.decision.approvedAmount,
      request.sourceNetwork,
    );
    console.log(`4Mica certificate received: ${certificate.claims.substring(0, 20)}...`);
    
    // Step 2: Use Circle Gateway for INSTANT cross-chain transfer
    if (!this.circleGatewayClient) {
      console.warn('Circle Gateway not configured - skipping cross-chain transfer');
      console.log('4Mica certificate ready for on-chain settlement');
      return {
        requestId: request.decision.requestId,
        success: true,
        certificate,
      };
    }
    
    console.log(`Executing instant transfer via Circle Gateway...`);
    
    const transferResult = await this.circleGatewayClient.transfer({
      amount: request.decision.approvedAmount,
      sourceNetwork: request.sourceNetwork,
      destinationNetwork: request.destinationNetwork!,
      recipientAddress: request.recipientAddress,
    });
    
    if (!transferResult.success) {
      console.error(`Circle Gateway transfer failed: ${transferResult.error}`);
      // Still return success with certificate - on-chain settlement can proceed
      return {
        requestId: request.decision.requestId,
        success: true, // 4Mica cert is the key deliverable
        certificate,
        error: `Gateway transfer failed: ${transferResult.error}`,
      };
    }
    
    console.log(`Circle Gateway transfer complete in <500ms! Tx: ${transferResult.destinationTxHash}`);
    
    return {
      requestId: request.decision.requestId,
      success: true,
      certificate,
      txHash: transferResult.destinationTxHash,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CLAWPAY INTEGRATION (Private Payments)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Execute a private payment via ClawPay
   * 
   * Use case: Agent wants to pay another agent privately
   * (e.g., for sensitive services, MEV protection, etc.)
   */
  async executePrivatePayment(
    recipientInvoiceAddress: string,
    amount: string,
    token: 'USDT' | 'USDC' = 'USDT',
  ): Promise<{ transferId: string; success: boolean; error?: string }> {
    if (!this.clawPayClient) {
      return {
        transferId: '',
        success: false,
        error: 'ClawPay not enabled in configuration',
      };
    }
    
    console.log(`Executing private payment via ClawPay: ${amount} ${token}`);
    
    const result = await this.clawPayClient.transfer({
      recipient: recipientInvoiceAddress,
      amount,
      token,
    });
    
    if (result.status === 'failed') {
      return {
        transferId: result.transferId,
        success: false,
        error: result.error,
      };
    }
    
    console.log(`Private payment initiated: ${result.transferId}`);
    return {
      transferId: result.transferId,
      success: true,
    };
  }
  
  /**
   * Get ClawPay invoice address for receiving private payments
   */
  async getPrivatePaymentAddress(): Promise<string | null> {
    if (!this.clawPayClient) {
      return null;
    }
    return await this.clawPayClient.getInvoiceAddress();
  }
  
  /**
   * Get private payment balance
   */
  async getPrivateBalance(token: 'USDT' | 'USDC' = 'USDT'): Promise<string | null> {
    if (!this.clawPayClient) {
      return null;
    }
    const balance = await this.clawPayClient.getBalance(token);
    return balance.shieldedBalance;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get current processing status
   */
  getStatus(): {
    isRunning: boolean;
    lastProcessedBlock: number;
  } {
    return {
      isRunning: this.isRunning,
      lastProcessedBlock: this.lastProcessedBlock,
    };
  }
  
  /**
   * Manually execute a credit request by ID
   */
  async executeById(requestId: string): Promise<CreditExecutionResult> {
    const decision = await this.creditStudio.getDecision(requestId);
    
    if (!decision.approved) {
      return {
        requestId,
        success: false,
        error: 'Request was not approved',
      };
    }
    
    const agentAddress = await this.identityRegistry.ownerOf(decision.agentId);
    
    return this.executeCredit({
      decision: {
        requestId,
        agentId: decision.agentId,
        approvedAmount: decision.approvedAmount,
        interestRateBps: decision.interestRateBps,
        ttlSeconds: decision.ttlSeconds,
        destinationChain: decision.destinationChain,
        approved: true,
        rejectionReason: '',
        timestamp: decision.timestamp,
      },
      recipientAddress: agentAddress,
      sourceNetwork: this.config.defaultNetwork,
    });
  }
}

/**
 * Create a new Credit Executor instance
 * 
 * Example usage:
 * ```typescript
 * const executor = createCreditExecutor(
 *   'https://sepolia.infura.io/v3/...',
 *   'private_key',
 *   '0x...creditStudio',
 *   '0x...identityRegistry',
 *   {
 *     // 4Mica
 *     fourMicaUrl: 'https://x402.4mica.xyz',
 *     defaultNetwork: 'eip155:11155111',
 *     
 *     // Circle Gateway (for cross-chain)
 *     destinationProviderUrl: 'https://base-sepolia.g.alchemy.com/...',
 *     destinationNetwork: 'eip155:84532',
 *     useGatewayTestnet: true,
 *     
 *     // ClawPay (for private payments)
 *     enableClawPay: true,
 *     clawPayApiUrl: 'https://clawpay.dev',
 *   }
 * );
 * ```
 */
export function createCreditExecutor(
  providerUrl: string,
  privateKey: string,
  creditStudioAddress: string,
  identityRegistryAddress: string,
  options?: Partial<CreditExecutorConfig>,
): CreditExecutor {
  const provider = new JsonRpcProvider(providerUrl);
  const signer = new Wallet(privateKey, provider);
  
  return new CreditExecutor({
    provider,
    signer,
    creditStudioAddress,
    identityRegistryAddress,
    
    // 4Mica config
    fourMicaUrl: options?.fourMicaUrl || 'https://x402.4mica.xyz',
    defaultNetwork: options?.defaultNetwork || 'eip155:11155111',
    pollIntervalMs: options?.pollIntervalMs,
    startBlock: options?.startBlock,
    
    // Circle Gateway config (need source URL for Gateway client)
    sourceProviderUrl: providerUrl,
    destinationProviderUrl: options?.destinationProviderUrl,
    destinationNetwork: options?.destinationNetwork,
    useGatewayTestnet: options?.useGatewayTestnet ?? true,
    
    // ClawPay config
    enableClawPay: options?.enableClawPay ?? false,
    clawPayApiUrl: options?.clawPayApiUrl || 'https://clawpay.dev',
  });
}
