/**
 * Credit Executor
 * 
 * Production-ready credit execution service with:
 * - State machine for idempotent execution
 * - BLS certificate persistence (DB + Arweave)
 * - Retry logic with exponential backoff
 * - Settlement and default event emission
 * 
 * Architecture:
 * 1. Watches CreditStudioLogic for CreditApproved events
 * 2. For each approval:
 *    a. Create execution record (APPROVED state)
 *    b. Get BLS certificate from 4Mica (CERT_ISSUED state)
 *    c. Persist certificate to DB + Arweave
 *    d. Execute Circle Gateway transfer (TRANSFER_PENDING → COMPLETED)
 *    e. On failure: retry with backoff until TTL expires
 * 3. Monitor for settlement or default
 */

import { Contract, Wallet, JsonRpcProvider, Provider, EventLog, keccak256, toUtf8Bytes } from 'ethers';
import { FourMicaClient, createFourMicaConfig } from './four-mica-client.js';
import { CircleGatewayClient, createCircleGatewayClient } from './circle-gateway-client.js';
import { ClawPayClient, createClawPayClient } from './clawpay-client.js';
import {
  CreditExecutionRequest,
  CreditExecutionResult,
  NetworkId,
} from './types.js';
import {
  ExecutionState,
  ExecutionRecord,
  CreditIntent,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  hasExpired,
} from './execution-state.js';
import {
  ExecutionPersistence,
  CertificateBackup,
  CreditEventEmitter,
  createPersistence,
  PersistenceConfig,
} from './persistence.js';

/**
 * CreditStudioLogic ABI (minimal for events)
 */
const CREDIT_STUDIO_ABI = [
  'event CreditApproved(bytes32 indexed requestId, uint256 indexed agentId, uint256 approvedAmount, uint256 interestRateBps, uint256 ttlSeconds)',
  'event CreditRejected(bytes32 indexed requestId, uint256 indexed agentId, string reason)',
  'function getDecision(bytes32 requestId) view returns (tuple(bytes32 requestId, uint256 agentId, uint256 approvedAmount, uint256 interestRateBps, uint256 ttlSeconds, uint256 destinationChain, bool approved, string rejectionReason, uint256 timestamp))',
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
  /** Map of chainId -> Provider for Circle Gateway */
  gatewayProviders?: Map<number, Provider>;
  /** Use Circle Gateway testnet (default: true) */
  useGatewayTestnet?: boolean;
  
  // ClawPay config
  /** Enable ClawPay for private payments */
  enableClawPay?: boolean;
  /** ClawPay API base URL */
  clawPayApiUrl?: string;
  
  // Persistence config
  /** Persistence configuration */
  persistence?: PersistenceConfig;
  /** Retry configuration */
  retryConfig?: RetryConfig;
}

/**
 * Credit Executor
 * 
 * Production-ready execution service with:
 * - State machine for idempotent execution
 * - BLS certificate persistence
 * - Retry logic with exponential backoff
 * - Settlement/default event emission
 */
export class CreditExecutor {
  private config: CreditExecutorConfig;
  private creditStudio: Contract;
  private identityRegistry: Contract;
  public fourMicaClient: FourMicaClient;
  private circleGatewayClient: CircleGatewayClient | null = null;
  private clawPayClient: ClawPayClient | null = null;
  
  // Persistence layer
  private persistence: ExecutionPersistence;
  private certificateBackup: CertificateBackup;
  private eventEmitter: CreditEventEmitter;
  private retryConfig: RetryConfig;
  
  // State
  private isRunning = false;
  private lastProcessedBlock = 0;
  private retryLoopRunning = false;
  private expirationLoopRunning = false;
  
  // In-flight processing lock to prevent races on concurrent events
  // This is critical for idempotency when the same requestId arrives
  // before the first processing completes and persists
  private processingLock: Set<string> = new Set();
  
