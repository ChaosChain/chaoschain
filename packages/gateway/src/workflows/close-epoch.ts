/**
 * CloseEpoch Workflow Implementation
 * 
 * Handles closing an epoch to trigger consensus and reward distribution.
 * 
 * Steps:
 * 1. CHECK_PRECONDITIONS - Read-only on-chain checks (structural only)
 * 2. SUBMIT_CLOSE_EPOCH - Submit closeEpoch transaction (irreversible)
 * 3. AWAIT_TX_CONFIRM - Wait for blockchain finality
 * 
 * Preconditions verified (structural only, no inference):
 * - Epoch exists
 * - Epoch is not already closed
 * - Close window is open (if contract enforces)
 * 
 * NOT verified (contract revert → FAILED):
 * - Work exists
 * - Scores exist
 * - Consensus achievable
 * 
 * closeEpoch is economically final - no heuristics or speculative retries.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  CloseEpochRecord,
  CloseEpochInput,
  StepResult,
  ClassifiedError,
} from './types.js';
import { StepExecutor, WorkflowDefinition } from './engine.js';
import { TxQueue, TxRequest } from './tx-queue.js';
import { WorkflowPersistence } from './persistence.js';

// =============================================================================
// EPOCH CHAIN STATE ADAPTER INTERFACE
// =============================================================================

export interface EpochChainStateAdapter {
  /**
   * Check if epoch exists.
   */
  epochExists(studioAddress: string, epoch: number): Promise<boolean>;

  /**
   * Check if epoch is already closed.
   */
  isEpochClosed(studioAddress: string, epoch: number): Promise<boolean>;

  /**
   * Check if close window is open (if contract enforces timing).
   * Returns true if close is allowed, false if too early.
   * Returns true if contract doesn't enforce timing.
   */
  isCloseWindowOpen(studioAddress: string, epoch: number): Promise<boolean>;
}

// =============================================================================
// EPOCH CONTRACT ENCODER INTERFACE
// =============================================================================

export interface EpochContractEncoder {
  /**
   * Encode closeEpoch call data for RewardsDistributor.
   * @param studioAddress - The studio to close epoch for
   * @param epoch - The epoch number to close
   */
  encodeCloseEpoch(studioAddress: string, epoch: number): string;
}

// =============================================================================
// STEP EXECUTORS
// =============================================================================

/**
 * Step 1: Check preconditions (read-only)
 * 
 * Verifies structural legality only:
 * - Epoch exists
 * - Epoch not already closed
 * - Close window open
 * 
 * Does NOT verify:
 * - Work exists
 * - Scores exist
 * - Readiness or consensus
 */
export class CheckPreconditionsStep implements StepExecutor<CloseEpochRecord> {
  private chainState: EpochChainStateAdapter;
  private persistence: WorkflowPersistence;

  constructor(chainState: EpochChainStateAdapter, persistence: WorkflowPersistence) {
    this.chainState = chainState;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    // Read-only, not irreversible
    return false;
  }

