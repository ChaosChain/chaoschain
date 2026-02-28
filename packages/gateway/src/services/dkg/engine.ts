/**
 * DKG Engine - Deterministic Knowledge Graph Computation
 * 
 * ARCHITECTURE.md Invariant #7: DKG Engine Purity Invariant
 * 
 * The DKG Engine MUST be a pure function over evidence.
 * 
 * DKG(evidence) → (DAG, weights)
 * 
 * Where:
 * - evidence = { arweave_tx_ids[], message_contents[], signatures[] }
 * - Same evidence → identical DAG → identical weights
 * - Every time. No exceptions.
 * 
 * CONSTRAINTS:
 * - No hidden state
 * - No time-based behavior
 * - No randomness
 * - No external calls
 * - Deterministic ordering (sorted keys, stable sorts)
 */

import { ethers } from 'ethers';
import {
  EvidencePackage,
  DKGNode,
  DKGDAG,
  DKGResult,
  ContributionWeights,
  DKGEngineConfig,
  DEFAULT_DKG_CONFIG,
  PoAFeatures,
} from './types.js';

// =============================================================================
// DKG ENGINE
// =============================================================================

/**
 * Compute DKG from evidence packages.
 * 
 * This is a PURE FUNCTION. Same input → same output. Always.
 * 
 * @param evidence - Array of evidence packages
 * @param config - Engine configuration (optional, defaults to DEFAULT_DKG_CONFIG)
 * @returns DKG computation result
 */
export function computeDKG(
  evidence: EvidencePackage[],
  config: DKGEngineConfig = DEFAULT_DKG_CONFIG
): DKGResult {
  // Step 1: Sort evidence deterministically by arweave_tx_id
  const sortedEvidence = [...evidence].sort((a, b) =>
    a.arweave_tx_id.localeCompare(b.arweave_tx_id)
  );

  // Step 2: Build DAG from sorted evidence
  const dag = buildDAG(sortedEvidence);

  // Step 3: Compute weights using deterministic algorithm
  const weights = computeWeights(dag, config.weight_method);

  // Step 4: Compute evidence root (Merkle root of evidence tx IDs)
  const evidenceRoot = computeEvidenceRoot(sortedEvidence);

  // Step 5: Compute thread root (Merkle root of nodes)
  const threadRoot = dag.merkle_root;

  return {
    dag,
    weights,
    evidence_root: evidenceRoot,
    thread_root: threadRoot,
    version: config.version,
  };
}

// =============================================================================
// DAG CONSTRUCTION
// =============================================================================

/**
 * Build DAG from sorted evidence packages.
 * 
 * DETERMINISTIC: Same sorted input → same DAG output.
 */
function buildDAG(sortedEvidence: EvidencePackage[]): DKGDAG {
  const nodes = new Map<string, DKGNode>();
  const edges = new Map<string, string[]>();
  const roots = new Set<string>();
  const terminals = new Set<string>();
  const vlcMap = new Map<string, string>();

  // Process evidence in sorted order
  for (const evidence of sortedEvidence) {
    const nodeId = evidence.arweave_tx_id;

    // Compute canonical hash
    const canonicalHash = computeCanonicalHash(evidence);

    // Initialize edges for this node
    if (!edges.has(nodeId)) {
      edges.set(nodeId, []);
    }

    // Process parents
    const validParents: string[] = [];
    for (const parentId of evidence.parent_ids.sort()) { // Sort for determinism
      if (nodes.has(parentId)) {
        validParents.push(parentId);
        // Add edge: parent → child
        const parentChildren = edges.get(parentId) ?? [];
        parentChildren.push(nodeId);
        edges.set(parentId, parentChildren);
        // Parent is no longer a terminal
        terminals.delete(parentId);
      }
    }

    // Compute VLC
    const vlc = computeVLC(canonicalHash, validParents, vlcMap);
    vlcMap.set(nodeId, vlc);

    // Create node
    const node: DKGNode = {
      id: nodeId,
      author: evidence.author,
      timestamp: evidence.timestamp,
      parents: validParents,
      canonical_hash: canonicalHash,
      vlc,
      artifact_ids: [...evidence.artifact_ids].sort(), // Sort for determinism
      evidence_tx_id: evidence.arweave_tx_id,
    };

    nodes.set(nodeId, node);

    // Track roots and terminals
    if (validParents.length === 0) {
      roots.add(nodeId);
    }
    terminals.add(nodeId);
  }

  // Compute Merkle root of all nodes
  const merkleRoot = computeMerkleRootFromNodes(nodes);

  return {
    nodes,
    roots,
    terminals,
    edges,
    merkle_root: merkleRoot,
  };
}

