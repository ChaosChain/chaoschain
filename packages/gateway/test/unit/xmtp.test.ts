/**
 * XMTP Integration Tests
 * 
 * Proves that XMTP integration respects boundary invariants:
 * 
 * 1. XMTP is communication fabric, NOT control plane
 * 2. Gateway does NOT parse or interpret message content
 * 3. Gateway only stores IDs, fetches history, hashes for evidence
 * 4. No workflows are triggered by XMTP operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockXmtpAdapter,
  XmtpGatewayClient,
} from '../../src/xmtp/index.js';
import {
  xmtpConversationId,
  opaqueMessageContent,
} from '../../src/boundaries/index.js';

describe('MockXmtpAdapter', () => {
  let adapter: MockXmtpAdapter;

  beforeEach(() => {
    adapter = new MockXmtpAdapter();
  });

  describe('storeConversationId', () => {
    it('should store conversation ID', async () => {
      const id = xmtpConversationId('conv-123');
      
      // Should not throw
      await expect(adapter.storeConversationId(id)).resolves.toBeUndefined();
    });

    it('storing ID does NOT trigger any workflow', async () => {
      // This test documents the invariant:
      // Storing a conversation ID is purely for reference.
      // It has no side effects on workflow state.
      
      const id = xmtpConversationId('conv-123');
      await adapter.storeConversationId(id);
      
      // No workflow was triggered (we can only assert this through design)
      // The adapter has no workflow-triggering methods
    });
  });

  describe('fetchMessageHistory', () => {
    it('should return empty array for unknown conversation', async () => {
      const id = xmtpConversationId('unknown-conv');
      const history = await adapter.fetchMessageHistory(id);
      
      expect(history).toEqual([]);
    });

    it('should return messages for known conversation', async () => {
      const convId = 'test-conv';
      adapter.addTestMessage(convId, 'Hello', 1000);
      adapter.addTestMessage(convId, 'World', 2000);
      
      const id = xmtpConversationId(convId);
      const history = await adapter.fetchMessageHistory(id);
      
      expect(history).toHaveLength(2);
      expect(history[0].timestamp).toBe(1000);
      expect(history[1].timestamp).toBe(2000);
    });

    it('message content is OPAQUE', async () => {
      const convId = 'test-conv';
      const originalContent = 'This is a test message';
      adapter.addTestMessage(convId, originalContent, 1000);
      
      const id = xmtpConversationId(convId);
      const history = await adapter.fetchMessageHistory(id);
      
      // Content is returned as opaque bytes
      expect(history[0].content).toBeInstanceOf(Uint8Array);
      
      // Gateway should NOT interpret this content
      // We can verify the bytes are correct, but Gateway shouldn't
      const decoded = new TextDecoder().decode(history[0].content);
      expect(decoded).toBe(originalContent);
    });
  });

  describe('hashMessagesForEvidence', () => {
    it('should produce deterministic hash', async () => {
      const messages = [
        opaqueMessageContent(Buffer.from('Hello')),
        opaqueMessageContent(Buffer.from('World')),
      ];
      
      const hash1 = await adapter.hashMessagesForEvidence(messages);
      const hash2 = await adapter.hashMessagesForEvidence(messages);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('different messages produce different hashes', async () => {
      const messages1 = [opaqueMessageContent(Buffer.from('Hello'))];
      const messages2 = [opaqueMessageContent(Buffer.from('World'))];
      
      const hash1 = await adapter.hashMessagesForEvidence(messages1);
      const hash2 = await adapter.hashMessagesForEvidence(messages2);
      
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('XMTP Boundary Invariants', () => {
  it('XmtpGatewayClient interface has NO workflow-triggering methods', () => {
    // This test documents the interface constraint.
    // The interface only allows:
    // - storeConversationId
    // - fetchMessageHistory
    // - hashMessagesForEvidence
    
    // There is NO:
    // - onMessageReceived
    // - triggerWorkflow
    // - subscribeForControlFlow
    
    const adapter = new MockXmtpAdapter();
    const client: XmtpGatewayClient = adapter;
    
    // These methods exist
    expect(typeof client.storeConversationId).toBe('function');
    expect(typeof client.fetchMessageHistory).toBe('function');
    expect(typeof client.hashMessagesForEvidence).toBe('function');
    
    // These methods do NOT exist (would cause TypeScript error if accessed)
    // @ts-expect-error - Method should not exist
    expect(client.onMessageReceived).toBeUndefined();
    // @ts-expect-error - Method should not exist  
    expect(client.triggerWorkflow).toBeUndefined();
    // @ts-expect-error - Method should not exist
    expect(client.subscribeForControlFlow).toBeUndefined();
  });

  it('message content is treated as opaque bytes', async () => {
    const adapter = new MockXmtpAdapter();
    
    // Add a message with JSON content
    const jsonContent = JSON.stringify({ type: 'command', action: 'start' });
    adapter.addTestMessage('conv', jsonContent, 1000);
    
    const history = await adapter.fetchMessageHistory(xmtpConversationId('conv'));
    
    // Gateway receives this as opaque bytes, NOT as parsed JSON
    expect(history[0].content).toBeInstanceOf(Uint8Array);
    
    // Gateway MUST NOT do this:
    // const parsed = JSON.parse(new TextDecoder().decode(history[0].content));
    // if (parsed.type === 'command') { triggerWorkflow(); }
    
    // Gateway should only hash/archive the bytes
    const hash = await adapter.hashMessagesForEvidence([history[0].content]);
    expect(hash).toMatch(/^0x[a-f0-9]+$/);
  });

  it('fetching messages does NOT trigger workflows', async () => {
    // This is an architectural invariant, not a runtime check.
    // The test documents the expected behavior.
    
    const adapter = new MockXmtpAdapter();
    adapter.addTestMessage('conv', 'Start workflow!', 1000);
    adapter.addTestMessage('conv', 'Execute task!', 2000);
    
    // Fetching messages is purely for evidence retrieval
    const history = await adapter.fetchMessageHistory(xmtpConversationId('conv'));
    
    // The adapter has no way to trigger workflows
    // It only returns data for the caller to use as evidence
    expect(history.length).toBe(2);
  });
});
