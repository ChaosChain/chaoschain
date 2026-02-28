/**
 * Gateway Workflow Engine
 * 
 * Minimal v0 implementation of the workflow execution model.
 * See: GatewayWorkflowExecutionModel.md
 * 
 * Implements:
 * - Workflow record persistence
 * - State transitions
 * - Reconciliation loop
 * - Transaction queue (per-signer serialization)
 * - WorkSubmission workflow type
 * 
 * Design invariants:
 * - Reconciliation MUST run before any irreversible action
 * - FAILED = correctness failure (protocol-level, permanent)
 * - STALLED = operational failure (infrastructure-level, temporary)
 * - Workflows MUST NOT synchronously call other workflows
 */

// Type-only exports (interfaces and type aliases)
export type {
  DKGEvidencePackage,
  WorkflowMetaState,
  WorkflowType,
  WorkSubmissionStep,
  WorkSubmissionInput,
  WorkSubmissionProgress,
  WorkflowError,
  WorkflowRecord,
  WorkSubmissionRecord,
  ScoreSubmissionMode,
  ScoreSubmissionStep,
  ScoreSubmissionCommitRevealStep,
  ScoreSubmissionDirectStep,
  ScoreSubmissionInput,
  ScoreSubmissionProgress,
  ScoreSubmissionRecord,
  CloseEpochStep,
  CloseEpochInput,
  CloseEpochProgress,
  CloseEpochRecord,
  FailureCategory,
  ClassifiedError,
  TxStatus,
  TxReceipt,
  ArweaveStatus,
  RetryPolicy,
  StepResult,
} from './types.js';

// Value exports from types
export { DEFAULT_RETRY_POLICY } from './types.js';

// Persistence types
export type { WorkflowPersistence } from './persistence.js';
export { InMemoryWorkflowPersistence } from './persistence.js';

// Transaction Queue types
export type { TxRequest, TxSubmitResult, ChainAdapter } from './tx-queue.js';
export { TxQueue } from './tx-queue.js';

// Reconciliation types
export type { ChainStateAdapter, ArweaveAdapter, ReconciliationResult } from './reconciliation.js';
export { WorkflowReconciler } from './reconciliation.js';

// Engine types
export type { StepExecutor, WorkflowDefinition, EngineEvent, EventHandler } from './engine.js';
export { WorkflowEngine } from './engine.js';

// WorkSubmission types
export type {
  ArweaveUploader,
  ContractEncoder,
  RewardsDistributorEncoder,
  RewardsDistributorStateAdapter,
} from './work-submission.js';
export {
  ComputeDKGStep,
  UploadEvidenceStep,
  AwaitArweaveConfirmStep,
  SubmitWorkOnchainStep,
  AwaitTxConfirmStep,
  RegisterWorkStep,
  AwaitRegisterConfirmStep,
  createWorkSubmissionWorkflow,
  createWorkSubmissionDefinition,
} from './work-submission.js';

// ScoreSubmission types
export type {
  ScoreContractEncoder,
  DirectScoreContractEncoder,
  ScoreChainStateAdapter,
  ValidatorRegistrationEncoder,
  ScoreSubmissionEncoders,
} from './score-submission.js';
export {
  // Direct mode steps (default, MVP)
  SubmitScoreDirectStep,
  AwaitScoreConfirmStep,
  // Commit-reveal mode steps (legacy, available)
  CommitScoreStep,
  AwaitCommitConfirmStep,
  RevealScoreStep,
  AwaitRevealConfirmStep,
  // Shared steps (both modes)
  RegisterValidatorStep,
  AwaitRegisterValidatorConfirmStep,
  // Workflow factory
  createScoreSubmissionWorkflow,
  createScoreSubmissionDefinition,
  createCommitRevealScoreSubmissionDefinition,
  // Encoders
  DefaultDirectScoreContractEncoder,
  DefaultScoreContractEncoder,
  DefaultValidatorRegistrationEncoder,
} from './score-submission.js';

// CloseEpoch types
export type { EpochChainStateAdapter, EpochContractEncoder } from './close-epoch.js';
export {
  CheckPreconditionsStep,
  SubmitCloseEpochStep,
  AwaitCloseEpochConfirmStep,
  createCloseEpochWorkflow,
  createCloseEpochDefinition,
  DefaultEpochContractEncoder,
} from './close-epoch.js';
