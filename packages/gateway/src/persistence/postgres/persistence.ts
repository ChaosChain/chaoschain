/**
 * PostgreSQL Workflow Persistence
 * 
 * Implements WorkflowPersistence interface using PostgreSQL.
 * 
 * Guarantees:
 * - Write-ahead: state persisted BEFORE action
 * - Atomic transitions: state + progress in single transaction
 * - Immutable input: never modified after creation
 * - Append-only progress: fields set once, never cleared
 */

import { Pool } from 'pg';
import {
  WorkflowPersistence,
  WorkflowRecord,
  WorkflowMetaState,
  WorkflowError,
  WorkflowType,
} from '../../workflows/index.js';

// =============================================================================
// SCHEMA BOOTSTRAP
// =============================================================================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    state VARCHAR(32) NOT NULL,
    step VARCHAR(64) NOT NULL,
    step_attempts INTEGER NOT NULL DEFAULT 0,
    input JSONB NOT NULL,
    progress JSONB NOT NULL DEFAULT '{}',
    error JSONB,
    signer VARCHAR(42) NOT NULL,
    CONSTRAINT valid_state CHECK (state IN ('CREATED', 'RUNNING', 'STALLED', 'COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_active
    ON workflows (state)
    WHERE state IN ('RUNNING', 'STALLED');

CREATE INDEX IF NOT EXISTS idx_workflows_type_state
    ON workflows (type, state);

CREATE INDEX IF NOT EXISTS idx_workflows_signer
    ON workflows (signer);

CREATE INDEX IF NOT EXISTS idx_workflows_studio
    ON workflows ((input->>'studio_address'));

CREATE INDEX IF NOT EXISTS idx_workflows_updated
    ON workflows (updated_at DESC);

INSERT INTO schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
`;

const MIGRATION_V2_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2) THEN

    CREATE TABLE IF NOT EXISTS sessions (
      session_id     VARCHAR(255) PRIMARY KEY,
      session_root_event_id VARCHAR(255),
      studio_address VARCHAR(255) NOT NULL,
      studio_policy_version VARCHAR(255) NOT NULL,
      work_mandate_id VARCHAR(255) NOT NULL,
      task_type      VARCHAR(64)  NOT NULL,
      agent_address  VARCHAR(255) NOT NULL,
      status         VARCHAR(32)  NOT NULL,
      started_at     TIMESTAMPTZ  NOT NULL,
      completed_at   TIMESTAMPTZ,
      event_count    INTEGER      NOT NULL DEFAULT 0,
      workflow_id    VARCHAR(255),
      data_hash      VARCHAR(255),
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
    CREATE INDEX IF NOT EXISTS idx_sessions_studio ON sessions (studio_address);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent  ON sessions (agent_address);

    CREATE TABLE IF NOT EXISTS session_events (
      id            SERIAL PRIMARY KEY,
      session_id    VARCHAR(255) NOT NULL REFERENCES sessions(session_id),
      event_id      VARCHAR(255) NOT NULL,
      event_type    VARCHAR(64)  NOT NULL,
      received_at   TIMESTAMPTZ  NOT NULL,
      event_payload JSONB        NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events (session_id);
    CREATE INDEX IF NOT EXISTS idx_session_events_ts
      ON session_events ((event_payload->>'timestamp'), received_at);

    INSERT INTO schema_migrations (version) VALUES (2);
  END IF;
END $$;
`;

const MIGRATION_V3_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3) THEN
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS epoch INTEGER;

    INSERT INTO schema_migrations (version) VALUES (3);
  END IF;
END $$;
`;

const MIGRATION_V4_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4) THEN
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agent_name VARCHAR(128);

    INSERT INTO schema_migrations (version) VALUES (4);
  END IF;
END $$;
`;

// Migration V5: cross-workflow ScoreSubmission idempotency.
//
// Background: without this constraint, multiple verifier instances polling
// the gateway's pending queue can both discover the same work item and both
// persist separate ScoreSubmission workflows that each reach COMPLETED for
// the same data_hash. The compare-page leaderboard AVGs across all COMPLETED
// ScoreSubmission rows per agent, so duplicate rows directly pollute the
// canonical per-agent scores that drive the product's core comparison
// signal. The zombie-Railway-replica incident on 2026-04-11 demonstrated
// this in production (17 score submissions for 12 unique data_hashes, all
// with identical deterministic score dims 0-2 but diverging LLM-dependent
// dims 3-4 — unambiguous evidence of two independent verifier runs).
//
// The partial unique index filters on ``state = 'COMPLETED'`` so that
// CREATED/RUNNING/STALLED/FAILED rows can coexist freely for the same
// data_hash — only the transition _into_ COMPLETED is serialised, which is
// exactly where duplication matters. This layer catches the TOCTOU race
// between SubmitScoreDirectStep's application-level check and its progress
// append; on violation the workflow step handler converts pg error 23505
// into a no-op success ("first winner is canonical").
const MIGRATION_V5_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 5) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_score_submission_data_hash_completed
      ON workflows ((input->>'data_hash'))
      WHERE type = 'ScoreSubmission' AND state = 'COMPLETED';

    INSERT INTO schema_migrations (version) VALUES (5);
  END IF;
