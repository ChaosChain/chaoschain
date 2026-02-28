/**
 * ScoreSubmission Workflow Implementation
 * 
 * Supports TWO scoring modes:
 * 
 * 1. DIRECT MODE (default, MVP):
 *    - SUBMIT_SCORE_DIRECT - Call submitScoreVectorForWorker
 *    - AWAIT_SCORE_CONFIRM - Wait for confirmation
 *    - REGISTER_VALIDATOR - Register with RewardsDistributor
 *    - AWAIT_REGISTER_VALIDATOR_CONFIRM - Wait for confirmation
 * 
 * 2. COMMIT-REVEAL MODE (legacy, available):
 *    - COMMIT_SCORE - Submit commit hash
 *    - AWAIT_COMMIT_CONFIRM - Wait for commit confirmation
 *    - REVEAL_SCORE - Submit reveal with scores
 *    - AWAIT_REVEAL_CONFIRM - Wait for reveal confirmation
 *    - REGISTER_VALIDATOR - Register with RewardsDistributor
 *    - AWAIT_REGISTER_VALIDATOR_CONFIRM - Wait for confirmation
 * 
 * Direct mode is simpler and avoids time-window issues.
 * Commit-reveal prevents last-mover bias but has timing constraints.
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import {
  ScoreSubmissionRecord,
  ScoreSubmissionInput,
  ScoreSubmissionMode,
  StepResult,
  ClassifiedError,
} from './types.js';
import { StepExecutor, WorkflowDefinition } from './engine.js';
import { TxQueue, TxRequest } from './tx-queue.js';
import { WorkflowPersistence } from './persistence.js';

// =============================================================================
// SCORE CONTRACT ENCODER INTERFACE (Commit-Reveal Mode)
// =============================================================================

export interface ScoreContractEncoder {
  /**
   * Compute commit hash from scores and salt.
   * commit = keccak256(abi.encodePacked(dataHash, scores, salt))
   */
  computeCommitHash(
    dataHash: string,
    scores: number[],
    salt: string
  ): string;

  /**
   * Encode commitScore call data.
   */
  encodeCommitScore(
    dataHash: string,
    commitHash: string
  ): string;

  /**
   * Encode revealScore call data.
   */
  encodeRevealScore(
    dataHash: string,
    scores: number[],
    salt: string
  ): string;
}

// =============================================================================
// DIRECT SCORE CONTRACT ENCODER INTERFACE (Direct Mode)
// =============================================================================

export interface DirectScoreContractEncoder {
  /**
   * Encode submitScoreVectorForWorker call data.
   * submitScoreVectorForWorker(bytes32 dataHash, address worker, bytes scoreVector)
   */
  encodeSubmitScoreVectorForWorker(
    dataHash: string,
    workerAddress: string,
    scores: number[]
  ): string;
}

// =============================================================================
// VALIDATOR REGISTRATION ENCODER INTERFACE
// =============================================================================

export interface ValidatorRegistrationEncoder {
  /**
   * Encode registerValidator call data for RewardsDistributor.
   * registerValidator(bytes32 dataHash, address validator)
   */
  encodeRegisterValidator(
    dataHash: string,
    validatorAddress: string
  ): string;

  /**
   * Get the RewardsDistributor address.
   */
  getRewardsDistributorAddress(): string;
}

// =============================================================================
// CHAIN STATE ADAPTER FOR SCORE SUBMISSION
// =============================================================================

