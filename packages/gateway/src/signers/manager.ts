/**
 * Signer Manager
 * 
 * Validates signer existence/availability.
 * 
 * HARD CONSTRAINT: Gateway must NOT choose or rotate signers.
 * Workflow input provides the signer explicitly.
 * SignerManager may only validate existence / availability.
 * 
 * No signer selection logic.
 * No rotation logic.
 * No load balancing.
 */

import { ethers } from 'ethers';

// =============================================================================
// SIGNER MANAGER INTERFACE
// =============================================================================

/**
 * Interface for validating signer availability.
 * 
 * Does NOT select signers.
 * Does NOT rotate signers.
 * Does NOT manage signer lifecycle.
 */
export interface SignerManager {
  /**
   * Check if a signer is registered and available.
   * 
   * Does NOT select or recommend a signer.
   * Only validates that the explicitly requested signer exists.
   */
  isSignerAvailable(address: string): Promise<boolean>;

  /**
   * Get a signer by address.
   * Returns null if signer not found.
   * 
   * Caller must know which signer they want.
   * This does NOT select a signer for them.
   */
  getSigner(address: string): Promise<ethers.Signer | null>;

  /**
   * List all registered signer addresses.
   * For diagnostics and validation only.
   */
  listSigners(): Promise<string[]>;
}

// =============================================================================
// VALIDATION ERROR
// =============================================================================

export class SignerNotFoundError extends Error {
  constructor(public readonly address: string) {
    super(`Signer not found: ${address}`);
    this.name = 'SignerNotFoundError';
  }
}

export class SignerUnavailableError extends Error {
  constructor(public readonly address: string, public readonly reason: string) {
    super(`Signer unavailable: ${address} - ${reason}`);
    this.name = 'SignerUnavailableError';
  }
}

// =============================================================================
// IN-MEMORY IMPLEMENTATION
// =============================================================================

/**
 * Simple in-memory signer manager.
 * 
 * Stores signers in a map.
 * Production should use KMS, HSM, or secure vault.
 */
export class InMemorySignerManager implements SignerManager {
  private signers: Map<string, ethers.Signer> = new Map();

  /**
   * Register a signer.
   * Address is normalized to lowercase.
   */
  registerSigner(address: string, signer: ethers.Signer): void {
    this.signers.set(address.toLowerCase(), signer);
  }

  /**
   * Register a signer from a private key.
   */
  async registerSignerFromKey(privateKey: string, provider?: ethers.Provider): Promise<string> {
    const wallet = provider 
      ? new ethers.Wallet(privateKey, provider)
      : new ethers.Wallet(privateKey);
    const address = await wallet.getAddress();
    this.registerSigner(address, wallet);
    return address;
  }

  async isSignerAvailable(address: string): Promise<boolean> {
    return this.signers.has(address.toLowerCase());
  }

  async getSigner(address: string): Promise<ethers.Signer | null> {
    return this.signers.get(address.toLowerCase()) ?? null;
  }

  async listSigners(): Promise<string[]> {
    return Array.from(this.signers.keys());
  }

  /**
   * Remove a signer.
   */
  removeSigner(address: string): void {
    this.signers.delete(address.toLowerCase());
  }

  /**
   * Clear all signers.
   */
  clear(): void {
    this.signers.clear();
  }
}

// =============================================================================
// VALIDATION HELPER
// =============================================================================

/**
 * Validate that a signer exists before workflow creation.
 * 
 * This is admission control only - validates that the explicitly
 * provided signer is available. Does NOT select a signer.
 */
export async function validateSignerExists(
  manager: SignerManager,
  address: string
): Promise<void> {
  const available = await manager.isSignerAvailable(address);
  if (!available) {
    throw new SignerNotFoundError(address);
  }
}
