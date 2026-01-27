/**
 * Gateway Application
 * 
 * Bootstrap + lifecycle management.
 * 
 * Lifecycle:
 * - On startup: resume all RUNNING and STALLED workflows
 * - On shutdown: graceful cleanup (let in-flight txs reconcile on restart)
 */

// Load environment variables from .env file
import 'dotenv/config';

import express, { Express } from 'express';
import { Pool } from 'pg';

import { WorkflowEngine } from './workflows/engine.js';
import { WorkflowReconciler } from './workflows/reconciliation.js';
import { TxQueue } from './workflows/tx-queue.js';
import { createWorkSubmissionDefinition } from './workflows/work-submission.js';
import { createScoreSubmissionDefinition, DefaultScoreContractEncoder } from './workflows/score-submission.js';
import { createCloseEpochDefinition, DefaultEpochContractEncoder } from './workflows/close-epoch.js';
import { PostgresWorkflowPersistence } from './persistence/postgres/index.js';
import { EthersChainAdapter, StudioProxyEncoder } from './adapters/chain-adapter.js';
import { TurboArweaveAdapter, MockArweaveAdapter } from './adapters/arweave-adapter.js';
import { createRoutes, errorHandler } from './http/index.js';
import { createLogger, Logger } from './utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface GatewayConfig {
  // Server
  port: number;
  host: string;

  // Database
  databaseUrl: string;

  // Chain
  rpcUrl: string;
  chainId: number;
  confirmationBlocks: number;

  // Contracts (read-only, for validation/reconciliation)
  chaosCoreAddress: string;
  rewardsDistributorAddress: string;

  // Arweave (Turbo)
  turboGatewayUrl: string;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfigFromEnv(): GatewayConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/gateway',
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
    chainId: parseInt(process.env.CHAIN_ID ?? '11155111', 10), // Sepolia
    confirmationBlocks: parseInt(process.env.CONFIRMATION_BLOCKS ?? '2', 10),
    // ChaosChain contract addresses (Sepolia)
    chaosCoreAddress: process.env.CHAOS_CORE_ADDRESS ?? '0xF6a57f04a08e3b5cC3c12D71c66189a0c0A73378',
    rewardsDistributorAddress: process.env.REWARDS_DISTRIBUTOR_ADDRESS ?? '0x0549772a3fF4F095C57AEFf655B3ed97B7925C19',
    // Arweave Turbo gateway
    turboGatewayUrl: process.env.TURBO_GATEWAY_URL ?? 'https://arweave.net',
    logLevel: (process.env.LOG_LEVEL ?? 'info') as GatewayConfig['logLevel'],
  };
}

// =============================================================================
// GATEWAY APPLICATION
// =============================================================================