END $$;
`;

/**
 * Ensure the database schema exists. Idempotent — safe to call on every startup.
 * Uses CREATE TABLE IF NOT EXISTS so it's a no-op on an already-initialized DB.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
  await pool.query(MIGRATION_V2_SQL);
  await pool.query(MIGRATION_V3_SQL);
  await pool.query(MIGRATION_V4_SQL);
  await pool.query(MIGRATION_V5_SQL);
}

// =============================================================================
// POSTGRESQL PERSISTENCE IMPLEMENTATION
// =============================================================================

export class PostgresWorkflowPersistence implements WorkflowPersistence {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new workflow record.
   * Called once at workflow instantiation.
   */
  async create(record: WorkflowRecord): Promise<void> {
    const query = `
      INSERT INTO workflows (
        id, type, created_at, updated_at,
        state, step, step_attempts,
        input, progress, error, signer
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11
      )
    `;

    const values = [
      record.id,
      record.type,
      record.created_at,
      record.updated_at,
      record.state,
      record.step,
      record.step_attempts,
      JSON.stringify(record.input),
      JSON.stringify(record.progress),
      record.error ? JSON.stringify(record.error) : null,
      record.signer,
    ];

    try {
      await this.pool.query(query, values);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        throw new Error(`Workflow ${record.id} already exists`);
      }
      throw error;
    }
  }

  /**
   * Load a workflow by ID.
   * Returns null if not found.
   */
  async load(id: string): Promise<WorkflowRecord | null> {
    const query = `
      SELECT 
        id, type, created_at, updated_at,
        state, step, step_attempts,
        input, progress, error, signer
      FROM workflows
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToRecord(result.rows[0]);
  }

  /**
   * Update workflow state and step.
   * Atomic: state, step, step_attempts updated together.
   */
  async updateState(
    id: string,
    state: WorkflowMetaState,
    step: string,
    step_attempts: number
  ): Promise<void> {
    const query = `
      UPDATE workflows
      SET state = $2, step = $3, step_attempts = $4, updated_at = $5
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [
      id,
      state,
      step,
      step_attempts,
      Date.now(),
    ]);

    if (result.rowCount === 0) {
      throw new Error(`Workflow ${id} not found`);
    }
  }

  /**
   * Append to progress.
   * Progress fields are set once, never cleared.
   * This merges new fields into existing progress.
   */
  async appendProgress(id: string, progress: Record<string, unknown>): Promise<void> {
    // Use JSONB concatenation to merge progress
    // The || operator merges objects, with right side taking precedence
    const query = `
      UPDATE workflows
      SET progress = progress || $2::jsonb, updated_at = $3
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [
      id,
      JSON.stringify(progress),
      Date.now(),
    ]);

    if (result.rowCount === 0) {
      throw new Error(`Workflow ${id} not found`);
    }
  }

  /**
   * Set error on workflow.
   */
  async setError(id: string, error: WorkflowError): Promise<void> {
    const query = `
      UPDATE workflows
      SET error = $2, updated_at = $3
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [
      id,
      JSON.stringify(error),
      Date.now(),
    ]);

    if (result.rowCount === 0) {
      throw new Error(`Workflow ${id} not found`);
    }
  }

  /**
   * Find all workflows in RUNNING or STALLED state.
   * Used for reconciliation on startup.
   */
  async findActiveWorkflows(): Promise<WorkflowRecord[]> {
    const query = `
      SELECT 
        id, type, created_at, updated_at,
        state, step, step_attempts,
        input, progress, error, signer
      FROM workflows
      WHERE state IN ('RUNNING', 'STALLED')
      ORDER BY created_at ASC
    `;

    const result = await this.pool.query(query);
    return result.rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Find workflows by type and state.
   */
  async findByTypeAndState(
    type: string,
    state: WorkflowMetaState
  ): Promise<WorkflowRecord[]> {
    const query = `
      SELECT 
        id, type, created_at, updated_at,
        state, step, step_attempts,
        input, progress, error, signer
      FROM workflows
      WHERE type = $1 AND state = $2
      ORDER BY created_at ASC
    `;

    const result = await this.pool.query(query, [type, state]);
    return result.rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Find workflows by studio address.
   */
  async findByStudio(studioAddress: string): Promise<WorkflowRecord[]> {
    const query = `
      SELECT 
        id, type, created_at, updated_at,
        state, step, step_attempts,
        input, progress, error, signer
      FROM workflows
      WHERE input->>'studio_address' = $1
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query(query, [studioAddress]);
    return result.rows.map((row) => this.rowToRecord(row));
  }

  // ===========================================================================
  // Read-only queries for public API (WorkflowQuerySource)
  // ===========================================================================

  async findWorkByDataHash(dataHash: string): Promise<WorkflowRecord | null> {
    const query = `
      SELECT id, type, created_at, updated_at,
             state, step, step_attempts,
             input, progress, error, signer
      FROM workflows
      WHERE type = 'WorkSubmission' AND input->>'data_hash' = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const result = await this.pool.query(query, [dataHash]);
    return result.rows.length > 0 ? this.rowToRecord(result.rows[0]) : null;
  }

  async findLatestCompletedWorkForAgent(agentAddress: string): Promise<WorkflowRecord | null> {
    const query = `
      SELECT id, type, created_at, updated_at,
             state, step, step_attempts,
             input, progress, error, signer
      FROM workflows
      WHERE type = 'WorkSubmission'
        AND state = 'COMPLETED'
        AND LOWER(input->>'agent_address') = LOWER($1)
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const result = await this.pool.query(query, [agentAddress]);
    return result.rows.length > 0 ? this.rowToRecord(result.rows[0]) : null;
  }

  async findAllCompletedWorkflowsForAgent(
    agentAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const countQuery = `
      SELECT COUNT(*) AS cnt FROM workflows
      WHERE state = 'COMPLETED'
        AND (
          (type = 'WorkSubmission' AND LOWER(input->>'agent_address') = LOWER($1))
          OR
          (type = 'ScoreSubmission' AND LOWER(input->>'validator_address') = LOWER($1))
        )
    `;
    const countResult = await this.pool.query(countQuery, [agentAddress]);
    const total = parseInt(countResult.rows[0]?.cnt ?? '0', 10);

    const query = `
      SELECT id, type, created_at, updated_at,
             state, step, step_attempts,
             input, progress, error, signer
      FROM workflows
      WHERE state = 'COMPLETED'
        AND (
          (type = 'WorkSubmission' AND LOWER(input->>'agent_address') = LOWER($1))
          OR
          (type = 'ScoreSubmission' AND LOWER(input->>'validator_address') = LOWER($1))
        )
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await this.pool.query(query, [agentAddress, limit, offset]);
    return { records: result.rows.map((row) => this.rowToRecord(row)), total };
  }

  async hasCompletedScoreForDataHash(dataHash: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM workflows
      WHERE type = 'ScoreSubmission'
        AND state = 'COMPLETED'
        AND input->>'data_hash' = $1
      LIMIT 1
    `;
    const result = await this.pool.query(query, [dataHash]);
    return result.rows.length > 0;
  }

  async hasCompletedCloseEpoch(studioAddress: string, epoch: number): Promise<boolean> {
    const query = `
      SELECT 1 FROM workflows
      WHERE type = 'CloseEpoch'
        AND state = 'COMPLETED'
        AND input->>'studio_address' = $1
        AND (input->>'epoch')::int = $2
      LIMIT 1
    `;
    const result = await this.pool.query(query, [studioAddress, epoch]);
    return result.rows.length > 0;
  }

  /**
   * Pending: COMPLETED WorkSubmission, no completed ScoreSubmission, epoch not closed.
   */
  async findPendingWorkForStudio(
    studioAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const where = `
      w.type = 'WorkSubmission'
      AND w.state = 'COMPLETED'
      AND LOWER(w.input->>'studio_address') = LOWER($1)
      AND NOT EXISTS (
        SELECT 1 FROM workflows sc
        WHERE sc.type = 'ScoreSubmission'
          AND sc.state = 'COMPLETED'
          AND sc.input->>'data_hash' = w.input->>'data_hash'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows ce
        WHERE ce.type = 'CloseEpoch'
          AND ce.state = 'COMPLETED'
          AND LOWER(ce.input->>'studio_address') = LOWER($1)
          AND (ce.input->>'epoch')::int = (w.input->>'epoch')::int
      )`;

    const countResult = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM workflows w WHERE ${where}`, [studioAddress],
    );
    const total = parseInt(countResult.rows[0]?.cnt ?? '0', 10);

    const result = await this.pool.query(`
      SELECT w.id, w.type, w.created_at, w.updated_at,
             w.state, w.step, w.step_attempts,
             w.input, w.progress, w.error, w.signer
      FROM workflows w WHERE ${where}
      ORDER BY w.created_at DESC
      LIMIT $2 OFFSET $3`,
      [studioAddress, limit, offset],
    );
    return { records: result.rows.map((row) => this.rowToRecord(row)), total };
  }

  /**
   * Scored: COMPLETED WorkSubmission with at least one completed ScoreSubmission,
   * but epoch not closed.
   */
  async findScoredWorkForStudio(
    studioAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const where = `
      w.type = 'WorkSubmission'
      AND w.state = 'COMPLETED'
      AND LOWER(w.input->>'studio_address') = LOWER($1)
      AND EXISTS (
        SELECT 1 FROM workflows sc
        WHERE sc.type = 'ScoreSubmission'
          AND sc.state = 'COMPLETED'
          AND sc.input->>'data_hash' = w.input->>'data_hash'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows ce
        WHERE ce.type = 'CloseEpoch'
          AND ce.state = 'COMPLETED'
          AND LOWER(ce.input->>'studio_address') = LOWER($1)
          AND (ce.input->>'epoch')::int = (w.input->>'epoch')::int
      )`;

    const countResult = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM workflows w WHERE ${where}`, [studioAddress],
    );
    const total = parseInt(countResult.rows[0]?.cnt ?? '0', 10);

    const result = await this.pool.query(`
      SELECT w.id, w.type, w.created_at, w.updated_at,
             w.state, w.step, w.step_attempts,
             w.input, w.progress, w.error, w.signer
      FROM workflows w WHERE ${where}
      ORDER BY w.created_at DESC
      LIMIT $2 OFFSET $3`,
      [studioAddress, limit, offset],
    );
    return { records: result.rows.map((row) => this.rowToRecord(row)), total };
  }

  /**
   * Finalized: COMPLETED WorkSubmission whose epoch has a completed CloseEpoch.
   */
  async findFinalizedWorkForStudio(
    studioAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const where = `
      w.type = 'WorkSubmission'
      AND w.state = 'COMPLETED'
      AND LOWER(w.input->>'studio_address') = LOWER($1)
      AND EXISTS (
        SELECT 1 FROM workflows ce
        WHERE ce.type = 'CloseEpoch'
          AND ce.state = 'COMPLETED'
          AND LOWER(ce.input->>'studio_address') = LOWER($1)
          AND (ce.input->>'epoch')::int = (w.input->>'epoch')::int
      )`;

    const countResult = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM workflows w WHERE ${where}`, [studioAddress],
    );
    const total = parseInt(countResult.rows[0]?.cnt ?? '0', 10);

    const result = await this.pool.query(`
      SELECT w.id, w.type, w.created_at, w.updated_at,
             w.state, w.step, w.step_attempts,
             w.input, w.progress, w.error, w.signer
      FROM workflows w WHERE ${where}
      ORDER BY w.created_at DESC
      LIMIT $2 OFFSET $3`,
      [studioAddress, limit, offset],
    );
    return { records: result.rows.map((row) => this.rowToRecord(row)), total };
  }

  async findAllWorkForStudio(
    studioAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const countQuery = `
      SELECT COUNT(*) AS cnt FROM workflows w
      WHERE w.type = 'WorkSubmission'
        AND w.state = 'COMPLETED'
        AND LOWER(w.input->>'studio_address') = LOWER($1)
    `;
    const countResult = await this.pool.query(countQuery, [studioAddress]);
    const total = parseInt(countResult.rows[0]?.cnt ?? '0', 10);

    const query = `
      SELECT w.id, w.type, w.created_at, w.updated_at,
             w.state, w.step, w.step_attempts,
             w.input, w.progress, w.error, w.signer
      FROM workflows w
      WHERE w.type = 'WorkSubmission'
        AND w.state = 'COMPLETED'
        AND LOWER(w.input->>'studio_address') = LOWER($1)
      ORDER BY w.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await this.pool.query(query, [studioAddress, limit, offset]);
    return { records: result.rows.map((row) => this.rowToRecord(row)), total };
  }

  async findScoresForDataHash(dataHash: string): Promise<WorkflowRecord[]> {
    const query = `
      SELECT id, type, created_at, updated_at,
             state, step, step_attempts,
             input, progress, error, signer
      FROM workflows
      WHERE type = 'ScoreSubmission'
        AND state = 'COMPLETED'
        AND input->>'data_hash' = $1
      ORDER BY created_at DESC
    `;
    const result = await this.pool.query(query, [dataHash]);
    return result.rows.map((row) => this.rowToRecord(row));
  }

  async findScoresForStudio(
    studioAddress: string,
    filter: { workerAddress?: string; validatorAddress?: string },
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const conditions: string[] = [
      `type = 'ScoreSubmission'`,
      `state = 'COMPLETED'`,
      `LOWER(input->>'studio_address') = LOWER($1)`,
    ];
    const values: unknown[] = [studioAddress];

    if (filter.workerAddress) {
      values.push(filter.workerAddress);
      conditions.push(`LOWER(input->>'worker_address') = LOWER($${values.length})`);
    }
    if (filter.validatorAddress) {
      values.push(filter.validatorAddress);
      conditions.push(`LOWER(input->>'validator_address') = LOWER($${values.length})`);
    }

    const where = conditions.join(' AND ');

    const countResult = await this.pool.query(
      `SELECT COUNT(*) AS count FROM workflows WHERE ${where}`,
      values,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    values.push(limit, offset);
    const limitIdx = values.length - 1;
    const offsetIdx = values.length;

    const query = `
      SELECT id, type, created_at, updated_at,
             state, step, step_attempts,
             input, progress, error, signer
      FROM workflows
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const result = await this.pool.query(query, values);
    return { records: result.rows.map((row) => this.rowToRecord(row)), total };
  }

  // ===========================================================================
  // PRIVATE: Row mapping
  // ===========================================================================

  private rowToRecord(row: Record<string, unknown>): WorkflowRecord {
    return {
      id: row.id as string,
      type: row.type as WorkflowType,
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      state: row.state as WorkflowMetaState,
      step: row.step as string,
      step_attempts: row.step_attempts as number,
      input: row.input as Record<string, unknown>,
      progress: row.progress as Record<string, unknown>,
      error: row.error as WorkflowError | undefined,
      signer: row.signer as string,
    };
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createPostgresPersistence(connectionString: string): PostgresWorkflowPersistence {
  const pool = new Pool({ connectionString });
  return new PostgresWorkflowPersistence(pool);
}

export function createPostgresPersistenceFromPool(pool: Pool): PostgresWorkflowPersistence {
  return new PostgresWorkflowPersistence(pool);
}
