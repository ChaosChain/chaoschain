/**
 * WorkSubmission Workflow Implementation
 * 
 * Handles the full flow of submitting worker evidence:
 * 1. UPLOAD_EVIDENCE - Upload evidence package to Arweave
 * 2. AWAIT_ARWEAVE_CONFIRM - Poll for Arweave confirmation
 * 3. SUBMIT_WORK_ONCHAIN - Submit transaction to StudioProxy
 * 4. AWAIT_TX_CONFIRM - Wait for blockchain finality
 * 
 * See: GatewayWorkflowExecutionModel.md
 */

import { v4 as uuidv4 } from 'uuid';
import {
  WorkSubmissionRecord,
  WorkSubmissionInput,
  StepResult,
  ClassifiedError,
} from './types.js';
import { StepExecutor, WorkflowDefinition } from './engine.js';
import { TxQueue, TxRequest } from './tx-queue.js';
import { WorkflowPersistence } from './persistence.js';
import { computeDKG } from '../services/dkg/engine.js';

// =============================================================================
// ARWEAVE ADAPTER INTERFACE
// =============================================================================

export interface ArweaveUploader {
  /**
   * Upload content to Arweave.
   * Returns transaction ID.
   */
  upload(content: Buffer, tags?: Record<string, string>): Promise<string>;

  /**
   * Check if transaction is confirmed.
   */
  isConfirmed(txId: string): Promise<boolean>;
}

// =============================================================================
// CONTRACT ENCODER INTERFACE
// =============================================================================

export interface ContractEncoder {
  /**
   * Encode submitWork call data.
   */
  encodeSubmitWork(
    dataHash: string,
    threadRoot: string,
    evidenceRoot: string,
    evidenceUri: string
  ): string;

  /**
   * Encode submitWorkMultiAgent call data.
   */
  encodeSubmitWorkMultiAgent(
    dataHash: string,
    threadRoot: string,
    evidenceRoot: string,
    workers: string[],
    weights: number[],
    evidenceUri: string
  ): string;
}

// =============================================================================
// REWARDS DISTRIBUTOR ENCODER INTERFACE
// =============================================================================

export interface RewardsDistributorEncoder {
  /**
   * Encode registerWork call data for RewardsDistributor.
   * @param studioAddress - The studio address
   * @param epoch - The epoch number
   * @param dataHash - The work data hash
   */
  encodeRegisterWork(studioAddress: string, epoch: number, dataHash: string): string;
}

// =============================================================================
// REWARDS DISTRIBUTOR STATE ADAPTER INTERFACE
// =============================================================================

export interface RewardsDistributorStateAdapter {
  /**
   * Check if work is registered in RewardsDistributor for an epoch.
   * @param studioAddress - The studio address
   * @param epoch - The epoch number
   * @param dataHash - The work data hash
   */
  isWorkRegistered(studioAddress: string, epoch: number, dataHash: string): Promise<boolean>;
}

// =============================================================================
// STEP EXECUTORS
// =============================================================================

/**
 * Step 0: Compute DKG (thread_root, evidence_root, weights)
 *
 * Pure, synchronous computation over the caller-provided evidence packages.
 * Persists results to progress so downstream steps never depend on caller-supplied roots.
 */
export class ComputeDKGStep implements StepExecutor<WorkSubmissionRecord> {
  private persistence: WorkflowPersistence;

