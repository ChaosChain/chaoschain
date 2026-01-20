/**
 * Arweave Adapter - Irys implementation
 * 
 * Minimal implementation for WorkSubmission workflow only.
 * Uses Irys (formerly Bundlr) for fast uploads with guaranteed finality.
 * 
 * Note: This is a stub that can be swapped for real Irys client.
 * For testing, use MockArweaveAdapter.
 */

import {
  ArweaveUploader,
  ArweaveAdapter,
  ArweaveStatus,
} from '../workflows/index.js';

// =============================================================================
// ARWEAVE ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * Real Arweave/Irys adapter.
 * Requires Irys SDK to be installed.
 * 
 * Usage:
 * ```
 * const irys = new Irys({ url: 'https://node1.irys.xyz', ... });
 * const adapter = new IrysArweaveAdapter(irys);
 * ```
 */
export class IrysArweaveAdapter implements ArweaveUploader, ArweaveAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private irys: any; // Irys type from @irys/sdk
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
    const irysTags = tags
      ? Object.entries(tags).map(([name, value]) => ({ name, value }))
      : [];

    const receipt = await this.irys.upload(content, { tags: irysTags });
    return receipt.id;
  }

  async isConfirmed(txId: string): Promise<boolean> {
    // Irys provides instant finality, so if upload succeeded, it's confirmed
    // For extra safety, we can check gateway
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
      
      // Other status codes - assume pending
      return 'pending';
    } catch {
      // Network error - assume pending
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
