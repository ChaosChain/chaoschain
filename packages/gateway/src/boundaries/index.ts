/**
 * Gateway Boundaries Module
 * 
 * Exports types, guards, and assertions that enforce Gateway invariants.
 */

export {
  // Branded types
  XmtpConversationId,
  XmtpMessageId,
  ArweaveTxId,
  OnchainTxHash,
  SignerAddress,
  OpaqueMessageContent,
  
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
  
  // Interfaces
  AllowedXmtpOperations,
  ForbiddenXmtpOperations,
  AllowedArweaveOperations,
  ArweaveFailureSemantic,
  mapArweaveErrorToState,
  
  // Guards
  SignerSerializationGuard,
  FROZEN_WORKFLOW_TYPES,
  FrozenWorkflowType,
  
  // Documentation markers
  orchestrationOnly,
  evidenceOnly,
} from './invariants.js';
