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

// Types
export {
  WorkflowMetaState,
  WorkflowType,
  WorkSubmissionStep,
  WorkSubmissionInput,
  WorkSubmissionProgress,
  WorkflowError,
  WorkflowRecord,
  WorkSubmissionRecord,
  // ScoreSubmission types
  ScoreSubmissionStep,
  ScoreSubmissionInput,
  ScoreSubmissionProgress,
  ScoreSubmissionRecord,
  // Common types
  FailureCategory,
  ClassifiedError,
  TxStatus,
  TxReceipt,
  ArweaveStatus,
  RetryPolicy,
  DEFAULT_RETRY_POLICY,
  StepResult,
} from './types.js';

// Persistence
export {
  WorkflowPersistence,
  InMemoryWorkflowPersistence,
} from './persistence.js';

// Transaction Queue
export {
  TxRequest,
  TxSubmitResult,
  ChainAdapter,
  TxQueue,
} from './tx-queue.js';

// Reconciliation
export {
  ChainStateAdapter,
  ArweaveAdapter,
  ReconciliationResult,
  WorkflowReconciler,
} from './reconciliation.js';

// Engine
export {
  StepExecutor,
  WorkflowDefinition,
  EngineEvent,
  EventHandler,
  WorkflowEngine,
} from './engine.js';

// WorkSubmission Workflow
export {
  ArweaveUploader,
  ContractEncoder,
  UploadEvidenceStep,
  AwaitArweaveConfirmStep,
  SubmitWorkOnchainStep,
  AwaitTxConfirmStep,
  createWorkSubmissionWorkflow,
  createWorkSubmissionDefinition,
} from './work-submission.js';

// ScoreSubmission Workflow
export {
  ScoreContractEncoder,
  ScoreChainStateAdapter,
  CommitScoreStep,
  AwaitCommitConfirmStep,
  RevealScoreStep,
  AwaitRevealConfirmStep,
  createScoreSubmissionWorkflow,
  createScoreSubmissionDefinition,
  DefaultScoreContractEncoder,
} from './score-submission.js';
