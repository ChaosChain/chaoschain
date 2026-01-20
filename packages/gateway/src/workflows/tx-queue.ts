/**
 * Transaction Queue
 * 
 * Enforces per-signer serialization for transaction submission.
 * 
 * Invariant: One signer = one nonce stream = at most one pending tx at a time.
 * 
 * This prevents:
 * - Nonce races (two txs with same nonce)
 * - Stuck workflows (tx A fails, tx B with nonce+1 stuck forever)
 * - Ghost failures (assuming tx succeeded without confirmation)
 */

import { TxReceipt } from './types.js';

// =============================================================================
// TRANSACTION REQUEST
// =============================================================================

export interface TxRequest {
  to: string;
  data: string;
  value?: bigint;
  gasLimit?: bigint;
}

export interface TxSubmitResult {
  txHash: string;
}

// =============================================================================
// CHAIN ADAPTER INTERFACE
// =============================================================================

/**
 * Interface for blockchain interactions.
 * Injected into TxQueue to allow testing.
 */
export interface ChainAdapter {
  /**
   * Get current nonce for address.
   */
  getNonce(address: string): Promise<number>;

  /**
   * Submit a signed transaction.
   * Returns tx hash immediately (does not wait for confirmation).
   */
  submitTx(
    signer: string,
    request: TxRequest,
    nonce: number
  ): Promise<TxSubmitResult>;

  /**
   * Get transaction receipt.
   * Returns null if tx not found or still pending.
   */
  getTxReceipt(txHash: string): Promise<TxReceipt | null>;

  /**
   * Wait for transaction confirmation.
   * Polls until confirmed, reverted, or timeout.
   */
  waitForConfirmation(
    txHash: string,
    timeoutMs: number
  ): Promise<TxReceipt>;
}

// =============================================================================
// SIGNER LOCK
// =============================================================================

interface SignerLock {
  holder: string | null;  // Workflow ID holding the lock
  queue: Array<{
    workflowId: string;
    resolve: () => void;
  }>;
}

// =============================================================================
// TRANSACTION QUEUE
// =============================================================================

export class TxQueue {
  private locks: Map<string, SignerLock> = new Map();
  private chainAdapter: ChainAdapter;
  private confirmationTimeoutMs: number;

  constructor(chainAdapter: ChainAdapter, confirmationTimeoutMs: number = 120000) {
    this.chainAdapter = chainAdapter;
    this.confirmationTimeoutMs = confirmationTimeoutMs;
  }

  /**
   * Submit a transaction with per-signer serialization.
   * 
   * Flow:
   * 1. Acquire lock for signer
   * 2. Get nonce
   * 3. Submit tx
   * 4. Wait for confirmation
   * 5. Release lock
   * 
   * If the workflow crashes after step 3, the caller is responsible for
   * persisting the txHash and reconciling later.
   */
  async submitAndWait(
    workflowId: string,
    signer: string,
    request: TxRequest
  ): Promise<{ txHash: string; receipt: TxReceipt }> {
    // Step 1: Acquire lock
    await this.acquireLock(workflowId, signer);

    try {
      // Step 2: Get nonce
      const nonce = await this.chainAdapter.getNonce(signer);

      // Step 3: Submit tx
      const { txHash } = await this.chainAdapter.submitTx(signer, request, nonce);

      // Step 4: Wait for confirmation
      const receipt = await this.chainAdapter.waitForConfirmation(
        txHash,
        this.confirmationTimeoutMs
      );

      return { txHash, receipt };
    } finally {
      // Step 5: Release lock (always, even on error)
      this.releaseLock(signer);
    }
  }

  /**
   * Submit transaction and return hash immediately.
   * Caller is responsible for waiting for confirmation.
   * Lock is NOT released until releaseSignerLock is called.
   */
  async submitOnly(
    workflowId: string,
    signer: string,
    request: TxRequest
  ): Promise<string> {
    await this.acquireLock(workflowId, signer);

    try {
      const nonce = await this.chainAdapter.getNonce(signer);
      const { txHash } = await this.chainAdapter.submitTx(signer, request, nonce);
      return txHash;
    } catch (error) {
      // On error, release lock
      this.releaseLock(signer);
      throw error;
    }
    // Note: Lock is NOT released on success - caller must call releaseSignerLock
  }

  /**
   * Wait for a previously submitted transaction.
   * Assumes lock is already held.
   */
  async waitForTx(txHash: string): Promise<TxReceipt> {
    return this.chainAdapter.waitForConfirmation(txHash, this.confirmationTimeoutMs);
  }

  /**
   * Release lock for a signer.
   * Called after transaction is confirmed (or after giving up).
   */
  releaseSignerLock(signer: string): void {
    this.releaseLock(signer);
  }

  /**
   * Check transaction status without holding lock.
   * Used for reconciliation.
   */
  async checkTxStatus(txHash: string): Promise<TxReceipt | null> {
    return this.chainAdapter.getTxReceipt(txHash);
  }

  // ===========================================================================
  // PRIVATE: Lock Management
  // ===========================================================================

  private async acquireLock(workflowId: string, signer: string): Promise<void> {
    let lock = this.locks.get(signer);
    
    if (!lock) {
      // No lock exists, create and acquire immediately
      lock = { holder: workflowId, queue: [] };
      this.locks.set(signer, lock);
      return;
    }

    if (lock.holder === null) {
      // Lock exists but not held, acquire immediately
      lock.holder = workflowId;
      return;
    }

    if (lock.holder === workflowId) {
      // Same workflow already holds lock (re-entrant)
      return;
    }

    // Lock is held by another workflow, queue up and wait
    return new Promise<void>((resolve) => {
      lock!.queue.push({ workflowId, resolve });
    });
  }

  private releaseLock(signer: string): void {
    const lock = this.locks.get(signer);
    if (!lock) return;

    // Give lock to next in queue, or clear holder
    const next = lock.queue.shift();
    if (next) {
      lock.holder = next.workflowId;
      next.resolve();
    } else {
      lock.holder = null;
    }
  }

  // For testing: check if signer has pending lock
  isLocked(signer: string): boolean {
    const lock = this.locks.get(signer);
    return lock?.holder !== null && lock?.holder !== undefined;
  }

  // For testing: get queue length for signer
  queueLength(signer: string): number {
    const lock = this.locks.get(signer);
    return lock?.queue.length ?? 0;
  }
}
