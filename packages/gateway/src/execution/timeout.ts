/**
 * Step Timeout Enforcement
 * 
 * HARD CONSTRAINT: Timeout → STALLED only.
 * Timeouts are operational failures, not correctness failures.
 * 
 * No control logic.
 * No dynamic adjustment.
 */

import { WorkflowType } from '../workflows/types.js';

// =============================================================================
// TIMEOUT CONFIG
// =============================================================================

export interface TimeoutConfig {
  /**
   * Default timeout for all steps (ms).
   * Applied when no specific timeout is set.
   */
  defaultStepTimeoutMs: number;

  /**
   * Per-workflow-type step timeouts (ms).
   * Keys are step names.
   */
  stepTimeouts?: Partial<Record<WorkflowType, Record<string, number>>>;

  /**
   * Transaction confirmation timeout (ms).
   * How long to wait for tx to be mined.
   */
  txConfirmationTimeoutMs: number;
}

/**
 * Default timeout configuration.
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  // 30 seconds for most steps
  defaultStepTimeoutMs: 30_000,

  // 5 minutes for tx confirmation (blocks can take time)
  txConfirmationTimeoutMs: 5 * 60_000,

  // Specific step timeouts
  stepTimeouts: {
    WorkSubmission: {
      'STORE_EVIDENCE': 60_000, // Arweave can be slow
      'AWAIT_TX_CONFIRM': 5 * 60_000,
    },
    ScoreSubmission: {
      'AWAIT_COMMIT_CONFIRM': 5 * 60_000,
      'AWAIT_REVEAL_CONFIRM': 5 * 60_000,
    },
    CloseEpoch: {
      'AWAIT_TX_CONFIRM': 5 * 60_000,
    },
  },
};

// =============================================================================
// TIMEOUT ERROR
// =============================================================================

export class StepTimeoutError extends Error {
  constructor(
    public readonly workflowType: WorkflowType,
    public readonly step: string,
    public readonly timeoutMs: number
  ) {
    super(`Step timed out: ${workflowType}/${step} after ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
  }
}

// =============================================================================
// TIMEOUT WRAPPER
// =============================================================================

/**
 * Get timeout for a specific step.
 */
export function getStepTimeout(
  config: TimeoutConfig,
  workflowType: WorkflowType,
  step: string
): number {
  const workflowTimeouts = config.stepTimeouts?.[workflowType];
  return workflowTimeouts?.[step] ?? config.defaultStepTimeoutMs;
}

/**
 * Execute a function with timeout.
 * 
 * On timeout:
 * - Throws StepTimeoutError
 * - Caller should transition to STALLED (operational failure)
 * 
 * Does NOT cancel the underlying operation.
 * The operation may still complete after timeout - caller must handle.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  workflowType: WorkflowType,
  step: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new StepTimeoutError(workflowType, step, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// =============================================================================
// TIMEOUT GUARD (for step execution)
// =============================================================================

/**
 * Creates a timeout guard for step execution.
 * 
 * Usage:
 *   const guard = createTimeoutGuard(config, 'WorkSubmission', 'STORE_EVIDENCE');
 *   const result = await guard.execute(() => doWork());
 */
export interface TimeoutGuard {
  timeoutMs: number;
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export function createTimeoutGuard(
  config: TimeoutConfig,
  workflowType: WorkflowType,
  step: string
): TimeoutGuard {
  const timeoutMs = getStepTimeout(config, workflowType, step);
  return {
    timeoutMs,
    execute: <T>(fn: () => Promise<T>) => withTimeout(fn, timeoutMs, workflowType, step),
  };
}