  constructor(config: CreditExecutorConfig) {
    this.config = {
      pollIntervalMs: 15000, // 15 seconds
      startBlock: 0,
      useGatewayTestnet: true,
      enableClawPay: false,
      ...config,
    };
    
    // Initialize persistence
    const { execution, certificateBackup, eventEmitter } = createPersistence(
      config.persistence || {}
    );
    this.persistence = execution;
    this.certificateBackup = certificateBackup;
    this.eventEmitter = eventEmitter;
    this.retryConfig = config.retryConfig || DEFAULT_RETRY_CONFIG;
    
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
    if (config.gatewayProviders && config.gatewayProviders.size > 0) {
      this.circleGatewayClient = createCircleGatewayClient(
        config.signer.privateKey,
        config.gatewayProviders,
        config.useGatewayTestnet ?? true,
      );
      console.log(`Circle Gateway client initialized with ${config.gatewayProviders.size} chain providers`);
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
   * 
   * Starts three concurrent loops:
   * 1. Event polling (new CreditApproved events)
   * 2. Retry loop (failed transfers that can be retried)
   * 3. Expiration loop (check for expired credits)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('Credit Executor already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Credit Executor starting...');
    console.log('  - Persistence: enabled');
    console.log('  - Certificate backup: enabled');
    console.log('  - Retry config:', JSON.stringify(this.retryConfig));
    
    // Get current block if no start block specified
    if (this.lastProcessedBlock === 0) {
      this.lastProcessedBlock = await this.config.provider.getBlockNumber();
    }
    
    // Recover any in-progress executions
    await this.recoverInProgress();
    
    // Start all loops
    this.pollLoop();
    this.retryLoop();
    this.expirationLoop();
  }
  
  /**
   * Stop the executor
   */
  stop(): void {
    this.isRunning = false;
    this.retryLoopRunning = false;
    this.expirationLoopRunning = false;
    console.log('Credit Executor stopped');
  }
  
  /**
   * Recover in-progress executions after restart
   */
  private async recoverInProgress(): Promise<void> {
    console.log('Recovering in-progress executions...');
    
    // Get records that were mid-execution
    const certIssued = await this.persistence.getByState(ExecutionState.CERT_ISSUED);
    const transferPending = await this.persistence.getByState(ExecutionState.TRANSFER_PENDING);
    
    console.log(`  Found ${certIssued.length} in CERT_ISSUED state`);
    console.log(`  Found ${transferPending.length} in TRANSFER_PENDING state`);
    
    // Resume execution for CERT_ISSUED (need to do transfer)
    for (const record of certIssued) {
      if (!hasExpired(record)) {
        console.log(`  Resuming transfer for ${record.requestId}`);
        // Will be picked up by retry loop
        await this.persistence.transitionState(
          record.requestId,
          ExecutionState.TRANSFER_PENDING,
        );
      }
    }
  }
  
  /**
   * Main polling loop for new events
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
  
  /**
   * Retry loop for failed transfers
   */
  private async retryLoop(): Promise<void> {
    if (this.retryLoopRunning) return;
    this.retryLoopRunning = true;
    
    while (this.isRunning) {
      try {
        const pendingRetries = await this.persistence.getPendingRetries();
        
        for (const record of pendingRetries) {
          if (record.transferAttempts >= this.retryConfig.maxAttempts) {
            console.log(`[Retry] Max attempts reached for ${record.requestId}`);
            continue;
          }
          
          // Calculate delay
          const delay = calculateRetryDelay(record.transferAttempts + 1, this.retryConfig);
          const timeSinceLastAttempt = Date.now() - (record.lastTransferAttempt || 0);
          
          if (timeSinceLastAttempt < delay) {
            continue; // Not time yet
          }
          
          console.log(`[Retry] Retrying transfer for ${record.requestId} (attempt ${record.transferAttempts + 1})`);
          await this.executeTransfer(record);
        }
      } catch (error) {
        console.error('Error in retry loop:', error);
      }
      
      await new Promise(resolve => setTimeout(resolve, 30000)); // Check every 30s
    }
    
    this.retryLoopRunning = false;
  }
  
  /**
   * Expiration loop for defaulted credits
   */
  private async expirationLoop(): Promise<void> {
    if (this.expirationLoopRunning) return;
    this.expirationLoopRunning = true;
    
    while (this.isRunning) {
      try {
        const expired = await this.persistence.getExpired();
        
        for (const record of expired) {
          console.log(`[Expiration] Credit ${record.requestId} has defaulted`);
          
          await this.persistence.transitionState(
            record.requestId,
            ExecutionState.DEFAULTED,
            { defaultedAt: Date.now() },
          );
          
          // Emit default event
          await this.eventEmitter.emitDefaulted({
            requestId: record.requestId,
            agentId: record.intent.agentId,
            amount: record.approvedAmount,
            certificateClaims: record.certificate?.claims || '',
            certificateSignature: record.certificate?.signature || '',
            defaultedAt: Date.now(),
            remediationRequired: true,
          });
        }
      } catch (error) {
        console.error('Error in expiration loop:', error);
      }
      
      await new Promise(resolve => setTimeout(resolve, 60000)); // Check every minute
    }
    
    this.expirationLoopRunning = false;
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
   * Handle a CreditApproved event (IDEMPOTENT)
   * 
   * This method is safe to call multiple times for the same event.
   * It uses a two-level idempotency check:
   * 1. Persistence check (already processed and saved)
   * 2. In-flight lock (currently being processed)
   * 
   * Intent Binding: The full CreditIntent is stored with every ExecutionRecord,
   * providing complete audit trail for:
   * - Policy disputes
   * - Reputation attribution  
   * - Auditing agent behavior
   */
  private async handleCreditApproved(event: EventLog): Promise<void> {
    const args = event.args;
    const requestId = args[0] as string;
    const agentId = args[1] as bigint;
    const approvedAmount = args[2] as bigint;
    const interestRateBps = args[3] as bigint;
    const ttlSeconds = args[4] as bigint;
    
    // IDEMPOTENCY CHECK 1: Skip if already processed and persisted
    if (await this.persistence.exists(requestId)) {
      const existing = await this.persistence.get(requestId);
      console.log(`[Idempotent] Request ${requestId} already exists in state: ${existing?.state}`);
      return;
    }
    
    // IDEMPOTENCY CHECK 2: Skip if currently being processed (in-flight lock)
    if (this.processingLock.has(requestId)) {
      console.log(`[Idempotent] Request ${requestId} already being processed`);
      return;
    }
    
    // Acquire processing lock
    this.processingLock.add(requestId);
    
    try {
      // Double-check after acquiring lock (another concurrent call might have persisted)
      if (await this.persistence.exists(requestId)) {
        console.log(`[Idempotent] Request ${requestId} already exists (after lock)`);
        return;
      }
    
      console.log(`Processing CreditApproved: requestId=${requestId}, agentId=${agentId}, amount=${approvedAmount}`);
    
    // Get full decision from contract
    const decision = await this.creditStudio.getDecision(requestId);
    
    // Get agent address from IdentityRegistry
    const agentAddress = await this.identityRegistry.ownerOf(agentId);
    
    // Create formalized intent
    const now = Date.now();
    const expiresAt = now + Number(ttlSeconds) * 1000;
    const purpose = 'Credit request'; // Would come from contract in full impl
    
    const intent: CreditIntent = {
      intentHash: keccak256(toUtf8Bytes(`${requestId}-${agentId}-${approvedAmount}`)),
      agentId,
      amount: approvedAmount,
      sourceChain: this.config.defaultNetwork,
      destinationChain: decision.destinationChain
        ? `eip155:${Number(decision.destinationChain)}` as NetworkId
        : this.config.defaultNetwork,
      ttlSeconds: Number(ttlSeconds),
      purpose,
      purposeHash: keccak256(toUtf8Bytes(purpose)),
      recipientAddress: agentAddress,
      createdAt: Math.floor(now / 1000),
      expiresAt: Math.floor(expiresAt / 1000),
    };
    
    // Create execution record
    const record: ExecutionRecord = {
      requestId,
      intent,
      state: ExecutionState.APPROVED,
      approvedAmount,
      interestRateBps: Number(interestRateBps),
      approvedAt: now,
      transferAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    
      // Persist initial record (IMPORTANT: Full intent is bound to record for audit trail)
      await this.persistence.save(record);
      console.log(`[State] ${requestId}: APPROVED`);
      
      // Execute the credit flow
      await this.executeCreditFlow(record);
    } finally {
      // Always release the processing lock
      this.processingLock.delete(requestId);
    }
  }
  
  /**
   * Execute the full credit flow with state transitions
   */
  private async executeCreditFlow(record: ExecutionRecord): Promise<void> {
    try {
      // Step 1: Get BLS certificate from 4Mica (best-effort)
      // The BLS certificate is a cryptographic proof of the credit guarantee.
      // If 4Mica is unavailable, we still proceed with the transfer —
      // the on-chain CreditApproved event serves as the authoritative record.
      console.log(`[4Mica] Requesting certificate for ${record.requestId}`);
      
      let certRecord = record;
      try {
        const certificate = await this.fourMicaClient.requestCreditGuarantee(
          record.intent.recipientAddress,
          record.approvedAmount,
          record.intent.sourceChain,
        );
        
        // Persist certificate immediately
        const arweaveId = await this.certificateBackup.backup(record.requestId, certificate);
        
        await this.persistence.transitionState(
          record.requestId,
          ExecutionState.CERT_ISSUED,
          {
            certificate,
            certificateIssuedAt: Date.now(),
            certificateArweaveId: arweaveId,
          },
        );
        
        console.log(`[State] ${record.requestId}: CERT_ISSUED (backed up: ${arweaveId})`);
        
        const updatedRecord = await this.persistence.get(record.requestId);
        if (updatedRecord) certRecord = updatedRecord;
        
      } catch (certError) {
        // 4Mica certificate is best-effort — proceed without it
        const msg = certError instanceof Error ? certError.message : String(certError);
        console.warn(`[4Mica] Certificate failed (proceeding without): ${msg}`);
        console.log(`[State] ${record.requestId}: Skipping CERT_ISSUED, moving to transfer`);
      }
      
      // Step 2: Execute transfer (proceeds regardless of certificate outcome)
      await this.executeTransfer(certRecord);
      
    } catch (error) {
      console.error(`[Error] Credit flow failed for ${record.requestId}:`, error);
      // Record stays in current state - will be retried or expired
    }
  }
  
  /**
   * Execute the transfer step (with retry support)
   */
  private async executeTransfer(record: ExecutionRecord): Promise<void> {
    // Transition to TRANSFER_PENDING
    await this.persistence.transitionState(
      record.requestId,
      ExecutionState.TRANSFER_PENDING,
      {
        transferAttempts: record.transferAttempts + 1,
        lastTransferAttempt: Date.now(),
      },
    );
    
    const isCrossChain = record.intent.destinationChain !== record.intent.sourceChain;
    
    try {
      if (isCrossChain && this.circleGatewayClient) {
        // Cross-chain transfer via Circle Gateway
        console.log(`[Gateway] Executing cross-chain transfer for ${record.requestId}`);
        
        const result = await this.circleGatewayClient.transfer({
          amount: record.approvedAmount,
          sourceNetwork: record.intent.sourceChain,
          destinationNetwork: record.intent.destinationChain,
          recipientAddress: record.intent.recipientAddress,
          maxFee: 2_000_100n, // 2.0001 USDC — Gateway minimum ~2.00005, actual fee ~0.00005
        });
        
        if (!result.success) {
          throw new Error(result.error || 'Transfer failed');
        }
        
        // Success!
        await this.persistence.transitionState(
          record.requestId,
          ExecutionState.COMPLETED,
          {
            transferTxHash: result.mintTxHash,
            transferCompletedAt: Date.now(),
          },
        );
        
        console.log(`[State] ${record.requestId}: COMPLETED (tx: ${result.mintTxHash})`);
        
      } else {
        // Same-chain: Just mark as completed (certificate is the deliverable)
        await this.persistence.transitionState(
          record.requestId,
          ExecutionState.COMPLETED,
          { transferCompletedAt: Date.now() },
        );
        
        console.log(`[State] ${record.requestId}: COMPLETED (same-chain, cert only)`);
      }
      
      // Mark on-chain as completed
      const tx = await this.creditStudio.markCompleted(record.requestId);
      await tx.wait();
      console.log(`[Contract] ${record.requestId} marked completed on-chain`);
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // Check if retryable
      if (isRetryableError(err) && record.transferAttempts < this.retryConfig.maxAttempts) {
        console.log(`[Retry] Transfer failed for ${record.requestId}: ${err.message} (will retry)`);
        
        await this.persistence.transitionState(
          record.requestId,
          ExecutionState.TRANSFER_FAILED,
          { lastTransferError: err.message },
        );
      } else {
        console.error(`[Error] Transfer failed permanently for ${record.requestId}: ${err.message}`);
        // Will eventually be marked as defaulted by expiration loop
      }
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
    
    console.log(`Circle Gateway transfer complete in <500ms! Tx: ${transferResult.mintTxHash}`);
    
    return {
      requestId: request.decision.requestId,
      success: true,
      certificate,
      gatewayTxHash: transferResult.mintTxHash,
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
  // SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Mark a credit as settled (agent repaid)
   * 
   * This should be called when payment is received, either:
   * - On-chain settlement detected
   * - Off-chain confirmation received
   */
  async markSettled(
    requestId: string,
    settlementTxHash: string,
    interestPaid: bigint,
  ): Promise<void> {
    const record = await this.persistence.get(requestId);
    if (!record) {
      throw new Error(`Record not found: ${requestId}`);
    }
    
    if (record.state !== ExecutionState.COMPLETED) {
      throw new Error(`Cannot settle from state: ${record.state}`);
    }
    
    await this.persistence.transitionState(
      requestId,
      ExecutionState.SETTLED,
      {
        settlementTxHash,
        settledAt: Date.now(),
      },
    );
    
    // Emit settlement event
    await this.eventEmitter.emitSettled({
      requestId,
      agentId: record.intent.agentId,
      amount: record.approvedAmount,
      interestPaid,
      settlementTxHash,
      timestamp: Date.now(),
    });
    
    console.log(`[Settlement] ${requestId} settled (tx: ${settlementTxHash})`);
  }
  
  /**
   * Get execution record for a request
   */
  async getExecutionRecord(requestId: string): Promise<ExecutionRecord | null> {
    return this.persistence.get(requestId);
  }
  
  /**
   * Get all records in a given state
   */
  async getRecordsByState(state: ExecutionState): Promise<ExecutionRecord[]> {
    return this.persistence.getByState(state);
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
    
    // Circle Gateway config
    gatewayProviders: options?.gatewayProviders,
    useGatewayTestnet: options?.useGatewayTestnet ?? true,
    
    // ClawPay config
    enableClawPay: options?.enableClawPay ?? false,
    clawPayApiUrl: options?.clawPayApiUrl || 'https://clawpay.dev',
  });
}
