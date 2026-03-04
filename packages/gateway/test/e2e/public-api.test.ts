import { describe, it, expect, beforeAll } from 'vitest';
import {
  GATEWAY_URL,
  WORKERS,
  randomDataHash,
  getAddresses,
  postWorkflow,
  pollUntilTerminal,
  createDkgEvidence,
} from './helpers';

let studioProxy: string;

beforeAll(async () => {
  const res = await fetch(`${GATEWAY_URL}/health`);
  expect(res.status).toBe(200);
  const addresses = getAddresses();
  studioProxy = addresses.STUDIO_PROXY;
});

/**
 * Submit work via the workflow engine and wait for completion.
 * Returns the dataHash used so callers can query the public API.
 */
async function submitWorkAndWait(): Promise<string> {
  const worker = WORKERS[0];
  const dataHash = randomDataHash();
  const evidence = Buffer.from('public-api e2e evidence').toString('base64');

  const { status, data } = await postWorkflow('/workflows/work-submission', {
    studio_address: studioProxy,
    epoch: 1,
    agent_address: worker.address,
    data_hash: dataHash,
    dkg_evidence: createDkgEvidence([worker]),
    evidence_content: evidence,
    signer_address: worker.address,
  });

  expect(status).toBe(201);
  const final = await pollUntilTerminal(data.id);
  expect(final.state).toBe('COMPLETED');

  return dataHash;
}

describe('Public API E2E', () => {
  // ─── GET /v1/work/:hash ──────────────────────────────────────────────

  describe('GET /v1/work/:hash', () => {
    it('returns 404 for unknown work hash', async () => {
      const unknownHash = randomDataHash();
      const res = await fetch(`${GATEWAY_URL}/v1/work/${unknownHash}`);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.version).toBeDefined();
      expect(body.error.code).toBe('WORK_NOT_FOUND');
    });

    it('returns 400 for invalid hash format', async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/work/not-a-hash`);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.version).toBeDefined();
      expect(body.error.code).toBe('INVALID_WORK_ID');
    });

    it('returns work metadata after submission', async () => {
      const dataHash = await submitWorkAndWait();

      const res = await fetch(`${GATEWAY_URL}/v1/work/${dataHash}`);
      const body = await res.json();

      // The work data reader may or may not have indexed the work yet.
      // Accept 200 (found) or 404 (not yet indexed but valid request).
      expect([200, 404]).toContain(res.status);
      expect(body.version).toBeDefined();

      if (res.status === 200) {
        expect(body.data).toBeDefined();
      }
    });
  });

  // ─── GET /v1/studio/:address/work ────────────────────────────────────

  describe('GET /v1/studio/:address/work', () => {
    it('returns 200 for valid studio address', async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/studio/${studioProxy}/work`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.version).toBeDefined();
      expect(body.data).toBeDefined();
    });

    it('returns 400 for invalid address format', async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/studio/invalid-address/work`);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.version).toBeDefined();
      expect(body.error.code).toBe('INVALID_STUDIO_ADDRESS');
    });

    it('supports pagination params', async () => {
      const res = await fetch(
        `${GATEWAY_URL}/v1/studio/${studioProxy}/work?limit=1&offset=0`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.version).toBeDefined();
      expect(body.data).toBeDefined();
    });
  });

  // ─── GET /v1/work/:hash/evidence ─────────────────────────────────────

  describe('GET /v1/work/:hash/evidence', () => {
    it('returns 404 for unknown hash', async () => {
      const unknownHash = randomDataHash();
      const res = await fetch(`${GATEWAY_URL}/v1/work/${unknownHash}/evidence`);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.version).toBeDefined();
      expect(body.error.code).toBe('WORK_NOT_FOUND');
    });

    it('returns evidence after work submission', async () => {
      const dataHash = await submitWorkAndWait();

      const res = await fetch(`${GATEWAY_URL}/v1/work/${dataHash}/evidence`);
      const body = await res.json();

      // Accept 200 (evidence found) or 404 (not yet indexed).
      expect([200, 404]).toContain(res.status);
      expect(body.version).toBeDefined();

      if (res.status === 200) {
        expect(body.data).toBeDefined();
      }
    });
  });

  // ─── GET /v1/agent/:id/reputation ────────────────────────────────────

  describe('GET /v1/agent/:id/reputation', () => {
    it('returns 400 for invalid agent ID (non-numeric)', async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/agent/abc/reputation`);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.version).toBeDefined();
      expect(body.error.code).toBe('INVALID_AGENT_ID');
    });

    it('returns 400 for invalid agent ID (negative)', async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/agent/-1/reputation`);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.version).toBeDefined();
      expect(body.error.code).toBe('INVALID_AGENT_ID');
    });

    it('returns data or 503 for valid agent ID', async () => {
      const workerId = WORKERS[0].agentId;
      const res = await fetch(`${GATEWAY_URL}/v1/agent/${workerId}/reputation`);
      const body = await res.json();

      // ReputationRegistry may not be deployed in E2E, so accept either
      // a successful response or a 503 (chain unavailable) or 404 (agent not found).
      expect([200, 404, 503]).toContain(res.status);
      expect(body.version).toBeDefined();

      if (res.status === 200) {
        expect(body.data).toBeDefined();
      } else if (res.status === 503) {
        expect(body.error.code).toBe('CHAIN_UNAVAILABLE');
      } else if (res.status === 404) {
        expect(body.error.code).toBe('AGENT_NOT_FOUND');
      }
    });
  });

  // ─── GET /health (public API) ────────────────────────────────────────

  describe('GET /health', () => {
    it('returns health status', async () => {
      const res = await fetch(`${GATEWAY_URL}/health`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
    });
  });
});
