/**
 * DKG Engine - Public API
 * 
 * Exports the deterministic DKG computation engine.
 * 
 * INVARIANT: DKG is a pure function over evidence.
 * Same evidence → same DAG → same weights. Every time.
 */

export * from './types.js';
export { computeDKG, verifyCausality, extractPoAFeatures } from './engine.js';
