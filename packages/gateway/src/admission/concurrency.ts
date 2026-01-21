/**
 * Concurrency Limits (Admission Control)
 * 
 * HARD CONSTRAINT: Limits must NOT affect execution order.
 * No scheduling, prioritization, or reordering.
 * Only reject workflow creation when limits exceeded.
 * 
 * This is purely admission control.
 */

import { WorkflowType, WorkflowRecord } from '../workflows/types.js';
import { WorkflowPersistence } from '../workflows/persistence.js';

// =============================================================================
// CONCURRENCY LIMITS CONFIG
// =============================================================================

export interface ConcurrencyLimits {
  /**
   * Max active (CREATED, RUNNING) workflows per type.
   * If undefined, no per-type limit.
   */
  maxPerType?: Partial<Record<WorkflowType, number>>;

  /**
   * Max active workflows per signer.
   * If undefined, no per-signer limit.
   */
  maxPerSigner?: number;

  /**
   * Max total active workflows.
   * If undefined, no total limit.
   */
  maxTotal?: number;
}

// =============================================================================
// REJECTION REASONS
// =============================================================================

export type RejectionReason = 'type_limit' | 'signer_limit' | 'total_limit';

export class WorkflowRejectedError extends Error {
  constructor(
    public readonly reason: RejectionReason,
    public readonly limit: number,
    public readonly current: number,
    public readonly context?: string
  ) {
    const details = context ? ` (${context})` : '';
    super(`Workflow rejected: ${reason} - ${current}/${limit} active${details}`);
    this.name = 'WorkflowRejectedError';
  }
}

// =============================================================================
// ADMISSION CONTROLLER
// =============================================================================

/**
 * Admission controller for concurrency limits.
 * 
 * Does NOT:
 * - Affect execution order
 * - Schedule or prioritize
 * - Queue workflows for later
 * 
 * Does:
 * - Reject workflow creation when limits exceeded
 * - Count active workflows
 */
export interface AdmissionController {
  /**
   * Check if a new workflow can be admitted.
   * Throws WorkflowRejectedError if limits exceeded.
   * 
   * Does NOT reserve a slot - just checks at point in time.
   * Race conditions are acceptable (limits are soft, for backpressure).
   */
  checkAdmission(type: WorkflowType, signer: string): Promise<void>;

  /**
   * Get current active counts (for observability).
   */
  getActiveCounts(): Promise<{
    total: number;
    byType: Record<string, number>;
    bySigner: Record<string, number>;
  }>;
}

// =============================================================================
// DEFAULT IMPLEMENTATION
// =============================================================================

/**
 * Default admission controller that counts active workflows.
 */
export class DefaultAdmissionController implements AdmissionController {
  constructor(
    private readonly persistence: WorkflowPersistence,
    private readonly limits: ConcurrencyLimits
  ) {}

  async checkAdmission(type: WorkflowType, signer: string): Promise<void> {
    // Check total limit first (most global)
    if (this.limits.maxTotal !== undefined) {
      const total = await this.countActiveTotal();
      if (total >= this.limits.maxTotal) {
        throw new WorkflowRejectedError('total_limit', this.limits.maxTotal, total);
      }
    }

    // Check per-type limit
    const typeLimit = this.limits.maxPerType?.[type];
    if (typeLimit !== undefined) {
      const byType = await this.countActiveByType(type);
      if (byType >= typeLimit) {
        throw new WorkflowRejectedError('type_limit', typeLimit, byType, type);
      }
    }

    // Check per-signer limit
    if (this.limits.maxPerSigner !== undefined) {
      const bySigner = await this.countActiveBySigner(signer);
      if (bySigner >= this.limits.maxPerSigner) {
        throw new WorkflowRejectedError(
          'signer_limit', 
          this.limits.maxPerSigner, 
          bySigner, 
          signer
        );
      }
    }
  }

  async getActiveCounts(): Promise<{
    total: number;
    byType: Record<string, number>;
    bySigner: Record<string, number>;
  }> {
    const allWorkflows = await this.getActiveWorkflows();

    const byType: Record<string, number> = {};
    const bySigner: Record<string, number> = {};

    for (const wf of allWorkflows) {
      byType[wf.type] = (byType[wf.type] ?? 0) + 1;
      bySigner[wf.signer] = (bySigner[wf.signer] ?? 0) + 1;
    }

    return {
      total: allWorkflows.length,
      byType,
      bySigner,
    };
  }

  private async countActiveTotal(): Promise<number> {
    const active = await this.getActiveWorkflows();
    return active.length;
  }

  private async countActiveByType(type: WorkflowType): Promise<number> {
    const all = await this.getActiveWorkflows();
    return all.filter((wf) => wf.type === type).length;
  }

  private async countActiveBySigner(signer: string): Promise<number> {
    const all = await this.getActiveWorkflows();
    const normalizedSigner = signer.toLowerCase();
    return all.filter((wf) => wf.signer.toLowerCase() === normalizedSigner).length;
  }

  private async getActiveWorkflows(): Promise<WorkflowRecord[]> {
    // findActiveWorkflows returns RUNNING and STALLED workflows
    // For admission control, we also need CREATED workflows
    const active = await this.persistence.findActiveWorkflows();
    
    // Get CREATED workflows by type (we need to check all types)
    const types: WorkflowType[] = ['WorkSubmission', 'ScoreSubmission', 'CloseEpoch'];
    const created: WorkflowRecord[] = [];
    for (const type of types) {
      const typeCreated = await this.persistence.findByTypeAndState(type, 'CREATED');
      created.push(...typeCreated);
    }
    
    return [...active, ...created];
  }
}

// =============================================================================
// NO-LIMIT CONTROLLER (for testing)
// =============================================================================

/**
 * Admission controller that allows everything.
 * For testing only.
 */
export class UnlimitedAdmissionController implements AdmissionController {
  async checkAdmission(_type: WorkflowType, _signer: string): Promise<void> {
    // Always allow
  }

  async getActiveCounts(): Promise<{
    total: number;
    byType: Record<string, number>;
    bySigner: Record<string, number>;
  }> {
    return { total: 0, byType: {}, bySigner: {} };
  }
}
