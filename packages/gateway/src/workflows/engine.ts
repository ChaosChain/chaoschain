/**
 * Workflow Execution Engine
 * 
 * Orchestrates workflow execution according to the design model.
 * 
 * Invariants:
 * 1. Workflows are explicit state machines
 * 2. Every step is idempotent
 * 3. Every step is resumable
 * 4. On-chain state is authoritative
 * 5. Crash tolerance (write-ahead persistence)
 * 6. Per-signer serialization
 * 7. Retries are bounded
 * 8. Progress is append-only
 * 
 * Critical:
 * - Reconciliation MUST run before any irreversible action
 * - FAILED = correctness failure (protocol-level, permanent)
 * - STALLED = operational failure (infrastructure-level, temporary)
 * - Workflows MUST NOT synchronously call other workflows
 */

import {
  WorkflowRecord,
  WorkSubmissionRecord,
  StepResult,
  ClassifiedError,
  RetryPolicy,
  DEFAULT_RETRY_POLICY,
} from './types.js';
import { WorkflowPersistence } from './persistence.js';
import { WorkflowReconciler } from './reconciliation.js';

// =============================================================================
// STEP EXECUTOR INTERFACE
// =============================================================================

/**
 * Interface for executing a single workflow step.
 * Each workflow type provides its own step executors.
 */
export interface StepExecutor<TRecord extends WorkflowRecord> {
  /**
   * Execute the step.
   * Returns result indicating success, retry, stall, or fail.
   */
  execute(workflow: TRecord): Promise<StepResult>;

  /**
   * Check if this step involves an irreversible action.
   * If true, reconciliation MUST run before execution.
   */
  isIrreversible(): boolean;
}

// =============================================================================
// WORKFLOW DEFINITION
// =============================================================================

export interface WorkflowDefinition<TRecord extends WorkflowRecord> {
  type: string;
  initialStep: string;
  steps: Map<string, StepExecutor<TRecord>>;
  stepOrder: string[];  // For determining "next step"
}

// =============================================================================
// ENGINE EVENTS
// =============================================================================

export type EngineEvent =
  | { type: 'WORKFLOW_CREATED'; workflowId: string }
  | { type: 'WORKFLOW_STARTED'; workflowId: string }
  | { type: 'STEP_STARTED'; workflowId: string; step: string }
  | { type: 'STEP_COMPLETED'; workflowId: string; step: string; nextStep: string | null }
  | { type: 'STEP_RETRY'; workflowId: string; step: string; attempt: number; error: ClassifiedError }
  | { type: 'WORKFLOW_STALLED'; workflowId: string; reason: string }
  | { type: 'WORKFLOW_FAILED'; workflowId: string; error: ClassifiedError }
  | { type: 'WORKFLOW_COMPLETED'; workflowId: string }
  | { type: 'RECONCILIATION_RAN'; workflowId: string; changed: boolean };

export type EventHandler = (event: EngineEvent) => void;

// =============================================================================
// WORKFLOW ENGINE
// =============================================================================

export class WorkflowEngine {
  private persistence: WorkflowPersistence;
  private reconciler: WorkflowReconciler;
  private definitions: Map<string, WorkflowDefinition<any>> = new Map();
  private retryPolicy: RetryPolicy;
  private eventHandlers: EventHandler[] = [];

  constructor(
    persistence: WorkflowPersistence,
    reconciler: WorkflowReconciler,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY
  ) {
    this.persistence = persistence;
    this.reconciler = reconciler;
    this.retryPolicy = retryPolicy;
  }

  /**
   * Register a workflow definition.
   */
  registerWorkflow<TRecord extends WorkflowRecord>(
    definition: WorkflowDefinition<TRecord>
  ): void {
    this.definitions.set(definition.type, definition);
  }

