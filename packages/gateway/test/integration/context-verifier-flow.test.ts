/**
 * Integration Test — Context Endpoint + Full Verifier Flow
 *
 * This test:
 *   1. Seeds an in-process gateway with real PR evidence data
 *   2. Hits GET /v1/work/:hash/context
 *   3. Validates the response includes evidence, policy, and mandate
 *   4. Runs verifyWorkEvidence() + composeScoreVector() — the real verifier flow
 *   5. Stress tests: missing mandate, unknown policy, large DAG, empty evidence
 *
 * No external services required — everything runs in-process.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import { createPublicApiRoutes, PublicApiConfig } from '../../src/routes/public-api.js';
import { ReputationReader } from '../../src/services/reputation-reader.js';
import { WorkDataReader, WorkflowQuerySource } from '../../src/services/work-data-reader.js';
import type { WorkflowRecord } from '../../src/workflows/types.js';

import {
  verifyWorkEvidence,
  composeScoreVector,
  type EvidencePackage as SDKEvidencePackage,
} from '../../../../../chaoschain-sdk-ts/src/evidence.ts';

// =============================================================================
// Real PR evidence data (from dabit3/react-native-ai/pull/40)
// =============================================================================

const WORK_HASH = '0x12691a0e529531a6219099638f4f4014867429da4183cf94b5c9dd70ae2c14b8';
const AGENT_ADDRESS = '0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831';
const STUDIO_ADDRESS = '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';

const REAL_EVIDENCE = [
  {
    arweave_tx_id: 'demo_85ed255df66893eacb802502f6b178e6c988700450f1',
    author: AGENT_ADDRESS.toLowerCase(),
    timestamp: 1773214388494,
    parent_ids: [],
    payload_hash: '0x85ed255df66893eacb802502f6b178e6c988700450f1b1e17678a66e4352a1b7',
    artifact_ids: [
      'app/constants.ts',
      'app/src/components/KimiIcon.tsx',
      'app/src/components/index.ts',
      'app/src/screens/chat.tsx',
      'app/src/utils.ts',
      'server/src/chat/chatRouter.ts',
      'server/src/chat/kimi.ts',
    ],
    signature: '0xdemo_signature',
  },
  {
    arweave_tx_id: 'demo_61c602e4cb9619b1df516b61a42577eabcc10c4fef0a',
    author: AGENT_ADDRESS.toLowerCase(),
    timestamp: 1773214389494,
    parent_ids: ['demo_85ed255df66893eacb802502f6b178e6c988700450f1'],
    payload_hash: '0x61c602e4cb9619b1df516b61a42577eabcc10c4fef0af452fa480d065ec8b4e4',
    artifact_ids: [
      'app/constants.ts',
      'app/src/components/KimiIcon.tsx',
      'app/src/components/index.ts',
      'app/src/screens/chat.tsx',
      'app/src/utils.ts',
      'server/src/chat/chatRouter.ts',
      'server/src/chat/kimi.ts',
    ],
    signature: '0xdemo_signature',
  },
  {
    arweave_tx_id: 'demo_bedd926dfafa306a9acf47d2ccdbf3f51a3fbe90b3f4',
    author: AGENT_ADDRESS.toLowerCase(),
    timestamp: 1773214390494,
    parent_ids: ['demo_61c602e4cb9619b1df516b61a42577eabcc10c4fef0a'],
    payload_hash: '0xbedd926dfafa306a9acf47d2ccdbf3f51a3fbe90b3f4f2a0e4d3ab1f9c8e7d6a',
    artifact_ids: [
      'app/constants.ts',
      'app/src/components/KimiIcon.tsx',
      'app/src/components/index.ts',
      'app/src/screens/chat.tsx',
      'app/src/utils.ts',
      'server/src/chat/chatRouter.ts',
      'server/src/chat/kimi.ts',
    ],
    signature: '0xdemo_signature',
  },
];

// =============================================================================
// Mock infrastructure
// =============================================================================

class MockReputationReader {
  async agentExists(_id: number): Promise<boolean> { return false; }
  async getReputation(_id: number): Promise<never> { throw new Error('not found'); }
  async resolveAddress(_id: number): Promise<null> { return null; }
}

class MockQuerySource implements WorkflowQuerySource {
  private works = new Map<string, WorkflowRecord>();

  addWork(dataHash: string, record: WorkflowRecord) {
    this.works.set(dataHash, record);
  }

  async findWorkByDataHash(hash: string) { return this.works.get(hash) ?? null; }
  async findLatestCompletedWorkForAgent() { return null; }
  async findAllCompletedWorkflowsForAgent() { return { records: [], total: 0 }; }
  async hasCompletedScoreForDataHash() { return false; }
  async hasCompletedCloseEpoch() { return false; }
  async findPendingWorkForStudio() { return { records: [], total: 0 }; }
  async findAllWorkForStudio() { return { records: [], total: 0 }; }
  async findScoresForDataHash() { return []; }
  async findScoresForStudio() { return { records: [], total: 0 }; }
}

function makeWorkRecord(overrides?: {
  input?: Record<string, unknown>;
}): WorkflowRecord {
  return {
    id: 'wf-test-001',
    type: 'WorkSubmission',
    state: 'COMPLETED',
    step: 'DONE',
    step_attempts: 0,
    created_at: Date.parse('2026-03-11T07:33:08.913Z'),
    updated_at: Date.parse('2026-03-11T07:33:50.000Z'),
    input: overrides?.input ?? {
      studio_address: STUDIO_ADDRESS,
      epoch: 0,
      agent_address: AGENT_ADDRESS,
      data_hash: WORK_HASH,
      dkg_evidence: REAL_EVIDENCE,
      evidence_content: 'base64...',
      signer_address: AGENT_ADDRESS,
      studio_policy_version: 'engineering-studio-default-v1',
      work_mandate_id: 'mandate-feature-001',
      task_type: 'feature',
    },
    progress: {
      dkg_thread_root: '0x87b4d889e43d39068f5759a381fbde504de8441a2e2838ac31ec9d1dd56d2aa3',
      arweave_tx_id: 'mock-ar-1',
    },
    signer: AGENT_ADDRESS,
  };
}

const API_KEY = 'cc_test_integration_key';

function buildApp(querySource: MockQuerySource): express.Express {
  const app = express();
  app.use(express.json());

  const workDataReader = new WorkDataReader(querySource);
  const config: PublicApiConfig = {
    reputationReader: new MockReputationReader() as unknown as ReputationReader,
    workDataReader,
    network: 'sepolia',
    identityRegistryAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistryAddress: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    apiKeys: new Set([API_KEY]),
  };

  app.use(createPublicApiRoutes(config));
  return app;
}

async function get(
  app: express.Express,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      fetch(url, { headers })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body: body as Record<string, unknown> });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// =============================================================================
// Test 1 — Context endpoint returns full payload for real PR data
// =============================================================================

describe('Test 1 — Context endpoint with real PR data', () => {
  let app: express.Express;

  beforeAll(() => {
    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord());
    app = buildApp(qs);
  });

  it('returns 200 with evidence, policy, and mandate', async () => {
    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    expect(status).toBe(200);
    expect(body.version).toBe('1.0');

    const data = body.data as Record<string, unknown>;
    expect(data.work_id).toBe(WORK_HASH);
    expect(data.data_hash).toBe(WORK_HASH);
    expect(data.worker_address).toBe(AGENT_ADDRESS);
    expect(data.studio_address).toBe(STUDIO_ADDRESS);
    expect(data.task_type).toBe('feature');
    expect(data.studio_policy_version).toBe('engineering-studio-default-v1');
    expect(data.work_mandate_id).toBe('mandate-feature-001');
  });

  it('evidence matches the 3-node DAG from the PR pipeline', async () => {
    const { body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    const data = body.data as Record<string, unknown>;
    const evidence = data.evidence as Array<Record<string, unknown>>;

    expect(evidence).toHaveLength(3);

    expect(evidence[0].parent_ids).toEqual([]);
    expect(evidence[0].arweave_tx_id).toContain('demo_85ed255');

    expect(evidence[1].parent_ids).toEqual([evidence[0].arweave_tx_id]);
    expect(evidence[1].arweave_tx_id).toContain('demo_61c602e');

    expect(evidence[2].parent_ids).toEqual([evidence[1].arweave_tx_id]);
    expect(evidence[2].arweave_tx_id).toContain('demo_bedd926');
  });

  it('studioPolicy is the Engineering Agent Studio policy', async () => {
    const { body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    const data = body.data as Record<string, unknown>;
    const policy = data.studioPolicy as Record<string, unknown>;

    expect(policy).not.toBeNull();
    expect(policy.studioName).toBe('Engineering Agent Studio');
    expect(policy.version).toBe('1.0');

    const scoring = policy.scoring as Record<string, unknown>;
    expect(scoring).toBeDefined();
    expect(scoring.initiative).toBeDefined();
    expect(scoring.collaboration).toBeDefined();
    expect(scoring.reasoning).toBeDefined();
    expect(scoring.compliance).toBeDefined();
    expect(scoring.efficiency).toBeDefined();
  });

  it('workMandate matches the feature mandate', async () => {
    const { body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    const data = body.data as Record<string, unknown>;
    const mandate = data.workMandate as Record<string, unknown>;

    expect(mandate).not.toBeNull();
    expect(mandate.taskId).toBe('mandate-feature-001');
    expect(mandate.taskType).toBe('feature');
    expect(mandate.title).toBeDefined();
    expect(mandate.objective).toBeDefined();
  });
});

// =============================================================================
// Test 2 — Full verifier flow: context → verifyWorkEvidence → composeScoreVector
// =============================================================================

describe('Test 2 — Full verifier agent flow (zero glue code)', () => {
  let app: express.Express;

  beforeAll(() => {
    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord());
    app = buildApp(qs);
  });

  it('fetches context, verifies evidence, composes scores — no glue code', async () => {
    // Step 1: Fetch context (exactly what a verifier agent does)
    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );
    expect(status).toBe(200);

    const data = body.data as Record<string, unknown>;
    const evidence = data.evidence as SDKEvidencePackage[];
    const studioPolicy = data.studioPolicy as any;
    const workMandate = data.workMandate as any;

    // Step 2: verifyWorkEvidence — exactly as documented
    const result = verifyWorkEvidence(evidence, {
      studioPolicy,
      workMandate,
    });

    expect(result.valid).toBe(true);
    expect(result.signals).toBeDefined();

    const { signals } = result;

    // Signals should be in [0, 1]
    expect(signals!.initiativeSignal).toBeGreaterThanOrEqual(0);
    expect(signals!.initiativeSignal).toBeLessThanOrEqual(1);
    expect(signals!.collaborationSignal).toBeGreaterThanOrEqual(0);
    expect(signals!.collaborationSignal).toBeLessThanOrEqual(1);
    expect(signals!.reasoningSignal).toBeGreaterThanOrEqual(0);
    expect(signals!.reasoningSignal).toBeLessThanOrEqual(1);

    // Observed features should match the 3-node linear chain
    expect(signals!.observed.totalNodes).toBe(3);
    expect(signals!.observed.rootCount).toBe(1);
    expect(signals!.observed.edgeCount).toBe(2);
    expect(signals!.observed.maxDepth).toBe(3);

    // Step 3: composeScoreVector — exactly as documented
    const scores = composeScoreVector(signals!, {
      complianceScore: 0.85,
      efficiencyScore: 0.78,
    });

    expect(scores).toHaveLength(5);
    for (const s of scores) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }

    // Compliance and efficiency should map from 0..1 to 0..100
    expect(scores[3]).toBe(85);
    expect(scores[4]).toBe(78);
  });

  it('verifier can override structural signals', async () => {
    const { body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    const data = body.data as Record<string, unknown>;
    const evidence = data.evidence as SDKEvidencePackage[];
    const studioPolicy = data.studioPolicy as any;
    const workMandate = data.workMandate as any;

    const result = verifyWorkEvidence(evidence, { studioPolicy, workMandate });
    expect(result.valid).toBe(true);

    const scores = composeScoreVector(result.signals!, {
      complianceScore: 0.90,
      efficiencyScore: 0.75,
      initiativeScore: 0.60,
      collaborationScore: 0.70,
      reasoningScore: 0.80,
    });

    expect(scores[0]).toBe(60);
    expect(scores[1]).toBe(70);
    expect(scores[2]).toBe(80);
    expect(scores[3]).toBe(90);
    expect(scores[4]).toBe(75);
  });
});

// =============================================================================
// Test 3 — Stress tests: edge cases and fallbacks
// =============================================================================

describe('Test 3 — Stress test context loading', () => {
  it('missing mandate → returns generic-task mandate object', async () => {
    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 0,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH,
        dkg_evidence: REAL_EVIDENCE,
        signer_address: AGENT_ADDRESS,
      },
    }));
    const app = buildApp(qs);

    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.work_mandate_id).toBe('generic-task');

    const mandate = data.workMandate as Record<string, unknown>;
    expect(mandate).toBeDefined();
    expect(mandate).not.toBeNull();
    expect(mandate.taskId).toBe('generic-task');
    expect(mandate.taskType).toBe('general');
  });

  it('unknown mandate ID → falls back to generic-task object', async () => {
    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 0,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH,
        dkg_evidence: REAL_EVIDENCE,
        signer_address: AGENT_ADDRESS,
        work_mandate_id: 'mandate-does-not-exist-xyz',
      },
    }));
    const app = buildApp(qs);

    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.work_mandate_id).toBe('mandate-does-not-exist-xyz');

    const mandate = data.workMandate as Record<string, unknown>;
    expect(mandate).not.toBeNull();
    expect(mandate.taskId).toBe('generic-task');
  });

  it('unknown policy version → falls back to default policy', async () => {
    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 0,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH,
        dkg_evidence: REAL_EVIDENCE,
        signer_address: AGENT_ADDRESS,
        studio_policy_version: 'nonexistent-policy-v99',
      },
    }));
    const app = buildApp(qs);

    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.studio_policy_version).toBe('nonexistent-policy-v99');

    const policy = data.studioPolicy as Record<string, unknown>;
    expect(policy).not.toBeNull();
    expect(policy.studioName).toBe('Engineering Agent Studio');
  });

  it('large evidence DAG (200 nodes) → no crash, verifier flow still works', async () => {
    const largeEvidence = [];
    for (let i = 0; i < 200; i++) {
      largeEvidence.push({
        arweave_tx_id: `tx_${String(i).padStart(4, '0')}`,
        author: AGENT_ADDRESS.toLowerCase(),
        timestamp: 1700000000 + i * 1000,
        parent_ids: i > 0 ? [`tx_${String(i - 1).padStart(4, '0')}`] : [],
        payload_hash: '0x' + i.toString(16).padStart(64, '0'),
        artifact_ids: [`file_${i}.ts`],
        signature: '0xdemo',
      });
    }

    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 0,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH,
        dkg_evidence: largeEvidence,
        signer_address: AGENT_ADDRESS,
      },
    }));
    const app = buildApp(qs);

    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    const evidence = data.evidence as unknown[];
    expect(evidence).toHaveLength(200);

    // Full verifier flow still works on large DAG
    const result = verifyWorkEvidence(evidence as SDKEvidencePackage[]);
    expect(result.valid).toBe(true);
    expect(result.signals!.observed.totalNodes).toBe(200);
    expect(result.signals!.observed.maxDepth).toBe(200);

    const scores = composeScoreVector(result.signals!, {
      complianceScore: 0.80,
      efficiencyScore: 0.70,
    });
    expect(scores).toHaveLength(5);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('empty evidence → context returns, verifyWorkEvidence returns invalid', async () => {
    const qs = new MockQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 0,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH,
        signer_address: AGENT_ADDRESS,
      },
    }));
    const app = buildApp(qs);

    const { status, body } = await get(
      app,
      `/v1/work/${WORK_HASH}/context`,
      { 'x-api-key': API_KEY },
    );

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.evidence).toEqual([]);

    const result = verifyWorkEvidence([] as SDKEvidencePackage[]);
    expect(result.signals!.observed.totalNodes).toBe(0);
  });

  it('work with all three mandate types resolves correctly', async () => {
    for (const mandateId of ['mandate-bugfix-001', 'mandate-feature-001', 'mandate-refactor-001']) {
      const qs = new MockQuerySource();
      qs.addWork(WORK_HASH, makeWorkRecord({
        input: {
          studio_address: STUDIO_ADDRESS,
          epoch: 0,
          agent_address: AGENT_ADDRESS,
          data_hash: WORK_HASH,
          dkg_evidence: REAL_EVIDENCE,
          signer_address: AGENT_ADDRESS,
          work_mandate_id: mandateId,
        },
      }));
      const app = buildApp(qs);

      const { status, body } = await get(
        app,
        `/v1/work/${WORK_HASH}/context`,
        { 'x-api-key': API_KEY },
      );

      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      const mandate = data.workMandate as Record<string, unknown>;
      expect(mandate.taskId).toBe(mandateId);
    }
  });
});
