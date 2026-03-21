/**
 * Reputation Reader Service
 *
 * Read-only service that queries IdentityRegistry and ReputationRegistry
 * contracts to build the public reputation API response.
 *
 * No signer. No state changes. Pure reads via ethers.js provider.
 */

import { ethers } from 'ethers';

const IDENTITY_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
] as const;

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
] as const;

/**
 * Coerce any ethers return value (BigInt, number, string, or unknown) to a
 * safe JS number. Handles ethers v6 Result entries that may be BigInt,
 * hex strings, or already numbers.
 */
function safeNumber(val: unknown): number {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export interface ReputationData {
  agent_id: number;
  trust_score: number;
  epochs_participated: number;
  quality_score: number | null;
  consensus_accuracy: number | null;
  /** TODO: requires EpochClosed event indexing — returns null until indexer is built */
  last_updated_epoch: number | null;
  evidence_anchor: string | null;
  derivation_root: string | null;
  network: string;
}

export interface ReputationReaderConfig {
  provider: ethers.Provider;
  identityRegistryAddress: string;
  reputationRegistryAddress: string;
  rewardsDistributorAddress: string;
  network: string;
  /** Number of universal PoA dimensions (default: 5) */
  universalDimensions?: number;
}

export class ReputationReader {
  private identity: ethers.Contract;
  private reputation: ethers.Contract;
  private rewardsDistributorAddress: string;
  private network: string;
  private dims: number;

  constructor(config: ReputationReaderConfig) {
    this.identity = new ethers.Contract(
      config.identityRegistryAddress,
      IDENTITY_ABI,
      config.provider,
    );
    this.reputation = new ethers.Contract(
      config.reputationRegistryAddress,
      REPUTATION_ABI,
      config.provider,
    );
    this.rewardsDistributorAddress = config.rewardsDistributorAddress;
    this.network = config.network;
    this.dims = config.universalDimensions ?? 5;
  }

  /**
   * Check whether an agentId exists in the identity registry.
   * ownerOf reverts for non-existent tokens (ERC-721 spec).
   */
  async agentExists(agentId: number): Promise<boolean> {
    try {
      const owner: string = await this.identity.ownerOf(agentId);
      return owner !== ethers.ZeroAddress;
    } catch {
      return false;
    }
  }

  /**
   * Resolve agentId to its owner address (lowercase).
   * Returns null if the agent doesn't exist.
   */
  async resolveAddress(agentId: number): Promise<string | null> {
    try {
      const owner: string = await this.identity.ownerOf(agentId);
      if (owner === ethers.ZeroAddress) return null;
      return owner.toLowerCase();
    } catch {
      return null;
    }
  }

  /**
   * Resolve a wallet address to its agentId via ERC-721 Enumerable.
   * Returns 0 if the address owns no identity token.
   */
  async resolveAgentId(address: string): Promise<number> {
    try {
      const balance: bigint = await this.identity.balanceOf(address);
      if (balance === 0n) return 0;
      const tokenId: bigint = await this.identity.tokenOfOwnerByIndex(address, 0);
      return Number(tokenId);
    } catch {
      return 0;
    }
  }

  /**
   * Build the full reputation payload for a given agent.
   * Caller must verify agentExists first.
   */
  async getReputation(agentId: number): Promise<ReputationData> {
    // clientAddresses = [RewardsDistributor] — the contract that calls giveFeedback
    // during closeEpoch. The ReputationRegistry records msg.sender as the client,
    // so we must filter by RD address (not Studio address) to get results.
    const clients = [this.rewardsDistributorAddress];

    let totalCount = 0;
    let totalValue = 0;
    let verifierCount = 0;
    let verifierValue = 0;

    try {
      const [overall, verifier] = await Promise.all([
        this.reputation.getSummary(agentId, clients, '', ''),
        this.reputation.getSummary(agentId, clients, 'VALIDATOR_ACCURACY', 'CONSENSUS_MATCH'),
      ]);

      totalCount = safeNumber(overall[0]);
      totalValue = safeNumber(overall[1]);
      verifierCount = safeNumber(verifier[0]);
      verifierValue = safeNumber(verifier[1]);
    } catch (err) {
      // Contract call failed (ABI mismatch, decode error, RPC issue).
      // Return zero-reputation rather than propagating — the agent exists
      // on-chain, we just can't read reputation data right now.
      console.error(
        `[ReputationReader] getSummary failed for agent ${agentId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    const workerCount = totalCount - verifierCount;
    const workerValue = totalValue - verifierValue;

    // trust_score: average feedback value across all entries (0-100)
    const trustScore =
      totalCount > 0 ? Math.round(totalValue / totalCount) : 0;

    // epochs_participated: each epoch produces `dims` worker feedbacks
    // plus verifier feedbacks. Approximate using total count.
    const workerEpochs =
      this.dims > 0 ? Math.floor(workerCount / this.dims) : 0;
    const epochsParticipated = Math.max(workerEpochs, verifierCount);

    // quality_score: worker average normalized to 0-1
    let qualityScore: number | null = null;
    if (workerCount > 0) {
      qualityScore =
        Math.round((workerValue / workerCount / 100) * 100) / 100;
    }

    // consensus_accuracy: verifier average normalized to 0-1
    let consensusAccuracy: number | null = null;
    if (verifierCount > 0) {
      consensusAccuracy =
        Math.round((verifierValue / verifierCount / 100) * 100) / 100;
    }

    return {
      agent_id: agentId,
      trust_score: Math.max(0, Math.min(100, trustScore)),
      epochs_participated: epochsParticipated,
      quality_score: qualityScore,
      consensus_accuracy: consensusAccuracy,
      last_updated_epoch: null,
      evidence_anchor: null,
      derivation_root: null,
      network: this.network,
    };
  }
}