  constructor(persistence: WorkflowPersistence) {
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    return false;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    if (progress.dkg_thread_root) {
      return { type: 'SUCCESS', nextStep: 'UPLOAD_EVIDENCE' };
    }

    try {
      const result = computeDKG(input.dkg_evidence);

      const weights: Record<string, number> = {};
      for (const [agent, weight] of result.weights) {
        weights[agent] = weight;
      }

      await this.persistence.appendProgress(workflow.id, {
        dkg_thread_root: result.thread_root,
        dkg_evidence_root: result.evidence_root,
        dkg_weights: weights,
      });

      return { type: 'SUCCESS', nextStep: 'UPLOAD_EVIDENCE' };
    } catch (error) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'DKG_COMPUTATION_FAILED',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

/**
 * Step 1: Upload evidence to Arweave
 */
export class UploadEvidenceStep implements StepExecutor<WorkSubmissionRecord> {
  private arweave: ArweaveUploader;
  private persistence: WorkflowPersistence;

  constructor(arweave: ArweaveUploader, persistence: WorkflowPersistence) {
    this.arweave = arweave;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    // Arweave upload is permanent but can be retried with same content
    return false;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have an arweave tx, skip
    if (progress.arweave_tx_id) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_ARWEAVE_CONFIRM' };
    }

    try {
      const txId = await this.arweave.upload(input.evidence_content, {
        'Content-Type': 'application/octet-stream',
        'ChaosChain-Studio': input.studio_address,
        'ChaosChain-Epoch': String(input.epoch),
        'ChaosChain-DataHash': input.data_hash,
        'ChaosChain-Agent': input.agent_address,
      });

      // Persist progress (append-only)
      await this.persistence.appendProgress(workflow.id, { arweave_tx_id: txId });

      return { type: 'SUCCESS', nextStep: 'AWAIT_ARWEAVE_CONFIRM' };
    } catch (error) {
      const classified = this.classifyError(error);

      if (classified.category === 'PERMANENT') {
        return { type: 'FAILED', error: classified };
      }

      return { type: 'RETRY', error: classified };
    }
  }

  private classifyError(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);
    
    // Classify based on error patterns
    if (message.includes('insufficient funds')) {
      return {
        category: 'RECOVERABLE',
        message: 'Insufficient Arweave funds',
        code: 'ARWEAVE_INSUFFICIENT_FUNDS',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('invalid content') || message.includes('rejected')) {
      return {
        category: 'PERMANENT',
        message: 'Arweave rejected content',
        code: 'ARWEAVE_REJECTED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    // Network errors are transient
    if (message.includes('network') || message.includes('timeout') || message.includes('ECONNREFUSED')) {
      return {
        category: 'TRANSIENT',
        message: 'Network error during Arweave upload',
        code: 'NETWORK_ERROR',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    return {
      category: 'UNKNOWN',
      message,
      code: 'UNKNOWN_ERROR',
      originalError: error instanceof Error ? error : undefined,
    };
  }
}

/**
 * Step 2: Wait for Arweave confirmation
 */
export class AwaitArweaveConfirmStep implements StepExecutor<WorkSubmissionRecord> {
  private arweave: ArweaveUploader;
  private persistence: WorkflowPersistence;
  private maxWaitMs: number;

  constructor(
    arweave: ArweaveUploader,
    persistence: WorkflowPersistence,
    maxWaitMs: number = 600000 // 10 minutes
  ) {
    this.arweave = arweave;
    this.persistence = persistence;
    this.maxWaitMs = maxWaitMs;
  }

  isIrreversible(): boolean {
    return false;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { progress, created_at } = workflow;

    // Idempotency: if already confirmed, skip
    if (progress.arweave_confirmed) {
      return { type: 'SUCCESS', nextStep: 'SUBMIT_WORK_ONCHAIN' };
    }

    if (!progress.arweave_tx_id) {
      // Should not happen if state machine is correct
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No Arweave tx ID found',
          code: 'MISSING_ARWEAVE_TX',
        },
      };
    }

    try {
      const confirmed = await this.arweave.isConfirmed(progress.arweave_tx_id);

      if (confirmed) {
        await this.persistence.appendProgress(workflow.id, {
          arweave_confirmed: true,
          arweave_confirmed_at: Date.now(),
        });
        return { type: 'SUCCESS', nextStep: 'SUBMIT_WORK_ONCHAIN' };
      }

      // Check timeout
      const elapsed = Date.now() - created_at;
      if (elapsed > this.maxWaitMs) {
        return {
          type: 'STALLED',
          reason: `Arweave confirmation timeout after ${Math.floor(elapsed / 1000)}s`,
        };
      }

      // Not yet confirmed, retry
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: 'Arweave tx not yet confirmed',
          code: 'ARWEAVE_PENDING',
        },
      };
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'ARWEAVE_CHECK_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

/**
 * Step 3: Submit work on-chain
 */
export class SubmitWorkOnchainStep implements StepExecutor<WorkSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private contractEncoder: ContractEncoder;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    contractEncoder: ContractEncoder
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.contractEncoder = contractEncoder;
  }

  isIrreversible(): boolean {
    // On-chain submission is irreversible - MUST reconcile first
    return true;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a tx hash, skip to confirmation
    if (progress.onchain_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_TX_CONFIRM' };
    }

    if (!progress.arweave_tx_id || !progress.arweave_confirmed) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'Arweave upload not confirmed',
          code: 'ARWEAVE_NOT_READY',
        },
      };
    }

