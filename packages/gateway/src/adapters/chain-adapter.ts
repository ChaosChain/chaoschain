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
  // submitWork function
  'function submitWork(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, string calldata evidenceUri) external',
  // submitWorkMultiAgent function  
  'function submitWorkMultiAgent(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, address[] calldata workers, uint16[] calldata weights, string calldata evidenceUri) external',
  // View functions for checking existing submissions
  'function getWorkSubmission(bytes32 dataHash) external view returns (address submitter, bytes32 threadRoot, bytes32 evidenceRoot, string memory evidenceUri, uint64 timestamp)',
  // Score submission (commit-reveal)
  'function commitScore(bytes32 dataHash, bytes32 commitHash) external',
  'function revealScore(bytes32 dataHash, uint16[] calldata scores, bytes32 salt) external',
  'function getScoreCommit(bytes32 dataHash, address validator) external view returns (bytes32 commitHash, uint64 timestamp)',
  'function getScoreReveal(bytes32 dataHash, address validator) external view returns (uint16[] memory scores, uint64 timestamp)',
  // Epoch management
  'function currentEpoch() external view returns (uint256)',
  'function isEpochClosed(uint256 epoch) external view returns (bool)',
  'function getEpochEndTime(uint256 epoch) external view returns (uint64)',
  'function closeEpoch(uint256 epoch) external',
];

// =============================================================================
// ETHERS CHAIN ADAPTER
// =============================================================================

export class EthersChainAdapter implements ChainAdapter, ChainStateAdapter, ScoreChainStateAdapter, EpochChainStateAdapter {
  private provider: ethers.Provider;
  private signers: Map<string, ethers.Signer> = new Map();
  private confirmationBlocks: number;
  private pollIntervalMs: number;

  constructor(
    provider: ethers.Provider,
    confirmationBlocks: number = 2,
    pollIntervalMs: number = 2000
  ) {
    this.provider = provider;
    this.confirmationBlocks = confirmationBlocks;
    this.pollIntervalMs = pollIntervalMs;
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
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const currentEpoch = await contract.currentEpoch();
      // Epoch exists if it's <= current epoch
      return epoch <= Number(currentEpoch);
    } catch {
      return false;
    }
  }

  async isEpochClosed(studioAddress: string, epoch: number): Promise<boolean> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      return await contract.isEpochClosed(epoch);
    } catch {
      return false;
    }
  }

  async isCloseWindowOpen(studioAddress: string, epoch: number): Promise<boolean> {
    const contract = new ethers.Contract(
      studioAddress,
      STUDIO_PROXY_ABI,
      this.provider
    );

    try {
      const endTime = await contract.getEpochEndTime(epoch);
      const currentTime = Math.floor(Date.now() / 1000);
      // Window is open if current time >= epoch end time
      return currentTime >= Number(endTime);
    } catch {
      // If contract doesn't enforce timing, assume window is open
      return true;
    }
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
    return this.iface.encodeFunctionData('submitWork', [
      dataHash,
      threadRoot,
      evidenceRoot,
      evidenceUri,
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
