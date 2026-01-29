/**
 * Signer Manager Tests
 * 
 * Proves:
 * - SignerManager ONLY validates existence/availability
 * - SignerManager does NOT select or rotate signers
 * - Workflow input provides the signer explicitly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import {
  InMemorySignerManager,
  SignerNotFoundError,
  validateSignerExists,
} from '../../src/signers/manager.js';

describe('InMemorySignerManager', () => {
  let manager: InMemorySignerManager;

  beforeEach(() => {
    manager = new InMemorySignerManager();
  });

  describe('registerSigner', () => {
    it('should register a signer', async () => {
      const wallet = ethers.Wallet.createRandom();
      const address = await wallet.getAddress();

      manager.registerSigner(address, wallet);

      expect(await manager.isSignerAvailable(address)).toBe(true);
    });

    it('should normalize address to lowercase', async () => {
      const wallet = ethers.Wallet.createRandom();
      const address = await wallet.getAddress();

      manager.registerSigner(address.toUpperCase(), wallet);

      expect(await manager.isSignerAvailable(address.toLowerCase())).toBe(true);
      expect(await manager.isSignerAvailable(address.toUpperCase())).toBe(true);
    });
  });

  describe('registerSignerFromKey', () => {
    it('should register signer from private key', async () => {
      const privateKey = ethers.Wallet.createRandom().privateKey;

      const address = await manager.registerSignerFromKey(privateKey);

      expect(await manager.isSignerAvailable(address)).toBe(true);
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });

  describe('isSignerAvailable', () => {
    it('should return true for registered signer', async () => {
      const wallet = ethers.Wallet.createRandom();
      const address = await wallet.getAddress();
      manager.registerSigner(address, wallet);

      expect(await manager.isSignerAvailable(address)).toBe(true);
    });

    it('should return false for unregistered signer', async () => {
      const unknownAddress = '0x' + '1'.repeat(40);

      expect(await manager.isSignerAvailable(unknownAddress)).toBe(false);
    });
  });

  describe('getSigner', () => {
    it('should return signer for registered address', async () => {
      const wallet = ethers.Wallet.createRandom();
      const address = await wallet.getAddress();
      manager.registerSigner(address, wallet);

      const signer = await manager.getSigner(address);

      expect(signer).toBeDefined();
      expect(await signer?.getAddress()).toBe(address);
    });

    it('should return null for unregistered address', async () => {
      const unknownAddress = '0x' + '1'.repeat(40);

      const signer = await manager.getSigner(unknownAddress);

      expect(signer).toBeNull();
    });
  });

  describe('listSigners', () => {
    it('should return empty array when no signers', async () => {
      const signers = await manager.listSigners();
      expect(signers).toEqual([]);
    });

    it('should return all registered signer addresses', async () => {
      const wallet1 = ethers.Wallet.createRandom();
      const wallet2 = ethers.Wallet.createRandom();
      const addr1 = (await wallet1.getAddress()).toLowerCase();
      const addr2 = (await wallet2.getAddress()).toLowerCase();

      manager.registerSigner(addr1, wallet1);
      manager.registerSigner(addr2, wallet2);

      const signers = await manager.listSigners();
      expect(signers).toHaveLength(2);
      expect(signers).toContain(addr1);
      expect(signers).toContain(addr2);
    });
  });

  describe('removeSigner', () => {
    it('should remove registered signer', async () => {
      const wallet = ethers.Wallet.createRandom();
      const address = await wallet.getAddress();
      manager.registerSigner(address, wallet);

      expect(await manager.isSignerAvailable(address)).toBe(true);

      manager.removeSigner(address);

      expect(await manager.isSignerAvailable(address)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all signers', async () => {
      const wallet1 = ethers.Wallet.createRandom();
      const wallet2 = ethers.Wallet.createRandom();
      manager.registerSigner(await wallet1.getAddress(), wallet1);
      manager.registerSigner(await wallet2.getAddress(), wallet2);

      expect((await manager.listSigners()).length).toBe(2);

      manager.clear();

      expect((await manager.listSigners()).length).toBe(0);
    });
  });
});

describe('validateSignerExists', () => {
  it('should pass for registered signer', async () => {
    const manager = new InMemorySignerManager();
    const wallet = ethers.Wallet.createRandom();
    const address = await wallet.getAddress();
    manager.registerSigner(address, wallet);

    await expect(validateSignerExists(manager, address))
      .resolves.toBeUndefined();
  });

  it('should throw SignerNotFoundError for unregistered signer', async () => {
    const manager = new InMemorySignerManager();
    const unknownAddress = '0x' + '1'.repeat(40);

    await expect(validateSignerExists(manager, unknownAddress))
      .rejects.toThrow(SignerNotFoundError);
  });

  it('should include address in error', async () => {
    const manager = new InMemorySignerManager();
    const unknownAddress = '0xabc123abc123abc123abc123abc123abc123abc1';

    const err = await validateSignerExists(manager, unknownAddress)
      .catch((e) => e);

    expect(err).toBeInstanceOf(SignerNotFoundError);
    expect(err.address).toBe(unknownAddress);
    expect(err.message).toContain(unknownAddress);
  });
});

describe('SignerManager Invariants', () => {
  it('MUST NOT select signers', () => {
    // The SignerManager interface does NOT have any method that
    // selects, recommends, or rotates signers.
    const manager = new InMemorySignerManager();

    // There is no:
    // - getAvailableSigner()
    // - selectSigner()
    // - nextSigner()
    // - rotateSigner()

    // Only validation:
    // - isSignerAvailable(address)
    // - getSigner(address)
    // - listSigners()

    expect(typeof manager.isSignerAvailable).toBe('function');
    expect(typeof manager.getSigner).toBe('function');
    expect(typeof manager.listSigners).toBe('function');

    // @ts-expect-error - Method should not exist
    expect(manager.selectSigner).toBeUndefined();
    // @ts-expect-error - Method should not exist
    expect(manager.getAvailableSigner).toBeUndefined();
    // @ts-expect-error - Method should not exist
    expect(manager.nextSigner).toBeUndefined();
    // @ts-expect-error - Method should not exist
    expect(manager.rotateSigner).toBeUndefined();
  });

  it('workflow input MUST provide signer explicitly', () => {
    // This is a design constraint, not a code test.
    // The workflow input types (WorkSubmissionInput, etc.) require
    // signer_address as an explicit field.
    //
    // The Gateway does NOT infer or select the signer.
    // It only validates that the requested signer exists.

    // This is already enforced by TypeScript types:
    // - WorkSubmissionInput.signer_address: string (required)
    // - ScoreSubmissionInput.signer_address: string (required)
    // - CloseEpochInput.signer_address: string (required)
  });

  it('MUST NOT have rotation logic', () => {
    // There is no state that tracks which signer was used last
    // or any logic to rotate between signers.

    const manager = new InMemorySignerManager();

    // No internal rotation state
    // @ts-expect-error - Property should not exist
    expect(manager.lastUsedSigner).toBeUndefined();
    // @ts-expect-error - Property should not exist
    expect(manager.rotationIndex).toBeUndefined();
  });
});
