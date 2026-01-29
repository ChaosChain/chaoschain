/**
 * Evidence Builder
 * 
 * Builds evidence packages from XMTP conversations and archives them to Arweave.
 * 
 * BOUNDARY INVARIANTS:
 * 
 * 1. Evidence is ARCHIVAL, not control flow
 *    - Building evidence does NOT trigger workflows
 *    - Archiving to Arweave does NOT change workflow state
 *    - Evidence is built on request, not on message receipt
 * 
 * 2. Content is OPAQUE
 *    - Gateway does not interpret XMTP message content
 *    - Gateway does not interpret Arweave evidence content
 *    - Gateway only hashes and archives
 * 
 * 3. Failures are STALLED
 *    - XMTP fetch failure → retry (does not affect workflow)
 *    - Arweave upload failure → STALLED (operational, not correctness)
 */

import { createHash } from 'crypto';
import {
  XmtpConversationId,
  OpaqueMessageContent,
  ArweaveTxId,
  arweaveTxId,
  evidenceOnly,
} from '../boundaries/index.js';
import { XmtpGatewayClient } from '../xmtp/index.js';
import { ArweaveUploader } from '../workflows/index.js';

// =============================================================================
// EVIDENCE PACKAGE SCHEMA
// =============================================================================

/**
 * Evidence package header.
 * Contains metadata about the evidence, not the evidence itself.
 */
export interface EvidenceHeader {
  /** Schema version */
  version: '1.0.0';
  
  /** Studio this evidence is for */
  studioAddress: string;
  
  /** Epoch number */
  epoch: number;
  
  /** Agent who produced this evidence */
  agentAddress: string;
  
  /** XMTP conversation ID (reference) */
  conversationId?: string;
  
  /** Timestamp of evidence creation */
  timestamp: number;
  
  /** Number of messages in evidence */
  messageCount: number;
}

/**
 * Evidence package.
 * 
 * This is what gets archived to Arweave.
 * Content is serialized as opaque bytes.
 */
export interface EvidencePackage {
  /** Header with metadata */
  header: EvidenceHeader;
  
  /** Hash of all message contents (for integrity) */
  contentHash: string;
  
  /** Serialized message contents (opaque) */
  contentBytes: Uint8Array;
}

// =============================================================================
// EVIDENCE BUILDER
// =============================================================================

/**
 * Evidence builder configuration.
 */
export interface EvidenceBuilderConfig {
  /** XMTP client for fetching messages */
  xmtp: XmtpGatewayClient;
  
  /** Arweave uploader for archiving */
  arweave: ArweaveUploader;
}

/**
 * Evidence builder.
 * 
 * Fetches XMTP messages and archives them to Arweave as evidence.
 * 
 * This is called by workflow steps when building evidence packages.
 * It does NOT trigger workflows or affect workflow state directly.
 */
export class EvidenceBuilder {
  private xmtp: XmtpGatewayClient;
  private arweave: ArweaveUploader;

  constructor(config: EvidenceBuilderConfig) {
    this.xmtp = config.xmtp;
    this.arweave = config.arweave;
  }

  /**
   * Build evidence package from XMTP conversation.
   * 
   * 1. Fetches messages from XMTP (opaque content)
   * 2. Hashes messages for integrity
   * 3. Serializes to evidence package
   * 
   * Does NOT upload to Arweave. Use `archiveEvidence()` for that.
   */
  async buildFromConversation(
    conversationId: XmtpConversationId,
    studioAddress: string,
    epoch: number,
    agentAddress: string
  ): Promise<EvidencePackage> {
    evidenceOnly('Building evidence package from XMTP conversation');

    // Fetch messages (opaque content)
    const messages = await this.xmtp.fetchMessageHistory(conversationId);

    // Extract content for hashing
    const contents = messages.map((m) => m.content);

    // Hash for integrity
    const contentHash = await this.xmtp.hashMessagesForEvidence(contents);

    // Serialize messages to bytes
    const serialized = this.serializeMessages(messages);

    return {
      header: {
        version: '1.0.0',
        studioAddress,
        epoch,
        agentAddress,
        conversationId,
        timestamp: Date.now(),
        messageCount: messages.length,
      },
      contentHash,
      contentBytes: serialized,
    };
  }

  /**
   * Build evidence package from raw content.
   * 
   * Used when evidence is not from XMTP (e.g., direct submission).
   */
  async buildFromContent(
    content: Uint8Array,
    studioAddress: string,
    epoch: number,
    agentAddress: string
  ): Promise<EvidencePackage> {
    evidenceOnly('Building evidence package from raw content');

    const contentHash = '0x' + createHash('sha256').update(content).digest('hex');

    return {
      header: {
        version: '1.0.0',
        studioAddress,
        epoch,
        agentAddress,
        timestamp: Date.now(),
        messageCount: 1,
      },
      contentHash,
      contentBytes: content,
    };
  }

