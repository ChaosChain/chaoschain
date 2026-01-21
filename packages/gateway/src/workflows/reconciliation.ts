/**
 * Workflow Reconciliation
 * 
 * Determines true workflow state from on-chain truth.
 * 
 * Invariant: Reconciliation MUST run before any irreversible action.
 * Invariant: On-chain state is always authoritative over local state.
 * 
 * Reconciliation runs:
 * 1. On Gateway startup (for all RUNNING/STALLED workflows)
 * 2. Before step execution (optionally, to skip completed steps)
 * 3. After timeout (when a step has been pending too long)
 */

import {
  WorkflowRecord,
  WorkSubmissionRecord,
  ScoreSubmissionRecord,
  CloseEpochRecord,
  ArweaveStatus,
} from './types.js';
import { TxQueue } from './tx-queue.js';
import { ScoreChainStateAdapter } from './score-submission.js';
import { EpochChainStateAdapter } from './close-epoch.js';

// =============================================================================
// CHAIN STATE ADAPTER INTERFACE
// =============================================================================

/**
 * Interface for querying on-chain state.
 * Used by reconciliation to determine true workflow state.
 */
export interface ChainStateAdapter {
  /**
   * Check if work submission exists on-chain.
   */
  workSubmissionExists(studioAddress: string, dataHash: string): Promise<boolean>;

  /**
   * Get work submission details.
   * Returns null if not found.
   */
  getWorkSubmission(studioAddress: string, dataHash: string): Promise<{
    dataHash: string;
    submitter: string;
    timestamp: number;
    blockNumber: number;
  } | null>;
}

// =============================================================================
// ARWEAVE ADAPTER INTERFACE
// =============================================================================

/**
 * Interface for querying Arweave status.
 */
export interface ArweaveAdapter {
  /**
   * Check if Arweave transaction is confirmed.
   */
  getStatus(txId: string): Promise<ArweaveStatus>;
}

// =============================================================================
// RECONCILIATION RESULT
// =============================================================================

export type ReconciliationResult =
  | { action: 'NO_CHANGE' }
  | { action: 'ADVANCE_TO_STEP'; step: string }
  | { action: 'COMPLETE' }
  | { action: 'FAIL'; reason: string }
  | { action: 'CLEAR_TX_HASH_AND_RETRY' }
  | { action: 'UPDATE_PROGRESS'; updates: Record<string, unknown> };

// =============================================================================
// RECONCILER
// =============================================================================

export class WorkflowReconciler {
  private chainState: ChainStateAdapter;
  private arweave: ArweaveAdapter;
  private txQueue: TxQueue;
  private scoreChainState?: ScoreChainStateAdapter;
  private epochChainState?: EpochChainStateAdapter;

  constructor(
    chainState: ChainStateAdapter,
    arweave: ArweaveAdapter,
    txQueue: TxQueue,
    scoreChainState?: ScoreChainStateAdapter,
    epochChainState?: EpochChainStateAdapter
  ) {
    this.chainState = chainState;
    this.arweave = arweave;
    this.txQueue = txQueue;
    this.scoreChainState = scoreChainState;
    this.epochChainState = epochChainState;
  }

  /**
   * Reconcile a workflow (routes based on type).
   * 
   * Determines true state by querying on-chain state.
   * Works for WorkSubmission, ScoreSubmission, and CloseEpoch workflows.
   */
  async reconcileWorkSubmission(
    workflow: WorkflowRecord
  ): Promise<ReconciliationResult> {
    // Route to type-specific reconciliation
    if (workflow.type === 'ScoreSubmission') {
      return this.reconcileScoreSubmissionInternal(workflow as ScoreSubmissionRecord);
    }

    if (workflow.type === 'CloseEpoch') {
      return this.reconcileCloseEpochInternal(workflow as CloseEpochRecord);
    }

    // Default: WorkSubmission
    return this.reconcileWorkSubmissionInternal(workflow as WorkSubmissionRecord);
  }

