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
import { 
  createScoreSubmissionDefinition, 
  DefaultScoreContractEncoder, 
  DefaultDirectScoreContractEncoder,
  DefaultValidatorRegistrationEncoder 
} from './workflows/score-submission.js';
import { createCloseEpochDefinition, DefaultEpochContractEncoder } from './workflows/close-epoch.js';
import { PostgresWorkflowPersistence } from './persistence/postgres/index.js';
import { EthersChainAdapter, StudioProxyEncoder, DefaultRewardsDistributorEncoder } from './adapters/chain-adapter.js';
import { TurboArweaveAdapter, MockArweaveAdapter } from './adapters/arweave-adapter.js';
import { createRoutes, errorHandler, apiKeyAuth, parseApiKeys, rateLimit, InMemoryRateLimiter } from './http/index.js';
import { createPublicApiRoutes } from './routes/public-api.js';
import { ReputationReader } from './services/reputation-reader.js';
import { WorkDataReader } from './services/work-data-reader.js';
import {
  trackWorkflowCreated,
  trackWorkflowCompleted,
  trackWorkflowFailed,
  startMetricsServer,
} from './metrics/index.js';
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

  // ERC-8004 registries (read-only, for public API)
  identityRegistryAddress: string;
  reputationRegistryAddress: string;

  // Arweave (Turbo)
  turboGatewayUrl: string;

  // Admin signer (owner of RewardsDistributor, signs registerWork/registerValidator)
  adminSignerAddress?: string;

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
    // ChaosChain contract addresses (Sepolia) - v0.4.31 ERC-8004 Feb 2026 ABI
    chaosCoreAddress: process.env.CHAOS_CORE_ADDRESS ?? '0x92cBc471D8a525f3Ffb4BB546DD8E93FC7EE67ca',
    rewardsDistributorAddress: process.env.REWARDS_DISTRIBUTOR_ADDRESS ?? '0x4bd7c3b53474Ba5894981031b5a9eF70CEA35e53',
    // ERC-8004 registries (Base Sepolia official deployments)
    identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS ?? '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistryAddress: process.env.REPUTATION_REGISTRY_ADDRESS ?? '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    // Arweave Turbo gateway
    turboGatewayUrl: process.env.TURBO_GATEWAY_URL ?? 'https://arweave.net',
    logLevel: (process.env.LOG_LEVEL ?? 'info') as GatewayConfig['logLevel'],
    // Admin signer (optional, but required for full functionality)
    adminSignerAddress: process.env.ADMIN_SIGNER_ADDRESS || undefined,
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
  private metricsServer?: import('http').Server;
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

    // Register signers from environment
    const { ethers } = await import('ethers');
    const provider = await this.createProvider();
    
    // Primary signer
    const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
    if (signerPrivateKey) {
      const wallet = new ethers.Wallet(signerPrivateKey, provider);
      const signerAddress = await wallet.getAddress();
      chainAdapter.registerSigner(signerAddress.toLowerCase(), wallet);
      this.logger.info({ address: signerAddress }, 'Signer registered from SIGNER_PRIVATE_KEY');
    } else {
      this.logger.warn({}, 'No SIGNER_PRIVATE_KEY configured - workflows requiring tx submission will fail');
    }
    
    // Additional signers (SIGNER_PRIVATE_KEY_2, SIGNER_PRIVATE_KEY_3, etc.)
    for (let i = 2; i <= 10; i++) {
      const additionalKey = process.env[`SIGNER_PRIVATE_KEY_${i}`];
      if (additionalKey) {
        const wallet = new ethers.Wallet(additionalKey, provider);
        const signerAddress = await wallet.getAddress();
        chainAdapter.registerSigner(signerAddress.toLowerCase(), wallet);
        this.logger.info({ address: signerAddress }, `Signer registered from SIGNER_PRIVATE_KEY_${i}`);
      }
    }

    if (this.config.adminSignerAddress) {
      this.logger.info({ address: this.config.adminSignerAddress }, 'Admin signer configured for RewardsDistributor operations');
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
    const epochEncoder = new DefaultEpochContractEncoder();
    const rewardsDistributorEncoder = new DefaultRewardsDistributorEncoder();

    // 1. WorkSubmission workflow (now includes REGISTER_WORK step)
    const workSubmissionDef = createWorkSubmissionDefinition(
      arweaveAdapter,
      txQueue,
      persistence,
      studioEncoder,
      rewardsDistributorEncoder,
      this.config.rewardsDistributorAddress,
      this.config.adminSignerAddress
    );
    this.engine.registerWorkflow(workSubmissionDef);
    this.logger.info(
      { rewardsDistributor: this.config.rewardsDistributorAddress },
      'WorkSubmission workflow registered (with REGISTER_WORK step)'
    );

    // 2. ScoreSubmission workflow (supports BOTH direct and commit-reveal modes)
    const validatorEncoder = new DefaultValidatorRegistrationEncoder(
      this.config.rewardsDistributorAddress
    );
    const directScoreEncoder = new DefaultDirectScoreContractEncoder();
    const commitRevealScoreEncoder = new DefaultScoreContractEncoder();
    
    const scoreSubmissionDef = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      chainAdapter as any, // ChainStateAdapter for score queries
      {
        directEncoder: directScoreEncoder,           // For direct mode (default, MVP)
        commitRevealEncoder: commitRevealScoreEncoder, // For commit-reveal mode (available)
        validatorEncoder,                            // For REGISTER_VALIDATOR step (both modes)
      },
      this.config.adminSignerAddress
    );
    this.engine.registerWorkflow(scoreSubmissionDef);
    this.logger.info(
      { rewardsDistributor: this.config.rewardsDistributorAddress },
      'ScoreSubmission workflow registered (direct + commit-reveal modes, with REGISTER_VALIDATOR step)'
    );

    // 3. CloseEpoch workflow
    const closeEpochDef = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      chainAdapter as any // EpochChainStateAdapter
    );
    this.engine.registerWorkflow(closeEpochDef);
    this.logger.info({}, 'CloseEpoch workflow registered');

    // Subscribe to engine events for logging + metrics
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
          trackWorkflowFailed(event.workflowId);
          break;
        case 'WORKFLOW_COMPLETED':
          this.logger.info(ctx, 'Workflow completed');
          trackWorkflowCompleted(event.workflowId);
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

    // Rate limiting (in-memory, per-IP)
    const readLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 60 });
    const writeLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 30 });

    // API key auth for write endpoints
    const apiKeys = parseApiKeys(process.env.CHAOSCHAIN_API_KEYS);
    if (apiKeys.size > 0) {
      this.app.post('/workflows/*', apiKeyAuth({ keys: apiKeys }));
      this.logger.info({ count: apiKeys.size }, 'API key auth enabled for write endpoints');
    } else {
      this.logger.warn({}, 'No CHAOSCHAIN_API_KEYS configured — write endpoints are unauthenticated');
    }

    // Write endpoint rate limiting (POST /workflows/*)
    this.app.post('/workflows/*', rateLimit(writeLimiter));

    // Workflow routes
    this.app.use(createRoutes(this.engine, persistence, this.logger));

    // Public read API (rate limited, no auth)
    const reputationReader = new ReputationReader({
      provider: await this.createProvider(),
      identityRegistryAddress: this.config.identityRegistryAddress,
      reputationRegistryAddress: this.config.reputationRegistryAddress,
    });
    const workDataReader = new WorkDataReader(
      persistence as any,
    );
    this.app.use(
      rateLimit(readLimiter),
      createPublicApiRoutes({
        reputationReader,
        workDataReader,
        network: process.env.NETWORK_NAME ?? 'base-sepolia',
        identityRegistryAddress: this.config.identityRegistryAddress,
        reputationRegistryAddress: this.config.reputationRegistryAddress,
      }),
    );

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

    // Start internal metrics server (Prometheus /metrics)
    const metricsPort = parseInt(process.env.METRICS_PORT ?? '9090', 10);
    this.metricsServer = startMetricsServer(metricsPort);
    this.logger.info({ port: metricsPort }, 'Internal metrics server started (Prometheus /metrics)');

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

    // Stop metrics server
    if (this.metricsServer) {
      this.metricsServer.close();
      this.logger.info({}, 'Metrics server stopped');
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