// =============================================================================
// WEIGHT COMPUTATION
// =============================================================================

/**
 * Compute contribution weights for each agent.
 * 
 * DETERMINISTIC: Same DAG → same weights.
 */
function computeWeights(
  dag: DKGDAG,
  method: 'betweenness' | 'path_count'
): ContributionWeights {
  if (method === 'betweenness') {
    return computeBetweennessWeights(dag);
  } else {
    return computePathCountWeights(dag);
  }
}

/**
 * Compute weights based on betweenness centrality.
 * 
 * Betweenness = fraction of shortest paths that pass through agent's nodes.
 * High betweenness = agent's work was critical for connecting other work.
 */
function computeBetweennessWeights(dag: DKGDAG): ContributionWeights {
  const betweenness = new Map<string, number>();

  // Get sorted roots and terminals for determinism
  const sortedRoots = [...dag.roots].sort();
  const sortedTerminals = [...dag.terminals].sort();

  // For each pair of (root, terminal), compute shortest paths
  for (const rootId of sortedRoots) {
    for (const terminalId of sortedTerminals) {
      if (rootId === terminalId) continue;

      // Find all shortest paths
      const paths = findAllShortestPaths(dag, rootId, terminalId);

      if (paths.length === 0) continue;

      // Each node on a path gets credit
      const numPaths = paths.length;
      for (const path of paths) {
        // Exclude root and terminal
        for (let i = 1; i < path.length - 1; i++) {
          const nodeId = path[i];
          const current = betweenness.get(nodeId) ?? 0;
          betweenness.set(nodeId, current + 1.0 / numPaths);
        }
      }
    }
  }

  // Aggregate by agent
  const agentWeights = new Map<string, number>();
  for (const [nodeId, score] of betweenness) {
    const node = dag.nodes.get(nodeId);
    if (!node) continue;
    const current = agentWeights.get(node.author) ?? 0;
    agentWeights.set(node.author, current + score);
  }

  // Normalize
  const total = [...agentWeights.values()].reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const [agent, weight] of agentWeights) {
      agentWeights.set(agent, weight / total);
    }
  }

  return agentWeights;
}

/**
 * Compute weights based on path counts.
 * 
 * For each agent, count how many paths from roots to terminals
 * include at least one of that agent's nodes.
 */
function computePathCountWeights(dag: DKGDAG): ContributionWeights {
  const agentPathCounts = new Map<string, number>();
  let totalPaths = 0;

  // Get sorted roots and terminals for determinism
  const sortedRoots = [...dag.roots].sort();
  const sortedTerminals = [...dag.terminals].sort();

  // Count paths through each agent's nodes
  for (const rootId of sortedRoots) {
    for (const terminalId of sortedTerminals) {
      if (rootId === terminalId) continue;

      const paths = findAllPaths(dag, rootId, terminalId, 100);
      totalPaths += paths.length;

      // For each path, credit agents whose nodes appear
      for (const path of paths) {
        const agentsInPath = new Set<string>();
        for (const nodeId of path) {
          const node = dag.nodes.get(nodeId);
          if (node) {
            agentsInPath.add(node.author);
          }
        }

        for (const agent of agentsInPath) {
          const current = agentPathCounts.get(agent) ?? 0;
          agentPathCounts.set(agent, current + 1);
        }
      }
    }
  }

  // Normalize to sum to 1.0
  const agentWeights = new Map<string, number>();
  const totalCount = [...agentPathCounts.values()].reduce((a, b) => a + b, 0);
  if (totalCount > 0) {
    for (const [agent, count] of agentPathCounts) {
      agentWeights.set(agent, count / totalCount);
    }
  }

  return agentWeights;
}

// =============================================================================
// PATH FINDING (DETERMINISTIC)
// =============================================================================

/**
 * Find all shortest paths between two nodes.
 * 
 * DETERMINISTIC: Children are processed in sorted order.
 */
function findAllShortestPaths(
  dag: DKGDAG,
  fromId: string,
  toId: string
): string[][] {
  const queue: Array<{ nodeId: string; path: string[]; length: number }> = [];
  const visited = new Map<string, number>();
  const allPaths: string[][] = [];
  let minLength = Infinity;

  queue.push({ nodeId: fromId, path: [fromId], length: 0 });
  visited.set(fromId, 0);

  while (queue.length > 0) {
    const { nodeId, path, length } = queue.shift()!;

    if (nodeId === toId) {
      if (length < minLength) {
        minLength = length;
        allPaths.length = 0;
        allPaths.push(path);
      } else if (length === minLength) {
        allPaths.push(path);
      }
      continue;
    }

    if (length >= minLength) continue;

    // Get children in sorted order for determinism
    const children = dag.edges.get(nodeId) ?? [];
    const sortedChildren = [...children].sort();

    for (const childId of sortedChildren) {
      const childLength = length + 1;
      const visitedLength = visited.get(childId);
      if (visitedLength === undefined || visitedLength >= childLength) {
        visited.set(childId, childLength);
        queue.push({ nodeId: childId, path: [...path, childId], length: childLength });
      }
    }
  }

  return allPaths;
}