  /**
   * Internal: Reconcile WorkSubmission workflow.
   */
  private async reconcileWorkSubmissionInternal(
    workflow: WorkSubmissionRecord
  ): Promise<ReconciliationResult> {
    const { input, progress, step } = workflow;

    // ==========================================================================
    // RULE 1: Check if work is already on-chain (highest priority)
    // ==========================================================================
    const onChainExists = await this.chainState.workSubmissionExists(
      input.studio_address,
      input.data_hash
    );

    if (onChainExists) {
      // Work is on-chain, workflow should be complete
      return { action: 'COMPLETE' };
    }

    // ==========================================================================
    // RULE 2: Check transaction status (if we have a tx hash)
    // ==========================================================================
    if (progress.onchain_tx_hash) {
      const receipt = await this.txQueue.checkTxStatus(progress.onchain_tx_hash);

      if (receipt === null) {
        // Tx not found - might be pending or dropped
        // Give it some time, then allow retry
        // For now, assume pending and continue
        return { action: 'NO_CHANGE' };
      }

      switch (receipt.status) {
        case 'confirmed':
          // Tx confirmed but work not on chain?
          // This could be a reorg or view inconsistency.
          // Double-check on-chain state.
          const doubleCheck = await this.chainState.workSubmissionExists(
            input.studio_address,
            input.data_hash
          );
          if (doubleCheck) {
            return { action: 'COMPLETE' };
          }
          // Tx confirmed but work not found - should not happen
          return { action: 'FAIL', reason: 'tx_confirmed_but_work_not_found' };

        case 'reverted':
          // Tx reverted - this is a FAILED state
          return { action: 'FAIL', reason: `tx_reverted: ${receipt.revertReason}` };

        case 'pending':
          // Still pending, no change
          return { action: 'NO_CHANGE' };

        case 'not_found':
          // Tx was never mined or was dropped
          // Safe to clear tx hash and retry
          return { action: 'CLEAR_TX_HASH_AND_RETRY' };
      }
    }

    // ==========================================================================
    // RULE 3: Check Arweave status (if we have an arweave tx id)
    // ==========================================================================
    if (progress.arweave_tx_id && !progress.arweave_confirmed) {
      const arweaveStatus = await this.arweave.getStatus(progress.arweave_tx_id);

      switch (arweaveStatus) {
        case 'confirmed':
          // Arweave confirmed, advance to next step
          if (step === 'AWAIT_ARWEAVE_CONFIRM') {
            return {
              action: 'UPDATE_PROGRESS',
              updates: { arweave_confirmed: true, arweave_confirmed_at: Date.now() }
            };
          }
          // If we're past that step, just update progress
          return {
            action: 'UPDATE_PROGRESS',
            updates: { arweave_confirmed: true, arweave_confirmed_at: Date.now() }
          };

        case 'pending':
          // Still pending, no change
          return { action: 'NO_CHANGE' };

        case 'not_found':
          // This is problematic - we thought we uploaded but it's gone
          // This is rare (Arweave should be permanent)
          // For now, treat as operational failure
          return { action: 'NO_CHANGE' };
      }
    }

    // ==========================================================================
    // RULE 4: No reconciliation needed
    // ==========================================================================
    return { action: 'NO_CHANGE' };
  }

  /**
   * Internal: Reconcile ScoreSubmission workflow.
   */
  private async reconcileScoreSubmissionInternal(
    workflow: ScoreSubmissionRecord
  ): Promise<ReconciliationResult> {
    const { input, progress } = workflow;

    if (!this.scoreChainState) {
      // No score chain state adapter, skip reconciliation
      return { action: 'NO_CHANGE' };
    }

    // ==========================================================================
    // RULE 1: Check if reveal already exists (highest priority - workflow done)
    // ==========================================================================
    const revealExists = await this.scoreChainState.revealExists(
      input.studio_address,
      input.data_hash,
      input.validator_address
    );

    if (revealExists) {
      return { action: 'COMPLETE' };
    }

    // ==========================================================================
    // RULE 2: Check reveal tx status (if we have a reveal tx hash)
    // ==========================================================================
    if (progress.reveal_tx_hash) {
      const receipt = await this.txQueue.checkTxStatus(progress.reveal_tx_hash);

      if (receipt === null) {
        return { action: 'NO_CHANGE' };
      }

      switch (receipt.status) {
        case 'confirmed':
          const revealDoubleCheck = await this.scoreChainState.revealExists(
            input.studio_address,
            input.data_hash,
            input.validator_address
          );
          if (revealDoubleCheck) {
            return { action: 'COMPLETE' };
          }
          return { action: 'FAIL', reason: 'reveal_tx_confirmed_but_reveal_not_found' };

        case 'reverted':
          return { action: 'FAIL', reason: `reveal_tx_reverted: ${receipt.revertReason}` };

        case 'pending':
          return { action: 'NO_CHANGE' };

        case 'not_found':
          // Clear reveal tx hash and retry
          return { 
            action: 'UPDATE_PROGRESS', 
            updates: { reveal_tx_hash: undefined } 
          };
      }
    }

    // ==========================================================================
    // RULE 3: Check if commit already exists
    // ==========================================================================
    const commitExists = await this.scoreChainState.commitExists(
      input.studio_address,
      input.data_hash,
      input.validator_address
    );

    if (commitExists && !progress.commit_confirmed) {
      // Commit exists but we don't have it recorded, update progress
      return {
        action: 'UPDATE_PROGRESS',
        updates: { commit_confirmed: true, commit_confirmed_at: Date.now() }
      };
    }

    // ==========================================================================
    // RULE 4: Check commit tx status (if we have a commit tx hash)
    // ==========================================================================
    if (progress.commit_tx_hash && !progress.commit_confirmed) {
      const receipt = await this.txQueue.checkTxStatus(progress.commit_tx_hash);

      if (receipt === null) {
        return { action: 'NO_CHANGE' };
      }

      switch (receipt.status) {
        case 'confirmed':
          const commitDoubleCheck = await this.scoreChainState.commitExists(
            input.studio_address,
            input.data_hash,
            input.validator_address
          );
          if (commitDoubleCheck) {
            return {
              action: 'UPDATE_PROGRESS',
              updates: { 
                commit_confirmed: true, 
                commit_block: receipt.blockNumber,
                commit_confirmed_at: Date.now() 
              }
            };
          }
          return { action: 'FAIL', reason: 'commit_tx_confirmed_but_commit_not_found' };

        case 'reverted':
          return { action: 'FAIL', reason: `commit_tx_reverted: ${receipt.revertReason}` };

        case 'pending':
          return { action: 'NO_CHANGE' };

        case 'not_found':
          // Clear commit tx hash and retry
          return { 
            action: 'UPDATE_PROGRESS', 
            updates: { commit_tx_hash: undefined } 
          };
      }
    }

    // ==========================================================================
    // RULE 5: No reconciliation needed
    // ==========================================================================
    return { action: 'NO_CHANGE' };
  }

