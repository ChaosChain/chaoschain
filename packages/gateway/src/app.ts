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

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express, { Express } from 'express';
import { Pool } from 'pg';

import { WorkflowEngine } from './workflows/engine.js';
import { NoOpReconciler } from './workflows/reconciliation.js';
import { createWorkSubmissionDefinition } from './workflows/work-submission.js';
import { createScoreSubmissionDefinition } from './workflows/score-submission.js';
import { PostgresWorkflowPersistence, runMigrations } from './persistence/postgres/index.js';
import { EpochCounter } from './services/epoch-counter.js';
import { createRoutes, errorHandler, apiKeyAuth, rateLimit, InMemoryRateLimiter } from './http/index.js';
import { createPublicApiRoutes } from './routes/public-api.js';
import { ApiKeyStore, createAdminRoutes } from './routes/admin-api.js';
import { SessionStore, createSessionRoutes } from './sessions/index.js';
import { WorkDataReader } from './services/work-data-reader.js';
import {
  trackWorkflowCompleted,
  trackWorkflowFailed,
  startMetricsServer,
} from './metrics/index.js';
import { createLogger, Logger } from './utils/index.js';
import { computeDKG } from './services/dkg/index.js';
import { createWorkSubmissionWorkflow } from './workflows/work-submission.js';
import type { EvidencePackage as DKGEvidencePackage } from './services/dkg/types.js';


// =============================================================================
// CONFIGURATION
// =============================================================================

export interface GatewayConfig {
  // Server
  port: number;
  host: string;

  // Database
  databaseUrl: string;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Restart / deploy safety
  runningWorkflowResumeMinAgeMs: number;
  shutdownDrainTimeoutMs: number;
}

