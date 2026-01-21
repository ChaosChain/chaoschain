/**
 * Metrics Interface
 * 
 * Write-only signals for observability.
 * 
 * HARD CONSTRAINT: Engine and workflows must NEVER read metrics or act on them.
 * Metrics are purely for external monitoring.
 * 
 * Default implementation is no-op.
 * Production can inject Prometheus, StatsD, etc.
 */

import { WorkflowType } from '../workflows/types.js';

// =============================================================================
// METRICS INTERFACE
// =============================================================================

/**
 * Write-only metrics sink.
 * 
 * All methods are fire-and-forget.
 * Implementations must never throw.
 */
export interface WorkflowMetrics {
  // =========================================================================
  // Workflow lifecycle
  // =========================================================================

  /**
   * Workflow was created (not yet started).
   */
  workflowCreated(type: WorkflowType): void;

  /**
   * Workflow started execution.
   */
  workflowStarted(type: WorkflowType): void;

  /**
   * Workflow completed successfully.
   */
  workflowCompleted(type: WorkflowType, durationMs: number): void;

  /**
   * Workflow failed (permanent error).
   */
  workflowFailed(type: WorkflowType, errorCode: string): void;

  /**
   * Workflow stalled (operational error, recoverable).
   */
  workflowStalled(type: WorkflowType, reason: string): void;

  /**
   * Workflow resumed after stall or restart.
   */
  workflowResumed(type: WorkflowType): void;

  // =========================================================================
  // Step lifecycle
  // =========================================================================

  /**
   * Step execution started.
   */
  stepStarted(type: WorkflowType, step: string): void;

  /**
   * Step completed successfully.
   */
  stepCompleted(type: WorkflowType, step: string, durationMs: number): void;

  /**
   * Step is being retried.
   */
  stepRetried(type: WorkflowType, step: string, attempt: number, errorCode: string): void;

  /**
   * Step timed out (will transition to STALLED).
   */
  stepTimedOut(type: WorkflowType, step: string, timeoutMs: number): void;

  // =========================================================================
  // Transaction lifecycle
  // =========================================================================

  /**
   * Transaction submitted to chain.
   */
  txSubmitted(signer: string, workflowType: WorkflowType): void;

  /**
   * Transaction confirmed.
   */
  txConfirmed(signer: string, workflowType: WorkflowType, durationMs: number): void;

  /**
   * Transaction reverted.
   */
  txReverted(signer: string, workflowType: WorkflowType): void;

  /**
   * Transaction not found after timeout.
   */
  txNotFound(signer: string, workflowType: WorkflowType): void;

  // =========================================================================
  // Admission control
  // =========================================================================

  /**
   * Workflow creation rejected due to concurrency limit.
   */
  workflowRejected(type: WorkflowType, reason: 'type_limit' | 'signer_limit' | 'total_limit'): void;

  // =========================================================================
  // Reconciliation
  // =========================================================================

  /**
   * Reconciliation ran for a workflow.
   */
  reconciliationRan(type: WorkflowType, changed: boolean): void;
}

// =============================================================================
// NO-OP IMPLEMENTATION (Default)
// =============================================================================

/**
 * Default no-op metrics implementation.
 * Used when no metrics sink is configured.
 */
export class NoOpMetrics implements WorkflowMetrics {
  workflowCreated(_type: WorkflowType): void {}
  workflowStarted(_type: WorkflowType): void {}
  workflowCompleted(_type: WorkflowType, _durationMs: number): void {}
  workflowFailed(_type: WorkflowType, _errorCode: string): void {}
  workflowStalled(_type: WorkflowType, _reason: string): void {}
  workflowResumed(_type: WorkflowType): void {}

  stepStarted(_type: WorkflowType, _step: string): void {}
  stepCompleted(_type: WorkflowType, _step: string, _durationMs: number): void {}
  stepRetried(_type: WorkflowType, _step: string, _attempt: number, _errorCode: string): void {}
  stepTimedOut(_type: WorkflowType, _step: string, _timeoutMs: number): void {}

  txSubmitted(_signer: string, _workflowType: WorkflowType): void {}
  txConfirmed(_signer: string, _workflowType: WorkflowType, _durationMs: number): void {}
  txReverted(_signer: string, _workflowType: WorkflowType): void {}
  txNotFound(_signer: string, _workflowType: WorkflowType): void {}

  workflowRejected(_type: WorkflowType, _reason: 'type_limit' | 'signer_limit' | 'total_limit'): void {}

  reconciliationRan(_type: WorkflowType, _changed: boolean): void {}
}

// =============================================================================
// CONSOLE METRICS (for development)
// =============================================================================

/**
 * Simple console-based metrics for development/debugging.
 * Logs all metrics to console with timestamps.
 */
export class ConsoleMetrics implements WorkflowMetrics {
  private log(category: string, event: string, data: Record<string, unknown>): void {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      category,
      event,
      ...data,
    }));
  }

  workflowCreated(type: WorkflowType): void {
    this.log('workflow', 'created', { type });
  }

  workflowStarted(type: WorkflowType): void {
    this.log('workflow', 'started', { type });
  }

  workflowCompleted(type: WorkflowType, durationMs: number): void {
    this.log('workflow', 'completed', { type, durationMs });
  }

  workflowFailed(type: WorkflowType, errorCode: string): void {
    this.log('workflow', 'failed', { type, errorCode });
  }

  workflowStalled(type: WorkflowType, reason: string): void {
    this.log('workflow', 'stalled', { type, reason });
  }

  workflowResumed(type: WorkflowType): void {
    this.log('workflow', 'resumed', { type });
  }

  stepStarted(type: WorkflowType, step: string): void {
    this.log('step', 'started', { type, step });
  }

  stepCompleted(type: WorkflowType, step: string, durationMs: number): void {
    this.log('step', 'completed', { type, step, durationMs });
  }

  stepRetried(type: WorkflowType, step: string, attempt: number, errorCode: string): void {
    this.log('step', 'retried', { type, step, attempt, errorCode });
  }

  stepTimedOut(type: WorkflowType, step: string, timeoutMs: number): void {
    this.log('step', 'timed_out', { type, step, timeoutMs });
  }

  txSubmitted(signer: string, workflowType: WorkflowType): void {
    this.log('tx', 'submitted', { signer, workflowType });
  }

  txConfirmed(signer: string, workflowType: WorkflowType, durationMs: number): void {
    this.log('tx', 'confirmed', { signer, workflowType, durationMs });
  }

  txReverted(signer: string, workflowType: WorkflowType): void {
    this.log('tx', 'reverted', { signer, workflowType });
  }

  txNotFound(signer: string, workflowType: WorkflowType): void {
    this.log('tx', 'not_found', { signer, workflowType });
  }

  workflowRejected(type: WorkflowType, reason: 'type_limit' | 'signer_limit' | 'total_limit'): void {
    this.log('admission', 'rejected', { type, reason });
  }

  reconciliationRan(type: WorkflowType, changed: boolean): void {
    this.log('reconciliation', 'ran', { type, changed });
  }
}
