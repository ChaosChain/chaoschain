/**
 * Chain Adapter - ethers.js implementation
 * 
 * Minimal implementation for WorkSubmission workflow only.
 * 
 * Implements:
 * - submitWork transaction encoding
 * - getTxReceipt
 * - waitForConfirmation
 * - getNonce
 * - workSubmissionExists
 * 
 * Does NOT implement:
 * - score submission
 * - epoch closure
 * - batching
 * - gas optimization
 * - fancy error decoding
 */

import { ethers } from 'ethers';
import {
  ChainAdapter,
  TxRequest,
  TxSubmitResult,
  TxReceipt,
  TxStatus,
  ChainStateAdapter,
  ContractEncoder,
} from '../workflows/index.js';
import { ScoreChainStateAdapter } from '../workflows/score-submission.js';
import { EpochChainStateAdapter } from '../workflows/close-epoch.js';

// =============================================================================
// STUDIO PROXY ABI (minimal, only what we need)
// =============================================================================

const STUDIO_PROXY_ABI = [
  // submitWork function (feedbackAuth is empty bytes in Jan 2026 spec)
  'function submitWork(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, bytes calldata feedbackAuth) external',
  // submitWorkMultiAgent function (no feedbackAuth in Jan 2026 spec)
  'function submitWorkMultiAgent(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, address[] calldata workers, uint16[] calldata weights, string calldata evidenceUri) external',
  // View functions for checking existing submissions
  'function getWorkSubmission(bytes32 dataHash) external view returns (address submitter, bytes32 threadRoot, bytes32 evidenceRoot, bytes memory feedbackAuth, uint64 timestamp)',
  // Score submission (commit-reveal)
  'function commitScore(bytes32 dataHash, bytes32 commitHash) external',
  'function revealScore(bytes32 dataHash, uint16[] calldata scores, bytes32 salt) external',
  'function getScoreCommit(bytes32 dataHash, address validator) external view returns (bytes32 commitHash, uint64 timestamp)',
  'function getScoreReveal(bytes32 dataHash, address validator) external view returns (uint16[] memory scores, uint64 timestamp)',
];

// =============================================================================
// REWARDS DISTRIBUTOR ABI (for epoch management)
// =============================================================================

const REWARDS_DISTRIBUTOR_ABI = [
  // Epoch closure (called by owner)
  'function closeEpoch(address studio, uint64 epoch) external',
  // Work registration
  'function registerWork(address studio, uint64 epoch, bytes32 dataHash) external',
  // Query functions
  'function getEpochWork(address studio, uint64 epoch) external view returns (bytes32[] memory)',
];

// =============================================================================
// ETHERS CHAIN ADAPTER
// =============================================================================

export class EthersChainAdapter implements ChainAdapter, ChainStateAdapter, ScoreChainStateAdapter, EpochChainStateAdapter {
  private provider: ethers.Provider;
  private signers: Map<string, ethers.Signer> = new Map();
  private confirmationBlocks: number;
  private pollIntervalMs: number;
  private rewardsDistributorAddress: string | null;

  constructor(
    provider: ethers.Provider,
    confirmationBlocks: number = 2,
    pollIntervalMs: number = 2000,
    rewardsDistributorAddress?: string
  ) {
    this.provider = provider;
    this.confirmationBlocks = confirmationBlocks;
    this.pollIntervalMs = pollIntervalMs;
    this.rewardsDistributorAddress = rewardsDistributorAddress ?? null;
  }

  /**
   * Set the RewardsDistributor address for epoch management.
   */
  setRewardsDistributorAddress(address: string): void {
    this.rewardsDistributorAddress = address;
  }

  /**
   * Get the RewardsDistributor address.
   */
  getRewardsDistributorAddress(): string | null {
    return this.rewardsDistributorAddress;
  }

  /**
   * Register a signer for an address.
   * Must be called before submitting transactions.
   */
  registerSigner(address: string, signer: ethers.Signer): void {
    this.signers.set(address.toLowerCase(), signer);
  }

