/**
 * Evidence Module
 * 
 * Provides evidence building and archival for ChaosChain.
 * 
 * Evidence is ARCHIVAL, not control flow.
 * Evidence does NOT trigger workflows.
 */

export {
  EvidenceHeader,
  EvidencePackage,
  EvidenceBuilderConfig,
  EvidenceBuilder,
  MockEvidenceBuilder,
} from './builder.js';