export interface ScoreChainStateAdapter {
  /**
   * Check if a commit exists for this validator and data hash.
   * (commit-reveal mode)
   */
  commitExists(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<boolean>;

  /**
   * Check if a reveal exists for this validator and data hash.
   * (commit-reveal mode)
   */
  revealExists(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<boolean>;

  /**
   * Get commit details.
   * (commit-reveal mode)
   */
  getCommit(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<{ commitHash: string; timestamp: number } | null>;

  /**
   * Check if a direct score exists for this validator, worker, and data hash.
   * (direct mode)
   */
  scoreExistsForWorker?(
    studioAddress: string,
    dataHash: string,
    validator: string,
    worker: string
  ): Promise<boolean>;

  /**
   * Check if validator is registered in RewardsDistributor for this dataHash.
   * (both modes)
   */
  isValidatorRegisteredInRewardsDistributor?(
    dataHash: string,
    validatorAddress: string
  ): Promise<boolean>;
}

// =============================================================================
// STEP EXECUTORS - DIRECT MODE
// =============================================================================

/**
 * Step 1 (Direct): Submit score vector directly
 * Calls StudioProxy.submitScoreVectorForWorker(dataHash, worker, scoreVector)
 */
export class SubmitScoreDirectStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private encoder: DirectScoreContractEncoder;
  private chainState: ScoreChainStateAdapter;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    encoder: DirectScoreContractEncoder,
    chainState: ScoreChainStateAdapter
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.encoder = encoder;
    this.chainState = chainState;
  }

  isIrreversible(): boolean {
    // On-chain score submission is irreversible - MUST reconcile first
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a score tx hash, skip to confirmation
    if (progress.score_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_SCORE_CONFIRM' };
    }

    // Validate required input for direct mode
    if (!input.worker_address) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'worker_address is required for direct scoring mode',
          code: 'MISSING_WORKER_ADDRESS',
        },
      };
    }

    // Reconciliation: check if score already exists on-chain
    if (this.chainState.scoreExistsForWorker) {
      const scoreExists = await this.chainState.scoreExistsForWorker(
        input.studio_address,
        input.data_hash,
        input.validator_address,
        input.worker_address
      );
      if (scoreExists) {
        // Score already on-chain, skip to validator registration
        await this.persistence.appendProgress(workflow.id, {
          score_confirmed: true,
          score_confirmed_at: Date.now(),
        });
        return { type: 'SUCCESS', nextStep: 'REGISTER_VALIDATOR' };
      }
    }

    // Encode transaction
    const txData = this.encoder.encodeSubmitScoreVectorForWorker(
      input.data_hash,
      input.worker_address,
      input.scores
    );

    const txRequest: TxRequest = {
      to: input.studio_address,
      data: txData,
    };

    try {
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        input.signer_address,
        txRequest
      );

      // Persist tx hash (critical checkpoint)
      await this.persistence.appendProgress(workflow.id, { score_tx_hash: txHash });

      return { type: 'SUCCESS', nextStep: 'AWAIT_SCORE_CONFIRM' };
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

    // Contract reverts are permanent
    if (message.includes('already scored') || message.includes('score exists')) {
      return {
        category: 'PERMANENT',
        message: 'Score already submitted for this worker',
        code: 'ALREADY_SCORED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('not registered') || message.includes('unauthorized') || message.includes('not a validator')) {
      return {
        category: 'PERMANENT',
        message: 'Not a registered validator',
        code: 'NOT_VALIDATOR',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('no work') || message.includes('work not found')) {
      return {
        category: 'PERMANENT',
        message: 'Work submission not found',
        code: 'WORK_NOT_FOUND',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('invalid worker') || message.includes('not a participant')) {
      return {
        category: 'PERMANENT',
        message: 'Worker is not a participant in this work',
        code: 'INVALID_WORKER',
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

    // Network errors are transient
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
 * Step 2 (Direct): Wait for score transaction confirmation
 */
export class AwaitScoreConfirmStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence) {
    this.txQueue = txQueue;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, move to validator registration
    if (progress.score_confirmed) {
      return { type: 'SUCCESS', nextStep: 'REGISTER_VALIDATOR' };
    }

    if (!progress.score_tx_hash) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No score tx hash found',
          code: 'MISSING_SCORE_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.score_tx_hash);

      // Release signer lock after confirmation
      this.txQueue.releaseSignerLock(input.signer_address);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            score_confirmed: true,
            score_block: receipt.blockNumber,
            score_confirmed_at: Date.now(),
          });
          return { type: 'SUCCESS', nextStep: 'REGISTER_VALIDATOR' };

        case 'reverted':
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `Score transaction reverted: ${receipt.revertReason}`,
              code: 'SCORE_TX_REVERTED',
            },
          };

        case 'pending':
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'Score transaction still pending',
              code: 'SCORE_TX_PENDING',
            },
          };

        case 'not_found':
          return {
            type: 'STALLED',
            reason: 'Score transaction not found after timeout',
          };
      }
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'SCORE_WAIT_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