/**
 * Find all paths (up to maxPaths) between two nodes.
 * 
 * DETERMINISTIC: Children are processed in sorted order.
 */
function findAllPaths(
  dag: DKGDAG,
  fromId: string,
  toId: string,
  maxPaths: number
): string[][] {
  const allPaths: string[][] = [];

  function dfs(nodeId: string, path: string[], visited: Set<string>) {
    if (allPaths.length >= maxPaths) return;

    if (nodeId === toId) {
      allPaths.push([...path]);
      return;
    }

    // Get children in sorted order for determinism
    const children = dag.edges.get(nodeId) ?? [];
    const sortedChildren = [...children].sort();

    for (const childId of sortedChildren) {
      if (!visited.has(childId)) {
        visited.add(childId);
        path.push(childId);
        dfs(childId, path, visited);
        path.pop();
        visited.delete(childId);
      }
    }
  }

  dfs(fromId, [fromId], new Set([fromId]));
  return allPaths;
}

// =============================================================================
// HASHING (DETERMINISTIC)
// =============================================================================

/**
 * Compute canonical hash for an evidence package.
 * 
 * Canon(e) = keccak256(author || timestamp || arweave_tx_id || payload_hash || sorted(parent_ids))
 */
function computeCanonicalHash(evidence: EvidencePackage): string {
  const sortedParents = [...evidence.parent_ids].sort();
  const canonical = [
    evidence.author,
    evidence.timestamp.toString(),
    evidence.arweave_tx_id,
    evidence.payload_hash,
    sortedParents.join(','),
  ].join('|');

  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

/**
 * Compute Verifiable Logical Clock (VLC).
 * 
 * VLC(v) = keccak256(canonical_hash || max(parent_vlcs))
 */
function computeVLC(
  canonicalHash: string,
  parentIds: string[],
  vlcMap: Map<string, string>
): string {
  // Find max parent VLC (lexicographically)
  let maxParentVLC = ethers.ZeroHash;
  for (const parentId of parentIds.sort()) {
    const parentVLC = vlcMap.get(parentId);
    if (parentVLC && parentVLC > maxParentVLC) {
      maxParentVLC = parentVLC;
    }
  }

  // VLC = keccak256(canonical_hash || max_parent_vlc)
  return ethers.keccak256(ethers.concat([canonicalHash, maxParentVLC]));
}

/**
 * Compute Merkle root from nodes.
 */
function computeMerkleRootFromNodes(nodes: Map<string, DKGNode>): string {
  // Get node hashes in sorted order
  const sortedNodeIds = [...nodes.keys()].sort();
  const hashes = sortedNodeIds.map((id) => nodes.get(id)!.canonical_hash);

  return computeMerkleRoot(hashes);
}

/**
 * Compute evidence root (Merkle root of evidence tx IDs).
 */
function computeEvidenceRoot(sortedEvidence: EvidencePackage[]): string {
  const hashes = sortedEvidence.map((e) =>
    ethers.keccak256(ethers.toUtf8Bytes(e.arweave_tx_id))
  );

  return computeMerkleRoot(hashes);
}

/**
 * Compute Merkle root from list of hashes.
 */
function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return ethers.ZeroHash;
  }
  if (hashes.length === 1) {
    return hashes[0];
  }

  // Build Merkle tree
  let currentLevel = [...hashes];
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = ethers.concat([currentLevel[i], currentLevel[i + 1]]);
        nextLevel.push(ethers.keccak256(combined));
      } else {
        // Odd number - hash with itself
        const combined = ethers.concat([currentLevel[i], currentLevel[i]]);
        nextLevel.push(ethers.keccak256(combined));
      }
    }
    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

// =============================================================================
// POA FEATURE EXTRACTION
// =============================================================================

/**
 * Extract Proof-of-Agency feature scores from a DKG result for a specific agent.
 *
 * PURE FUNCTION: same DKGResult + agentAddress → same PoAFeatures. Always.
 *
 * Features:
 *   initiative   — ratio of root nodes authored by agent vs total nodes
 *   collaboration — ratio of edges where agent is parent or child vs total edges
 *   reasoning    — max depth reachable from any agent node, normalized to 0-100
 *   compliance   — null (requires task spec comparison, stays verifier-opinion)
 *   efficiency   — null (requires goal-completion heuristic, stays verifier-opinion)
 */
