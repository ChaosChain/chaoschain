/**
 * Gateway Workflow Types
 * 
 * Type definitions for the workflow execution model.
 * See: GatewayWorkflowExecutionModel.md
 */

// =============================================================================
// META-STATES (Universal across all workflow types)
// =============================================================================

export type WorkflowMetaState = 
  | 'CREATED'    // Instantiated, not yet started
  | 'RUNNING'    // Actively executing steps
  | 'STALLED'    // Waiting for external condition (operational failure)
  | 'COMPLETED'  // All steps finished successfully
  | 'FAILED';    // Unrecoverable error (correctness failure)

// =============================================================================
// WORKFLOW TYPES
// =============================================================================

export type WorkflowType = 
  | 'WorkSubmission'
  | 'ScoreSubmission'
  | 'CloseEpoch'
  | 'AgentRegistration'
  | 'StudioCreation';

// =============================================================================
// WORK SUBMISSION WORKFLOW STEPS
// =============================================================================

export type WorkSubmissionStep =
  | 'UPLOAD_EVIDENCE'
  | 'AWAIT_ARWEAVE_CONFIRM'
  | 'SUBMIT_WORK_ONCHAIN'
  | 'AWAIT_TX_CONFIRM';

// =============================================================================
// SCORE SUBMISSION WORKFLOW STEPS
// =============================================================================

export type ScoreSubmissionStep =
  | 'COMMIT_SCORE'
  | 'AWAIT_COMMIT_CONFIRM'
  | 'REVEAL_SCORE'
  | 'AWAIT_REVEAL_CONFIRM';

// =============================================================================
// CLOSE EPOCH WORKFLOW STEPS
// =============================================================================

export type CloseEpochStep =
  | 'CHECK_PRECONDITIONS'
  | 'SUBMIT_CLOSE_EPOCH'
  | 'AWAIT_TX_CONFIRM';

// =============================================================================
// WORKFLOW INPUT (Immutable after creation)
// =============================================================================

export interface WorkSubmissionInput {
  studio_address: string;
  epoch: number;
  agent_address: string;
  data_hash: string;          // bytes32 hex
  thread_root: string;        // bytes32 hex
  evidence_root: string;      // bytes32 hex
  evidence_content: Buffer;   // Raw evidence bytes
  signer_address: string;     // Which key signs on-chain txs
}

// =============================================================================
// WORKFLOW PROGRESS (Mutable, append-only)
// =============================================================================

export interface WorkSubmissionProgress {
  arweave_tx_id?: string;
  arweave_confirmed?: boolean;
  arweave_confirmed_at?: number;
  onchain_tx_hash?: string;
  onchain_confirmed?: boolean;
  onchain_block?: number;
  onchain_confirmed_at?: number;
}

// =============================================================================
// WORKFLOW ERROR
// =============================================================================

export interface WorkflowError {
  step: string;
  message: string;
  code: string;
  timestamp: number;
  recoverable: boolean;
}

// =============================================================================
// WORKFLOW RECORD (Persisted to database)
// =============================================================================

export interface WorkflowRecord<TInput = unknown, TProgress = unknown> {
  // Identity
  id: string;                 // UUID
  type: WorkflowType;
  created_at: number;         // Unix timestamp ms
  updated_at: number;         // Unix timestamp ms
  
  // State
  state: WorkflowMetaState;
  step: string;               // Current step name
  step_attempts: number;      // Retry counter for current step
  
  // Context
  input: TInput;
  progress: TProgress;
  
  // Failure info
  error?: WorkflowError;
  
  // Signer coordination
  signer: string;             // Address of signing key
}

export type WorkSubmissionRecord = WorkflowRecord<WorkSubmissionInput, WorkSubmissionProgress>;

// =============================================================================
// SCORE SUBMISSION INPUT (Immutable after creation)
// =============================================================================

export interface ScoreSubmissionInput {
  studio_address: string;
  epoch: number;
  validator_address: string;   // The validator submitting scores
  data_hash: string;           // bytes32 - which work is being scored
  scores: number[];            // Array of dimension scores (0-10000 basis points)
  salt: string;                // bytes32 - random salt for commit-reveal
  signer_address: string;      // Which key signs on-chain txs
}

// =============================================================================
// SCORE SUBMISSION PROGRESS (Mutable, append-only)
// =============================================================================

export interface ScoreSubmissionProgress {
  // Commit phase
  commit_hash?: string;        // Computed commit hash
  commit_tx_hash?: string;
  commit_confirmed?: boolean;
  commit_block?: number;
  commit_confirmed_at?: number;
  
  // Reveal phase
  reveal_tx_hash?: string;
  reveal_confirmed?: boolean;
  reveal_block?: number;
  reveal_confirmed_at?: number;
}

export type ScoreSubmissionRecord = WorkflowRecord<ScoreSubmissionInput, ScoreSubmissionProgress>;

// =============================================================================
// CLOSE EPOCH INPUT (Immutable after creation)
// =============================================================================

export interface CloseEpochInput {
  studio_address: string;
  epoch: number;
  signer_address: string;     // Which key signs on-chain txs
}

// =============================================================================
// CLOSE EPOCH PROGRESS (Mutable, append-only)
// =============================================================================

export interface CloseEpochProgress {
  // Precondition checks
  preconditions_checked?: boolean;
  preconditions_checked_at?: number;
  
  // Close epoch tx
  close_tx_hash?: string;
  close_confirmed?: boolean;
  close_block?: number;
  close_confirmed_at?: number;
}

export type CloseEpochRecord = WorkflowRecord<CloseEpochInput, CloseEpochProgress>;

// =============================================================================
// FAILURE CATEGORIES
// =============================================================================

export type FailureCategory = 
  | 'TRANSIENT'    // Network timeout, RPC error - retry with backoff
  | 'RECOVERABLE'  // Nonce too low - retry with fix
  | 'PERMANENT'    // Contract revert - no retry, FAILED
  | 'UNKNOWN';     // Ambiguous - reconcile first

export interface ClassifiedError {
  category: FailureCategory;
  message: string;
  code: string;
  originalError?: Error;
}

// =============================================================================
// TRANSACTION STATUS
// =============================================================================

export type TxStatus = 
  | 'pending'
  | 'confirmed'
  | 'reverted'
  | 'not_found';

export interface TxReceipt {
  status: TxStatus;
  blockNumber?: number;
  gasUsed?: bigint;
  revertReason?: string;
}

// =============================================================================
// ARWEAVE STATUS
// =============================================================================

export type ArweaveStatus = 
  | 'pending'
  | 'confirmed'
  | 'not_found';

// =============================================================================
// RETRY POLICY
// =============================================================================

export interface RetryPolicy {
  max_attempts: number;
  initial_delay_ms: number;
  max_delay_ms: number;
  backoff_multiplier: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 5,
  initial_delay_ms: 1000,
  max_delay_ms: 60000,
  backoff_multiplier: 2.0,
  jitter: true,
};

// =============================================================================
// STEP EXECUTION RESULT
// =============================================================================

export type StepResult = 
  | { type: 'SUCCESS'; nextStep: string | null }  // null = COMPLETED
  | { type: 'RETRY'; error: ClassifiedError }
  | { type: 'STALLED'; reason: string }
  | { type: 'FAILED'; error: ClassifiedError };