  async execute(workflow: CloseEpochRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already checked, skip
    if (progress.preconditions_checked) {
      return { type: 'SUCCESS', nextStep: 'SUBMIT_CLOSE_EPOCH' };
    }

    try {
      // Check 1: Epoch exists
      const exists = await this.chainState.epochExists(
        input.studio_address,
        input.epoch
      );
      if (!exists) {
        return {
          type: 'FAILED',
          error: {
            category: 'PERMANENT',
            message: `Epoch ${input.epoch} does not exist`,
            code: 'EPOCH_NOT_FOUND',
          },
        };
      }

      // Check 2: Epoch not already closed
      const isClosed = await this.chainState.isEpochClosed(
        input.studio_address,
        input.epoch
      );
      if (isClosed) {
        return {
          type: 'FAILED',
          error: {
            category: 'PERMANENT',
            message: `Epoch ${input.epoch} is already closed`,
            code: 'EPOCH_ALREADY_CLOSED',
          },
        };
      }

      // Check 3: Close window is open
      const windowOpen = await this.chainState.isCloseWindowOpen(
        input.studio_address,
        input.epoch
      );
      if (!windowOpen) {
        return {
          type: 'FAILED',
          error: {
            category: 'PERMANENT',
            message: `Close window not yet open for epoch ${input.epoch}`,
            code: 'CLOSE_WINDOW_NOT_OPEN',
          },
        };
      }

      // All preconditions passed
      await this.persistence.appendProgress(workflow.id, {
        preconditions_checked: true,
        preconditions_checked_at: Date.now(),
      });

      return { type: 'SUCCESS', nextStep: 'SUBMIT_CLOSE_EPOCH' };
    } catch (error) {
      // RPC/network errors are transient
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'PRECONDITION_CHECK_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

/**
 * Step 2: Submit closeEpoch transaction
 * 
 * This is economically final - closeEpoch triggers consensus and rewards.
 * No heuristics or speculative retries.
 */
export class SubmitCloseEpochStep implements StepExecutor<CloseEpochRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private encoder: EpochContractEncoder;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    encoder: EpochContractEncoder
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.encoder = encoder;
  }

  isIrreversible(): boolean {
    // closeEpoch is economically final - MUST reconcile first
    return true;
  }

  async execute(workflow: CloseEpochRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a tx hash, skip to confirmation
    if (progress.close_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_TX_CONFIRM' };
    }

    // Precondition: preconditions must be checked
    if (!progress.preconditions_checked) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'Preconditions not checked',
          code: 'PRECONDITIONS_NOT_CHECKED',
        },
      };
    }

    // Encode transaction for RewardsDistributor.closeEpoch(address studio, uint64 epoch)
    const txData = this.encoder.encodeCloseEpoch(input.studio_address, input.epoch);

    // Get RewardsDistributor address from input or environment
    const rewardsDistributorAddress = input.rewards_distributor_address 
      ?? process.env.REWARDS_DISTRIBUTOR_ADDRESS 
      ?? '0x0549772a3fF4F095C57AEFf655B3ed97B7925C19'; // Sepolia default

    const txRequest: TxRequest = {
      to: rewardsDistributorAddress,
      data: txData,
    };

    try {
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        input.signer_address,
        txRequest
      );

      // Persist tx hash (critical checkpoint)
      await this.persistence.appendProgress(workflow.id, { close_tx_hash: txHash });

      return { type: 'SUCCESS', nextStep: 'AWAIT_TX_CONFIRM' };
    } catch (error) {
      const classified = this.classifyTxError(error);

      if (classified.category === 'PERMANENT') {
        return { type: 'FAILED', error: classified };
      }

      return { type: 'RETRY', error: classified };
    }
  }

  private classifyTxError(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);

    // Contract reverts are permanent - closeEpoch is final
    if (message.includes('epoch already closed') || message.includes('already closed')) {
      return {
        category: 'PERMANENT',
        message: 'Epoch already closed',
        code: 'EPOCH_ALREADY_CLOSED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('epoch not found') || message.includes('invalid epoch')) {
      return {
        category: 'PERMANENT',
        message: 'Epoch not found',
        code: 'EPOCH_NOT_FOUND',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('close window') || message.includes('too early') || message.includes('not closeable')) {
      return {
        category: 'PERMANENT',
        message: 'Close window not open',
        code: 'CLOSE_WINDOW_NOT_OPEN',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('no work') || message.includes('no submissions')) {
      return {
        category: 'PERMANENT',
        message: 'No work submissions in epoch',
        code: 'NO_WORK_SUBMISSIONS',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('no scores') || message.includes('no validators')) {
      return {
        category: 'PERMANENT',
        message: 'No score submissions in epoch',
        code: 'NO_SCORE_SUBMISSIONS',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('unauthorized') || message.includes('not authorized')) {
      return {
        category: 'PERMANENT',
        message: 'Not authorized to close epoch',
        code: 'UNAUTHORIZED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    // Nonce issues are recoverable
    if (message.includes('nonce too low')) {
      return {
        category: 'RECOVERABLE',
        message: 'Nonce too low (tx may have landed)',
        code: 'NONCE_TOO_LOW',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    // Network errors are transient (STALLED after max retries)
    if (message.includes('network') || message.includes('timeout')) {
      return {
        category: 'TRANSIENT',
        message: 'Network error',
        code: 'NETWORK_ERROR',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    return {
      category: 'UNKNOWN',
      message,
      code: 'UNKNOWN_TX_ERROR',
      originalError: error instanceof Error ? error : undefined,
    };
  }
}

/**
 * Step 3: Wait for transaction confirmation
 */
export class AwaitCloseEpochConfirmStep implements StepExecutor<CloseEpochRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence) {
    this.txQueue = txQueue;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    return true;
  }

  async execute(workflow: CloseEpochRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, we're done
    if (progress.close_confirmed) {
      return { type: 'SUCCESS', nextStep: null };
    }

    if (!progress.close_tx_hash) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No close tx hash found',
          code: 'MISSING_CLOSE_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.close_tx_hash);

      // Release signer lock after confirmation
      this.txQueue.releaseSignerLock(input.signer_address);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            close_confirmed: true,
            close_block: receipt.blockNumber,
            close_confirmed_at: Date.now(),
          });
          return { type: 'SUCCESS', nextStep: null }; // COMPLETED

        case 'reverted':
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `CloseEpoch transaction reverted: ${receipt.revertReason}`,
              code: 'CLOSE_TX_REVERTED',
            },
          };

        case 'pending':
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'CloseEpoch transaction still pending',
              code: 'CLOSE_TX_PENDING',
            },
          };

        case 'not_found':
          return {
            type: 'STALLED',
            reason: 'CloseEpoch transaction not found after timeout',
          };
      }
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'CLOSE_WAIT_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

// =============================================================================
// WORKFLOW FACTORY
// =============================================================================

/**
 * Create a CloseEpoch workflow record.
 */
export function createCloseEpochWorkflow(
  input: CloseEpochInput
): CloseEpochRecord {
  return {
    id: uuidv4(),
    type: 'CloseEpoch',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'CREATED',
    step: 'CHECK_PRECONDITIONS',
    step_attempts: 0,
    input,
    progress: {},
    signer: input.signer_address,
  };
}

/**
 * Create CloseEpoch workflow definition.
 */
export function createCloseEpochDefinition(
  txQueue: TxQueue,
  persistence: WorkflowPersistence,
  encoder: EpochContractEncoder,
  chainState: EpochChainStateAdapter
): WorkflowDefinition<CloseEpochRecord> {
  const steps = new Map<string, StepExecutor<CloseEpochRecord>>();

  steps.set('CHECK_PRECONDITIONS', new CheckPreconditionsStep(chainState, persistence));
  steps.set('SUBMIT_CLOSE_EPOCH', new SubmitCloseEpochStep(txQueue, persistence, encoder));
  steps.set('AWAIT_TX_CONFIRM', new AwaitCloseEpochConfirmStep(txQueue, persistence));

  return {
    type: 'CloseEpoch',
    initialStep: 'CHECK_PRECONDITIONS',
    steps,
    stepOrder: [
      'CHECK_PRECONDITIONS',
      'SUBMIT_CLOSE_EPOCH',
      'AWAIT_TX_CONFIRM',
    ],
  };
}

// =============================================================================
// DEFAULT ENCODER IMPLEMENTATION
// =============================================================================

export class DefaultEpochContractEncoder implements EpochContractEncoder {
  encodeCloseEpoch(studioAddress: string, epoch: number): string {
    // RewardsDistributor.closeEpoch(address studio, uint64 epoch)
    // Function selector: keccak256("closeEpoch(address,uint64)").slice(0, 10) = 0x1d1a696d
    // 
    // ABI encoding:
    // - address: padded to 32 bytes (left-padded with zeros)
    // - uint64: padded to 32 bytes (left-padded with zeros)
    
    const selector = '0x2b7b2d0b'; // closeEpoch(address,uint64)
    
    // Pad address to 32 bytes (remove 0x prefix, then pad left)
    const addressPadded = studioAddress.slice(2).toLowerCase().padStart(64, '0');
    
    // Pad epoch to 32 bytes
    const epochHex = epoch.toString(16).padStart(64, '0');
    
    return selector + addressPadded + epochHex;
  }
}
