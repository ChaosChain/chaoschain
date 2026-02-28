/**
 * DKG Engine Types
 * 
 * Type definitions for the Decentralized Knowledge Graph engine.
 * 
 * INVARIANT: DKG is a pure function over evidence.
 * Same evidence → same DAG → same weights. Every time.
 */

// =============================================================================
// DKG NODE TYPES
// =============================================================================

/**
 * Evidence package from Arweave.
 * This is the raw input to the DKG engine.
 */
export interface EvidencePackage {
  /** Arweave transaction ID */
  arweave_tx_id: string;
  /** Agent address (author) */
  author: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Parent evidence tx IDs (causal links) */
  parent_ids: string[];
  /** Message content hash (keccak256) */
  payload_hash: string;
  /** Artifact references (IPFS CIDs, Arweave tx IDs) */
  artifact_ids: string[];
  /** Agent signature over the evidence */
  signature: string;
}

/**
 * DKG Node - a node in the knowledge graph.
 * Derived from EvidencePackage with computed fields.
 */
export interface DKGNode {
  /** Node ID (Arweave tx ID) */
  id: string;
  /** Agent address (author) */
  author: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Parent node IDs */
  parents: string[];
  /** Canonical hash of this node */
  canonical_hash: string;
  /** Verifiable Logical Clock */
  vlc: string;
  /** Artifact references */
  artifact_ids: string[];
  /** Original evidence reference */
  evidence_tx_id: string;
}

/**
 * Causal edge in the DAG.
 */
export interface DKGEdge {
  from: string;
  to: string;
}

/**
 * Complete DAG structure.
 */
export interface DKGDAG {
  /** All nodes in the DAG, keyed by node ID */
  nodes: Map<string, DKGNode>;
  /** Root nodes (no parents) */
  roots: Set<string>;
  /** Terminal nodes (no children) */
  terminals: Set<string>;
  /** Adjacency list: parent → children */
  edges: Map<string, string[]>;
  /** Merkle root of the DAG */
  merkle_root: string;
}

// =============================================================================
// WEIGHT COMPUTATION TYPES
// =============================================================================

/**
 * Contribution weights per agent.
 * Weights sum to 1.0 (normalized).
 */
export type ContributionWeights = Map<string, number>;

/**
 * Weight computation method.
 */
export type WeightMethod = 'betweenness' | 'path_count';

/**
 * DKG computation result.
 * This is the output of the DKG engine.
 */
export interface DKGResult {
  /** The computed DAG */
  dag: DKGDAG;
  /** Contribution weights per agent */
  weights: ContributionWeights;
  /** Evidence root (Merkle root of evidence packages) */
  evidence_root: string;
  /** Thread root (Merkle root of nodes) */
  thread_root: string;
  /** Algorithm version used */
  version: string;
}

// =============================================================================
// ENGINE CONFIGURATION
// =============================================================================

/**
 * DKG Engine configuration.
 */
export interface DKGEngineConfig {
  /** Weight computation method */
  weight_method: WeightMethod;
  /** Algorithm version (for reproducibility) */
  version: string;
}

/**
 * Default configuration.
 */
export const DEFAULT_DKG_CONFIG: DKGEngineConfig = {
  weight_method: 'betweenness',
  version: '1.0.0',
};

// =============================================================================
// POA FEATURE TYPES
// =============================================================================

/**
 * Proof-of-Agency feature scores derived from DKG graph structure.
 * Each score is 0-100.
 *
 * initiative and collaboration and reasoning are evidence-derived.
 * compliance and efficiency are verifier-opinion placeholders until
 * formal definitions are ratified.
 */
export interface PoAFeatures {
  /** Ratio of nodes where agent is originator vs total nodes (0-100) */
  initiative: number;
  /** Ratio of reply edges involving agent (0-100) */
  collaboration: number;
  /** Normalized max path length from agent nodes (0-100) */
  reasoning: number;
  /** Verifier-opinion placeholder — not graph-derivable yet */
  compliance: null;
  /** Verifier-opinion placeholder — not graph-derivable yet */
  efficiency: null;
}
