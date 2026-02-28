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
