import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

import {
  WorkflowEngine,
  WorkflowReconciler,
} from '../../src/workflows/index';
import type {
  StepExecutor,
  WorkflowDefinition,
} from '../../src/workflows/index';
import {
  PostgresWorkflowPersistence,
  runMigrations,
} from '../../src/persistence/postgres/index';

const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:gateway@127.0.0.1:5432/postgres';

function buildDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function createMinimalEngine(persistence: PostgresWorkflowPersistence) {
  const reconciler = {
    reconcileWorkSubmission: vi.fn().mockResolvedValue({ action: 'NO_CHANGE' }),
    applyReconciliationResult: vi.fn((workflow: unknown) => ({
      workflow,
      stateChanged: false,
    })),
  } as unknown as WorkflowReconciler;

  return new WorkflowEngine(persistence, reconciler);
}

function registerNoOpWorkflow(
  engine: WorkflowEngine,
  execute: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ type: 'SUCCESS', nextStep: null })
) {
  const stepExecutor: StepExecutor<any> = {
    execute,
    isIrreversible: () => false,
  };

  const definition: WorkflowDefinition<any> = {
    type: 'WorkSubmission',
    initialStep: 'TEST_STEP',
    steps: new Map([['TEST_STEP', stepExecutor]]),
    stepOrder: ['TEST_STEP'],
  };

  engine.registerWorkflow(definition);
  return execute;
}

describe('Postgres startup handoff integration', () => {
  const adminDatabaseUrl = process.env.GATEWAY_TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
  const databaseName = `gateway_phase1_${randomUUID().replace(/-/g, '_')}`;
  const testDatabaseUrl = buildDatabaseUrl(adminDatabaseUrl, databaseName);

  let adminPool: Pool;
  let pool: Pool;
  let persistence: PostgresWorkflowPersistence;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: adminDatabaseUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);

    pool = new Pool({ connectionString: testDatabaseUrl });
    await runMigrations(pool);
    persistence = new PostgresWorkflowPersistence(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE workflows');
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${databaseName}'
        AND pid <> pg_backend_pid()
    `);
    await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await adminPool.end();
  });

  it('skips recently updated RUNNING workflows when startup guard is enabled', async () => {
    const engine = createMinimalEngine(persistence);
    const execute = registerNoOpWorkflow(engine);
    const now = 1_700_000_000_000;

    const workflowId = randomUUID();

    await persistence.create({
      id: workflowId,
      type: 'WorkSubmission',
      created_at: now - 30_000,
      updated_at: now - 10_000,
      state: 'RUNNING',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    await engine.reconcileAllActive({
      runningWorkflowMinAgeMs: 60_000,
      now,
    });

    expect(execute).not.toHaveBeenCalled();

    const after = await persistence.load(workflowId);
    expect(after?.state).toBe('RUNNING');
    expect(after?.step).toBe('TEST_STEP');
  });

  it('reproduces pre-phase-1 behavior when startup guard is disabled', async () => {
    const engine = createMinimalEngine(persistence);
    const execute = registerNoOpWorkflow(engine);
    const now = 1_700_000_000_000;

    const workflowId = randomUUID();

    await persistence.create({
      id: workflowId,
      type: 'WorkSubmission',
      created_at: now - 30_000,
      updated_at: now - 10_000,
      state: 'RUNNING',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    await engine.reconcileAllActive({
      runningWorkflowMinAgeMs: 0,
      now,
    });

    expect(execute).toHaveBeenCalledTimes(1);

    const after = await persistence.load(workflowId);
    expect(after?.state).toBe('COMPLETED');
  });

  it('still resumes stale RUNNING workflows with the startup guard enabled', async () => {
    const engine = createMinimalEngine(persistence);
    const execute = registerNoOpWorkflow(engine);
    const now = 1_700_000_000_000;

    const workflowId = randomUUID();

    await persistence.create({
      id: workflowId,
      type: 'WorkSubmission',
      created_at: now - 120_000,
      updated_at: now - 61_000,
      state: 'RUNNING',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    await engine.reconcileAllActive({
      runningWorkflowMinAgeMs: 60_000,
      now,
    });

    expect(execute).toHaveBeenCalledTimes(1);

    const after = await persistence.load(workflowId);
    expect(after?.state).toBe('COMPLETED');
  });
});
