/**
 * Evidence Module
 * 
 * Provides evidence building and archival for ChaosChain.
 * 
 * Evidence is ARCHIVAL, not control flow.
 * Evidence does NOT trigger workflows.
 */

// Type-only exports
export type { EvidenceHeader, EvidencePackage, EvidenceBuilderConfig } from './builder.js';

// Value exports
export { EvidenceBuilder, MockEvidenceBuilder } from './builder.js';