    if (!progress.dkg_thread_root || !progress.dkg_evidence_root) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'DKG roots missing from progress',
          code: 'MISSING_DKG_ROOTS',
        },
      };
    }

    const evidenceUri = `ar://${progress.arweave_tx_id}`;

    const txData = this.contractEncoder.encodeSubmitWork(
      input.data_hash,
      progress.dkg_thread_root,
      progress.dkg_evidence_root,
      evidenceUri
    );

    const txRequest: TxRequest = {
      to: input.studio_address,
      data: txData,
    };

    try {
      // Use submitOnly to get tx hash immediately
      // Lock is held until we explicitly release
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        input.signer_address,
        txRequest
      );

      // Persist tx hash (critical checkpoint)
      await this.persistence.appendProgress(workflow.id, { onchain_tx_hash: txHash });

      return { type: 'SUCCESS', nextStep: 'AWAIT_TX_CONFIRM' };
    } catch (error) {
      // Release lock is handled by txQueue on error
      const classified = this.classifyTxError(error);

      if (classified.category === 'PERMANENT') {
        return { type: 'FAILED', error: classified };
      }

      return { type: 'RETRY', error: classified };
    }
  }

  private classifyTxError(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);

    // Contract reverts are permanent
    if (message.includes('already submitted') || message.includes('work exists')) {
      return {
        category: 'PERMANENT',
        message: 'Work already submitted',
        code: 'ALREADY_SUBMITTED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('epoch closed') || message.includes('epoch not active')) {
      return {
        category: 'PERMANENT',
        message: 'Epoch is closed',
        code: 'EPOCH_CLOSED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('not registered') || message.includes('unauthorized')) {
      return {
        category: 'PERMANENT',
        message: 'Agent not registered',
        code: 'AGENT_NOT_REGISTERED',
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

    // Gas issues are transient (can retry with different gas)
    if (message.includes('gas') || message.includes('out of gas')) {
      return {
        category: 'TRANSIENT',
        message: 'Gas estimation failed',
        code: 'GAS_ERROR',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    // Network errors
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
 * Step 4: Wait for transaction confirmation
 */
export class AwaitTxConfirmStep implements StepExecutor<WorkSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence) {
    this.txQueue = txQueue;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    // Waiting is not irreversible, but should reconcile anyway
    return true;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, we're done
    if (progress.onchain_confirmed) {
      return { type: 'SUCCESS', nextStep: null };
    }

    if (!progress.onchain_tx_hash) {
      // Should not happen if state machine is correct
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No tx hash found',
          code: 'MISSING_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.onchain_tx_hash);

      // Release the signer lock now that tx is confirmed
      this.txQueue.releaseSignerLock(input.signer_address);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            onchain_confirmed: true,
            onchain_block: receipt.blockNumber,
            onchain_confirmed_at: Date.now(),
          });
          // Continue to REGISTER_WORK step
          return { type: 'SUCCESS', nextStep: 'REGISTER_WORK' };

        case 'reverted':
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `Transaction reverted: ${receipt.revertReason}`,
              code: 'TX_REVERTED',
            },
          };

        case 'pending':
          // Still pending, retry
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'Transaction still pending',
              code: 'TX_PENDING',
            },
          };

        case 'not_found':
          // Tx dropped, need to resubmit
          return {
            type: 'STALLED',
            reason: 'Transaction not found after timeout',
          };
      }
    } catch (error) {
      // Don't release lock on error - reconciliation will handle
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'TX_WAIT_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

// =============================================================================
// STEP 5: REGISTER WORK WITH REWARDS DISTRIBUTOR
// =============================================================================

/**
 * Step 5: Register work with RewardsDistributor
 * 
 * After work is submitted to StudioProxy, it must be registered with
 * RewardsDistributor for epoch tracking. This enables closeEpoch().
 */
export class RegisterWorkStep implements StepExecutor<WorkSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private encoder: RewardsDistributorEncoder;
  private rewardsDistributorAddress: string;
  private adminSignerAddress?: string;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    encoder: RewardsDistributorEncoder,
    rewardsDistributorAddress: string,
    adminSignerAddress?: string
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.encoder = encoder;
    this.rewardsDistributorAddress = rewardsDistributorAddress;
    this.adminSignerAddress = adminSignerAddress;
  }

  isIrreversible(): boolean {
    // On-chain registration is irreversible - MUST reconcile first
    return true;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a register tx hash, skip to confirmation
    if (progress.register_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_REGISTER_CONFIRM' };
    }

    // Precondition: work must be confirmed on-chain first
    if (!progress.onchain_confirmed) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'Work not confirmed on-chain before registration',
          code: 'WORK_NOT_CONFIRMED',
        },
      };
    }

    // Encode RewardsDistributor.registerWork(studio, epoch, dataHash)
    const txData = this.encoder.encodeRegisterWork(
      input.studio_address,
      input.epoch,
      input.data_hash
    );

    const txRequest: TxRequest = {
      to: this.rewardsDistributorAddress,
      data: txData,
    };

    try {
      // Use admin signer (RewardsDistributor owner) if configured, otherwise fall back to agent signer
      const signer = this.adminSignerAddress || input.signer_address;
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        signer,
        txRequest
      );

      // Persist tx hash (critical checkpoint)
      await this.persistence.appendProgress(workflow.id, { register_tx_hash: txHash });

      return { type: 'SUCCESS', nextStep: 'AWAIT_REGISTER_CONFIRM' };
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

    // Already registered is idempotent success - but the reconciliation should skip this
    // If we hit this error, something is wrong but we can treat it as success
    if (message.includes('already registered') || message.includes('work exists')) {
      return {
        category: 'PERMANENT',
        message: 'Work already registered (idempotent)',
        code: 'ALREADY_REGISTERED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    // Only owner can register
    if (message.includes('not owner') || message.includes('Ownable')) {
      return {
        category: 'PERMANENT',
        message: 'Only protocol owner can register work',
        code: 'NOT_OWNER',
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

    // Network errors
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
      code: 'UNKNOWN_REGISTER_ERROR',
      originalError: error instanceof Error ? error : undefined,
    };
  }
}

/**
 * Step 6: Wait for register work confirmation
 */
export class AwaitRegisterConfirmStep implements StepExecutor<WorkSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private adminSignerAddress?: string;

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence, adminSignerAddress?: string) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.adminSignerAddress = adminSignerAddress;
  }

  isIrreversible(): boolean {
    return true;
  }

  async execute(workflow: WorkSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, we're done
    if (progress.register_confirmed) {
      return { type: 'SUCCESS', nextStep: null };
    }

    if (!progress.register_tx_hash) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No register tx hash found',
          code: 'MISSING_REGISTER_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.register_tx_hash);

      // Release the signer that was used for the register tx (admin if configured)
      const registerSigner = this.adminSignerAddress || input.signer_address;
      this.txQueue.releaseSignerLock(registerSigner);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            register_confirmed: true,
            register_confirmed_at: Date.now(),
          });
          return { type: 'SUCCESS', nextStep: null };

        case 'reverted':
          // Check if it's because already registered (idempotent success)
          if (receipt.revertReason?.includes('already') || 
              receipt.revertReason?.includes('registered')) {
            // Treat as success - work is registered
            await this.persistence.appendProgress(workflow.id, {
              register_confirmed: true,
              register_confirmed_at: Date.now(),
            });
            return { type: 'SUCCESS', nextStep: null };
          }
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `Register transaction reverted: ${receipt.revertReason}`,
              code: 'REGISTER_TX_REVERTED',
            },
          };

        case 'pending':
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'Register transaction still pending',
              code: 'REGISTER_TX_PENDING',
            },
          };

        case 'not_found':
          return {
            type: 'STALLED',
            reason: 'Register transaction not found after timeout',
          };
      }
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'REGISTER_TX_WAIT_ERROR',
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
 * Create a WorkSubmission workflow record.
 */
