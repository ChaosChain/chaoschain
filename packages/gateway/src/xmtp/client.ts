/**
 * XMTP Client Adapter
 * 
 * BOUNDARY INVARIANTS (NON-NEGOTIABLE):
 * 
 * 1. XMTP is the agent-to-agent COMMUNICATION FABRIC (chat, planning, coordination)
 * 2. Agents and SDKs may freely send/read messages via XMTP
 * 3. Gateway must NEVER interpret, parse, or react to message content
 * 4. Gateway may ONLY:
 *    - Store XMTP thread/conversation identifiers
 *    - Fetch message history when building evidence
 *    - Hash or archive messages as evidence
 * 5. XMTP must NOT trigger workflows or affect execution logic
 * 
 * If you find yourself parsing message content or triggering actions
 * based on message content, you are violating these invariants.
 * 
 * @see https://docs.xmtp.org/chat-apps/sdks/node
 */

import { createHash } from 'crypto';
import {
  XmtpConversationId,
  XmtpMessageId,
  OpaqueMessageContent,
  xmtpConversationId,
  xmtpMessageId,
  opaqueMessageContent,
  AllowedXmtpOperations,
  evidenceOnly,
} from '../boundaries/index.js';

// =============================================================================
// XMTP MESSAGE (Opaque to Gateway)
// =============================================================================

/**
 * XMTP message as seen by Gateway.
 * 
 * CRITICAL: `content` is OPAQUE.
 * Gateway must NOT parse, interpret, or react to it.
 * It is evidence data only.
 */
export interface XmtpMessage {
  /** Message ID for reference */
  id: XmtpMessageId;
  
  /** Conversation this message belongs to */
  conversationId: XmtpConversationId;
  
  /** Sender address (for attribution in DKG) */
  senderAddress: string;
  
  /** Timestamp (for ordering in DKG) */
  timestamp: number;
  
  /**
   * Message content — OPAQUE to Gateway.
   * 
   * Gateway must NOT:
   * - Parse this
   * - Interpret this
   * - React to this
   * - Trigger workflows based on this
   * 
   * Gateway may ONLY:
   * - Store it as evidence
   * - Hash it for integrity
   * - Archive it to Arweave
   */
  content: OpaqueMessageContent;
}

// =============================================================================
// XMTP CLIENT INTERFACE
// =============================================================================

/**
 * XMTP client interface for Gateway.
 * 
 * This interface enforces that Gateway can ONLY perform allowed operations.
 * There are no methods for sending messages or subscribing for control flow.
 */
export interface XmtpGatewayClient extends AllowedXmtpOperations {
  /**
   * Fetch message history for a conversation.
   * 
   * Returns messages as OPAQUE content.
   * Gateway does NOT interpret these messages.
   */
  fetchMessageHistory(
    conversationId: XmtpConversationId
  ): Promise<Array<{ id: XmtpMessageId; content: OpaqueMessageContent; timestamp: number }>>;
}

// =============================================================================
// PRODUCTION XMTP ADAPTER
// =============================================================================

/**
 * Configuration for XMTP client.
 */
export interface XmtpClientConfig {
  /** XMTP environment: 'production' or 'dev' */
  env: 'production' | 'dev';
  
  /** Database encryption key (32 bytes) */
  dbEncryptionKey: Uint8Array;
}

/**
 * Production XMTP client adapter.
 * 
 * Wraps the @xmtp/node-sdk client with boundary enforcement.
 * 
 * This adapter:
 * - Fetches message history (evidence retrieval)
 * - Stores conversation IDs (reference tracking)
 * - Hashes messages (integrity verification)
 * 
 * This adapter does NOT:
 * - Parse message content
 * - React to message content
 * - Trigger workflows from messages
 * - Subscribe for control flow
 */