export function loadConfigFromEnv(): GatewayConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/gateway',
    logLevel: (process.env.LOG_LEVEL ?? 'info') as GatewayConfig['logLevel'],
    runningWorkflowResumeMinAgeMs: parseInt(process.env.RUNNING_WORKFLOW_RESUME_MIN_AGE_MS ?? '180000', 10),
    shutdownDrainTimeoutMs: parseInt(process.env.SHUTDOWN_DRAIN_TIMEOUT_MS ?? '120000', 10),
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
  private shuttingDown = false;

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

    // Run database migrations (idempotent — safe on every startup)
    this.logger.info({}, 'Running database migrations...');
    await runMigrations(this.pool);
    this.logger.info({}, 'Database schema ready');

    // Initialize persistence
    const persistence = new PostgresWorkflowPersistence(this.pool);
    this.logger.info({}, 'Database connection established');

    // OFF-CHAIN FIRST: No chain adapter, no signers, no TxQueue, no Arweave.
    // All workflows complete via Postgres persistence only.
    const reconciler = new NoOpReconciler();
    this.engine = new WorkflowEngine(persistence, reconciler);

    // 1. WorkSubmission workflow (off-chain: DKG → evidence no-op → COMPLETED)
    const workSubmissionDef = createWorkSubmissionDefinition(persistence);
    this.engine.registerWorkflow(workSubmissionDef);
    this.logger.info({}, 'WorkSubmission workflow registered (off-chain)');

    // 2. ScoreSubmission workflow (off-chain: persist score → COMPLETED)
    const scoreSubmissionDef = createScoreSubmissionDefinition(persistence);
    this.engine.registerWorkflow(scoreSubmissionDef);
    this.logger.info({}, 'ScoreSubmission workflow registered (off-chain)');

    // TODO: Re-enable CloseEpoch as async settlement worker when needed.
    // CloseEpoch is an operator-triggered on-chain action not in the product path.

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

    // Setup HTTP server (MUST happen before workflow reconciliation so /health is available)
    this.app.use(express.json({ limit: '10mb' }));

    // During shutdown, reject new write traffic while allowing reads/health checks
    // to continue until the deployment is fully drained.
    this.app.use((req, res, next) => {
      if (!this.shuttingDown) {
        next();
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        next();
        return;
      }

      res.setHeader('Connection', 'close');
      res.status(503).json({
        error: 'Gateway is shutting down',
        code: 'SHUTTING_DOWN',
      });
    });

    // Root landing page
    this.app.get('/', (_req, res) => {
      res.json({
        name: 'ChaosChain Gateway',
        version: '1.0',
        status: 'ok',
        docs: 'https://github.com/ChaosChain/chaoschain/blob/main/docs/VERIFIER_INTEGRATION_GUIDE.md',
        endpoints: {
          health: '/health',
          reputation: '/v1/agent/:id/reputation',
          pendingWork: '/v1/studio/:address/work?status=pending',
          workDetails: '/v1/work/:hash',
          evidence: '/v1/work/:hash/evidence',
          skills: '/v1/skills',
          skillFiles: '/skills/engineering-studio/SKILL.md',
          sessions: {
            create: 'POST /v1/sessions',
            appendEvents: 'POST /v1/sessions/:id/events',
            complete: 'POST /v1/sessions/:id/complete',
            context: 'GET /v1/sessions/:id/context',
            viewer: 'GET /v1/sessions/:id/viewer',
            evidence: 'GET /v1/sessions/:id/evidence',
          },
        },
      });
    });

    // Serve agent skill files as static assets (public, no auth)
    const appFileUrl = fileURLToPath(import.meta.url);
    const skillsDir =
      process.env.SKILLS_DIR ? resolve(process.env.SKILLS_DIR) : resolve(dirname(appFileUrl), '../../../chaoschain-skills');
    this.app.use('/skills', express.static(skillsDir));
    this.logger.info({ path: skillsDir }, 'Skill files mounted at /skills');

    // Initialize API key store (Postgres-backed with in-memory cache)
    const keyStore = new ApiKeyStore(this.pool);
    await keyStore.initialize();
    await keyStore.seedFromEnv(process.env.CHAOSCHAIN_API_KEYS);
    this.logger.info({ keys: keyStore.asSet().size }, 'API key store initialized');

    // Rate limiting: 100 req/min per IP for reads, 30 req/min for writes
    const readLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 100 });
    const writeLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 30 });

    // API key auth for write endpoints (uses live key store)
    const apiKeys = keyStore.asSet();
    if (apiKeys.size > 0) {
      this.app.post('/workflows/*', apiKeyAuth({ keys: apiKeys }));
      this.logger.info({ count: apiKeys.size }, 'API key auth enabled for write endpoints');
    } else {
      this.logger.warn({}, 'No API keys configured — write endpoints are unauthenticated');
    }

    // Write endpoint rate limiting (POST /workflows/*)
    this.app.post('/workflows/*', rateLimit(writeLimiter));

    // Admin routes (key management)
    const adminKey = process.env.ADMIN_KEY;
    if (adminKey) {
      this.app.use(createAdminRoutes({ adminKey, keyStore, pool: this.pool }));
      this.logger.info({}, 'Admin key management enabled (POST /admin/keys, POST /admin/seed-demo)');
    } else {
      this.logger.warn({}, 'No ADMIN_KEY configured — admin routes disabled');
    }

    // Epoch counter — auto-increments per session, persists in Postgres
    const epochCounter = new EpochCounter(this.pool ?? undefined, parseInt(process.env.CURRENT_EPOCH ?? '1', 10));
    await epochCounter.initialize();
    this.logger.info({ nextEpoch: epochCounter.current() }, 'Epoch counter initialized');

    // Session API (Engineering Studio — Postgres-backed)
    const sessionStore = new SessionStore(this.pool);
    const sessionSubmitWork = async (input: Record<string, unknown>) => {
      const workflow = createWorkSubmissionWorkflow(input as any);
      await this.engine.createWorkflow(workflow);
      this.engine.startWorkflow(workflow.id).catch(() => {/* engine logs errors */});
      return { id: workflow.id };
    };

    this.app.use(
      rateLimit(writeLimiter),
      createSessionRoutes({
        store: sessionStore,
        apiKeys,
        submitWork: sessionSubmitWork,
        signerAddress: 'off-chain',
        epochAllocator: epochCounter,
        logger: this.logger,
        pool: this.pool,
      }),
    );
    this.logger.info({}, 'Session API mounted (/v1/sessions)');

    // Workflow routes
    this.app.use(createRoutes(this.engine, persistence, this.logger));

    // Public read API (rate limited, no auth)
    const workDataReader = new WorkDataReader(
      persistence as any,
      async (_address: string) => 0,
    );

    this.app.use(
      rateLimit(readLimiter),
      createPublicApiRoutes({
        reputationReader: undefined,
        workDataReader,
        network: process.env.NETWORK_NAME ?? 'base-sepolia',
        identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS ?? '',
        reputationRegistryAddress: process.env.REPUTATION_REGISTRY_ADDRESS ?? '',
        apiKeys,
        prIngestion: {
          signerAddress: 'off-chain',
          computeDKG: (evidence: unknown[]) => {
            const result = computeDKG(evidence as DKGEvidencePackage[]);
            return { thread_root: result.thread_root, evidence_root: result.evidence_root };
          },
          submitWork: async (input: Record<string, unknown>) => {
            const workflow = createWorkSubmissionWorkflow(input as any);
            await this.engine.createWorkflow(workflow);
            this.engine.startWorkflow(workflow.id).catch(() => {/* engine logs errors */});
            return { id: workflow.id };
          },
        },
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

    this.logger.info({
      mode: 'off-chain-first',
      runningWorkflowResumeMinAgeMs: this.config.runningWorkflowResumeMinAgeMs,
      shutdownDrainTimeoutMs: this.config.shutdownDrainTimeoutMs,
    }, 'Gateway started successfully (off-chain mode)');

    // Resume active workflows in the background AFTER the HTTP server is healthy.
    // This must not block startup — stale workflows can take minutes to exhaust
    // retries, which would prevent /health from responding within Railway's window.
    this.logger.info({}, 'Resuming active workflows (background)...');
    this.engine.reconcileAllActive({
      runningWorkflowMinAgeMs: this.config.runningWorkflowResumeMinAgeMs,
    }).then(
      () => this.logger.info({}, 'Active workflows resumed'),
      (err) => this.logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Workflow reconciliation failed'),
    );
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
    this.shuttingDown = true;

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

    const drained = await this.engine.waitForIdle(this.config.shutdownDrainTimeoutMs);
    if (drained) {
      this.logger.info({}, 'In-flight workflows drained');
    } else {
      this.logger.warn(
        { timeoutMs: this.config.shutdownDrainTimeoutMs, activeExecutions: this.engine.activeExecutionCount() },
        'Timed out waiting for in-flight workflows to drain'
      );
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

  // createProvider removed — no on-chain reads required in off-chain mode
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
