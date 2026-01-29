/**
 * Boundary Invariant Tests
 * 
 * Proves that the boundary guards enforce Gateway invariants:
 * 
 * 1. Branded types prevent misuse at compile-time
 * 2. Assertions catch violations at runtime
 * 3. XMTP is communication fabric, not control plane
 * 4. Arweave failures → STALLED, never FAILED
 * 5. Signer serialization is enforced
 */

import { describe, it, expect } from 'vitest';
import {
  // Branded types
  xmtpConversationId,
  xmtpMessageId,
  arweaveTxId,
  onchainTxHash,
  signerAddress,
  opaqueMessageContent,
  
  // Assertions
  InvariantViolation,
  assertReconciliationPerformed,
  assertFrozenWorkflowType,
  
  // Guards
  SignerSerializationGuard,
  mapArweaveErrorToState,
  FROZEN_WORKFLOW_TYPES,
} from '../../src/boundaries/index.js';

describe('Branded Types', () => {
  describe('xmtpConversationId', () => {
    it('should create branded type from valid string', () => {
      const id = xmtpConversationId('conv-123');
      expect(id).toBe('conv-123');
    });

    it('should reject empty string', () => {
      expect(() => xmtpConversationId('')).toThrow(InvariantViolation);
      expect(() => xmtpConversationId('   ')).toThrow(InvariantViolation);
    });
  });

  describe('xmtpMessageId', () => {
    it('should create branded type from valid string', () => {
      const id = xmtpMessageId('msg-456');
      expect(id).toBe('msg-456');
    });

    it('should reject empty string', () => {
      expect(() => xmtpMessageId('')).toThrow(InvariantViolation);
    });
  });

  describe('arweaveTxId', () => {
    it('should create branded type from valid string', () => {
      const id = arweaveTxId('ar-tx-789');
      expect(id).toBe('ar-tx-789');
    });

    it('should reject empty string', () => {
      expect(() => arweaveTxId('')).toThrow(InvariantViolation);
    });
  });

  describe('onchainTxHash', () => {
    it('should create branded type from valid hex string', () => {
      const hash = onchainTxHash('0xabc123');
      expect(hash).toBe('0xabc123');
    });

    it('should reject non-hex strings', () => {
      expect(() => onchainTxHash('not-hex')).toThrow(InvariantViolation);
      expect(() => onchainTxHash('abc123')).toThrow(InvariantViolation);
    });

    it('should reject empty string', () => {
      expect(() => onchainTxHash('')).toThrow(InvariantViolation);
    });
  });

  describe('signerAddress', () => {
    it('should create branded type from valid address', () => {
      const addr = signerAddress('0xABC123abc123ABC123abc123ABC123abc123ABC1');
      expect(addr).toBe('0xabc123abc123abc123abc123abc123abc123abc1'); // lowercase
    });

    it('should normalize to lowercase', () => {
      const upper = signerAddress('0xABCDEF');
      const lower = signerAddress('0xabcdef');
      expect(upper).toBe(lower);
    });

    it('should reject non-hex strings', () => {
      expect(() => signerAddress('not-an-address')).toThrow(InvariantViolation);
    });
  });

  describe('opaqueMessageContent', () => {
    it('should wrap bytes as opaque', () => {
      const content = opaqueMessageContent(new Uint8Array([1, 2, 3]));
      expect(content).toBeInstanceOf(Uint8Array);
      expect(content.length).toBe(3);
    });
  });
});

