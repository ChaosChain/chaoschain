/**
 * Public API Routes — Phase A + B
 *
 * Read-only endpoints for querying agent reputation and work data.
 *
 * Two tiers:
 *   Public (no auth):  /health, /v1/agent/:id/reputation, /v1/work/:hash,
 *                      /v1/studio/:address/work
 *   Gated (API key):   /v1/work/:hash/evidence, /v1/work/:hash/context,
 *                      /v1/agent/:id/history
 *
 * These routes are independent of the workflow engine and do NOT
 * modify any existing workflow endpoints.
 */

import express, { Router, Request, Response, NextFunction } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ReputationReader } from '../services/reputation-reader.js';
import { WorkDataReader } from '../services/work-data-reader.js';

// =============================================================================
// Load policy + mandate JSON at module level (read once)
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEMO_DATA_DIR = resolve(__dirname, '../../demo-data');

function loadJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULT_POLICY = loadJsonFile(resolve(DEMO_DATA_DIR, 'engineering-studio-policy.json'));

const mandatesArray = loadJsonFile(resolve(DEMO_DATA_DIR, 'engineering-work-mandates.json')) as unknown as Array<Record<string, unknown>> | null;
const MANDATES_BY_ID = new Map<string, Record<string, unknown>>();
if (Array.isArray(mandatesArray)) {
  for (const m of mandatesArray) {
    if (typeof m.taskId === 'string') MANDATES_BY_ID.set(m.taskId, m);
  }
}

function resolvePolicy(_version: string): Record<string, unknown> | null {
  return DEFAULT_POLICY;
}

const GENERIC_MANDATE: Record<string, unknown> = {
  taskId: 'generic-task',
  title: 'General task',
  objective: 'Complete assigned work according to studio policy',
  taskType: 'general',
};

function resolveMandate(mandateId: string): Record<string, unknown> {
  if (mandateId === 'generic-task') return GENERIC_MANDATE;
  return MANDATES_BY_ID.get(mandateId) ?? GENERIC_MANDATE;
}

const API_VERSION = '1.0';

export interface PRIngestionConfig {
  submitWork: (input: Record<string, unknown>) => Promise<{ id: string }>;
  computeDKG: (evidence: unknown[]) => { thread_root: string; evidence_root: string };
  signerAddress: string;
}

export interface PublicApiConfig {
  reputationReader: ReputationReader;
  workDataReader?: WorkDataReader;
  network: string;
  identityRegistryAddress: string;
  reputationRegistryAddress: string;
  /** API keys for gated evidence/history endpoints. Empty set = no gating. */
  apiKeys?: Set<string>;
  /** Optional: enables POST /v1/engineering/pr */
  prIngestion?: PRIngestionConfig;
}

function evidenceAuth(apiKeys: Set<string> | undefined) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!apiKeys || apiKeys.size === 0) {
      next();
      return;
    }
    const key = _req.headers['x-api-key'];
    if (!key || typeof key !== 'string' || !apiKeys.has(key)) {
      res.status(401).json({
        version: API_VERSION,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key required. Request access at chaoscha.in',
        },
      });
      return;
    }
    next();
  };
}