  /**
   * Archive evidence package to Arweave.
   * 
   * Returns Arweave TX ID.
   * On failure, throws error → caller should handle as STALLED.
   */
  async archiveEvidence(evidence: EvidencePackage): Promise<ArweaveTxId> {
    evidenceOnly('Archiving evidence package to Arweave');

    // Serialize entire package
    const serialized = this.serializePackage(evidence);

    // Upload to Arweave
    const txId = await this.arweave.upload(Buffer.from(serialized), {
      'Content-Type': 'application/octet-stream',
      'ChaosChain-Version': '1.0.0',
      'ChaosChain-Studio': evidence.header.studioAddress,
      'ChaosChain-Epoch': evidence.header.epoch.toString(),
      'ChaosChain-Agent': evidence.header.agentAddress,
      'ChaosChain-ContentHash': evidence.contentHash,
    });

    return arweaveTxId(txId);
  }

  /**
   * Build and archive in one step.
   * 
   * Convenience method for workflow steps.
   */
  async buildAndArchiveFromConversation(
    conversationId: XmtpConversationId,
    studioAddress: string,
    epoch: number,
    agentAddress: string
  ): Promise<{ package: EvidencePackage; arweaveTxId: ArweaveTxId }> {
    const pkg = await this.buildFromConversation(
      conversationId,
      studioAddress,
      epoch,
      agentAddress
    );
    const txId = await this.archiveEvidence(pkg);
    return { package: pkg, arweaveTxId: txId };
  }

  /**
   * Compute evidence root for on-chain submission.
   * 
   * This is the hash that gets submitted to the contract.
   */
  computeEvidenceRoot(evidence: EvidencePackage): string {
    evidenceOnly('Computing evidence root for on-chain submission');

    const rootHash = createHash('sha256');
    rootHash.update(evidence.header.studioAddress);
    rootHash.update(evidence.header.epoch.toString());
    rootHash.update(evidence.header.agentAddress);
    rootHash.update(evidence.contentHash);
    return '0x' + rootHash.digest('hex');
  }

  // Internal serialization methods

  private serializeMessages(
    messages: Array<{ id: unknown; content: OpaqueMessageContent; timestamp: number }>
  ): Uint8Array {
    // Simple concatenation with length prefixes
    const parts: Uint8Array[] = [];
    
    for (const msg of messages) {
      // 8 bytes for timestamp
      const timestampBytes = new Uint8Array(8);
      const view = new DataView(timestampBytes.buffer);
      view.setBigUint64(0, BigInt(msg.timestamp), false);
      parts.push(timestampBytes);
      
      // 4 bytes for content length
      const lengthBytes = new Uint8Array(4);
      new DataView(lengthBytes.buffer).setUint32(0, msg.content.length, false);
      parts.push(lengthBytes);
      
      // Content bytes
      parts.push(msg.content);
    }

    // Concatenate all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  private serializePackage(pkg: EvidencePackage): Uint8Array {
    // Serialize header as JSON
    const headerJson = JSON.stringify(pkg.header);
    const headerBytes = new TextEncoder().encode(headerJson);
    
    // Format: [header_length (4 bytes)][header][content_hash][content]
    const contentHashBytes = new TextEncoder().encode(pkg.contentHash);
    
    const totalLength = 4 + headerBytes.length + contentHashBytes.length + pkg.contentBytes.length;
    const result = new Uint8Array(totalLength);
    
    // Header length
    new DataView(result.buffer).setUint32(0, headerBytes.length, false);
    
    // Header
    result.set(headerBytes, 4);
    
    // Content hash
    result.set(contentHashBytes, 4 + headerBytes.length);
    
    // Content
    result.set(pkg.contentBytes, 4 + headerBytes.length + contentHashBytes.length);
    
    return result;
  }
}

// =============================================================================
// MOCK EVIDENCE BUILDER FOR TESTING
// =============================================================================

/**
 * Mock evidence builder that doesn't require real XMTP/Arweave.
 */
export class MockEvidenceBuilder {
  private nextTxId = 1;
  private archived: Map<string, EvidencePackage> = new Map();

  async buildFromContent(
    content: Uint8Array,
    studioAddress: string,
    epoch: number,
    agentAddress: string
  ): Promise<EvidencePackage> {
    const contentHash = '0x' + createHash('sha256').update(content).digest('hex');
    return {
      header: {
        version: '1.0.0',
        studioAddress,
        epoch,
        agentAddress,
        timestamp: Date.now(),
        messageCount: 1,
      },
      contentHash,
      contentBytes: content,
    };
  }

  async archiveEvidence(evidence: EvidencePackage): Promise<ArweaveTxId> {
    const txId = `mock-ar-${this.nextTxId++}`;
    this.archived.set(txId, evidence);
    return arweaveTxId(txId);
  }

  computeEvidenceRoot(evidence: EvidencePackage): string {
    const rootHash = createHash('sha256');
    rootHash.update(evidence.header.studioAddress);
    rootHash.update(evidence.header.epoch.toString());
    rootHash.update(evidence.header.agentAddress);
    rootHash.update(evidence.contentHash);
    return '0x' + rootHash.digest('hex');
  }

  // Test helper
  getArchived(txId: string): EvidencePackage | undefined {
    return this.archived.get(txId);
  }
}