  // ===========================================================================
  // ChainAdapter Implementation
  // ===========================================================================

  async getNonce(address: string): Promise<number> {
    return await this.provider.getTransactionCount(address, 'pending');
  }

  async submitTx(
    signerAddress: string,
    request: TxRequest,
    nonce: number
  ): Promise<TxSubmitResult> {
    const signer = this.signers.get(signerAddress.toLowerCase());
    if (!signer) {
      throw new Error(`No signer registered for address: ${signerAddress}`);
    }

    const tx: ethers.TransactionRequest = {
      to: request.to,
      data: request.data,
      nonce,
    };

    if (request.value !== undefined) {
      tx.value = request.value;
    }

    if (request.gasLimit !== undefined) {
      tx.gasLimit = request.gasLimit;
    }

    const response = await signer.sendTransaction(tx);
    
    return { txHash: response.hash };
  }

  async getTxReceipt(txHash: string): Promise<TxReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return null;
    }

    return this.mapReceipt(receipt);
  }

  async waitForConfirmation(
    txHash: string,
    timeoutMs: number
  ): Promise<TxReceipt> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const receipt = await this.provider.getTransactionReceipt(txHash);

      if (receipt) {
        // Check if we have enough confirmations
        const currentBlock = await this.provider.getBlockNumber();
        const confirmations = currentBlock - receipt.blockNumber + 1;

        if (confirmations >= this.confirmationBlocks) {
          return this.mapReceipt(receipt);
        }
      }

      // Wait before polling again
      await this.sleep(this.pollIntervalMs);
    }

    // Timeout - check one more time
    const finalReceipt = await this.provider.getTransactionReceipt(txHash);
    if (finalReceipt) {
      return this.mapReceipt(finalReceipt);
    }

    // Tx not found after timeout
    return {
      status: 'not_found',
    };
  }

  // ===========================================================================
  // ChainStateAdapter Implementation
  // ===========================================================================

  async workSubmissionExists(
    studioAddress: string,
    dataHash: string
  ): Promise<boolean> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const submission = await contract.getWorkSubmission(dataHash);
      // If submitter is zero address, no submission exists
      return submission.submitter !== ethers.ZeroAddress;
    } catch (error) {
      // Contract call failed - assume doesn't exist
      // This could be because the function doesn't exist or other reasons
      return false;
    }
  }

  async getWorkSubmission(
    studioAddress: string,
    dataHash: string
  ): Promise<{
    dataHash: string;
    submitter: string;
    timestamp: number;
    blockNumber: number;
  } | null> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const submission = await contract.getWorkSubmission(dataHash);
      
      if (submission.submitter === ethers.ZeroAddress) {
        return null;
      }

      return {
        dataHash,
        submitter: submission.submitter,
        timestamp: Number(submission.timestamp),
        blockNumber: 0, // Not available from this call
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // ScoreChainStateAdapter Implementation
  // ===========================================================================

  async commitExists(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<boolean> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const commit = await contract.getScoreCommit(dataHash, validator);
      // If commitHash is zero, no commit exists
      return commit.commitHash !== ethers.ZeroHash;
    } catch {
      return false;
    }
  }

  async revealExists(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<boolean> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const reveal = await contract.getScoreReveal(dataHash, validator);
      // If scores array is empty, no reveal exists
      return reveal.scores && reveal.scores.length > 0;
    } catch {
      return false;
    }
  }

  async getCommit(
    studioAddress: string,
    dataHash: string,
    validator: string
  ): Promise<{ commitHash: string; timestamp: number } | null> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const commit = await contract.getScoreCommit(dataHash, validator);
      if (commit.commitHash === ethers.ZeroHash) {
        return null;
      }
      return {
        commitHash: commit.commitHash,
        timestamp: Number(commit.timestamp),
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // EpochChainStateAdapter Implementation
  // ===========================================================================

  async epochExists(studioAddress: string, epoch: number): Promise<boolean> {
    // ChaosChain doesn't have explicit epoch tracking - epochs are implicit
    // An epoch "exists" if there's work registered for it, or if epoch >= 0
    // The RewardsDistributor tracks work per epoch via _epochWork mapping
    
    if (!this.rewardsDistributorAddress) {
      // No RewardsDistributor configured - assume epoch exists (lenient)
      return epoch >= 0;
    }

    try {
      const contract = new ethers.Contract(
        this.rewardsDistributorAddress,
        REWARDS_DISTRIBUTOR_ABI,
        this.provider
      );
      
      // Check if there's any work in this epoch
      const workHashes = await contract.getEpochWork(studioAddress, epoch);
      return workHashes.length > 0 || epoch >= 0; // Epoch exists if >= 0
    } catch {
      // Fallback: assume epoch exists if >= 0
      return epoch >= 0;
    }
  }

  async isEpochClosed(_studioAddress: string, _epoch: number): Promise<boolean> {
    // ChaosChain doesn't have explicit isEpochClosed tracking
    // We check if the epoch has been processed by looking for work
    // An epoch is "open" if work hasn't been distributed yet
    
    // For now, assume epoch is NOT closed unless we have evidence
    // The contract will revert if closeEpoch is called incorrectly
    return false;
  }

  async isCloseWindowOpen(_studioAddress: string, _epoch: number): Promise<boolean> {
    // ChaosChain doesn't enforce time-based close windows
    // The RewardsDistributor allows closeEpoch anytime after work submission
    // Only the owner can call closeEpoch
    return true;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private mapReceipt(receipt: ethers.TransactionReceipt): TxReceipt {
    const status: TxStatus = receipt.status === 1 ? 'confirmed' : 'reverted';

    return {
      status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      revertReason: status === 'reverted' ? 'Transaction reverted' : undefined,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CONTRACT ENCODER IMPLEMENTATION
// =============================================================================

export class StudioProxyEncoder implements ContractEncoder {
  private iface: ethers.Interface;

  constructor() {
    this.iface = new ethers.Interface(STUDIO_PROXY_ABI);
  }

  encodeSubmitWork(
    dataHash: string,
    threadRoot: string,
    evidenceRoot: string,
    evidenceUri: string
  ): string {
    // Convert evidenceUri string to bytes for the contract's feedbackAuth parameter
    // In Jan 2026 spec, feedbackAuth is deprecated but kept for ABI compatibility
    const evidenceBytes = ethers.toUtf8Bytes(evidenceUri);
    return this.iface.encodeFunctionData('submitWork', [
      dataHash,
      threadRoot,
      evidenceRoot,
      evidenceBytes,
    ]);
  }

  encodeSubmitWorkMultiAgent(
    dataHash: string,
    threadRoot: string,
    evidenceRoot: string,
    workers: string[],
    weights: number[],
    evidenceUri: string
  ): string {
    return this.iface.encodeFunctionData('submitWorkMultiAgent', [
      dataHash,
      threadRoot,
      evidenceRoot,
      workers,
      weights,
      evidenceUri,
    ]);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a chain adapter from an RPC URL.
 */
export function createChainAdapter(
  rpcUrl: string,
  options?: {
    confirmationBlocks?: number;
    pollIntervalMs?: number;
  }
): EthersChainAdapter {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new EthersChainAdapter(
    provider,
    options?.confirmationBlocks,
    options?.pollIntervalMs
  );
}

/**
 * Create a chain adapter from a private key.
 * Registers the signer automatically.
 */
export async function createChainAdapterWithSigner(
  rpcUrl: string,
  privateKey: string,
  options?: {
    confirmationBlocks?: number;
    pollIntervalMs?: number;
  }
): Promise<EthersChainAdapter> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  const adapter = new EthersChainAdapter(
    provider,
    options?.confirmationBlocks,
    options?.pollIntervalMs
  );
  
  adapter.registerSigner(await wallet.getAddress(), wallet);
  
  return adapter;
}
