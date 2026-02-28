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
] as const;

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
] as const;

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
  network: string;
  /** Number of universal PoA dimensions (default: 5) */
  universalDimensions?: number;
}

export class ReputationReader {
  private identity: ethers.Contract;
  private reputation: ethers.Contract;
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
   * Build the full reputation payload for a given agent.
   * Caller must verify agentExists first.
   */
  async getReputation(agentId: number): Promise<ReputationData> {
    // Parallel reads: overall summary + verifier-specific summary
    // tag2 is hardcoded to 'CONSENSUS_MATCH' in RewardsDistributor._publishValidatorReputation
    const [overall, verifier] = await Promise.all([
      this.reputation.getSummary(agentId, [], '', ''),
      this.reputation.getSummary(agentId, [], 'VALIDATOR_ACCURACY', 'CONSENSUS_MATCH'),
    ]);

    const totalCount = Number(overall[0] as bigint);
    const totalValue = Number(overall[1] as bigint);

    const verifierCount = Number(verifier[0] as bigint);
    const verifierValue = Number(verifier[1] as bigint);

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