  /**
   * Internal: Reconcile CloseEpoch workflow.
   */
  private async reconcileCloseEpochInternal(
    workflow: CloseEpochRecord
  ): Promise<ReconciliationResult> {
    const { input, progress } = workflow;

    if (!this.epochChainState) {
      // No epoch chain state adapter, skip reconciliation
      return { action: 'NO_CHANGE' };
    }

    // ==========================================================================
    // RULE 1: Check if epoch is already closed (highest priority - workflow done)
    // ==========================================================================
    const isClosed = await this.epochChainState.isEpochClosed(
      input.studio_address,
      input.epoch
    );

    if (isClosed) {
      return { action: 'COMPLETE' };
    }

    // ==========================================================================
    // RULE 2: Check close tx status (if we have a tx hash)
    // ==========================================================================
    if (progress.close_tx_hash) {
      const receipt = await this.txQueue.checkTxStatus(progress.close_tx_hash);

      if (receipt === null) {
        return { action: 'NO_CHANGE' };
      }

      switch (receipt.status) {
        case 'confirmed':
          const closedDoubleCheck = await this.epochChainState.isEpochClosed(
            input.studio_address,
            input.epoch
          );
          if (closedDoubleCheck) {
            return { action: 'COMPLETE' };
          }
          // Tx confirmed but epoch not closed - should not happen
          return { action: 'FAIL', reason: 'close_tx_confirmed_but_epoch_not_closed' };

        case 'reverted':
          return { action: 'FAIL', reason: `close_tx_reverted: ${receipt.revertReason}` };

        case 'pending':
          return { action: 'NO_CHANGE' };

        case 'not_found':
          // Clear tx hash and allow retry
          return { 
            action: 'UPDATE_PROGRESS', 
            updates: { close_tx_hash: undefined } 
          };
      }
    }

    // ==========================================================================
    // RULE 3: No reconciliation needed
    // ==========================================================================
    return { action: 'NO_CHANGE' };
  }

  /**
   * Apply reconciliation result to workflow.
   * Returns updated workflow record (or original if no change).
   */
  applyReconciliationResult(
    workflow: WorkflowRecord,
    result: ReconciliationResult
  ): {
    workflow: WorkflowRecord;
    stateChanged: boolean;
  } {
    switch (result.action) {
      case 'NO_CHANGE':
        return { workflow, stateChanged: false };

      case 'COMPLETE':
        return {
          workflow: {
            ...workflow,
            state: 'COMPLETED',
            step: 'COMPLETED',
            updated_at: Date.now(),
          },
          stateChanged: true,
        };

      case 'FAIL':
        return {
          workflow: {
            ...workflow,
            state: 'FAILED',
            updated_at: Date.now(),
            error: {
              step: workflow.step,
              message: result.reason,
              code: 'RECONCILIATION_FAILURE',
              timestamp: Date.now(),
              recoverable: false,
            },
          },
          stateChanged: true,
        };

      case 'CLEAR_TX_HASH_AND_RETRY':
        // Clear tx hash from progress, reset attempts
        const clearedProgress = { ...(workflow.progress as Record<string, unknown>) };
        delete clearedProgress.onchain_tx_hash;
        return {
          workflow: {
            ...workflow,
            progress: clearedProgress,
            step_attempts: 0,
            updated_at: Date.now(),
          },
          stateChanged: true,
        };

      case 'UPDATE_PROGRESS':
        return {
          workflow: {
            ...workflow,
            progress: { ...(workflow.progress as Record<string, unknown>), ...result.updates },
            updated_at: Date.now(),
          },
          stateChanged: true,
        };

      case 'ADVANCE_TO_STEP':
        return {
          workflow: {
            ...workflow,
            step: result.step,
            step_attempts: 0,
            updated_at: Date.now(),
          },
          stateChanged: true,
        };
    }
  }
}
