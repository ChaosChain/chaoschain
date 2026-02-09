import { ethers } from 'ethers';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  GATEWAY_URL,
  WORKERS,
  VALIDATORS,
  UNREGISTERED,
  randomDataHash,
  randomRoot,
  getAddresses,
  postWorkflow,
  getWorkflow,
  pollUntilTerminal,
  createOnChainVerifier,
  type OnChainVerifier,
} from './helpers.js';

let studioProxy: string;
let verifier: OnChainVerifier;

beforeAll(async () => {
  // Verify gateway is healthy
  const res = await fetch(`${GATEWAY_URL}/health`);
  expect(res.status).toBe(200);
  const health = await res.json();
  expect(health.status).toBe('ok');

  const addresses = getAddresses();
  studioProxy = addresses.STUDIO_PROXY;
  verifier = createOnChainVerifier(studioProxy);
});

describe('Gateway E2E', () => {
  describe('Health', () => {
    it('GET /health returns ok', async () => {
      const res = await fetch(`${GATEWAY_URL}/health`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.status).toBe('ok');
    });
  });

  describe('Work Submission', () => {
    it('submits work on-chain then STALLs at REGISTER_WORK (onlyOwner)', async () => {
      const worker = WORKERS[0];
      const dataHash = randomDataHash();
      const threadRoot = randomRoot();
      const evidenceRoot = randomRoot();
      const evidence = Buffer.from('e2e test evidence content').toString('base64');

      const { status, data } = await postWorkflow('/workflows/work-submission', {
        studio_address: studioProxy,
        epoch: 1,
        agent_address: worker.address,
        data_hash: dataHash,
        thread_root: threadRoot,
        evidence_root: evidenceRoot,
        evidence_content: evidence,
        signer_address: worker.address,
      });

      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.type).toBe('WorkSubmission');
      expect(data.state).toBe('CREATED');

      // Poll until terminal state
      const final = await pollUntilTerminal(data.id);

      // The workflow STALLs at REGISTER_WORK (onlyOwner issue on RewardsDistributor)
      expect(['COMPLETED', 'STALLED']).toContain(final.state);

      // Verify progress: arweave and onchain steps should have been reached
      expect(final.progress.arweave_tx_id).toBeDefined();

      // On-chain verification: work IS recorded in StudioProxy despite workflow STALL
      const submitter = await verifier.getWorkSubmitter(dataHash);
      expect(submitter.toLowerCase()).toBe(worker.address.toLowerCase());
    });

    it('rejects invalid input (missing data_hash)', async () => {
      const { status } = await postWorkflow('/workflows/work-submission', {
        studio_address: studioProxy,
        epoch: 1,
        agent_address: WORKERS[0].address,
        // data_hash intentionally missing
        thread_root: randomRoot(),
        evidence_root: randomRoot(),
        evidence_content: Buffer.from('test').toString('base64'),
        signer_address: WORKERS[0].address,
      });

      expect(status).toBe(400);
    });
  });

  describe('Score Submission (direct mode)', () => {
    it('submits score on-chain for existing work, then STALLs at REGISTER_VALIDATOR', async () => {
      const worker = WORKERS[1];
      const validator = VALIDATORS[0];
      const dataHash = randomDataHash();

      // Step 1: Submit work first — the contract requires work to exist before scoring
      const workRes = await postWorkflow('/workflows/work-submission', {
        studio_address: studioProxy,
        epoch: 1,
        agent_address: worker.address,
        data_hash: dataHash,
        thread_root: randomRoot(),
        evidence_root: randomRoot(),
        evidence_content: Buffer.from('work for scoring').toString('base64'),
        signer_address: worker.address,
      });
      expect(workRes.status).toBe(201);
      const workFinal = await pollUntilTerminal(workRes.data.id);
      expect(['COMPLETED', 'STALLED']).toContain(workFinal.state);

      // Confirm work is on-chain before scoring
      const submitter = await verifier.getWorkSubmitter(dataHash);
      expect(submitter.toLowerCase()).toBe(worker.address.toLowerCase());

      // Step 2: Submit score for that work
      const { status, data } = await postWorkflow('/workflows/score-submission', {
        studio_address: studioProxy,
        epoch: 1,
        validator_address: validator.address,
        data_hash: dataHash,
        scores: [8000, 7500, 9000],
        signer_address: validator.address,
        worker_address: worker.address,
        mode: 'direct',
      });

      expect(status).toBe(201);
      expect(data.type).toBe('ScoreSubmission');
      expect(data.state).toBe('CREATED');

      // Poll — workflow FAILs at REGISTER_VALIDATOR ("Reveal not confirmed" — precondition bug
      // checks reveal_confirmed instead of score_confirmed for direct mode)
      const final = await pollUntilTerminal(data.id);
      expect(['COMPLETED', 'STALLED', 'FAILED']).toContain(final.state);

      // Score tx MUST have landed on-chain before the workflow failed at REGISTER_VALIDATOR
      expect(final.progress.score_tx_hash).toBeDefined();
      expect(final.progress.score_confirmed).toBe(true);

      // On-chain verification: score IS recorded in StudioProxy despite workflow FAIL
      const result = await verifier.getScoreVectorsForWorker(dataHash, worker.address);
      expect(result.validators.length).toBeGreaterThan(0);
      expect(result.validators.map((v) => v.toLowerCase())).toContain(validator.address.toLowerCase());
      expect(result.scoreVectors.length).toBe(result.validators.length);
    });
  });

  describe('Workflow Status', () => {
    it('GET /workflows/:id returns workflow details', async () => {
      const { data } = await postWorkflow('/workflows/work-submission', {
        studio_address: studioProxy,
        epoch: 1,
        agent_address: WORKERS[2].address,
        data_hash: randomDataHash(),
        thread_root: randomRoot(),
        evidence_root: randomRoot(),
        evidence_content: Buffer.from('status test').toString('base64'),
        signer_address: WORKERS[2].address,
      });

      const wf = await getWorkflow(data.id);
      expect(wf.id).toBe(data.id);
      expect(wf.type).toBe('WorkSubmission');
      expect(['CREATED', 'RUNNING', 'STALLED', 'COMPLETED', 'FAILED']).toContain(wf.state);
    });

    it('GET /workflows/:id returns 404 for unknown ID', async () => {
      const res = await fetch(`${GATEWAY_URL}/workflows/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  describe('On-chain state verification', () => {
    it('unsubmitted dataHash returns zero address', async () => {
      const unknownHash = ethers.keccak256(ethers.toUtf8Bytes('never-submitted'));
      const submitter = await verifier.getWorkSubmitter(unknownHash);
      expect(submitter).toBe(ethers.ZeroAddress);
    });
  });

  describe('Unregistered agent', () => {
    it('workflow fails for unregistered signer', async () => {
      const { status, data } = await postWorkflow('/workflows/work-submission', {
        studio_address: studioProxy,
        epoch: 1,
        agent_address: UNREGISTERED.address,
        data_hash: randomDataHash(),
        thread_root: randomRoot(),
        evidence_root: randomRoot(),
        evidence_content: Buffer.from('should fail').toString('base64'),
        signer_address: UNREGISTERED.address,
      });

      // Gateway may reject immediately (400) or create and fail later
      if (status === 201) {
        const final = await pollUntilTerminal(data.id);
        expect(['FAILED', 'STALLED']).toContain(final.state);
      } else {
        expect(status).toBe(400);
      }
    });
  });
});
