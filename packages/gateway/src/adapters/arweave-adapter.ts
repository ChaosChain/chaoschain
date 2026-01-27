/**
 * Arweave Adapter - Production Turbo Implementation
 * 
 * Uses ArDrive Turbo for fast uploads with guaranteed finality.
 * 
 * BOUNDARY INVARIANTS:
 * - Arweave is EVIDENCE STORAGE, not a control plane
 * - All Arweave failures → STALLED (operational), never FAILED (correctness)
 * - Gateway does NOT interpret stored content
 * - Gateway does NOT trigger workflows based on Arweave state
 * 
 * @see https://github.com/ardriveapp/turbo-python-sdk
 */

import {
  ArweaveUploader,
  ArweaveAdapter,
  ArweaveStatus,
} from '../workflows/index.js';
import {
  evidenceOnly,
  mapArweaveErrorToState,
} from '../boundaries/index.js';

// =============================================================================
// TURBO ADAPTER (Production)
// =============================================================================

/**
 * Turbo client interface.
 * Matches the API from @ardrive/turbo-sdk.
 */
export interface TurboClient {
  uploadFile(options: {
    fileStreamFactory: () => Buffer;
    fileSizeFactory: () => number;
    dataItemOpts?: {
      tags?: Array<{ name: string; value: string }>;
    };
  }): Promise<{ id: string }>;
}

/**
 * Production Arweave adapter using Turbo.
 * 
 * Turbo provides:
 * - Fast uploads (no proof of work)
 * - Guaranteed Arweave finality
 * - Pay-as-you-go pricing
 * 
 * FAILURE SEMANTICS:
 * All Turbo errors result in STALLED state (operational failure).
 * The evidence might have been uploaded; reconciliation will determine truth.
 */
export class TurboArweaveAdapter implements ArweaveUploader, ArweaveAdapter {
  private turbo: TurboClient | null;
  private gatewayUrl: string;

  /**
   * Create a Turbo adapter.
   * 
   * @param turboClientOrGatewayUrl - TurboClient for uploads, or just gateway URL for read-only mode
   * @param gatewayUrl - Arweave gateway URL (only when first arg is TurboClient)
   */
  constructor(turboClientOrGatewayUrl: TurboClient | string, gatewayUrl?: string) {
    if (typeof turboClientOrGatewayUrl === 'string') {
      // Read-only mode - no upload capability
      this.turbo = null;
      this.gatewayUrl = turboClientOrGatewayUrl;
    } else {
      // Full mode with uploads
      this.turbo = turboClientOrGatewayUrl;
      this.gatewayUrl = gatewayUrl ?? 'https://arweave.net';
    }
  }

  /**
   * Upload evidence to Arweave via Turbo.
   * 
   * Returns TX ID on success.
   * Throws on failure → caller should map to STALLED.
   * 
   * NOTE: Requires TurboClient to be configured. In read-only mode, this throws.
   */
  async upload(
    content: Buffer,
    tags?: Record<string, string>
  ): Promise<string> {
    evidenceOnly('Uploading evidence bundle to Arweave');

    if (!this.turbo) {
      throw new Error('TurboClient not configured - adapter is in read-only mode');
    }

    const turboTags = tags
      ? Object.entries(tags).map(([name, value]) => ({ name, value }))
      : [];

    // Add ChaosChain identification tag
    turboTags.push({ name: 'App-Name', value: 'ChaosChain' });
    turboTags.push({ name: 'App-Version', value: '0.1.0' });

    try {
      const result = await this.turbo.uploadFile({
        fileStreamFactory: () => content,
        fileSizeFactory: () => content.length,
        dataItemOpts: {
          tags: turboTags,
        },
      });

      return result.id;
    } catch (error) {
      // Map to STALLED semantic
      const state = mapArweaveErrorToState(error as Error);
      if (state !== 'STALLED') {
        throw new Error('Invariant violation: Arweave errors must map to STALLED');
      }
      throw error; // Re-throw; caller will handle as STALLED
    }
  }

  /**
   * Check if TX is confirmed on Arweave.
   * 
   * Gateway fetches the HEAD to verify existence.
   * Does NOT interpret content.
   */
  async isConfirmed(txId: string): Promise<boolean> {
    evidenceOnly('Checking Arweave TX confirmation status');

    try {
      const response = await fetch(`${this.gatewayUrl}/${txId}`, {
        method: 'HEAD',
      });
      return response.ok;
    } catch {
      // Network error — assume not confirmed (will retry)
      return false;
    }
  }