// =============================================================================
// STEP EXECUTORS - COMMIT-REVEAL MODE
// =============================================================================

/**
 * Step 1 (Commit-Reveal): Submit commit hash on-chain
 */
export class CommitScoreStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private encoder: ScoreContractEncoder;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    encoder: ScoreContractEncoder,
    _chainState: ScoreChainStateAdapter // Used by reconciler, not this step
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.encoder = encoder;
  }

  isIrreversible(): boolean {
    // On-chain commit is irreversible - MUST reconcile first
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a commit tx hash, skip to confirmation
    if (progress.commit_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_COMMIT_CONFIRM' };
    }

    // Compute commit hash if not already done
    let commitHash = progress.commit_hash;
    if (!commitHash) {
      commitHash = this.encoder.computeCommitHash(
        input.data_hash,
        input.scores,
        input.salt
      );
      await this.persistence.appendProgress(workflow.id, { commit_hash: commitHash });
    }

    // Encode transaction
    const txData = this.encoder.encodeCommitScore(input.data_hash, commitHash);

    const txRequest: TxRequest = {
      to: input.studio_address,
      data: txData,
    };

    try {
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        input.signer_address,
        txRequest
      );

      // Persist tx hash (critical checkpoint)
      await this.persistence.appendProgress(workflow.id, { commit_tx_hash: txHash });

      return { type: 'SUCCESS', nextStep: 'AWAIT_COMMIT_CONFIRM' };
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

    // Contract reverts are permanent
    if (message.includes('already committed') || message.includes('commit exists')) {
      return {
        category: 'PERMANENT',
        message: 'Score already committed',
        code: 'ALREADY_COMMITTED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('epoch closed') || message.includes('commit window closed')) {
      return {
        category: 'PERMANENT',
        message: 'Commit window closed',
        code: 'COMMIT_WINDOW_CLOSED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('not registered') || message.includes('unauthorized') || message.includes('not a validator')) {
      return {
        category: 'PERMANENT',
        message: 'Not a registered validator',
        code: 'NOT_VALIDATOR',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('no work') || message.includes('work not found')) {
      return {
        category: 'PERMANENT',
        message: 'Work submission not found',
        code: 'WORK_NOT_FOUND',
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

    // Network errors are transient
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
 * Step 2: Wait for commit transaction confirmation
 */
export class AwaitCommitConfirmStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence) {
    this.txQueue = txQueue;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, move to reveal
    if (progress.commit_confirmed) {
      return { type: 'SUCCESS', nextStep: 'REVEAL_SCORE' };
    }

    if (!progress.commit_tx_hash) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No commit tx hash found',
          code: 'MISSING_COMMIT_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.commit_tx_hash);

      // Release signer lock after confirmation
      this.txQueue.releaseSignerLock(input.signer_address);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            commit_confirmed: true,
            commit_block: receipt.blockNumber,
            commit_confirmed_at: Date.now(),
          });
          return { type: 'SUCCESS', nextStep: 'REVEAL_SCORE' };

        case 'reverted':
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `Commit transaction reverted: ${receipt.revertReason}`,
              code: 'COMMIT_TX_REVERTED',
            },
          };

        case 'pending':
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'Commit transaction still pending',
              code: 'COMMIT_TX_PENDING',
            },
          };

        case 'not_found':
          return {
            type: 'STALLED',
            reason: 'Commit transaction not found after timeout',
          };
      }
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'COMMIT_WAIT_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

/**
 * Step 3: Submit reveal with actual scores
 */
