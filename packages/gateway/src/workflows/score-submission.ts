/**
 * ScoreSubmission Workflow Implementation
 * 
 * Handles the commit-reveal pattern for validator score submissions:
 * 1. COMMIT_SCORE - Submit commit hash to contract
 * 2. AWAIT_COMMIT_CONFIRM - Wait for commit tx confirmation
 * 3. REVEAL_SCORE - Submit reveal with actual scores
 * 4. AWAIT_REVEAL_CONFIRM - Wait for reveal tx confirmation
 * 
 * Commit-reveal prevents last-mover bias in scoring.
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import {
  ScoreSubmissionRecord,
  ScoreSubmissionInput,
  StepResult,
  ClassifiedError,
} from './types.js';
import { StepExecutor, WorkflowDefinition } from './engine.js';
import { TxQueue, TxRequest } from './tx-queue.js';
import { WorkflowPersistence } from './persistence.js';

// =============================================================================
// SCORE CONTRACT ENCODER INTERFACE
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
   */
  commitExists(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<boolean>;

  /**
   * Check if a reveal exists for this validator and data hash.
   */
  revealExists(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<boolean>;

  /**
   * Get commit details.
   */
  getCommit(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<{ commitHash: string; timestamp: number } | null>;

  /**
   * Check if validator is registered in RewardsDistributor for this dataHash.
   */
  isValidatorRegisteredInRewardsDistributor?(
    dataHash: string,
    validatorAddress: string
  ): Promise<boolean>;
}

// =============================================================================
// STEP EXECUTORS
// =============================================================================

/**
 * Step 1: Submit commit hash on-chain
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

  constructor(
    txQueue: TxQueue,
    persistence: WorkflowPersistence,
    validatorEncoder: ValidatorRegistrationEncoder,
    chainState: ScoreChainStateAdapter
  ) {
    this.txQueue = txQueue;
    this.persistence = persistence;
    this.validatorEncoder = validatorEncoder;
    this.chainState = chainState;
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

    // Precondition: reveal must be confirmed
    if (!progress.reveal_confirmed) {
      return {
        type: 'FAILED',
        error: {
          category: 'PERMANENT',
          message: 'Reveal not confirmed',
          code: 'REVEAL_NOT_CONFIRMED',
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
      const txHash = await this.txQueue.submitOnly(
        workflow.id,
        input.signer_address,
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

  constructor(txQueue: TxQueue, persistence: WorkflowPersistence) {
    this.txQueue = txQueue;
    this.persistence = persistence;
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

      // Release signer lock after confirmation
      this.txQueue.releaseSignerLock(input.signer_address);

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
 * Create a ScoreSubmission workflow record.
 */
export function createScoreSubmissionWorkflow(
  input: ScoreSubmissionInput
): ScoreSubmissionRecord {
  return {
    id: uuidv4(),
    type: 'ScoreSubmission',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'CREATED',
    step: 'COMMIT_SCORE',
    step_attempts: 0,
    input,
    progress: {},
    signer: input.signer_address,
  };
}

/**
 * Create ScoreSubmission workflow definition.
 * 
 * @param validatorEncoder - Optional encoder for RewardsDistributor.registerValidator.
 *   If not provided, the workflow will complete after reveal (legacy behavior).
 */
export function createScoreSubmissionDefinition(
  txQueue: TxQueue,
  persistence: WorkflowPersistence,
  encoder: ScoreContractEncoder,
  chainState: ScoreChainStateAdapter,
  validatorEncoder?: ValidatorRegistrationEncoder
): WorkflowDefinition<ScoreSubmissionRecord> {
  const steps = new Map<string, StepExecutor<ScoreSubmissionRecord>>();

  steps.set('COMMIT_SCORE', new CommitScoreStep(txQueue, persistence, encoder, chainState));
  steps.set('AWAIT_COMMIT_CONFIRM', new AwaitCommitConfirmStep(txQueue, persistence));
  steps.set('REVEAL_SCORE', new RevealScoreStep(txQueue, persistence, encoder, chainState));
  steps.set('AWAIT_REVEAL_CONFIRM', new AwaitRevealConfirmStep(txQueue, persistence));
  
  // Add validator registration steps if encoder is provided
  if (validatorEncoder) {
    steps.set('REGISTER_VALIDATOR', new RegisterValidatorStep(
      txQueue, persistence, validatorEncoder, chainState
    ));
    steps.set('AWAIT_REGISTER_VALIDATOR_CONFIRM', new AwaitRegisterValidatorConfirmStep(
      txQueue, persistence
    ));
  }

  return {
    type: 'ScoreSubmission',
    initialStep: 'COMMIT_SCORE',
    steps,
    stepOrder: [
      'COMMIT_SCORE',
      'AWAIT_COMMIT_CONFIRM',
      'REVEAL_SCORE',
      'AWAIT_REVEAL_CONFIRM',
      'REGISTER_VALIDATOR',
      'AWAIT_REGISTER_VALIDATOR_CONFIRM',
    ],
  };
}

// =============================================================================
// DEFAULT ENCODER IMPLEMENTATION
// =============================================================================

export class DefaultScoreContractEncoder implements ScoreContractEncoder {
  private commitScoreSelector: string;
  private revealScoreSelector: string;

  constructor() {
    // Function selectors for StudioProxy
    // commitScore(bytes32 dataHash, bytes32 commitHash)
    this.commitScoreSelector = ethers.id('commitScore(bytes32,bytes32)').slice(0, 10);
    // revealScore(bytes32 dataHash, uint16[] scores, bytes32 salt)
    this.revealScoreSelector = ethers.id('revealScore(bytes32,uint16[],bytes32)').slice(0, 10);
  }

  computeCommitHash(
    dataHash: string,
    scores: number[],
    salt: string
  ): string {
    // commit = keccak256(abi.encodePacked(dataHash, scores, salt))
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
      ['bytes32', 'uint16[]', 'bytes32'],
      [dataHash, scores, salt]
    );
    return ethers.keccak256(encoded);
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
    const params = abiCoder.encode(
      ['bytes32', 'uint16[]', 'bytes32'],
      [dataHash, scores, salt]
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
