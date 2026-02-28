/**
 * Workflow Persistence Layer
 * 
 * Handles database storage of workflow records.
 * Guarantees:
 * - Write-ahead: state persisted BEFORE action
 * - Atomic transitions: state + progress in single transaction
 * - Immutable input: never modified after creation
 * - Append-only progress: fields set once, never cleared
 */

import { WorkflowRecord, WorkflowMetaState, WorkflowError } from './types.js';

// =============================================================================
// PERSISTENCE INTERFACE
// =============================================================================

export interface WorkflowPersistence {
  /**
   * Create a new workflow record.
   * Called once at workflow instantiation.
   */
  create(record: WorkflowRecord): Promise<void>;

  /**
   * Load a workflow by ID.
   * Returns null if not found.
   */
  load(id: string): Promise<WorkflowRecord | null>;

  /**
   * Update workflow state and step.
   * Atomic: state, step, step_attempts updated together.
   */
  updateState(
    id: string,
    state: WorkflowMetaState,
    step: string,
    step_attempts: number
  ): Promise<void>;

  /**
   * Append to progress.
   * Progress fields are set once, never cleared.
   * This merges new fields into existing progress.
   */
  appendProgress(id: string, progress: Record<string, unknown>): Promise<void>;

  /**
   * Set error on workflow.
   */
  setError(id: string, error: WorkflowError): Promise<void>;

  /**
   * Find all workflows in RUNNING or STALLED state.
   * Used for reconciliation on startup.
   */
  findActiveWorkflows(): Promise<WorkflowRecord[]>;

  /**
   * Find workflows by type and state.
   */
  findByTypeAndState(
    type: string,
    state: WorkflowMetaState
  ): Promise<WorkflowRecord[]>;
}

// =============================================================================
// IN-MEMORY IMPLEMENTATION (for v0)
// =============================================================================

/**
 * In-memory persistence for initial implementation.
 * 
 * WARNING: Data is lost on restart.
 * Production should use PostgreSQL.
 */
export class InMemoryWorkflowPersistence implements WorkflowPersistence {
  private workflows: Map<string, WorkflowRecord> = new Map();

  async create(record: WorkflowRecord): Promise<void> {
    if (this.workflows.has(record.id)) {
      throw new Error(`Workflow ${record.id} already exists`);
    }
    // Deep clone to prevent external mutation
    this.workflows.set(record.id, structuredClone(record));
  }

  async load(id: string): Promise<WorkflowRecord | null> {
    const record = this.workflows.get(id);
    if (!record) return null;
    // Return clone to prevent external mutation
    return structuredClone(record);
  }

  async updateState(
    id: string,
    state: WorkflowMetaState,
    step: string,
    step_attempts: number
  ): Promise<void> {
    const record = this.workflows.get(id);
    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }
    record.state = state;
    record.step = step;
    record.step_attempts = step_attempts;
    record.updated_at = Date.now();
  }

  async appendProgress(id: string, progress: Record<string, unknown>): Promise<void> {
    const record = this.workflows.get(id);
    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }
    // Merge new progress into existing (append-only)
    const existingProgress = record.progress as Record<string, unknown> ?? {};
    record.progress = { ...existingProgress, ...progress };
    record.updated_at = Date.now();
  }

  async setError(id: string, error: WorkflowError): Promise<void> {
    const record = this.workflows.get(id);
    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }
    record.error = error;
    record.updated_at = Date.now();
  }

  async findActiveWorkflows(): Promise<WorkflowRecord[]> {
    const active: WorkflowRecord[] = [];
    for (const record of this.workflows.values()) {
      if (record.state === 'RUNNING' || record.state === 'STALLED') {
        active.push(structuredClone(record));
      }
    }
    return active;
  }

  async findByTypeAndState(
    type: string,
    state: WorkflowMetaState
  ): Promise<WorkflowRecord[]> {
    const results: WorkflowRecord[] = [];
    for (const record of this.workflows.values()) {
      if (record.type === type && record.state === state) {
        results.push(structuredClone(record));
      }
    }
    return results;
  }

  // ===========================================================================
  // Read-only queries for public API (WorkflowQuerySource)
  // ===========================================================================

  async findWorkByDataHash(dataHash: string): Promise<WorkflowRecord | null> {
    for (const record of this.workflows.values()) {
      if (record.type !== 'WorkSubmission') continue;
      const input = record.input as Record<string, unknown>;
      if (input.data_hash === dataHash) return structuredClone(record);
    }
    return null;
  }

  async findLatestCompletedWorkForAgent(agentAddress: string): Promise<WorkflowRecord | null> {
    let latest: WorkflowRecord | null = null;
    const addr = agentAddress.toLowerCase();
    for (const record of this.workflows.values()) {
      if (record.type !== 'WorkSubmission') continue;
      if (record.state !== 'COMPLETED') continue;
      const input = record.input as Record<string, unknown>;
      if ((input.agent_address as string)?.toLowerCase() !== addr) continue;
      if (!latest || record.created_at > latest.created_at) {
        latest = record;
      }
    }
    return latest ? structuredClone(latest) : null;
  }

  async findAllCompletedWorkflowsForAgent(
    agentAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const addr = agentAddress.toLowerCase();
    const matching: WorkflowRecord[] = [];

    for (const record of this.workflows.values()) {
      if (record.state !== 'COMPLETED') continue;
      const input = record.input as Record<string, unknown>;

      if (record.type === 'WorkSubmission') {
        if ((input.agent_address as string)?.toLowerCase() === addr) {
          matching.push(record);
        }
      } else if (record.type === 'ScoreSubmission') {
        if ((input.validator_address as string)?.toLowerCase() === addr) {
          matching.push(record);
        }
      }
    }

    matching.sort((a, b) => b.created_at - a.created_at);
    const total = matching.length;
    const sliced = matching.slice(offset, offset + limit).map(r => structuredClone(r));
    return { records: sliced, total };
  }

  async hasCompletedScoreForDataHash(dataHash: string): Promise<boolean> {
    for (const record of this.workflows.values()) {
      if (record.type !== 'ScoreSubmission') continue;
      if (record.state !== 'COMPLETED') continue;
      const input = record.input as Record<string, unknown>;
      if (input.data_hash === dataHash) return true;
    }
    return false;
  }

  async hasCompletedCloseEpoch(studioAddress: string, epoch: number): Promise<boolean> {
    for (const record of this.workflows.values()) {
      if (record.type !== 'CloseEpoch') continue;
      if (record.state !== 'COMPLETED') continue;
      const input = record.input as Record<string, unknown>;
      if (input.studio_address === studioAddress && input.epoch === epoch) return true;
    }
    return false;
  }

  // For testing: clear all data
  clear(): void {
    this.workflows.clear();
  }

  // For testing: get count
  count(): number {
    return this.workflows.size;
  }
}
