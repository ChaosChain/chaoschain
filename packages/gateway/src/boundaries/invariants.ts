/**
 * Gateway Boundary Invariants
 * 
 * This file defines types, guards, and assertions that ENFORCE the Gateway's
 * hard constraints at compile-time and runtime.
 * 
 * These invariants are NON-NEGOTIABLE:
 * 
 * 1. Gateway is orchestration-only — no protocol logic
 * 2. Reconciliation before irreversible actions
 * 3. One signer = one nonce stream
 * 4. No off-chain inference or decision-making
 * 5. No fast paths, batching, or speculative execution
 * 6. XMTP is communication fabric — NOT a control plane
 * 7. Storage (Arweave) is evidence — NOT workflow triggers
 * 
 * If you need to bypass these guards, you are implementing forbidden behavior.
 */

// =============================================================================
// BRANDED TYPES (Compile-time enforcement)
// =============================================================================

/**
 * Branded type pattern prevents accidental misuse.
 * You cannot assign a regular string to these types.
 */
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

/**
 * XMTP conversation ID — can only be used for storage/archival, not control.
 */
export type XmtpConversationId = Brand<string, 'XmtpConversationId'>;

/**
 * XMTP message ID — reference only, Gateway must not parse content.
 */
export type XmtpMessageId = Brand<string, 'XmtpMessageId'>;

/**
 * Arweave transaction ID — evidence reference, not workflow trigger.
 */
export type ArweaveTxId = Brand<string, 'ArweaveTxId'>;

/**
 * On-chain transaction hash — the only source of truth for tx status.
 */
export type OnchainTxHash = Brand<string, 'OnchainTxHash'>;

/**
 * Signer address — each signer has exactly one nonce stream.
 */
export type SignerAddress = Brand<string, 'SignerAddress'>;

/**
 * Create branded types from raw strings.
 * These are the ONLY ways to create these types.
 */
export function xmtpConversationId(raw: string): XmtpConversationId {
  assertNonEmpty(raw, 'XMTP conversation ID');
  return raw as XmtpConversationId;
}

export function xmtpMessageId(raw: string): XmtpMessageId {
  assertNonEmpty(raw, 'XMTP message ID');
  return raw as XmtpMessageId;
}

export function arweaveTxId(raw: string): ArweaveTxId {
  assertNonEmpty(raw, 'Arweave TX ID');
  return raw as ArweaveTxId;
}

export function onchainTxHash(raw: string): OnchainTxHash {
  assertNonEmpty(raw, 'On-chain TX hash');
  assertHexString(raw, 'On-chain TX hash');
  return raw as OnchainTxHash;
}

export function signerAddress(raw: string): SignerAddress {
  assertNonEmpty(raw, 'Signer address');
  assertHexString(raw, 'Signer address');
  return raw.toLowerCase() as SignerAddress;
}

// =============================================================================
// ASSERTIONS (Runtime enforcement)
// =============================================================================

/**
 * Invariant violation error.
 * If this is thrown, a non-negotiable constraint was violated.
 */
export class InvariantViolation extends Error {
  constructor(
    public readonly invariant: string,
    public readonly details: string
  ) {
    super(`INVARIANT VIOLATION: ${invariant} — ${details}`);
    this.name = 'InvariantViolation';
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value || value.trim() === '') {
    throw new InvariantViolation('NON_EMPTY', `${name} must not be empty`);
  }
}

function assertHexString(value: string, name: string): void {
  if (!/^0x[a-fA-F0-9]+$/.test(value)) {
    throw new InvariantViolation('HEX_STRING', `${name} must be a hex string starting with 0x`);
  }
}

/**
 * Assert that reconciliation has been performed before an irreversible action.
 * 
 * Call this BEFORE any transaction submission.
 */
export function assertReconciliationPerformed(
  reconciliationTimestamp: number | undefined,
  actionName: string
): void {
  if (!reconciliationTimestamp) {
    throw new InvariantViolation(
      'RECONCILIATION_BEFORE_IRREVERSIBLE',
      `Reconciliation must be performed before ${actionName}`
    );
  }
  
  // Reconciliation must be recent (within last 60 seconds)
  const age = Date.now() - reconciliationTimestamp;
  if (age > 60_000) {
    throw new InvariantViolation(
      'RECONCILIATION_STALE',
      `Reconciliation for ${actionName} is stale (${age}ms old). Re-reconcile before proceeding.`
    );
  }
}

/**
 * Assert that we are not inferring or making off-chain decisions.
 * 
 * This is a documentation/marker function. Call it in places where
 * a future developer might be tempted to add inference logic.
 */
export function assertNoOffchainInference(_context: string): void {
  // This is a compile-time marker. The function does nothing at runtime.
  // Its presence documents that off-chain inference is forbidden here.
  // If you're adding logic here, you're violating invariants.
}

/**
 * Assert that a workflow step is NOT a fast path or speculative execution.
 */
export function assertNoFastPath(_stepName: string): void {
  // Marker function. Documents that fast paths are forbidden.
}

/**
 * Assert that batch operations are not being performed.
 */
export function assertNoBatching(_context: string): void {
  // Marker function. Documents that batching is forbidden.
}

// =============================================================================
// XMTP BOUNDARY GUARDS
// =============================================================================

/**
 * XMTP message content — opaque to Gateway.
 * 
 * Gateway must NEVER:
 * - Parse this content
 * - React to this content
 * - Use this content to make decisions
 * - Trigger workflows based on this content
 * 
 * Gateway MAY ONLY:
 * - Store it as evidence
 * - Hash it for integrity
 * - Archive it to Arweave
 */