export function createWorkSubmissionWorkflow(
  input: WorkSubmissionInput
): WorkSubmissionRecord {
  return {
    id: uuidv4(),
    type: 'WorkSubmission',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'CREATED',
    step: 'COMPUTE_DKG',
    step_attempts: 0,
    input,
    progress: {},
    signer: input.signer_address,
  };
}

/**
 * Create WorkSubmission workflow definition.
 * 
 * The full workflow now includes:
 * 0. COMPUTE_DKG - Compute thread_root and evidence_root via DKG
 * 1. UPLOAD_EVIDENCE - Upload to Arweave
 * 2. AWAIT_ARWEAVE_CONFIRM - Wait for Arweave confirmation
 * 3. SUBMIT_WORK_ONCHAIN - Submit to StudioProxy
 * 4. AWAIT_TX_CONFIRM - Wait for StudioProxy tx confirmation
 * 5. REGISTER_WORK - Register with RewardsDistributor
 * 6. AWAIT_REGISTER_CONFIRM - Wait for registration confirmation
 */
export function createWorkSubmissionDefinition(
  arweave: ArweaveUploader,
  txQueue: TxQueue,
  persistence: WorkflowPersistence,
  contractEncoder: ContractEncoder,
  rewardsDistributorEncoder: RewardsDistributorEncoder,
  rewardsDistributorAddress: string,
  adminSignerAddress?: string
): WorkflowDefinition<WorkSubmissionRecord> {
  const steps = new Map<string, StepExecutor<WorkSubmissionRecord>>();

  steps.set('COMPUTE_DKG', new ComputeDKGStep(persistence));
  steps.set('UPLOAD_EVIDENCE', new UploadEvidenceStep(arweave, persistence));
  steps.set('AWAIT_ARWEAVE_CONFIRM', new AwaitArweaveConfirmStep(arweave, persistence));
  steps.set('SUBMIT_WORK_ONCHAIN', new SubmitWorkOnchainStep(txQueue, persistence, contractEncoder));
  steps.set('AWAIT_TX_CONFIRM', new AwaitTxConfirmStep(txQueue, persistence));
  steps.set('REGISTER_WORK', new RegisterWorkStep(txQueue, persistence, rewardsDistributorEncoder, rewardsDistributorAddress, adminSignerAddress));
  steps.set('AWAIT_REGISTER_CONFIRM', new AwaitRegisterConfirmStep(txQueue, persistence, adminSignerAddress));

  return {
    type: 'WorkSubmission',
    initialStep: 'COMPUTE_DKG',
    steps,
    stepOrder: [
      'COMPUTE_DKG',
      'UPLOAD_EVIDENCE',
      'AWAIT_ARWEAVE_CONFIRM',
      'SUBMIT_WORK_ONCHAIN',
      'AWAIT_TX_CONFIRM',
      'REGISTER_WORK',
      'AWAIT_REGISTER_CONFIRM',
    ],
  };
}