  /**
   * Get detailed status of a TX.
   */
  async getStatus(txId: string): Promise<ArweaveStatus> {
    evidenceOnly('Getting Arweave TX status');

    try {
      const response = await fetch(`${this.gatewayUrl}/${txId}`, {
        method: 'HEAD',
      });
      
      if (response.ok) {
        return 'confirmed';
      }
      
      if (response.status === 404) {
        return 'not_found';
      }
      
      // Other status codes - assume pending
      return 'pending';
    } catch {
      // Network error - assume pending
      return 'pending';
    }
  }

  /**
   * Retrieve evidence from Arweave.
   * 
   * Returns raw bytes — Gateway does NOT interpret content.
   */
  async retrieve(txId: string): Promise<Uint8Array | null> {
    evidenceOnly('Retrieving evidence from Arweave');

    try {
      const response = await fetch(`${this.gatewayUrl}/${txId}`);
      
      if (!response.ok) {
        return null;
      }
      
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }
}

// =============================================================================
// IRYS ADAPTER (Legacy - kept for compatibility)
// =============================================================================

/**
 * Legacy Irys adapter.
 * @deprecated Use TurboArweaveAdapter instead.
 */
export class IrysArweaveAdapter implements ArweaveUploader, ArweaveAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private irys: any;
  private gatewayUrl: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(irysClient: any, gatewayUrl: string = 'https://arweave.net') {
    this.irys = irysClient;
    this.gatewayUrl = gatewayUrl;
  }

  async upload(
    content: Buffer,
    tags?: Record<string, string>
  ): Promise<string> {
    evidenceOnly('Uploading evidence via legacy Irys');

    const irysTags = tags
      ? Object.entries(tags).map(([name, value]) => ({ name, value }))
      : [];

    const receipt = await this.irys.upload(content, { tags: irysTags });
    return receipt.id;
  }

  async isConfirmed(txId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.gatewayUrl}/${txId}`, {
        method: 'HEAD',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(txId: string): Promise<ArweaveStatus> {
    try {
      const response = await fetch(`${this.gatewayUrl}/${txId}`, {
        method: 'HEAD',
      });
      
      if (response.ok) {
        return 'confirmed';
      }
      
      if (response.status === 404) {
        return 'not_found';
      }
      
      return 'pending';
    } catch {
      return 'pending';
    }
  }
}

// =============================================================================
// MOCK ADAPTER FOR TESTING
// =============================================================================

/**
 * Mock Arweave adapter for testing.
 * Simulates uploads without actual network calls.
 */
export class MockArweaveAdapter implements ArweaveUploader, ArweaveAdapter {
  private uploads: Map<string, { content: Buffer; confirmed: boolean }> = new Map();
  private uploadDelay: number;
  private confirmationDelay: number;
  private nextId: number = 1;

  constructor(
    options?: {
      uploadDelay?: number;
      confirmationDelay?: number;
    }
  ) {
    this.uploadDelay = options?.uploadDelay ?? 0;
    this.confirmationDelay = options?.confirmationDelay ?? 0;
  }

  async upload(
    content: Buffer,
    _tags?: Record<string, string>
  ): Promise<string> {
    if (this.uploadDelay > 0) {
      await new Promise((r) => setTimeout(r, this.uploadDelay));
    }

    const id = `mock-ar-${this.nextId++}`;
    this.uploads.set(id, { content, confirmed: false });

    // Schedule confirmation
    if (this.confirmationDelay > 0) {
      setTimeout(() => {
        const upload = this.uploads.get(id);
        if (upload) {
          upload.confirmed = true;
        }
      }, this.confirmationDelay);
    } else {
      // Instant confirmation
      this.uploads.get(id)!.confirmed = true;
    }

    return id;
  }

  async isConfirmed(txId: string): Promise<boolean> {
    const upload = this.uploads.get(txId);
    return upload?.confirmed ?? false;
  }

  async getStatus(txId: string): Promise<ArweaveStatus> {
    const upload = this.uploads.get(txId);
    
    if (!upload) {
      return 'not_found';
    }
    
    return upload.confirmed ? 'confirmed' : 'pending';
  }

  // For testing: get uploaded content
  getContent(txId: string): Buffer | undefined {
    return this.uploads.get(txId)?.content;
  }

  // For testing: force confirmation
  forceConfirm(txId: string): void {
    const upload = this.uploads.get(txId);
    if (upload) {
      upload.confirmed = true;
    }
  }

  // For testing: clear all uploads
  clear(): void {
    this.uploads.clear();
    this.nextId = 1;
  }
}