export class XmtpAdapter implements XmtpGatewayClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any; // XMTP Client type from @xmtp/node-sdk
  private conversationCache: Map<string, XmtpConversationId> = new Map();

  /**
   * Create adapter with an existing XMTP client.
   * 
   * The client should be created externally with proper signer setup.
   * This separation ensures Gateway doesn't control XMTP identity.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(xmtpClient: any) {
    this.client = xmtpClient;
  }

  /**
   * Store a conversation ID for later evidence retrieval.
   * 
   * This does NOT trigger any workflow.
   * This is purely for reference tracking.
   */
  async storeConversationId(id: XmtpConversationId): Promise<void> {
    evidenceOnly('Storing XMTP conversation ID for later evidence retrieval');
    
    // Store in local cache for quick lookup
    this.conversationCache.set(id, id);
    
    // Note: In production, this should persist to database
    // But that persistence is for evidence retrieval, not control flow
  }

  /**
   * Fetch message history for evidence building.
   * 
   * Returns messages as OPAQUE content.
   * Gateway does NOT interpret these messages.
   * 
   * This is called when building evidence packages for DKG.
   */
  async fetchMessageHistory(
    conversationId: XmtpConversationId
  ): Promise<Array<{ id: XmtpMessageId; content: OpaqueMessageContent; timestamp: number }>> {
    evidenceOnly('Fetching XMTP message history for evidence building');

    try {
      // Find the conversation
      const conversations = await this.client.conversations.list();
      const conversation = conversations.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c.id === conversationId || c.topic === conversationId
      );

      if (!conversation) {
        return [];
      }

      // Fetch messages
      const messages = await conversation.messages();

      // Convert to our opaque format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return messages.map((msg: any) => ({
        id: xmtpMessageId(msg.id),
        content: opaqueMessageContent(
          typeof msg.content === 'string' 
            ? Buffer.from(msg.content) 
            : msg.content
        ),
        timestamp: msg.sentAt?.getTime() ?? Date.now(),
      }));
    } catch (error) {
      // Log error but don't throw — evidence fetch failure is not critical
      console.error('Failed to fetch XMTP message history:', error);
      return [];
    }
  }

  /**
   * Hash messages for evidence integrity.
   * 
   * Produces a deterministic hash over message contents.
   * Used for creating threadRoot in DKG.
   * 
   * Input is OPAQUE content — Gateway does not interpret it.
   */
  async hashMessagesForEvidence(
    messages: OpaqueMessageContent[]
  ): Promise<string> {
    evidenceOnly('Hashing XMTP messages for evidence integrity');

    // Sort messages by content hash for determinism
    const sortedContents = [...messages].sort((a, b) => {
      const hashA = createHash('sha256').update(a).digest('hex');
      const hashB = createHash('sha256').update(b).digest('hex');
      return hashA.localeCompare(hashB);
    });

    // Create Merkle-like hash over all messages
    const combinedHash = createHash('sha256');
    for (const content of sortedContents) {
      const contentHash = createHash('sha256').update(content).digest();
      combinedHash.update(contentHash);
    }

    return '0x' + combinedHash.digest('hex');
  }
}

// =============================================================================
// MOCK ADAPTER FOR TESTING
// =============================================================================

/**
 * Mock XMTP adapter for testing.
 * 
 * Simulates XMTP operations without network calls.
 * Still enforces boundary invariants.
 */
export class MockXmtpAdapter implements XmtpGatewayClient {
  private conversations: Map<string, XmtpConversationId> = new Map();
  private messageStore: Map<string, Array<{
    id: XmtpMessageId;
    content: OpaqueMessageContent;
    timestamp: number;
  }>> = new Map();

  async storeConversationId(id: XmtpConversationId): Promise<void> {
    evidenceOnly('Mock: storing conversation ID');
    this.conversations.set(id, id);
  }

  async fetchMessageHistory(
    conversationId: XmtpConversationId
  ): Promise<Array<{ id: XmtpMessageId; content: OpaqueMessageContent; timestamp: number }>> {
    evidenceOnly('Mock: fetching message history');
    return this.messageStore.get(conversationId) ?? [];
  }

  async hashMessagesForEvidence(messages: OpaqueMessageContent[]): Promise<string> {
    evidenceOnly('Mock: hashing messages for evidence');
    
    const combinedHash = createHash('sha256');
    for (const content of messages) {
      combinedHash.update(content);
    }
    return '0x' + combinedHash.digest('hex');
  }

  // Test helpers
  addTestMessage(
    conversationId: string,
    content: string,
    timestamp: number = Date.now()
  ): void {
    const id = xmtpConversationId(conversationId);
    const existing = this.messageStore.get(id) ?? [];
    existing.push({
      id: xmtpMessageId(`msg-${existing.length + 1}`),
      content: opaqueMessageContent(Buffer.from(content)),
      timestamp,
    });
    this.messageStore.set(id, existing);
  }

  clear(): void {
    this.conversations.clear();
    this.messageStore.clear();
  }
}

// =============================================================================
// FORBIDDEN OPERATIONS (Documentation)
// =============================================================================

/**
 * FORBIDDEN XMTP OPERATIONS
 * 
 * The Gateway MUST NOT:
 * 
 * ❌ parseMessage() - Gateway must treat message content as opaque bytes
 * ❌ onMessageReceived() - Gateway must not take actions based on message content
 * ❌ triggerWorkflowFromMessage() - XMTP is not a control plane
 * ❌ subscribeForControlFlow() - Gateway does not use XMTP for workflow orchestration
 * 
 * If you need any of these operations, you are implementing forbidden behavior.
 */