  /**
   * Subscribe to engine events.
   */
  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: EngineEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Event handler error:', e);
      }
    }
  }

  /**
   * Create a new workflow instance.
   * Workflow is created in CREATED state, not yet started.
   */
  async createWorkflow<TRecord extends WorkflowRecord>(
    record: TRecord
  ): Promise<string> {
    const definition = this.definitions.get(record.type);
    if (!definition) {
      throw new Error(`Unknown workflow type: ${record.type}`);
    }

    // Ensure initial state
    record.state = 'CREATED';
    record.step = definition.initialStep;
    record.step_attempts = 0;
    record.created_at = Date.now();
    record.updated_at = Date.now();

    // Persist (write-ahead)
    await this.persistence.create(record);

    this.emit({ type: 'WORKFLOW_CREATED', workflowId: record.id });

    return record.id;
  }

  /**
   * Start a workflow.
   * Transitions from CREATED to RUNNING and begins execution.
   */
  async startWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.persistence.load(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (workflow.state !== 'CREATED') {
      throw new Error(`Workflow ${workflowId} is not in CREATED state`);
    }

    // Transition to RUNNING
    await this.persistence.updateState(workflowId, 'RUNNING', workflow.step, 0);

    this.emit({ type: 'WORKFLOW_STARTED', workflowId });

    // Begin execution
    await this.runWorkflow(workflowId);
  }

  /**
   * Resume a workflow from current state.
   * Used for RUNNING/STALLED workflows after restart.
   */
  async resumeWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.persistence.load(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (workflow.state === 'COMPLETED' || workflow.state === 'FAILED') {
      // Terminal states, nothing to do
      return;
    }

    if (workflow.state === 'CREATED') {
      // Not started yet, start it
      await this.startWorkflow(workflowId);
      return;
    }

    // RUNNING or STALLED - run reconciliation then continue
    await this.runWorkflow(workflowId);
  }

  /**
   * Run workflow execution loop.
   */
  private async runWorkflow(workflowId: string): Promise<void> {
    while (true) {
      // Load fresh workflow state
      const workflow = await this.persistence.load(workflowId);
      if (!workflow) {
        throw new Error(`Workflow ${workflowId} disappeared`);
      }

      // Check for terminal states
      if (workflow.state === 'COMPLETED' || workflow.state === 'FAILED') {
        return;
      }

      // Get definition
      const definition = this.definitions.get(workflow.type);
      if (!definition) {
        throw new Error(`Unknown workflow type: ${workflow.type}`);
      }

      // Get current step executor
      const stepExecutor = definition.steps.get(workflow.step);
      if (!stepExecutor) {
        // No executor for this step - might be terminal
        if (workflow.step === 'COMPLETED') {
          await this.transitionToCompleted(workflowId);
          return;
        }
        throw new Error(`Unknown step: ${workflow.step}`);
      }

      // =======================================================================
      // RECONCILIATION: Must run before irreversible actions
      // =======================================================================
      if (stepExecutor.isIrreversible()) {
        const reconcileResult = await this.reconciler.reconcileWorkSubmission(
          workflow as WorkSubmissionRecord
        );
        const { workflow: reconciledWorkflow, stateChanged } = 
          this.reconciler.applyReconciliationResult(
            workflow as WorkSubmissionRecord,
            reconcileResult
          );

        this.emit({ 
          type: 'RECONCILIATION_RAN', 
          workflowId, 
          changed: stateChanged 
        });

        if (stateChanged) {
          // Persist reconciled state
          await this.persistence.updateState(
            workflowId,
            reconciledWorkflow.state,
            reconciledWorkflow.step,
            reconciledWorkflow.step_attempts
          );
          if (reconciledWorkflow.progress !== workflow.progress) {
            await this.persistence.appendProgress(
              workflowId,
              reconciledWorkflow.progress as Record<string, unknown>
            );
          }
          if (reconciledWorkflow.error) {
            await this.persistence.setError(workflowId, reconciledWorkflow.error);
          }

          // If now in terminal state, exit
          if (reconciledWorkflow.state === 'COMPLETED') {
            this.emit({ type: 'WORKFLOW_COMPLETED', workflowId });
            return;
          }
          if (reconciledWorkflow.state === 'FAILED') {
            this.emit({ 
              type: 'WORKFLOW_FAILED', 
              workflowId, 
              error: {
                category: 'PERMANENT',
                message: reconciledWorkflow.error!.message,
                code: reconciledWorkflow.error!.code,
              }
            });
            return;
          }

          // Continue with updated state
          continue;
        }
      }

      // =======================================================================
      // EXECUTE STEP
      // =======================================================================
      this.emit({ type: 'STEP_STARTED', workflowId, step: workflow.step });

      let result: StepResult;
      try {
        result = await stepExecutor.execute(workflow);
      } catch (error) {
        // Unexpected error - classify as unknown
        result = {
          type: 'RETRY',
          error: {
            category: 'UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
            code: 'UNEXPECTED_ERROR',
            originalError: error instanceof Error ? error : undefined,
          },
        };
      }

      // =======================================================================
      // HANDLE RESULT
      // =======================================================================
      switch (result.type) {
        case 'SUCCESS':
          this.emit({ 
            type: 'STEP_COMPLETED', 
            workflowId, 
            step: workflow.step, 
            nextStep: result.nextStep 
          });

          if (result.nextStep === null) {
            // Workflow complete
            await this.transitionToCompleted(workflowId);
            return;
          }

          // Advance to next step
          await this.persistence.updateState(
            workflowId,
            'RUNNING',
            result.nextStep,
            0
          );
          // Continue loop
          break;

        case 'RETRY':
          const newAttempts = workflow.step_attempts + 1;
          this.emit({ 
            type: 'STEP_RETRY', 
            workflowId, 
            step: workflow.step, 
            attempt: newAttempts,
            error: result.error 
          });

          if (newAttempts >= this.retryPolicy.max_attempts) {
            // Max retries exceeded - stall or fail
            if (result.error.category === 'PERMANENT') {
              await this.transitionToFailed(workflowId, result.error);
              return;
            } else {
              await this.transitionToStalled(workflowId, result.error.message);
              return;
            }
          }

          // Update attempt count
          await this.persistence.updateState(
            workflowId,
            'RUNNING',
            workflow.step,
            newAttempts
          );

          // Wait before retry
          const delay = this.calculateDelay(newAttempts);
          await this.sleep(delay);
          // Continue loop
          break;

        case 'STALLED':
          this.emit({ type: 'WORKFLOW_STALLED', workflowId, reason: result.reason });
          await this.transitionToStalled(workflowId, result.reason);
          return;

        case 'FAILED':
          this.emit({ type: 'WORKFLOW_FAILED', workflowId, error: result.error });
          await this.transitionToFailed(workflowId, result.error);
          return;
      }
    }
  }

  /**
   * Reconcile and resume all active workflows.
   * Called on Gateway startup.
   */
  async reconcileAllActive(): Promise<void> {
    const activeWorkflows = await this.persistence.findActiveWorkflows();

    for (const workflow of activeWorkflows) {
      try {
        await this.resumeWorkflow(workflow.id);
      } catch (error) {
        console.error(`Failed to resume workflow ${workflow.id}:`, error);
        // Continue with other workflows
      }
    }
  }

  // ===========================================================================
  // PRIVATE: State Transitions
  // ===========================================================================

  private async transitionToCompleted(workflowId: string): Promise<void> {
    await this.persistence.updateState(workflowId, 'COMPLETED', 'COMPLETED', 0);
    this.emit({ type: 'WORKFLOW_COMPLETED', workflowId });
  }

  private async transitionToFailed(
    workflowId: string,
    error: ClassifiedError
  ): Promise<void> {
    const workflow = await this.persistence.load(workflowId);
    await this.persistence.updateState(workflowId, 'FAILED', workflow?.step ?? 'UNKNOWN', 0);
    await this.persistence.setError(workflowId, {
      step: workflow?.step ?? 'UNKNOWN',
      message: error.message,
      code: error.code,
      timestamp: Date.now(),
      recoverable: false,
    });
  }

  private async transitionToStalled(
    workflowId: string,
    reason: string
  ): Promise<void> {
    const workflow = await this.persistence.load(workflowId);
    await this.persistence.updateState(workflowId, 'STALLED', workflow?.step ?? 'UNKNOWN', 0);
    await this.persistence.setError(workflowId, {
      step: workflow?.step ?? 'UNKNOWN',
      message: reason,
      code: 'STALLED',
      timestamp: Date.now(),
      recoverable: true,  // STALLED is operational, potentially recoverable
    });
  }

  // ===========================================================================
  // PRIVATE: Retry Delay Calculation
  // ===========================================================================

  private calculateDelay(attempt: number): number {
    const { initial_delay_ms, max_delay_ms, backoff_multiplier, jitter } = this.retryPolicy;

    let delay = initial_delay_ms * Math.pow(backoff_multiplier, attempt - 1);
    delay = Math.min(delay, max_delay_ms);

    if (jitter) {
      // Add ±25% jitter
      const jitterRange = delay * 0.25;
      delay = delay - jitterRange + (Math.random() * jitterRange * 2);
    }

    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