export class RevealScoreStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private encoder: ScoreContractEncoder;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    encoder: ScoreContractEncoder,
    _chainState: ScoreChainStateAdapter // Used by reconciler, not this step
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.encoder = encoder;
  }

  isIrreversible(): boolean {
    // On-chain reveal is irreversible - MUST reconcile first
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a reveal tx hash, skip to confirmation
    if (progress.reveal_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_REVEAL_CONFIRM' };
    }

    // Precondition: commit must be confirmed
    if (!progress.commit_confirmed) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'Commit not confirmed',
          code: 'COMMIT_NOT_CONFIRMED',
        },
      };
    }

    // Encode reveal transaction
    const txData = this.encoder.encodeRevealScore(
      input.data_hash,
      input.scores,
      input.salt
    );

    const txRequest: TxRequest = {
      to: input.studio_address,
      data: txData,
    };

    try {
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        input.signer_address,
        txRequest
      );

      // Persist tx hash (critical checkpoint)
      await this.persistence.appendProgress(workflow.id, { reveal_tx_hash: txHash });

      return { type: 'SUCCESS', nextStep: 'AWAIT_REVEAL_CONFIRM' };
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

    // Contract reverts are permanent
    if (message.includes('already revealed') || message.includes('reveal exists')) {
      return {
        category: 'PERMANENT',
        message: 'Score already revealed',
        code: 'ALREADY_REVEALED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('reveal window closed') || message.includes('epoch closed')) {
      return {
        category: 'PERMANENT',
        message: 'Reveal window closed',
        code: 'REVEAL_WINDOW_CLOSED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('commit mismatch') || message.includes('invalid reveal')) {
      return {
        category: 'PERMANENT',
        message: 'Reveal does not match commit',
        code: 'COMMIT_MISMATCH',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('no commit') || message.includes('commit not found')) {
      return {
        category: 'PERMANENT',
        message: 'No commit found for reveal',
        code: 'NO_COMMIT',
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

    // Network errors are transient
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
 * Step 4: Wait for reveal transaction confirmation
 */
export class AwaitRevealConfirmStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence) {
    this.txQueue = txQueue;
    this.persistence = persistence;
  }

  isIrreversible(): boolean {
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, move to register validator
    if (progress.reveal_confirmed) {
      return { type: 'SUCCESS', nextStep: 'REGISTER_VALIDATOR' };
    }

    if (!progress.reveal_tx_hash) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No reveal tx hash found',
          code: 'MISSING_REVEAL_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.reveal_tx_hash);

      // Release signer lock after confirmation
      this.txQueue.releaseSignerLock(input.signer_address);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            reveal_confirmed: true,
            reveal_block: receipt.blockNumber,
            reveal_confirmed_at: Date.now(),
          });
          // After reveal confirmed, register validator with RewardsDistributor
          return { type: 'SUCCESS', nextStep: 'REGISTER_VALIDATOR' };

        case 'reverted':
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `Reveal transaction reverted: ${receipt.revertReason}`,
              code: 'REVEAL_TX_REVERTED',
            },
          };

        case 'pending':
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'Reveal transaction still pending',
              code: 'REVEAL_TX_PENDING',
            },
          };

        case 'not_found':
          return {
            type: 'STALLED',
            reason: 'Reveal transaction not found after timeout',
          };
      }
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'REVEAL_WAIT_ERROR',
          originalError: error instanceof Error ? error : undefined,
        },
      };
    }
  }
}

// =============================================================================
// REGISTER VALIDATOR STEP
// =============================================================================

/**
 * Step 5: Register validator with RewardsDistributor.
 * 
 * This step bridges the gap between StudioProxy (where scores are submitted)
 * and RewardsDistributor (where validators are tracked for closeEpoch).
 */