export type OpaqueMessageContent = Brand<Uint8Array, 'OpaqueMessageContent'>;

export function opaqueMessageContent(raw: Uint8Array): OpaqueMessageContent {
  // Gateway does not interpret this. Ever.
  return raw as OpaqueMessageContent;
}

/**
 * Allowed XMTP operations for Gateway.
 * These are the ONLY things Gateway can do with XMTP.
 */
export interface AllowedXmtpOperations {
  /**
   * Store a conversation ID for later evidence retrieval.
   * Does NOT trigger any workflow.
   */
  storeConversationId(id: XmtpConversationId): Promise<void>;

  /**
   * Fetch message history for evidence building.
   * Returns opaque content — Gateway must not interpret.
   */
  fetchMessageHistory(
    conversationId: XmtpConversationId
  ): Promise<Array<{ id: XmtpMessageId; content: OpaqueMessageContent; timestamp: number }>>;

  /**
   * Hash messages for evidence integrity.
   * Input is opaque, output is a hash.
   */
  hashMessagesForEvidence(
    messages: OpaqueMessageContent[]
  ): Promise<string>;
}

/**
 * FORBIDDEN XMTP operations.
 * These must NEVER be implemented.
 */
export interface ForbiddenXmtpOperations {
  // ❌ NEVER: Parse message content
  parseMessage: never;
  
  // ❌ NEVER: React to message content
  onMessageReceived: never;
  
  // ❌ NEVER: Trigger workflow from message
  triggerWorkflowFromMessage: never;
  
  // ❌ NEVER: Make decisions based on message
  decideBasedOnMessage: never;
  
  // ❌ NEVER: Subscribe to messages for control flow
  subscribeForControlFlow: never;
}

// =============================================================================
// ARWEAVE/TURBO BOUNDARY GUARDS
// =============================================================================

/**
 * Allowed Arweave operations for Gateway.
 */
export interface AllowedArweaveOperations {
  /**
   * Upload evidence bundle.
   * Returns TX ID — does NOT trigger any workflow.
   */
  uploadEvidence(data: Uint8Array, tags: Array<{ name: string; value: string }>): Promise<ArweaveTxId>;

  /**
   * Check if TX is confirmed.
   * Returns boolean — does NOT affect workflow state directly.
   */
  isConfirmed(txId: ArweaveTxId): Promise<boolean>;

  /**
   * Retrieve evidence by TX ID.
   */
  retrieve(txId: ArweaveTxId): Promise<Uint8Array | null>;
}

/**
 * Arweave failure semantics.
 * Arweave failures are ALWAYS operational (STALLED), never correctness (FAILED).
 */
export type ArweaveFailureSemantic = 'STALLED';

/**
 * Map Arweave error to workflow state.
 * All Arweave errors result in STALLED (recoverable).
 */
export function mapArweaveErrorToState(_error: Error): ArweaveFailureSemantic {
  // All Arweave errors are operational, not correctness failures.
  // The evidence might still be uploaded; we just don't know.
  // Reconciliation will determine the truth.
  return 'STALLED';
}

// =============================================================================
// WORKFLOW BOUNDARY GUARDS
// =============================================================================

/**
 * Workflow types are FROZEN.
 * Do NOT add new workflow types without explicit approval.
 */
export const FROZEN_WORKFLOW_TYPES = ['WorkSubmission', 'ScoreSubmission', 'CloseEpoch'] as const;
export type FrozenWorkflowType = typeof FROZEN_WORKFLOW_TYPES[number];

/**
 * Assert that a workflow type is one of the frozen types.
 */
export function assertFrozenWorkflowType(type: string): asserts type is FrozenWorkflowType {
  if (!FROZEN_WORKFLOW_TYPES.includes(type as FrozenWorkflowType)) {
    throw new InvariantViolation(
      'FROZEN_WORKFLOW_TYPES',
      `Workflow type "${type}" is not in the frozen list. Core workflows are FROZEN.`
    );
  }
}

/**
 * Signer serialization guard.
 * Ensures one signer = one nonce stream.
 */
export class SignerSerializationGuard {
  private pending = new Map<SignerAddress, boolean>();

  /**
   * Acquire exclusive access for a signer.
   * Throws if another transaction is pending.
   */
  acquire(signer: SignerAddress): void {
    if (this.pending.get(signer)) {
      throw new InvariantViolation(
        'SIGNER_SERIALIZATION',
        `Signer ${signer} already has a pending transaction. One signer = one nonce stream.`
      );
    }
    this.pending.set(signer, true);
  }

  /**
   * Release exclusive access for a signer.
   */
  release(signer: SignerAddress): void {
    this.pending.set(signer, false);
  }

  /**
   * Check if a signer has a pending transaction.
   */
  hasPending(signer: SignerAddress): boolean {
    return this.pending.get(signer) ?? false;
  }
}

// =============================================================================
// DOCUMENTATION MARKERS
// =============================================================================

/**
 * Mark a code path as orchestration-only.
 * This is a documentation marker — no runtime effect.
 */
export function orchestrationOnly(_description: string): void {
  // This function documents that the surrounding code is orchestration-only.
  // It submits transactions and observes results.
  // It does NOT compute consensus, validate scores, or make economic decisions.
}

/**
 * Mark a code path as evidence-only.
 * XMTP and Arweave data is evidence, not control plane.
 */
export function evidenceOnly(_description: string): void {
  // This function documents that the surrounding code treats data as evidence.
  // Evidence is stored, hashed, and archived.
  // Evidence does NOT trigger workflows or affect execution logic.
}