describe('Assertions', () => {
  describe('assertReconciliationPerformed', () => {
    it('should pass when reconciliation is recent', () => {
      const recentTimestamp = Date.now() - 5000; // 5 seconds ago
      expect(() => {
        assertReconciliationPerformed(recentTimestamp, 'test action');
      }).not.toThrow();
    });

    it('should throw when reconciliation never performed', () => {
      expect(() => {
        assertReconciliationPerformed(undefined, 'test action');
      }).toThrow(InvariantViolation);
    });

    it('should throw when reconciliation is stale', () => {
      const staleTimestamp = Date.now() - 120_000; // 2 minutes ago
      expect(() => {
        assertReconciliationPerformed(staleTimestamp, 'test action');
      }).toThrow(InvariantViolation);
      expect(() => {
        assertReconciliationPerformed(staleTimestamp, 'test action');
      }).toThrow(/stale/i);
    });
  });

  describe('assertFrozenWorkflowType', () => {
    it('should pass for frozen workflow types', () => {
      for (const type of FROZEN_WORKFLOW_TYPES) {
        expect(() => assertFrozenWorkflowType(type)).not.toThrow();
      }
    });

    it('should throw for unknown workflow types', () => {
      expect(() => assertFrozenWorkflowType('UnknownWorkflow')).toThrow(InvariantViolation);
      expect(() => assertFrozenWorkflowType('NewWorkflow')).toThrow(InvariantViolation);
    });
  });
});

describe('SignerSerializationGuard', () => {
  it('should allow first acquisition', () => {
    const guard = new SignerSerializationGuard();
    const signer = signerAddress('0xabc123');
    
    expect(() => guard.acquire(signer)).not.toThrow();
    expect(guard.hasPending(signer)).toBe(true);
  });

  it('should block second acquisition for same signer', () => {
    const guard = new SignerSerializationGuard();
    const signer = signerAddress('0xabc123');
    
    guard.acquire(signer);
    
    expect(() => guard.acquire(signer)).toThrow(InvariantViolation);
    expect(() => guard.acquire(signer)).toThrow(/one signer.*one nonce/i);
  });

  it('should allow acquisition for different signers', () => {
    const guard = new SignerSerializationGuard();
    const signer1 = signerAddress('0xabc123');
    const signer2 = signerAddress('0xdef456');
    
    guard.acquire(signer1);
    expect(() => guard.acquire(signer2)).not.toThrow();
    
    expect(guard.hasPending(signer1)).toBe(true);
    expect(guard.hasPending(signer2)).toBe(true);
  });

  it('should allow re-acquisition after release', () => {
    const guard = new SignerSerializationGuard();
    const signer = signerAddress('0xabc123');
    
    guard.acquire(signer);
    guard.release(signer);
    
    expect(guard.hasPending(signer)).toBe(false);
    expect(() => guard.acquire(signer)).not.toThrow();
  });
});

describe('Arweave Failure Semantics', () => {
  it('all Arweave errors map to STALLED', () => {
    // Network error
    expect(mapArweaveErrorToState(new Error('Network timeout'))).toBe('STALLED');
    
    // Upload error
    expect(mapArweaveErrorToState(new Error('Upload failed'))).toBe('STALLED');
    
    // Funding error
    expect(mapArweaveErrorToState(new Error('Insufficient funds'))).toBe('STALLED');
    
    // Unknown error
    expect(mapArweaveErrorToState(new Error('Unknown error'))).toBe('STALLED');
  });

  it('Arweave errors NEVER map to FAILED', () => {
    // This is a critical invariant:
    // Arweave failures are operational, not correctness failures.
    // The evidence might have been uploaded; reconciliation determines truth.
    
    const anyError = new Error('Any error');
    const result = mapArweaveErrorToState(anyError);
    
    expect(result).not.toBe('FAILED');
    expect(result).toBe('STALLED');
  });
});

describe('Frozen Workflow Types', () => {
  it('should have exactly 3 frozen types', () => {
    expect(FROZEN_WORKFLOW_TYPES).toHaveLength(3);
  });

  it('should include WorkSubmission, ScoreSubmission, CloseEpoch', () => {
    expect(FROZEN_WORKFLOW_TYPES).toContain('WorkSubmission');
    expect(FROZEN_WORKFLOW_TYPES).toContain('ScoreSubmission');
    expect(FROZEN_WORKFLOW_TYPES).toContain('CloseEpoch');
  });
});

describe('Invariant Violation Error', () => {
  it('should include invariant name and details', () => {
    const error = new InvariantViolation('TEST_INVARIANT', 'This is a test');
    
    expect(error.name).toBe('InvariantViolation');
    expect(error.invariant).toBe('TEST_INVARIANT');
    expect(error.details).toBe('This is a test');
    expect(error.message).toContain('TEST_INVARIANT');
    expect(error.message).toContain('This is a test');
  });
});
