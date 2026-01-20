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