export class Gateway {
  private config: GatewayConfig;
  private logger: Logger;
  private app: Express;
  private pool: Pool;
  private engine: WorkflowEngine;
  private server?: ReturnType<Express['listen']>;
  private shutdownPromise?: Promise<void>;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.logger = createLogger({ level: config.logLevel, service: 'gateway' });
    this.app = express();
    this.pool = new Pool({ connectionString: config.databaseUrl });
    this.engine = null!; // Initialized in start()
  }

  /**
   * Start the Gateway.
   * 
   * 1. Initialize components
   * 2. Register workflow definitions
   * 3. Resume active workflows
   * 4. Start HTTP server
   */
  async start(): Promise<void> {
    this.logger.info({}, 'Starting Gateway...');

    // Initialize persistence
    const persistence = new PostgresWorkflowPersistence(this.pool);
    this.logger.info({}, 'Database connection established');

    // Initialize chain adapter with RewardsDistributor address for epoch management
    const chainAdapter = new EthersChainAdapter(
      await this.createProvider(),
      this.config.confirmationBlocks,
      2000, // pollIntervalMs
      this.config.rewardsDistributorAddress
    );
    this.logger.info(
      { rpcUrl: this.config.rpcUrl, rewardsDistributor: this.config.rewardsDistributorAddress },
      'Chain adapter initialized'
    );

    // Register signer from environment
    const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
    if (signerPrivateKey) {
      const { ethers } = await import('ethers');
      const wallet = new ethers.Wallet(signerPrivateKey, await this.createProvider());
      const signerAddress = await wallet.getAddress();
      chainAdapter.registerSigner(signerAddress.toLowerCase(), wallet);
      this.logger.info({ address: signerAddress }, 'Signer registered from SIGNER_PRIVATE_KEY');
    } else {
      this.logger.warn({}, 'No SIGNER_PRIVATE_KEY configured - workflows requiring tx submission will fail');
    }

    // Initialize tx queue
    const txQueue = new TxQueue(chainAdapter);

    // Initialize arweave adapter
    // For local testing, set USE_MOCK_ARWEAVE=true to use in-memory mock
    const useMockArweave = process.env.USE_MOCK_ARWEAVE === 'true';
    const arweaveAdapter = useMockArweave
      ? new MockArweaveAdapter({ uploadDelay: 0, confirmationDelay: 100 })
      : new TurboArweaveAdapter(this.config.turboGatewayUrl);
    this.logger.info(
      { gateway: this.config.turboGatewayUrl, mock: useMockArweave },
      useMockArweave ? 'Arweave adapter initialized (MOCK)' : 'Arweave adapter initialized (Turbo)'
    );

    // Initialize reconciler
    const reconciler = new WorkflowReconciler(chainAdapter, arweaveAdapter, txQueue);

    // Initialize engine
    this.engine = new WorkflowEngine(persistence, reconciler);

    // Register all workflow definitions
    const studioEncoder = new StudioProxyEncoder();
    const scoreEncoder = new DefaultScoreContractEncoder();
    const epochEncoder = new DefaultEpochContractEncoder();

    // 1. WorkSubmission workflow
    const workSubmissionDef = createWorkSubmissionDefinition(
      arweaveAdapter,
      txQueue,
      persistence,
      studioEncoder
    );
    this.engine.registerWorkflow(workSubmissionDef);
    this.logger.info({}, 'WorkSubmission workflow registered');

    // 2. ScoreSubmission workflow
    const scoreSubmissionDef = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreEncoder,
      chainAdapter as any // ChainStateAdapter for score queries
    );
    this.engine.registerWorkflow(scoreSubmissionDef);
    this.logger.info({}, 'ScoreSubmission workflow registered');

    // 3. CloseEpoch workflow
    const closeEpochDef = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      chainAdapter as any // EpochChainStateAdapter
    );
    this.engine.registerWorkflow(closeEpochDef);
    this.logger.info({}, 'CloseEpoch workflow registered');

    // Subscribe to engine events for logging
    this.engine.onEvent((event) => {
      const ctx = { workflowId: 'workflowId' in event ? event.workflowId : undefined };
      
      switch (event.type) {
        case 'WORKFLOW_CREATED':
          this.logger.info(ctx, 'Workflow created');
          break;
        case 'WORKFLOW_STARTED':
          this.logger.info(ctx, 'Workflow started');
          break;
        case 'STEP_STARTED':
          this.logger.info({ ...ctx, step: event.step }, 'Step started');
          break;
        case 'STEP_COMPLETED':
          this.logger.info({ ...ctx, step: event.step, nextStep: event.nextStep }, 'Step completed');
          break;
        case 'STEP_RETRY':
          this.logger.warn({ ...ctx, step: event.step, attempt: event.attempt, error: event.error.message }, 'Step retry');
          break;
        case 'WORKFLOW_STALLED':
          this.logger.warn({ ...ctx, reason: event.reason }, 'Workflow stalled');
          break;
        case 'WORKFLOW_FAILED':
          this.logger.error({ ...ctx, error: event.error }, 'Workflow failed');
          break;
        case 'WORKFLOW_COMPLETED':
          this.logger.info(ctx, 'Workflow completed');
          break;
        case 'RECONCILIATION_RAN':
          if (event.changed) {
            this.logger.info(ctx, 'Reconciliation changed state');
          }
          break;
      }
    });

    // Resume active workflows (startup reconciliation)
    this.logger.info({}, 'Resuming active workflows...');
    await this.engine.reconcileAllActive();
    this.logger.info({}, 'Active workflows resumed');

    // Setup HTTP server
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(createRoutes(this.engine, persistence, this.logger));
    this.app.use(errorHandler(this.logger));

    // Start listening
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(this.config.port, this.config.host, () => {
        this.logger.info(
          { port: this.config.port, host: this.config.host },
          'Gateway HTTP server started'
        );
        resolve();
      });
    });

    // Setup shutdown handlers
    this.setupShutdownHandlers();

    this.logger.info({}, 'Gateway started successfully');
  }

  /**
   * Stop the Gateway gracefully.
   * 
   * - Stop accepting new requests
   * - Let in-flight operations complete (with timeout)
   * - Close database connections
   * 
   * Note: In-flight txs will be reconciled on next startup.
   */
  async stop(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.doStop();
    return this.shutdownPromise;
  }

  private async doStop(): Promise<void> {
    this.logger.info({}, 'Stopping Gateway...');

    // Stop HTTP server
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.logger.info({}, 'HTTP server stopped');
    }

    // Close database pool
    await this.pool.end();
    this.logger.info({}, 'Database connections closed');

    this.logger.info({}, 'Gateway stopped');
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info({ signal }, 'Received shutdown signal');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  private async createProvider(): Promise<any> {
    // Dynamic import to avoid issues if ethers isn't loaded
    const { ethers } = await import('ethers');
    return new ethers.JsonRpcProvider(this.config.rpcUrl);
  }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

export async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const gateway = new Gateway(config);
  await gateway.start();
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
