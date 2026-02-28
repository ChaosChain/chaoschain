/**
 * Public API — Unit Tests
 *
 * Tests for:
 *   GET /v1/agent/:id/reputation
 *   GET /v1/work/:hash
 *   GET /health
 *
 * Uses mock ReputationReader and WorkDataReader injected into the route handler.
 * No real chain calls.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import { createPublicApiRoutes, PublicApiConfig } from '../../src/routes/public-api.js';
import { ReputationReader, ReputationData } from '../../src/services/reputation-reader.js';
import { WorkDataReader, WorkDetail, AgentWorkSummary, WorkflowQuerySource } from '../../src/services/work-data-reader.js';
import type { WorkflowRecord } from '../../src/workflows/types.js';

// =============================================================================
// Mock ReputationReader
// =============================================================================

class MockReputationReader {
  private agents: Map<number, ReputationData> = new Map();
  private addresses: Map<number, string> = new Map();

  addAgent(data: ReputationData, address?: string): void {
    this.agents.set(data.agent_id, data);
    if (address) this.addresses.set(data.agent_id, address.toLowerCase());
  }

  async agentExists(agentId: number): Promise<boolean> {
    return this.agents.has(agentId);
  }

  async getReputation(agentId: number): Promise<ReputationData> {
    const data = this.agents.get(agentId);
    if (!data) throw new Error('Agent not found');
    return { ...data };
  }

  async resolveAddress(agentId: number): Promise<string | null> {
    return this.addresses.get(agentId) ?? null;
  }
}

// =============================================================================
// Mock WorkflowQuerySource
// =============================================================================

class MockWorkflowQuerySource implements WorkflowQuerySource {
  private works: Map<string, WorkflowRecord> = new Map();
  private allRecords: WorkflowRecord[] = [];
  private scores: Set<string> = new Set();
  private closedEpochs: Set<string> = new Set();

  addWork(dataHash: string, record: WorkflowRecord): void {
    this.works.set(dataHash, record);
    this.allRecords.push(record);
  }

  addScore(dataHash: string): void {
    this.scores.add(dataHash);
  }

  addClosedEpoch(studio: string, epoch: number): void {
    this.closedEpochs.add(`${studio}:${epoch}`);
  }

  async findWorkByDataHash(dataHash: string): Promise<WorkflowRecord | null> {
    return this.works.get(dataHash) ?? null;
  }

  async findLatestCompletedWorkForAgent(agentAddress: string): Promise<WorkflowRecord | null> {
    const addr = agentAddress.toLowerCase();
    let latest: WorkflowRecord | null = null;
    for (const record of this.allRecords) {
      if (record.state !== 'COMPLETED') continue;
      if (record.type !== 'WorkSubmission') continue;
      const input = record.input as Record<string, unknown>;
      if ((input.agent_address as string)?.toLowerCase() !== addr) continue;
      if (!latest || record.created_at > latest.created_at) latest = record;
    }
    return latest;
  }

  async findAllCompletedWorkflowsForAgent(
    agentAddress: string,
    limit: number,
    offset: number,
  ): Promise<{ records: WorkflowRecord[]; total: number }> {
    const addr = agentAddress.toLowerCase();
    const matching: WorkflowRecord[] = [];
    for (const record of this.allRecords) {
      if (record.state !== 'COMPLETED') continue;
      const input = record.input as Record<string, unknown>;
      if (record.type === 'WorkSubmission') {
        if ((input.agent_address as string)?.toLowerCase() === addr) matching.push(record);
      } else if (record.type === 'ScoreSubmission') {
        if ((input.validator_address as string)?.toLowerCase() === addr) matching.push(record);
      }
    }
    matching.sort((a, b) => b.created_at - a.created_at);
    return { records: matching.slice(offset, offset + limit), total: matching.length };
  }

  async hasCompletedScoreForDataHash(dataHash: string): Promise<boolean> {
    return this.scores.has(dataHash);
  }

  async hasCompletedCloseEpoch(studioAddress: string, epoch: number): Promise<boolean> {
    return this.closedEpochs.has(`${studioAddress}:${epoch}`);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function buildApp(
  reader: MockReputationReader,
  workDataReader?: WorkDataReader,
): express.Express {
  const app = express();
  app.use(express.json());

  const config: PublicApiConfig = {
    reputationReader: reader as unknown as ReputationReader,
    workDataReader,
    network: 'test-network',
    identityRegistryAddress: '0x1111111111111111111111111111111111111111',
    reputationRegistryAddress: '0x2222222222222222222222222222222222222222',
  };

  app.use(createPublicApiRoutes(config));
  return app;
}

async function get(
  app: express.Express,
  path: string,
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
      fetch(url)
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body: body as Record<string, unknown> });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// =============================================================================
// Forbidden blockchain jargon terms (shared across tests)
// =============================================================================

const FORBIDDEN_TERMS = [
  'contract',
  'solidity',
  'wei',
  'gwei',
  'ether',
  'msg.sender',
  'calldata',
  'ERC',
  'uint256',
  'bytes32',
  'mapping',
  'ReputationRegistry',
  'IdentityRegistry',
  'StudioProxy',
  'RewardsDistributor',
  'arweave',
  'dkg',
  'chain',
];

// =============================================================================
// Worker fixture
// =============================================================================

const WORKER_AGENT: ReputationData = {
  agent_id: 42,
  trust_score: 87,
  epochs_participated: 14,
  quality_score: 0.87,
  consensus_accuracy: null,
  last_updated_epoch: null,
  evidence_anchor: null,
  derivation_root: null,
  network: 'test-network',
};

// =============================================================================
// Verifier fixture
// =============================================================================

const VERIFIER_AGENT: ReputationData = {
  agent_id: 101,
  trust_score: 93,
  epochs_participated: 14,
  quality_score: null,
  consensus_accuracy: 0.93,
  last_updated_epoch: null,
  evidence_anchor: null,
  derivation_root: null,
  network: 'test-network',
};

// =============================================================================
// Work fixtures
// =============================================================================

const WORK_HASH = '0x' + 'ab'.repeat(32);
const AGENT_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const STUDIO_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const ARWEAVE_TX = 'tx_abc123def456';
const DKG_THREAD_ROOT = '0x' + 'cc'.repeat(32);

const SAMPLE_DKG_EVIDENCE = [
  {
    arweave_tx_id: 'arweave_tx_001',
    author: AGENT_ADDRESS,
    timestamp: 1700000000,
    parent_ids: [],
    payload_hash: '0x' + 'aa'.repeat(32),
    artifact_ids: [],
    signature: '0x' + '00'.repeat(65),
  },
  {
    arweave_tx_id: 'arweave_tx_002',
    author: AGENT_ADDRESS,
    timestamp: 1700001000,
    parent_ids: ['arweave_tx_001'],
    payload_hash: '0x' + 'bb'.repeat(32),
    artifact_ids: [],
    signature: '0x' + '00'.repeat(65),
  },
];

function makeWorkRecord(overrides?: Partial<{
  state: string;
  progress: Record<string, unknown>;
  input: Record<string, unknown>;
}>): WorkflowRecord {
  return {
    id: 'wf-001',
    type: 'WorkSubmission',
    state: overrides?.state ?? 'COMPLETED',
    step: 'AWAIT_REGISTER_CONFIRM',
    step_attempts: 0,
    created_at: Date.parse('2026-02-01T12:00:00Z'),
    updated_at: Date.parse('2026-02-01T12:05:00Z'),
    input: overrides?.input ?? {
      studio_address: STUDIO_ADDRESS,
      epoch: 1,
      agent_address: AGENT_ADDRESS,
      data_hash: WORK_HASH,
      dkg_evidence: SAMPLE_DKG_EVIDENCE,
      signer_address: AGENT_ADDRESS,
    },
    progress: overrides?.progress ?? {
      dkg_thread_root: DKG_THREAD_ROOT,
      dkg_evidence_root: '0x' + 'dd'.repeat(32),
      arweave_tx_id: ARWEAVE_TX,
      arweave_confirmed: true,
      onchain_tx_hash: '0x' + 'ee'.repeat(32),
      onchain_confirmed: true,
      register_tx_hash: '0x' + 'ff'.repeat(32),
      register_confirmed: true,
    },
    signer: AGENT_ADDRESS,
  };
}

// =============================================================================
// Tests — GET /v1/agent/:id/reputation
// =============================================================================

describe('Public API — GET /v1/agent/:id/reputation', () => {
  let app: express.Express;
  let reader: MockReputationReader;

  beforeAll(() => {
    reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT);
    reader.addAgent(VERIFIER_AGENT);
    app = buildApp(reader);
  });

  it('returns correct schema for a valid worker agent', async () => {
    const { status, body } = await get(app, '/v1/agent/42/reputation');

    expect(status).toBe(200);
    expect(body.version).toBe('1.0');

    const data = body.data as Record<string, unknown>;
    expect(data.agent_id).toBe(42);
    expect(data.trust_score).toBe(87);
    expect(data.epochs_participated).toBe(14);
    expect(data.quality_score).toBe(0.87);
    expect(data.consensus_accuracy).toBeNull();
    expect(data.last_updated_epoch).toBeNull();
    expect(data.evidence_anchor).toBeNull();
    expect(data.derivation_root).toBeNull();
    expect(data.network).toBe('test-network');
  });

  it('returns correct schema for a valid verifier agent', async () => {
    const { status, body } = await get(app, '/v1/agent/101/reputation');

    expect(status).toBe(200);

    const data = body.data as Record<string, unknown>;
    expect(data.agent_id).toBe(101);
    expect(data.quality_score).toBeNull();
    expect(data.consensus_accuracy).toBe(0.93);
  });

  it('returns 404 for a non-existent agent', async () => {
    const { status, body } = await get(app, '/v1/agent/9999/reputation');

    expect(status).toBe(404);
    expect(body.version).toBe('1.0');

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('AGENT_NOT_FOUND');
    expect(error.message).toContain('9999');
  });

  it('returns 400 for a non-integer agentId', async () => {
    const { status, body } = await get(app, '/v1/agent/abc/reputation');

    expect(status).toBe(400);
    expect(body.version).toBe('1.0');

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('INVALID_AGENT_ID');
  });

  it('returns 400 for zero agentId', async () => {
    const { status, body } = await get(app, '/v1/agent/0/reputation');

    expect(status).toBe(400);

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('INVALID_AGENT_ID');
  });

  it('returns 400 for negative agentId', async () => {
    const { status, body } = await get(app, '/v1/agent/-5/reputation');

    expect(status).toBe(400);

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('INVALID_AGENT_ID');
  });

  it('response contains no blockchain jargon', async () => {
    const { body } = await get(app, '/v1/agent/42/reputation');
    const json = JSON.stringify(body);

    for (const term of FORBIDDEN_TERMS) {
      expect(json.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

// =============================================================================
// Tests — GET /v1/agent/:id/reputation with WorkDataReader
// =============================================================================

describe('Public API — GET /v1/agent/:id/reputation (with work data)', () => {
  it('populates evidence_anchor and derivation_root from latest work', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord());

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { status, body } = await get(app, '/v1/agent/42/reputation');

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.evidence_anchor).toBe(ARWEAVE_TX);
    expect(data.derivation_root).toBe(DKG_THREAD_ROOT);
  });

  it('returns null for evidence_anchor/derivation_root when no work exists', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const querySource = new MockWorkflowQuerySource();
    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { status, body } = await get(app, '/v1/agent/42/reputation');

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.evidence_anchor).toBeNull();
    expect(data.derivation_root).toBeNull();
  });

  it('returns null derivation_root when DKG root absent from progress', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord({
      progress: { arweave_tx_id: ARWEAVE_TX, arweave_confirmed: true },
    }));

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { status, body } = await get(app, '/v1/agent/42/reputation');

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.evidence_anchor).toBe(ARWEAVE_TX);
    expect(data.derivation_root).toBeNull();
  });
});

// =============================================================================
// Tests — GET /v1/work/:hash
// =============================================================================

describe('Public API — GET /v1/work/:hash', () => {
  let app: express.Express;
  let querySource: MockWorkflowQuerySource;

  beforeAll(() => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT);
    querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord());

    const workDataReader = new WorkDataReader(querySource);
    app = buildApp(reader, workDataReader);
  });

  it('returns correct schema for valid hash', async () => {
    const { status, body } = await get(app, `/v1/work/${WORK_HASH}`);

    expect(status).toBe(200);
    expect(body.version).toBe('1.0');

    const data = body.data as Record<string, unknown>;
    expect(data.work_id).toBe(WORK_HASH);
    expect(data.agent_id).toBe(0);
    expect(data.studio).toBe(STUDIO_ADDRESS);
    expect(data.epoch).toBe(1);
    expect(data.status).toBe('pending');
    expect(data.consensus_score).toBeNull();
    expect(data.evidence_anchor).toBe(ARWEAVE_TX);
    expect(data.derivation_root).toBe(DKG_THREAD_ROOT);
    expect(typeof data.submitted_at).toBe('string');
    expect(new Date(data.submitted_at as string).toISOString()).toBe(data.submitted_at);
  });

  it('returns 404 for missing hash', async () => {
    const missingHash = '0x' + '00'.repeat(32);
    const { status, body } = await get(app, `/v1/work/${missingHash}`);

    expect(status).toBe(404);
    expect(body.version).toBe('1.0');

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('WORK_NOT_FOUND');
  });

  it('returns 400 for invalid hash format', async () => {
    const { status, body } = await get(app, '/v1/work/not-a-hash');

    expect(status).toBe(400);
    expect(body.version).toBe('1.0');

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('INVALID_WORK_ID');
  });

  it('returns 400 for short hex', async () => {
    const { status, body } = await get(app, '/v1/work/0xabcdef');

    expect(status).toBe(400);

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('INVALID_WORK_ID');
  });

  it('response contains no blockchain jargon', async () => {
    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const json = JSON.stringify(body);

    for (const term of FORBIDDEN_TERMS) {
      expect(json.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it('derivation_root is present when DKG roots exist in progress', async () => {
    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.derivation_root).toBe(DKG_THREAD_ROOT);
  });

  it('evidence_anchor is present when arweave tx_id exists in progress', async () => {
    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.evidence_anchor).toBe(ARWEAVE_TX);
  });
});

describe('Public API — GET /v1/work/:hash (status derivation)', () => {
  it('returns "scored" when score submission is completed', async () => {
    const reader = new MockReputationReader();
    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord());
    querySource.addScore(WORK_HASH);

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.status).toBe('scored');
  });

  it('returns "finalized" when close epoch is completed', async () => {
    const reader = new MockReputationReader();
    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord());
    querySource.addScore(WORK_HASH);
    querySource.addClosedEpoch(STUDIO_ADDRESS, 1);

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.status).toBe('finalized');
  });

  it('returns "pending" when work is still running', async () => {
    const reader = new MockReputationReader();
    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord({ state: 'RUNNING' }));

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.status).toBe('pending');
  });

  it('returns null derivation_root when absent from progress', async () => {
    const reader = new MockReputationReader();
    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord({
      progress: { arweave_tx_id: ARWEAVE_TX },
    }));

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.derivation_root).toBeNull();
    expect(data.evidence_anchor).toBe(ARWEAVE_TX);
  });

  it('returns null evidence_anchor when absent from progress', async () => {
    const reader = new MockReputationReader();
    const querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord({
      progress: { dkg_thread_root: DKG_THREAD_ROOT },
    }));

    const workDataReader = new WorkDataReader(querySource);
    const app = buildApp(reader, workDataReader);

    const { body } = await get(app, `/v1/work/${WORK_HASH}`);
    const data = body.data as Record<string, unknown>;
    expect(data.evidence_anchor).toBeNull();
    expect(data.derivation_root).toBe(DKG_THREAD_ROOT);
  });
});

// =============================================================================
// Tests — GET /v1/work/:hash/evidence
// =============================================================================

describe('Public API — GET /v1/work/:hash/evidence', () => {
  let app: express.Express;
  let querySource: MockWorkflowQuerySource;

  beforeAll(() => {
    const reader = new MockReputationReader();
    querySource = new MockWorkflowQuerySource();
    querySource.addWork(WORK_HASH, makeWorkRecord());

    const workDataReader = new WorkDataReader(querySource);
    app = buildApp(reader, workDataReader);
  });

  it('returns correct schema for valid hash with evidence', async () => {
    const { status, body } = await get(app, `/v1/work/${WORK_HASH}/evidence`);

    expect(status).toBe(200);
    expect(body.version).toBe('1.0');

    const data = body.data as Record<string, unknown>;
    expect(data.work_id).toBe(WORK_HASH);
    expect(data.thread_root).toBe(DKG_THREAD_ROOT);
    expect(Array.isArray(data.dkg_evidence)).toBe(true);

    const evidence = data.dkg_evidence as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(2);
    expect(evidence[0].arweave_tx_id).toBe('arweave_tx_001');
    expect(evidence[1].arweave_tx_id).toBe('arweave_tx_002');
    expect(evidence[1].parent_ids).toEqual(['arweave_tx_001']);
  });

  it('returns 404 for missing hash', async () => {
    const missingHash = '0x' + '00'.repeat(32);
    const { status, body } = await get(app, `/v1/work/${missingHash}/evidence`);

    expect(status).toBe(404);
    expect(body.version).toBe('1.0');

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('WORK_NOT_FOUND');
  });

  it('returns 400 for invalid hash format', async () => {
    const { status, body } = await get(app, '/v1/work/not-a-hash/evidence');

    expect(status).toBe(400);
    expect(body.version).toBe('1.0');

    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('INVALID_WORK_ID');
  });

  it('returns empty dkg_evidence array when no evidence in input', async () => {
    const reader2 = new MockReputationReader();
    const qs2 = new MockWorkflowQuerySource();
    qs2.addWork(WORK_HASH, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 1,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH,
        signer_address: AGENT_ADDRESS,
      },
      progress: { arweave_tx_id: ARWEAVE_TX },
    }));

    const wdr2 = new WorkDataReader(qs2);
    const app2 = buildApp(reader2, wdr2);

    const { status, body } = await get(app2, `/v1/work/${WORK_HASH}/evidence`);

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.dkg_evidence).toEqual([]);
    expect(data.thread_root).toBeNull();
  });

  it('returns null thread_root when absent from progress', async () => {
    const reader2 = new MockReputationReader();
    const qs2 = new MockWorkflowQuerySource();
    qs2.addWork(WORK_HASH, makeWorkRecord({
      progress: { arweave_tx_id: ARWEAVE_TX },
    }));

    const wdr2 = new WorkDataReader(qs2);
    const app2 = buildApp(reader2, wdr2);

    const { status, body } = await get(app2, `/v1/work/${WORK_HASH}/evidence`);

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.thread_root).toBeNull();
  });
});

// =============================================================================
// Tests — GET /v1/agent/:id/history
// =============================================================================

const WORK_HASH_2 = '0x' + 'cd'.repeat(32);
const VERIFIER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SCORE_HASH = '0x' + 'ef'.repeat(32);

function makeScoreRecord(
  verifierAddress: string,
  dataHash: string,
  opts?: { created_at?: number },
): WorkflowRecord {
  return {
    id: 'wf-score-' + dataHash.slice(0, 10),
    type: 'ScoreSubmission',
    state: 'COMPLETED',
    step: 'DONE',
    step_attempts: 0,
    created_at: opts?.created_at ?? Date.parse('2026-02-02T10:00:00Z'),
    updated_at: Date.parse('2026-02-02T10:05:00Z'),
    input: {
      studio_address: STUDIO_ADDRESS,
      epoch: 2,
      validator_address: verifierAddress,
      data_hash: dataHash,
      scores: [85, 88, 90, 82, 87],
      salt: '0x' + '00'.repeat(32),
    },
    progress: {
      score_tx_hash: '0x' + 'aa'.repeat(32),
      score_confirmed: true,
    },
    signer: verifierAddress,
  };
}

describe('Public API — GET /v1/agent/:id/history', () => {
  it('worker agent with 2 completed submissions returns 2 entries, most recent first', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const qs = new MockWorkflowQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord());
    qs.addWork(WORK_HASH_2, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 2,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH_2,
        dkg_evidence: SAMPLE_DKG_EVIDENCE,
        signer_address: AGENT_ADDRESS,
      },
      progress: {
        dkg_thread_root: '0x' + 'ee'.repeat(32),
        arweave_tx_id: 'arweave_tx_999',
      },
    }));
    // Override created_at so the second is newer
    (qs as any).allRecords[1].created_at = Date.parse('2026-02-05T12:00:00Z');

    const wdr = new WorkDataReader(qs);
    const app = buildApp(reader, wdr);

    const { status, body } = await get(app, '/v1/agent/42/history');

    expect(status).toBe(200);
    expect(body.version).toBe('1.0');
    const data = body.data as Record<string, unknown>;
    expect(data.agent_id).toBe(42);
    expect(data.total).toBe(2);

    const entries = data.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries[0].role).toBe('worker');
    expect(entries[1].role).toBe('worker');
    // Most recent first
    expect(new Date(entries[0].submitted_at as string).getTime())
      .toBeGreaterThan(new Date(entries[1].submitted_at as string).getTime());
  });

  it('verifier agent shows role="verifier" entries', async () => {
    const reader = new MockReputationReader();
    reader.addAgent({
      ...VERIFIER_AGENT,
      agent_id: 101,
    }, VERIFIER_ADDRESS);

    const qs = new MockWorkflowQuerySource();
    qs.addWork(SCORE_HASH, makeScoreRecord(VERIFIER_ADDRESS, SCORE_HASH));

    const wdr = new WorkDataReader(qs);
    const app = buildApp(reader, wdr);

    const { status, body } = await get(app, '/v1/agent/101/history');

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    const entries = data.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0].role).toBe('verifier');
    expect(entries[0].studio).toBe(STUDIO_ADDRESS);
    expect(entries[0].work_id).toBe(SCORE_HASH);
  });

  it('returns 404 for unknown agentId', async () => {
    const reader = new MockReputationReader();
    const qs = new MockWorkflowQuerySource();
    const wdr = new WorkDataReader(qs);
    const app = buildApp(reader, wdr);

    const { status, body } = await get(app, '/v1/agent/9999/history');

    expect(status).toBe(404);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe('AGENT_NOT_FOUND');
  });

  it('pagination: limit=1 returns 1 entry, offset=1 skips first', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const qs = new MockWorkflowQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord());
    qs.addWork(WORK_HASH_2, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 2,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH_2,
        dkg_evidence: SAMPLE_DKG_EVIDENCE,
        signer_address: AGENT_ADDRESS,
      },
    }));
    (qs as any).allRecords[1].created_at = Date.parse('2026-02-05T12:00:00Z');

    const wdr = new WorkDataReader(qs);
    const app = buildApp(reader, wdr);

    // limit=1
    const { body: body1 } = await get(app, '/v1/agent/42/history?limit=1');
    const data1 = body1.data as Record<string, unknown>;
    expect((data1.entries as unknown[]).length).toBe(1);
    expect(data1.total).toBe(2);
    expect(data1.limit).toBe(1);
    expect(data1.offset).toBe(0);

    // offset=1
    const { body: body2 } = await get(app, '/v1/agent/42/history?limit=1&offset=1');
    const data2 = body2.data as Record<string, unknown>;
    expect((data2.entries as unknown[]).length).toBe(1);
    expect(data2.offset).toBe(1);

    // The two entries should be different work_ids
    const e1 = (data1.entries as Array<Record<string, unknown>>)[0];
    const e2 = (data2.entries as Array<Record<string, unknown>>)[0];
    expect(e1.work_id).not.toBe(e2.work_id);
  });

  it('response contains no blockchain jargon', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const qs = new MockWorkflowQuerySource();
    qs.addWork(WORK_HASH, makeWorkRecord());

    const wdr = new WorkDataReader(qs);
    const app = buildApp(reader, wdr);

    const { body } = await get(app, '/v1/agent/42/history');
    const json = JSON.stringify(body);

    for (const term of FORBIDDEN_TERMS) {
      expect(json.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it('derivation_root present when DKG ran, null when not', async () => {
    const reader = new MockReputationReader();
    reader.addAgent(WORKER_AGENT, AGENT_ADDRESS);

    const qs = new MockWorkflowQuerySource();
    // With DKG
    qs.addWork(WORK_HASH, makeWorkRecord());
    // Without DKG
    qs.addWork(WORK_HASH_2, makeWorkRecord({
      input: {
        studio_address: STUDIO_ADDRESS,
        epoch: 2,
        agent_address: AGENT_ADDRESS,
        data_hash: WORK_HASH_2,
        signer_address: AGENT_ADDRESS,
      },
      progress: { arweave_tx_id: 'arweave_no_dkg' },
    }));
    (qs as any).allRecords[1].created_at = Date.parse('2026-01-01T12:00:00Z');

    const wdr = new WorkDataReader(qs);
    const app = buildApp(reader, wdr);

    const { body } = await get(app, '/v1/agent/42/history');
    const entries = (body.data as Record<string, unknown>).entries as Array<Record<string, unknown>>;

    // First entry (most recent) has DKG
    expect(entries[0].derivation_root).toBe(DKG_THREAD_ROOT);
    expect(entries[0].evidence_anchor).toBe(ARWEAVE_TX);
    // Second entry (older) has no DKG
    expect(entries[1].derivation_root).toBeNull();
    expect(entries[1].evidence_anchor).toBe('arweave_no_dkg');
  });
});

// =============================================================================
// Tests — GET /health
// =============================================================================

describe('Public API — GET /health', () => {
  let app: express.Express;

  beforeAll(() => {
    const reader = new MockReputationReader();
    app = buildApp(reader);
  });

  it('returns 200 with status ok', async () => {
    const { status, body } = await get(app, '/health');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.0');
    expect(body.chain).toBe('test-network');

    const contracts = body.contracts as Record<string, unknown>;
    expect(contracts.identity_registry).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    expect(contracts.reputation_registry).toBe(
      '0x2222222222222222222222222222222222222222',
    );
  });

  it('health response contains no blockchain jargon', async () => {
    const { body } = await get(app, '/health');
    const json = JSON.stringify(body);

    expect(json).not.toContain('ReputationRegistry');
    expect(json).not.toContain('IdentityRegistry');
    expect(json).not.toContain('solidity');
  });
});

// =============================================================================
// Tests — ReputationReader VALIDATOR_ACCURACY uses tag2='CONSENSUS_MATCH'
// =============================================================================

describe('ReputationReader — VALIDATOR_ACCURACY tag2=CONSENSUS_MATCH', () => {
  it('consensus_accuracy is populated when VALIDATOR_ACCURACY/CONSENSUS_MATCH returns non-zero', async () => {
    const reader = new MockReputationReader();
    reader.addAgent({
      agent_id: 200,
      trust_score: 85,
      epochs_participated: 3,
      quality_score: null,
      consensus_accuracy: 0.92,
      last_updated_epoch: null,
      evidence_anchor: null,
      derivation_root: null,
      network: 'test-network',
    });

    const app = buildApp(reader);
    const { status, body } = await get(app, '/v1/agent/200/reputation');

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.consensus_accuracy).toBe(0.92);
    expect(data.consensus_accuracy).not.toBeNull();
    expect(typeof data.consensus_accuracy).toBe('number');
  });
});

// =============================================================================
// Integration: Route mounted alongside workflow routes
// =============================================================================

describe('Public API — Integration (route mounting)', () => {
  it('GET /v1/agent/1/reputation returns 200 when mounted in app-style order', async () => {
    const reader = new MockReputationReader();
    reader.addAgent({
      agent_id: 1,
      trust_score: 75,
      epochs_participated: 5,
      quality_score: 0.75,
      consensus_accuracy: null,
      last_updated_epoch: null,
      evidence_anchor: null,
      derivation_root: null,
      network: 'base-sepolia',
    });

    const app = express();
    app.use(express.json());

    app.get('/api/workflows', (_req, res) => res.json({ workflows: [] }));

    const config: PublicApiConfig = {
      reputationReader: reader as unknown as ReputationReader,
      network: 'base-sepolia',
      identityRegistryAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      reputationRegistryAddress: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    };
    app.use(createPublicApiRoutes(config));

    const { status, body } = await get(app, '/v1/agent/1/reputation');

    expect(status).toBe(200);
    expect(body.version).toBe('1.0');

    const data = body.data as Record<string, unknown>;
    expect(data.agent_id).toBe(1);
    expect(data.trust_score).toBe(75);
  });
});
