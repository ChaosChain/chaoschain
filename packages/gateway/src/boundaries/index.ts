/**
 * Gateway Boundaries Module
 * 
 * Exports types, guards, and assertions that enforce Gateway invariants.
 */

// Type-only exports (interfaces don't exist at runtime)
export type {
  // Branded types
  XmtpConversationId,
  XmtpMessageId,
  ArweaveTxId,
  OnchainTxHash,
  SignerAddress,
  OpaqueMessageContent,
  
  // Interfaces
  AllowedXmtpOperations,
  ForbiddenXmtpOperations,
  AllowedArweaveOperations,
  ArweaveFailureSemantic,
  FrozenWorkflowType,
} from './invariants.js';

// Value exports (exist at runtime)
export {
  // Type constructors
  xmtpConversationId,
  xmtpMessageId,
  arweaveTxId,
  onchainTxHash,
  signerAddress,
  opaqueMessageContent,
  
  // Assertions
  InvariantViolation,
  assertReconciliationPerformed,
  assertNoOffchainInference,
  assertNoFastPath,
  assertNoBatching,
  assertFrozenWorkflowType,
  
  // Runtime functions
  mapArweaveErrorToState,
  
  // Guards
  SignerSerializationGuard,
  FROZEN_WORKFLOW_TYPES,
  
  // Documentation markers
  orchestrationOnly,
  evidenceOnly,
} from './invariants.js';