export function createPublicApiRoutes(config: PublicApiConfig): Router {
  const router = Router();
  const { reputationReader, workDataReader } = config;
  const requireEvidenceKey = evidenceAuth(config.apiKeys);

  // =========================================================================
  // GET /v1/agent/:id/reputation
  // =========================================================================

  router.get(
    '/v1/agent/:id/reputation',
    async (req: Request, res: Response) => {
      const rawId = req.params.id;
      const agentId = Number(rawId);

      if (!Number.isInteger(agentId) || agentId <= 0) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_AGENT_ID',
            message: 'agentId must be a positive integer',
          },
        });
        return;
      }

      try {
        const exists = await reputationReader.agentExists(agentId);
        if (!exists) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'AGENT_NOT_FOUND',
              message: `No agent registered with id ${agentId}`,
            },
          });
          return;
        }

        const data = await reputationReader.getReputation(agentId);

        if (workDataReader) {
          const address = await reputationReader.resolveAddress(agentId);
          if (address) {
            const workSummary = await workDataReader.getLatestWorkForAgent(address);
            if (workSummary) {
              data.evidence_anchor = workSummary.evidence_anchor;
              data.derivation_root = workSummary.derivation_root;
            }
          }
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown error';

        if (
          message.includes('could not detect network') ||
          message.includes('ECONNREFUSED') ||
          message.includes('timeout') ||
          message.includes('SERVER_ERROR')
        ) {
          res.status(503).json({
            version: API_VERSION,
            error: {
              code: 'CHAIN_UNAVAILABLE',
              message: 'Unable to reach the on-chain registry',
            },
          });
          return;
        }

        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/agent/:id/history (gated — requires API key)
  // =========================================================================

  router.get(
    '/v1/agent/:id/history',
    requireEvidenceKey,
    async (req: Request, res: Response) => {
      const rawId = req.params.id;
      const agentId = Number(rawId);

      if (!Number.isInteger(agentId) || agentId <= 0) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_AGENT_ID',
            message: 'agentId must be a positive integer',
          },
        });
        return;
      }

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      try {
        const exists = await reputationReader.agentExists(agentId);
        if (!exists) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'AGENT_NOT_FOUND',
              message: `No agent registered with id ${agentId}`,
            },
          });
          return;
        }

        if (!workDataReader) {
          res.status(503).json({
            version: API_VERSION,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Work data service not configured',
            },
          });
          return;
        }

        const address = await reputationReader.resolveAddress(agentId);
        if (!address) {
          res.json({
            version: API_VERSION,
            data: { agent_id: agentId, entries: [], total: 0, limit, offset },
          });
          return;
        }

        const data = await workDataReader.getAgentHistory(address, agentId, limit, offset);
        res.json({ version: API_VERSION, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (
          message.includes('could not detect network') ||
          message.includes('ECONNREFUSED') ||
          message.includes('timeout') ||
          message.includes('SERVER_ERROR')
        ) {
          res.status(503).json({
            version: API_VERSION,
            error: {
              code: 'CHAIN_UNAVAILABLE',
              message: 'Unable to reach the on-chain registry',
            },
          });
          return;
        }

        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/work/:hash
  // =========================================================================

  router.get(
    '/v1/work/:hash',
    async (req: Request, res: Response) => {
      const hash = req.params.hash;

      if (!hash || !hash.startsWith('0x') || hash.length !== 66) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_WORK_ID',
            message: 'work_id must be a 0x-prefixed bytes32 hex string (66 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      try {
        const data = await workDataReader.getWorkByHash(hash);
        if (!data) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'WORK_NOT_FOUND',
              message: `No work found with id ${hash}`,
            },
          });
          return;
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/work/:hash/evidence (gated — requires API key)
  // =========================================================================

  router.get(
    '/v1/work/:hash/evidence',
    requireEvidenceKey,
    async (req: Request, res: Response) => {
      const hash = req.params.hash;

      if (!hash || !hash.startsWith('0x') || hash.length !== 66) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_WORK_ID',
            message: 'work_id must be a 0x-prefixed bytes32 hex string (66 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      try {
        const data = await workDataReader.getWorkEvidence(hash);
        if (!data) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'WORK_NOT_FOUND',
              message: `No work found with id ${hash}`,
            },
          });
          return;
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/work/:hash/context (gated — requires API key)
  // =========================================================================

  router.get(
    '/v1/work/:hash/context',
    requireEvidenceKey,
    async (req: Request, res: Response) => {
      const hash = req.params.hash;

      if (!hash || !hash.startsWith('0x') || hash.length !== 66) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_WORK_ID',
            message: 'work_id must be a 0x-prefixed bytes32 hex string (66 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      try {
        const data = await workDataReader.getWorkContext(hash, resolvePolicy, resolveMandate);
        if (!data) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'WORK_NOT_FOUND',
              message: `No work found with id ${hash}`,
            },
          });
          return;
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/studio/:address/work
  // =========================================================================

  router.get(
    '/v1/studio/:address/work',
    async (req: Request, res: Response) => {
      const address = req.params.address;

      if (!address || !address.startsWith('0x') || address.length !== 42) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_STUDIO_ADDRESS',
            message: 'Studio address must be a 0x-prefixed 20-byte hex string (42 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      try {
        const data = await workDataReader.getPendingWorkForStudio(address, limit, offset);
        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // POST /v1/engineering/pr (gated — requires API key)
  // =========================================================================

  router.post(
    '/v1/engineering/pr',
    express.json(),
    requireEvidenceKey,
    async (req: Request, res: Response) => {
      if (!config.prIngestion) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'PR ingestion not configured on this gateway',
          },
        });
        return;
      }

      const { pr_url, studio_address, task_type, work_mandate_id } = req.body ?? {};

      if (!pr_url || typeof pr_url !== 'string') {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_REQUEST',
            message: 'pr_url is required (e.g. "https://github.com/owner/repo/pull/123")',
          },
        });
        return;
      }

      const prMatch = pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!prMatch) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_PR_URL',
            message: 'pr_url must be a GitHub PR URL (https://github.com/owner/repo/pull/123)',
          },
        });
        return;
      }

      const [, owner, repo, numStr] = prMatch;
      const prNumber = parseInt(numStr, 10);
      const studioAddr = studio_address ?? '0xA855F7893ac01653D1bCC24210bFbb3c47324649';

      try {
        const ghHeaders: Record<string, string> = { 'User-Agent': 'ChaosChain-Gateway' };
        if (process.env.GITHUB_TOKEN) ghHeaders['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;

        const [prRes, commitsRes, filesRes] = await Promise.all([
          fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers: ghHeaders }),
          fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits`, { headers: ghHeaders }),
          fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, { headers: ghHeaders }),
        ]);

        if (!prRes.ok) {
          res.status(502).json({
            version: API_VERSION,
            error: {
              code: 'GITHUB_ERROR',
              message: `GitHub API returned ${prRes.status}`,
            },
          });
          return;
        }

        const pr: any = await prRes.json() as any;
        const commits: any[] = await commitsRes.json() as any[];
        const files: any[] = await filesRes.json() as any[];

        const { createHash } = await import('crypto');
        const baseTimestamp = Date.now();
        const signerAddress = config.prIngestion.signerAddress;

        const commitShaToTxId = new Map<string, string>();
        const prCommitShas = new Set(commits.map((c: any) => c.sha.slice(0, 7)));
        const evidence: Record<string, unknown>[] = [];

        for (const [i, commit] of commits.entries()) {
          const sha7 = commit.sha.slice(0, 7);
          const payload = JSON.stringify({ sha: sha7, message: commit.commit.message, repo: `${owner}/${repo}`, pr_number: prNumber });
          const payloadHash = '0x' + createHash('sha256').update(payload).digest('hex');
          const txId = `demo_${payloadHash.slice(2, 46)}`;
          commitShaToTxId.set(sha7, txId);

          const parentShas = (commit.parents ?? [])
            .map((p: any) => p.sha.slice(0, 7))
            .filter((s: string) => prCommitShas.has(s));
          const parentIds = parentShas
            .map((sha: string) => commitShaToTxId.get(sha))
            .filter((id: string | undefined): id is string => !!id);

          const changedFiles = files
            .filter((_f: any) => commits.some((cc: any) => cc.sha === commit.sha))
            .map((f: any) => f.filename).slice(0, 20);

          evidence.push({
            arweave_tx_id: txId,
            author: signerAddress,
            timestamp: baseTimestamp + i * 1000,
            parent_ids: parentIds,
            payload_hash: payloadHash,
            artifact_ids: changedFiles.length > 0 ? changedFiles : [`${sha7}.patch`],
            signature: '0xdemo_signature',
          });
        }

        const dkg = config.prIngestion.computeDKG(evidence);
        const dataHashPayload = JSON.stringify({ repo: `${owner}/${repo}`, pr: prNumber, ts: baseTimestamp });
        const dataHash = '0x' + (await import('crypto')).createHash('sha256').update(dataHashPayload).digest('hex');

        const workflow = await config.prIngestion.submitWork({
          studio_address: studioAddr,
          epoch: 0,
          agent_address: signerAddress,
          data_hash: dataHash,
          dkg_evidence: evidence,
          evidence_content: Buffer.from(JSON.stringify({ pr_url, title: pr.title, author: pr.user?.login })).toString('base64'),
          signer_address: signerAddress,
          studio_policy_version: 'engineering-studio-default-v1',
          work_mandate_id: work_mandate_id ?? 'generic-task',
          task_type: task_type ?? 'feature',
        });

        res.status(201).json({
          version: API_VERSION,
          data: {
            workflow_id: workflow.id,
            data_hash: dataHash,
            pr: {
              repo: `${owner}/${repo}`,
              number: prNumber,
              title: pr.title,
              author: pr.user?.login,
              merged: pr.merged ?? false,
              commits: commits.length,
              files_changed: files.length,
            },
            evidence_nodes: evidence.length,
            dkg: {
              thread_root: dkg.thread_root,
              evidence_root: dkg.evidence_root,
            },
            studio_address: studioAddr,
          },
        });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: (err as Error).message || 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/studio/:address/leaderboard
  // =========================================================================

  router.get(
    '/v1/studio/:address/leaderboard',
    async (req: Request, res: Response) => {
      const address = req.params.address;

      if (!address || !address.startsWith('0x') || address.length !== 42) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_STUDIO_ADDRESS',
            message: 'Studio address must be a 0x-prefixed 20-byte hex string (42 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      try {
        const data = await workDataReader.getLeaderboard(address);
        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/work/:hash/viewer — minimal evidence DAG viewer
  // =========================================================================

  router.get(
    '/v1/work/:hash/viewer',
    async (req: Request, res: Response) => {
      const hash = req.params.hash;

      if (!hash || !hash.startsWith('0x') || hash.length !== 66) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_WORK_ID',
            message: 'work_id must be a 0x-prefixed bytes32 hex string (66 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      const format = req.query.format;

      try {
        const data = await workDataReader.getEvidenceViewer(hash);
        if (!data) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'WORK_NOT_FOUND',
              message: `No work found with id ${hash}`,
            },
          });
          return;
        }

        if (format === 'json') {
          res.json({ version: API_VERSION, data });
          return;
        }

        const html = renderEvidenceViewerHTML(data);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /health
  // =========================================================================

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: API_VERSION,
      chain: config.network,
      contracts: {
        identity_registry: config.identityRegistryAddress,
        reputation_registry: config.reputationRegistryAddress,
      },
    });
  });

  return router;
}

// =============================================================================
// Evidence Viewer HTML renderer
// =============================================================================

function renderEvidenceViewerHTML(data: import('../services/work-data-reader.js').EvidenceViewerData): string {
  const nodesJson = JSON.stringify(data.nodes);
  const edgesJson = JSON.stringify(data.edges);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence DAG — ${data.work_id.slice(0, 14)}...</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,monospace;background:#0a0a0a;color:#e0e0e0}
  .header{padding:20px 24px;border-bottom:1px solid #222}
  .header h1{font-size:16px;font-weight:600;color:#fff;margin-bottom:8px}
  .header .meta{font-size:12px;color:#888}
  .header .meta span{margin-right:16px}
  .graph{padding:24px;display:flex;flex-direction:column;gap:12px}
  .node{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border:1px solid #222;border-radius:8px;background:#111}
  .node.root{border-color:#2d6a2d}
  .node.integration{border-color:#6a5a2d}
  .node .badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0}
  .node.root .badge{background:#1a3a1a;color:#4ade80}
  .node.child .badge{background:#1a2a3a;color:#60a5fa}
  .node.integration .badge{background:#3a2a1a;color:#fbbf24}
  .node .info{flex:1;min-width:0}
  .node .id{font-size:13px;font-family:monospace;color:#ccc;word-break:break-all}
  .node .artifacts{font-size:11px;color:#666;margin-top:4px}
  .node .artifacts code{color:#888;background:#1a1a1a;padding:1px 4px;border-radius:2px;margin-right:4px}
  .edge{font-size:11px;color:#444;padding:0 16px 0 40px}
  .summary{padding:20px 24px;border-top:1px solid #222;font-size:12px;color:#666}
  .summary span{color:#999;margin-right:16px}
</style>
</head>
<body>
<div class="header">
  <h1>Evidence DAG</h1>
  <div class="meta">
    <span>Work: ${data.work_id.slice(0, 18)}...</span>
    <span>Worker: ${data.worker_address.slice(0, 10)}...</span>
    <span>Studio: ${data.studio_address.slice(0, 10)}...</span>
  </div>
</div>
<div class="graph" id="graph"></div>
<div class="summary">
  <span>${data.nodes.length} nodes</span>
  <span>${data.edges.length} edges</span>
  <span>${data.nodes.filter(n => n.type === 'root').length} roots</span>
  <span>${data.nodes.filter(n => n.type === 'integration').length} integration points</span>
</div>
<script>
const nodes = ${nodesJson};
const edges = ${edgesJson};
const graph = document.getElementById('graph');

const edgeMap = {};
edges.forEach(e => { if (!edgeMap[e.to]) edgeMap[e.to] = []; edgeMap[e.to].push(e.from); });

nodes.forEach(node => {
  const parents = edgeMap[node.id] || [];
  if (parents.length > 0) {
    const edgeEl = document.createElement('div');
    edgeEl.className = 'edge';
    edgeEl.textContent = '↓ from ' + parents.map(p => p.slice(0, 16) + '...').join(', ');
    graph.appendChild(edgeEl);
  }
  const el = document.createElement('div');
  el.className = 'node ' + node.type;
  const badge = node.type === 'root' ? 'ROOT' : node.type === 'integration' ? 'MERGE' : 'STEP';
  el.innerHTML =
    '<div class="badge">' + badge + '</div>' +
    '<div class="info">' +
      '<div class="id">' + node.id + '</div>' +
      '<div class="artifacts">' + node.artifacts.slice(0, 5).map(a => '<code>' + a + '</code>').join('') +
        (node.artifacts.length > 5 ? ' +' + (node.artifacts.length - 5) + ' more' : '') +
      '</div>' +
    '</div>';
  graph.appendChild(el);
});
</script>
</body>
</html>`;
}
