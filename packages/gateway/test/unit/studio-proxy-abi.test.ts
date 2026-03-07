/**
 * Validates that the ABI signatures used in E2E helpers match
 * the compiled StudioProxy contract artifact.
 *
 * This test catches ABI drift — if someone changes the contract
 * function signatures, this test will fail before E2E tests do.
 *
 * Requires: forge build (packages/contracts/out/ must exist)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ethers } from 'ethers';

const ARTIFACT_PATH = resolve(
  __dirname,
  '../../../../packages/contracts/out/StudioProxy.sol/StudioProxy.json',
);

// These must match the STUDIO_PROXY_ABI in test/e2e/helpers.ts
const EXPECTED_FUNCTIONS = [
  'getWorkSubmitter(bytes32)',
  'getScoreVectorsForWorker(bytes32,address)',
  'setCommitRevealDeadlines(bytes32,uint256,uint256)',
];

describe('StudioProxy ABI validation', () => {
  it('compiled artifact exists (run forge build if missing)', () => {
    expect(existsSync(ARTIFACT_PATH)).toBe(true);
  });

  it('E2E helper ABI signatures match compiled contract', () => {
    if (!existsSync(ARTIFACT_PATH)) return; // skip if not compiled

    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'));
    const abi = artifact.abi as Array<{
      type: string;
      name?: string;
      inputs?: Array<{ type: string }>;
    }>;

    // Build set of function selectors from compiled ABI
    const compiledSelectors = new Set<string>();
    for (const entry of abi) {
      if (entry.type === 'function' && entry.name && entry.inputs) {
        const sig = `${entry.name}(${entry.inputs.map((i) => i.type).join(',')})`;
        compiledSelectors.add(ethers.id(sig).slice(0, 10));
      }
    }

    // Verify each expected function exists in compiled ABI
    for (const sig of EXPECTED_FUNCTIONS) {
      const selector = ethers.id(sig).slice(0, 10);
      expect(
        compiledSelectors.has(selector),
        `Function ${sig} (selector ${selector}) not found in compiled StudioProxy ABI`,
      ).toBe(true);
    }
  });
});