export function extractPoAFeatures(
  result: DKGResult,
  agentAddress: string,
): PoAFeatures {
  const { dag } = result;
  const totalNodes = dag.nodes.size;

  if (totalNodes === 0) {
    return { initiative: 0, collaboration: 0, reasoning: 0, compliance: null, efficiency: null };
  }

  // --- initiative: root-originator ratio ---
  let agentRoots = 0;
  for (const rootId of dag.roots) {
    const node = dag.nodes.get(rootId);
    if (node && node.author === agentAddress) agentRoots++;
  }
  const initiative = Math.round((agentRoots / totalNodes) * 100);

  // --- collaboration: reply-edge involvement ratio ---
  let totalEdges = 0;
  let agentEdges = 0;
  for (const [parentId, children] of dag.edges) {
    for (const childId of children) {
      totalEdges++;
      const parent = dag.nodes.get(parentId);
      const child = dag.nodes.get(childId);
      if (
        (parent && parent.author === agentAddress) ||
        (child && child.author === agentAddress)
      ) {
        agentEdges++;
      }
    }
  }
  const collaboration = totalEdges > 0
    ? Math.round((agentEdges / totalEdges) * 100)
    : 0;

  // --- reasoning: max depth reachable from any agent node ---
  const agentNodeIds: string[] = [];
  for (const [nodeId, node] of dag.nodes) {
    if (node.author === agentAddress) agentNodeIds.push(nodeId);
  }

  let maxDepth = 0;
  for (const startId of agentNodeIds) {
    const depth = computeMaxDepth(dag, startId);
    if (depth > maxDepth) maxDepth = depth;
  }

  // Normalize: max possible depth is (totalNodes - 1)
  const maxPossibleDepth = totalNodes - 1;
  const reasoning = maxPossibleDepth > 0
    ? Math.round((maxDepth / maxPossibleDepth) * 100)
    : (agentNodeIds.length > 0 ? 100 : 0);

  return { initiative, collaboration, reasoning, compliance: null, efficiency: null };
}

/**
 * Compute the maximum depth reachable from a starting node following edges.
 * Deterministic: children processed in sorted order.
 */
function computeMaxDepth(dag: DKGDAG, startId: string): number {
  let max = 0;
  const visited = new Set<string>();

  function dfs(nodeId: string, depth: number): void {
    if (depth > max) max = depth;
    visited.add(nodeId);
    const children = dag.edges.get(nodeId) ?? [];
    for (const childId of [...children].sort()) {
      if (!visited.has(childId)) {
        dfs(childId, depth + 1);
      }
    }
    visited.delete(nodeId);
  }

  dfs(startId, 0);
  return max;
}

// =============================================================================
// VERIFICATION
// =============================================================================

/**
 * Verify causality constraints of a DAG.
 * 
 * Checks:
 * 1. All parent nodes exist
 * 2. No cycles in the DAG
 * 3. Timestamps are monotonic (child >= parent)
 */
export function verifyCausality(dag: DKGDAG): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check all parent nodes exist
  for (const [nodeId, node] of dag.nodes) {
    for (const parentId of node.parents) {
      if (!dag.nodes.has(parentId)) {
        errors.push(`Node ${nodeId} references non-existent parent ${parentId}`);
      }
    }
  }

  // Check for cycles (DAG property)
  if (!isAcyclic(dag)) {
    errors.push('Graph contains cycles (not a DAG)');
  }

  // Check timestamp monotonicity
  for (const [nodeId, node] of dag.nodes) {
    for (const parentId of node.parents) {
      const parent = dag.nodes.get(parentId);
      if (parent && node.timestamp < parent.timestamp) {
        errors.push(
          `Timestamp not monotonic: ${nodeId} (${node.timestamp}) < ${parentId} (${parent.timestamp})`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if graph is acyclic (DAG property).
 */
function isAcyclic(dag: DKGDAG): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const colors = new Map<string, number>();

  for (const nodeId of dag.nodes.keys()) {
    colors.set(nodeId, WHITE);
  }

  function hasCycle(nodeId: string): boolean {
    colors.set(nodeId, GRAY);
    for (const childId of dag.edges.get(nodeId) ?? []) {
      if (colors.get(childId) === GRAY) {
        return true; // Back edge = cycle
      }
      if (colors.get(childId) === WHITE && hasCycle(childId)) {
        return true;
      }
    }
    colors.set(nodeId, BLACK);
    return false;
  }

  for (const nodeId of dag.nodes.keys()) {
    if (colors.get(nodeId) === WHITE) {
      if (hasCycle(nodeId)) {
        return false;
      }
    }
  }

  return true;
}