export class RegisterValidatorStep implements StepExecutor<ScoreSubmissionRecord> {
  private txQueue: TxQueue;
  private persistence: WorkflowPersistence;
  private validatorEncoder: ValidatorRegistrationEncoder;
  private chainState: ScoreChainStateAdapter;
  private adminSignerAddress?: string;

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    validatorEncoder: ValidatorRegistrationEncoder,
    chainState: ScoreChainStateAdapter,
    adminSignerAddress?: string
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.validatorEncoder = validatorEncoder;
    this.chainState = chainState;
    this.adminSignerAddress = adminSignerAddress;
  }

  isIrreversible(): boolean {
    return true;
  }

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if we already have a register tx hash, skip to confirmation
    if (progress.register_validator_tx_hash) {
      return { type: 'SUCCESS', nextStep: 'AWAIT_REGISTER_VALIDATOR_CONFIRM' };
    }

    // Check if already registered (idempotent)
    if (this.chainState.isValidatorRegisteredInRewardsDistributor) {
      const isRegistered = await this.chainState.isValidatorRegisteredInRewardsDistributor(
        input.data_hash,
        input.validator_address
      );
      if (isRegistered) {
        // Already registered, skip to completion
        await this.persistence.appendProgress(workflow.id, {
          register_validator_confirmed: true,
          register_validator_confirmed_at: Date.now(),
        });
        return { type: 'SUCCESS', nextStep: null }; // COMPLETED
      }
    }

    // Precondition: score must be confirmed (direct mode sets score_confirmed, commit-reveal sets reveal_confirmed)
    if (!progress.reveal_confirmed && !progress.score_confirmed) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'Score not confirmed (neither reveal_confirmed nor score_confirmed)',
          code: 'SCORE_NOT_CONFIRMED',
        },
      };
    }

    // Encode registerValidator transaction
    const txData = this.validatorEncoder.encodeRegisterValidator(
      input.data_hash,
      input.validator_address
    );

    const txRequest: TxRequest = {
      to: this.validatorEncoder.getRewardsDistributorAddress(),
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
      await this.persistence.appendProgress(workflow.id, {
        register_validator_tx_hash: txHash
      });

      return { type: 'SUCCESS', nextStep: 'AWAIT_REGISTER_VALIDATOR_CONFIRM' };
    } catch (error) {
      const classified = this.classifyTxError(error);

      if (classified.category === 'PERMANENT') {
        // If already registered, treat as success
        if (classified.code === 'ALREADY_REGISTERED') {
          await this.persistence.appendProgress(workflow.id, {
            register_validator_confirmed: true,
            register_validator_confirmed_at: Date.now(),
          });
          return { type: 'SUCCESS', nextStep: null }; // COMPLETED
        }
        return { type: 'FAILED', error: classified };
      }

      return { type: 'RETRY', error: classified };
    }
  }

  private classifyTxError(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);

    // Contract reverts
    if (message.includes('already') || message.includes('registered')) {
      return {
        category: 'PERMANENT',
        message: 'Validator already registered',
        code: 'ALREADY_REGISTERED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('not owner') || message.includes('unauthorized') || message.includes('onlyOwner')) {
      return {
        category: 'PERMANENT',
        message: 'Not authorized to register validator',
        code: 'NOT_AUTHORIZED',
        originalError: error instanceof Error ? error : undefined,
      };
    }

    if (message.includes('no work') || message.includes('work not found')) {
      return {
        category: 'PERMANENT',
        message: 'Work not registered',
        code: 'WORK_NOT_REGISTERED',
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

    // Network errors are transient
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
 * Step 6: Wait for register validator transaction confirmation.
 */
export class AwaitRegisterValidatorConfirmStep implements StepExecutor<ScoreSubmissionRecord> {
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

  async execute(workflow: ScoreSubmissionRecord): Promise<StepResult> {
    const { input, progress } = workflow;

    // Idempotency: if already confirmed, we're done
    if (progress.register_validator_confirmed) {
      return { type: 'SUCCESS', nextStep: null };
    }

    if (!progress.register_validator_tx_hash) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'No register validator tx hash found',
          code: 'MISSING_REGISTER_VALIDATOR_TX_HASH',
        },
      };
    }

    try {
      const receipt = await this.txQueue.waitForTx(progress.register_validator_tx_hash);

      // Release the signer that was used for the register tx (admin if configured)
      const registerSigner = this.adminSignerAddress || input.signer_address;
      this.txQueue.releaseSignerLock(registerSigner);

      switch (receipt.status) {
        case 'confirmed':
          await this.persistence.appendProgress(workflow.id, {
            register_validator_confirmed: true,
            register_validator_confirmed_at: Date.now(),
          });
          return { type: 'SUCCESS', nextStep: null }; // COMPLETED

        case 'reverted':
          // Check if reverted because already registered (idempotent)
          if (receipt.revertReason?.includes('already') || 
              receipt.revertReason?.includes('registered')) {
            await this.persistence.appendProgress(workflow.id, {
              register_validator_confirmed: true,
              register_validator_confirmed_at: Date.now(),
            });
            return { type: 'SUCCESS', nextStep: null }; // COMPLETED
          }
          return {
            type: 'FAILED',
            error: {
              category: 'PERMANENT',
              message: `Register validator tx reverted: ${receipt.revertReason}`,
              code: 'REGISTER_VALIDATOR_TX_REVERTED',
            },
          };

        case 'pending':
          return {
            type: 'RETRY',
            error: {
              category: 'TRANSIENT',
              message: 'Register validator transaction still pending',
              code: 'REGISTER_VALIDATOR_TX_PENDING',
            },
          };

        case 'not_found':
          return {
            type: 'STALLED',
            reason: 'Register validator transaction not found after timeout',
          };
      }
    } catch (error) {
      return {
        type: 'RETRY',
        error: {
          category: 'TRANSIENT',
          message: error instanceof Error ? error.message : String(error),
          code: 'REGISTER_VALIDATOR_WAIT_ERROR',
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
 * Get the initial step based on scoring mode.
 * Default is "direct" mode.
 */
function getInitialStep(mode: ScoreSubmissionMode | undefined): string {
  const effectiveMode = mode ?? 'direct';
  return effectiveMode === 'direct' ? 'SUBMIT_SCORE_DIRECT' : 'COMMIT_SCORE';
}

/**
 * Create a ScoreSubmission workflow record.
 * 
 * Default mode is "direct" (simpler, no timing constraints).
 * Mode "commit_reveal" is available for scenarios requiring last-mover bias prevention.
 */
export function createScoreSubmissionWorkflow(
  input: ScoreSubmissionInput
): ScoreSubmissionRecord {
  const effectiveMode = input.mode ?? 'direct';
  const initialStep = getInitialStep(effectiveMode);
  
  return {
    id: uuidv4(),
    type: 'ScoreSubmission',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'CREATED',
    step: initialStep,
    step_attempts: 0,
    input: {
      ...input,
      mode: effectiveMode, // Normalize mode to explicit value
    },
    progress: {},
    signer: input.signer_address,
  };
}

/**
 * Encoders required for ScoreSubmission workflow.
 */
export interface ScoreSubmissionEncoders {
  /** Encoder for commit-reveal mode (required for commit_reveal mode) */
  commitRevealEncoder?: ScoreContractEncoder;
  /** Encoder for direct mode (required for direct mode) */
  directEncoder?: DirectScoreContractEncoder;
  /** Encoder for validator registration (required for both modes) */
  validatorEncoder?: ValidatorRegistrationEncoder;
}

/**
 * Create ScoreSubmission workflow definition supporting BOTH modes.
 * 
 * The workflow will use the appropriate steps based on input.mode:
 * - "direct": SUBMIT_SCORE_DIRECT → AWAIT_SCORE_CONFIRM → REGISTER_VALIDATOR → AWAIT_REGISTER_VALIDATOR_CONFIRM
 * - "commit_reveal": COMMIT_SCORE → AWAIT_COMMIT_CONFIRM → REVEAL_SCORE → AWAIT_REVEAL_CONFIRM → REGISTER_VALIDATOR → AWAIT_REGISTER_VALIDATOR_CONFIRM
 * 
 * @param txQueue - Transaction queue for nonce management
 * @param persistence - Workflow persistence
 * @param chainState - Chain state adapter
 * @param encoders - Required encoders for both modes
 */
export function createScoreSubmissionDefinition(
  txQueue: TxQueue,
  persistence: WorkflowPersistence,
  chainState: ScoreChainStateAdapter,
  encoders: ScoreSubmissionEncoders,
  adminSignerAddress?: string
): WorkflowDefinition<ScoreSubmissionRecord> {
  const steps = new Map<string, StepExecutor<ScoreSubmissionRecord>>();

  // Direct mode steps (default, MVP)
  if (encoders.directEncoder) {
    steps.set('SUBMIT_SCORE_DIRECT', new SubmitScoreDirectStep(
      txQueue, persistence, encoders.directEncoder, chainState
    ));
    steps.set('AWAIT_SCORE_CONFIRM', new AwaitScoreConfirmStep(txQueue, persistence));
  }

  // Commit-reveal mode steps (legacy, available)
  if (encoders.commitRevealEncoder) {
    steps.set('COMMIT_SCORE', new CommitScoreStep(
      txQueue, persistence, encoders.commitRevealEncoder, chainState
    ));
    steps.set('AWAIT_COMMIT_CONFIRM', new AwaitCommitConfirmStep(txQueue, persistence));
    steps.set('REVEAL_SCORE', new RevealScoreStep(
      txQueue, persistence, encoders.commitRevealEncoder, chainState
    ));
    steps.set('AWAIT_REVEAL_CONFIRM', new AwaitRevealConfirmStep(txQueue, persistence));
  }
  
  // Validator registration steps (both modes)
  if (encoders.validatorEncoder) {
    steps.set('REGISTER_VALIDATOR', new RegisterValidatorStep(
      txQueue, persistence, encoders.validatorEncoder, chainState, adminSignerAddress
    ));
    steps.set('AWAIT_REGISTER_VALIDATOR_CONFIRM', new AwaitRegisterValidatorConfirmStep(
      txQueue, persistence, adminSignerAddress
    ));
  }

  return {
    type: 'ScoreSubmission',
    // Initial step determined per-workflow by createScoreSubmissionWorkflow
    initialStep: 'SUBMIT_SCORE_DIRECT', // Default for definition (per-workflow start overrides)
    steps,
    stepOrder: [
      // Direct mode steps
      'SUBMIT_SCORE_DIRECT',
      'AWAIT_SCORE_CONFIRM',
      // Commit-reveal mode steps
      'COMMIT_SCORE',
      'AWAIT_COMMIT_CONFIRM',
      'REVEAL_SCORE',
      'AWAIT_REVEAL_CONFIRM',
      // Shared steps (both modes)
      'REGISTER_VALIDATOR',
      'AWAIT_REGISTER_VALIDATOR_CONFIRM',
    ],
  };
}

/**
 * Legacy factory function for commit-reveal only mode.
 * @deprecated Use createScoreSubmissionDefinition with encoders instead.
 */
export function createCommitRevealScoreSubmissionDefinition(
  txQueue: TxQueue,
  persistence: WorkflowPersistence,
  encoder: ScoreContractEncoder,
  chainState: ScoreChainStateAdapter,
  validatorEncoder?: ValidatorRegistrationEncoder
): WorkflowDefinition<ScoreSubmissionRecord> {
  return createScoreSubmissionDefinition(txQueue, persistence, chainState, {
    commitRevealEncoder: encoder,
    validatorEncoder,
  });
}

// =============================================================================
// DEFAULT ENCODER IMPLEMENTATIONS
// =============================================================================

/**
 * Default encoder for direct scoring mode.
 * Encodes calls to StudioProxy.submitScoreVectorForWorker
 */
export class DefaultDirectScoreContractEncoder implements DirectScoreContractEncoder {
  private submitScoreSelector: string;

  constructor() {
    // submitScoreVectorForWorker(bytes32 dataHash, address worker, bytes scoreVector)
    this.submitScoreSelector = ethers.id('submitScoreVectorForWorker(bytes32,address,bytes)').slice(0, 10);
  }

  encodeSubmitScoreVectorForWorker(
    dataHash: string,
    workerAddress: string,
    scores: number[]
  ): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    
    // Encode score vector as 5 uint8s (0-100 range)
    // Contract expects: abi.decode(scoreData, (uint8, uint8, uint8, uint8, uint8))
    // scores are 0-10000 basis points, scale to 0-100
    const scaledScores = scores.map(s => Math.floor(s / 100));
    
    // Ensure we have exactly 5 scores
    while (scaledScores.length < 5) {
      scaledScores.push(0);
    }
    
    // Encode the score bytes: 5 uint8s packed
    const scoreBytes = abiCoder.encode(
      ['uint8', 'uint8', 'uint8', 'uint8', 'uint8'],
      scaledScores.slice(0, 5)
    );
    
    // Encode the full function call
    const params = abiCoder.encode(
      ['bytes32', 'address', 'bytes'],
      [dataHash, workerAddress, scoreBytes]
    );
    
    return this.submitScoreSelector + params.slice(2);
  }
}

/**
 * Default encoder for commit-reveal scoring mode.
 * Encodes calls to StudioProxy.commitScore and revealScore.
 * Contract: revealScore(bytes32 dataHash, bytes calldata scoreVector, bytes32 salt)
 * Commitment: keccak256(abi.encodePacked(scoreVector, salt, dataHash))
 */
export class DefaultScoreContractEncoder implements ScoreContractEncoder {
  private commitScoreSelector: string;
  private revealScoreSelector: string;

  constructor() {
    // Function selectors for StudioProxy (must match deployed contract)
    this.commitScoreSelector = ethers.id('commitScore(bytes32,bytes32)').slice(0, 10);
    // revealScore(bytes32 dataHash, bytes calldata scoreVector, bytes32 salt)
    this.revealScoreSelector = ethers.id('revealScore(bytes32,bytes,bytes32)').slice(0, 10);
  }

  /**
   * Build scoreVector bytes from scores (0-10000 basis points).
   * Matches contract tests: abi.encode(uint8, uint8, ...) with 5 scores scaled to 0-100.
   */
  private encodeScoreVectorAsBytes(scores: number[]): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const scaled = scores.map(s => Math.min(255, Math.floor(s / 100)));
    const padded = scaled.slice(0, 5);
    while (padded.length < 5) padded.push(0);
    return abiCoder.encode(
      ['uint8', 'uint8', 'uint8', 'uint8', 'uint8'],
      padded
    );
  }

  computeCommitHash(
    dataHash: string,
    scores: number[],
    salt: string
  ): string {
    // Contract: keccak256(abi.encodePacked(scoreVector, salt, dataHash))
    const scoreVectorHex = this.encodeScoreVectorAsBytes(scores);
    const packed = ethers.concat([
      ethers.getBytes(scoreVectorHex),
      ethers.getBytes(salt),
      ethers.getBytes(dataHash),
    ]);
    return ethers.keccak256(packed);
  }

  encodeCommitScore(
    dataHash: string,
    commitHash: string
  ): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const params = abiCoder.encode(
      ['bytes32', 'bytes32'],
      [dataHash, commitHash]
    );
    return this.commitScoreSelector + params.slice(2);
  }

  encodeRevealScore(
    dataHash: string,
    scores: number[],
    salt: string
  ): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const scoreVectorHex = this.encodeScoreVectorAsBytes(scores);
    const params = abiCoder.encode(
      ['bytes32', 'bytes', 'bytes32'],
      [dataHash, scoreVectorHex, salt]
    );
    return this.revealScoreSelector + params.slice(2);
  }
}

// =============================================================================
// DEFAULT VALIDATOR REGISTRATION ENCODER
// =============================================================================

export class DefaultValidatorRegistrationEncoder implements ValidatorRegistrationEncoder {
  private rewardsDistributorAddress: string;
  private registerValidatorSelector: string;

  constructor(rewardsDistributorAddress: string) {
    this.rewardsDistributorAddress = rewardsDistributorAddress;
    // registerValidator(bytes32 dataHash, address validator)
    this.registerValidatorSelector = ethers.id('registerValidator(bytes32,address)').slice(0, 10);
  }

  encodeRegisterValidator(
    dataHash: string,
    validatorAddress: string
  ): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const params = abiCoder.encode(
      ['bytes32', 'address'],
      [dataHash, validatorAddress]
    );
    return this.registerValidatorSelector + params.slice(2);
  }

  getRewardsDistributorAddress(): string {
    return this.rewardsDistributorAddress;
  }
}
