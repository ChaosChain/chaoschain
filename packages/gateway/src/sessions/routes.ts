/**
 * Session API Routes — Engineering Studio MVP
 *
 * POST /v1/sessions              — Create a new coding session
 * POST /v1/sessions/:id/events   — Append canonical session events
 * POST /v1/sessions/:id/complete — Mark session complete; bridge to WorkSubmission
 * GET  /v1/sessions/:id/context  — Verifier scoring context (lightweight)
 * GET  /v1/sessions/:id/viewer   — Self-contained HTML evidence viewer
 * GET  /v1/sessions/:id/evidence — Full Evidence DAG
 */

import { Router, Request, Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SessionStore, NotFoundError, ConflictError } from './store.js';
import type {
  CodingSessionEvent,
  CreateSessionInput,
  CompleteSessionInput,
  SessionMetadata,
  EvidenceDAG,
} from './types.js';
import { CANONICAL_EVENT_TYPES as EVENT_TYPES } from './types.js';

// =============================================================================
// Policy & mandate resolution (re-used from public-api pattern)
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEMO_DATA_DIR = resolve(__dirname, '../../demo-data');

function loadJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

const DEFAULT_POLICY = loadJsonFile(resolve(DEMO_DATA_DIR, 'engineering-studio-policy.json'));

const mandatesRaw = loadJsonFile(
  resolve(DEMO_DATA_DIR, 'engineering-work-mandates.json'),
) as unknown as Array<Record<string, unknown>> | null;

const MANDATES_BY_ID = new Map<string, Record<string, unknown>>();
if (Array.isArray(mandatesRaw)) {
  for (const m of mandatesRaw) {
    if (typeof m.taskId === 'string') MANDATES_BY_ID.set(m.taskId, m);
  }
}

const GENERIC_MANDATE: Record<string, unknown> = {
  taskId: 'generic-task',
  title: 'General task',
  objective: 'Complete assigned work according to studio policy',
  taskType: 'general',
};

function resolveMandate(id: string): Record<string, unknown> {
  if (id === 'generic-task') return GENERIC_MANDATE;
  return MANDATES_BY_ID.get(id) ?? GENERIC_MANDATE;
}

const API_VERSION = '1.0';

// =============================================================================
// Validation helpers
// =============================================================================

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidISODate(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function validateEventEnvelope(evt: unknown): string | null {
  if (!evt || typeof evt !== 'object') return 'event must be an object';
  const e = evt as Record<string, unknown>;

  if (!isNonEmptyString(e.event_type)) return 'event_type is required';
  if (!EVENT_TYPE_SET.has(e.event_type as string)) {
    return `unknown event_type "${e.event_type}". Accepted: ${EVENT_TYPES.join(', ')}`;
  }
  if (!isNonEmptyString(e.timestamp) || !isValidISODate(e.timestamp)) {
    return 'timestamp must be a valid ISO-8601 string';
  }
  if (!isNonEmptyString(e.summary)) return 'summary is required';

  const studio = e.studio as Record<string, unknown> | undefined;
  if (!studio || typeof studio !== 'object') return 'studio object is required';
  if (!isNonEmptyString(studio.studio_address)) return 'studio.studio_address is required';

  const task = e.task as Record<string, unknown> | undefined;
  if (!task || typeof task !== 'object') return 'task object is required';
  if (!isNonEmptyString(task.work_mandate_id)) return 'task.work_mandate_id is required';
  if (!isNonEmptyString(task.task_type)) return 'task.task_type is required';

  const agent = e.agent as Record<string, unknown> | undefined;
  if (!agent || typeof agent !== 'object') return 'agent object is required';
  if (!isNonEmptyString(agent.agent_address)) return 'agent.agent_address is required';
  if (!['worker', 'verifier', 'collaborator'].includes(agent.role as string)) {
    return 'agent.role must be worker | verifier | collaborator';
  }

  const causality = e.causality as Record<string, unknown> | undefined;
  if (!causality || typeof causality !== 'object') return 'causality object is required';
  if (!Array.isArray(causality.parent_event_ids)) return 'causality.parent_event_ids must be an array';

  return null;
}

// =============================================================================
// Route factory
// =============================================================================

export interface SubmitWorkFn {
  (input: Record<string, unknown>): Promise<{ id: string }>;
}

export interface EpochAllocator {
  allocate(): Promise<number>;
  current(): number;
}

export interface SessionApiConfig {
  store: SessionStore;
  apiKeys?: Set<string>;
  submitWork?: SubmitWorkFn;
  signerAddress?: string;
  epochAllocator?: EpochAllocator;
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
}

export function createSessionRoutes(config: SessionApiConfig): Router {
  const router = Router();
  const { store } = config;

  // ── Epoch read endpoint ──
  router.get('/v1/epoch/current', (_req: Request, res: Response) => {
    const epoch = config.epochAllocator
      ? config.epochAllocator.current()
      : parseInt(process.env.CURRENT_EPOCH ?? '1', 10);
    res.json({ version: API_VERSION, data: { next_epoch: epoch } });
  });

  // =========================================================================
  // POST /v1/sessions — create a new coding session
  // =========================================================================

  router.post('/v1/sessions', async (req: Request, res: Response) => {
    try {
      const body = req.body as CreateSessionInput;

      if (!isNonEmptyString(body.studio_address)) {
        res.status(400).json({
          version: API_VERSION,
          error: { code: 'INVALID_INPUT', message: 'studio_address is required' },
        });
        return;
      }
      if (!isNonEmptyString(body.agent_address)) {
        res.status(400).json({
          version: API_VERSION,
          error: { code: 'INVALID_INPUT', message: 'agent_address is required' },
        });
        return;
      }

      const sessionId = isNonEmptyString(body.session_id)
        ? body.session_id
        : `sess_${randomUUID().replace(/-/g, '')}`;

      const epoch = config.epochAllocator
        ? await config.epochAllocator.allocate()
        : parseInt(process.env.CURRENT_EPOCH ?? '1', 10);

      const meta: SessionMetadata = {
        session_id: sessionId,
        session_root_event_id: null,
        studio_address: body.studio_address,
        studio_policy_version: body.studio_policy_version ?? 'engineering-studio-default-v1',
        work_mandate_id: body.work_mandate_id ?? 'generic-task',
        task_type: body.task_type ?? 'general',
        agent_address: body.agent_address,
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        event_count: 0,
        epoch,
        workflow_id: null,
        data_hash: null,
      };

      await store.create(meta);

      res.status(201).json({ version: API_VERSION, data: meta });
    } catch (err) {
      if (err instanceof ConflictError) {
        res.status(409).json({
          version: API_VERSION,
          error: { code: 'SESSION_EXISTS', message: err.message },
        });
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // POST /v1/sessions/:id/events — append canonical coding-session events
  // =========================================================================

  router.post('/v1/sessions/:id/events', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const session = await store.get(sessionId);

      if (!session) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` },
        });
        return;
      }

      if (session.status !== 'running') {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'SESSION_NOT_RUNNING',
            message: `Session is ${session.status}; events can only be appended to running sessions`,
          },
        });
        return;
      }

      const raw: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
      if (raw.length === 0) {
        res.status(400).json({
          version: API_VERSION,
          error: { code: 'INVALID_INPUT', message: 'At least one event is required' },
        });
        return;
      }

      const errors: { index: number; message: string }[] = [];
      for (let i = 0; i < raw.length; i++) {
        const err = validateEventEnvelope(raw[i]);
        if (err) errors.push({ index: i, message: err });
      }

      if (errors.length > 0) {
        res.status(400).json({
          version: API_VERSION,
          error: { code: 'VALIDATION_FAILED', details: errors },
        });
        return;
      }

      const enriched: CodingSessionEvent[] = raw.map((r) => {
        const evt = r as CodingSessionEvent;
        return {
          ...evt,
          version: evt.version ?? '1.0',
          session_id: sessionId,
        };
      });

      const added = await store.appendEvents(sessionId, enriched);

      res.status(201).json({
        version: API_VERSION,
        data: {
          session_id: sessionId,
          events_accepted: added.length,
          total_events: session.event_count,
          events: added,
        },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: err.message },
        });
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // POST /v1/sessions/:id/complete — mark session complete, bridge to workflow
  // =========================================================================

  router.post('/v1/sessions/:id/complete', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const session = await store.get(sessionId);

      if (!session) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` },
        });
        return;
      }

      if (session.status !== 'running') {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'SESSION_NOT_RUNNING',
            message: `Session is already ${session.status}`,
          },
        });
        return;
      }

      const body = (req.body ?? {}) as CompleteSessionInput;
      const finalStatus = body.status === 'failed' ? 'failed' : 'completed';
      const completedAt = new Date().toISOString();

      // Materialise terminal submission node if the last event isn't already one
      const events = await store.getEvents(sessionId);
      const lastEvent = events[events.length - 1];
      const isAlreadyTerminal =
        lastEvent &&
        (lastEvent.event_type === 'submission_created' || lastEvent.event_type === 'task_completed');

      if (!isAlreadyTerminal && events.length > 0) {
        const terminalEvent: CodingSessionEvent = {
          version: '1.0',
          session_id: sessionId,
          event_id: `evt_complete_${randomUUID().replace(/-/g, '')}`,
          event_type: 'task_completed',
          timestamp: completedAt,
          studio: {
            studio_address: session.studio_address,
            studio_policy_version: session.studio_policy_version,
          },
          task: {
            work_mandate_id: session.work_mandate_id,
            task_type: session.task_type,
          },
          agent: {
            agent_address: session.agent_address,
            role: 'worker',
          },
          causality: {
            parent_event_ids: [lastEvent.event_id],
          },
          summary: body.summary ?? `Session ${finalStatus}`,
        };

        await store.appendEvents(sessionId, [terminalEvent]);
      }

      // --- Bridge to WorkSubmission workflow ---
      let workflowId: string | null = null;
      let dataHash: string | null = null;

      if (finalStatus === 'completed' && config.submitWork && config.signerAddress) {
        const dag = await store.materializeDAG(sessionId);

        // Map event_ids to arweave_tx_ids so DKG parent references resolve correctly
        const eventToArweave = new Map(
          dag.nodes.map((n) => [n.node_id, `session_${sessionId}_${n.node_id}`]),
        );

        const dkgEvidence = dag.nodes.map((node) => ({
          arweave_tx_id: `session_${sessionId}_${node.node_id}`,
          author: node.agent_address,
          timestamp: new Date(node.timestamp).getTime(),
          parent_ids: node.parent_ids.map((pid) => eventToArweave.get(pid) ?? pid),
          payload_hash: node.payload_hash,
          artifact_ids: node.artifacts.map((a) => a.id),
          signature: '0xsession',
        }));

        dataHash = '0x' + createHash('sha256')
          .update(JSON.stringify({
            session_id: sessionId,
            agent_address: session.agent_address,
            studio_address: session.studio_address,
            merkle_root: dag.merkle_root,
          }))
          .digest('hex');

        const evidenceContent = Buffer.from(JSON.stringify({
          session_id: sessionId,
          event_count: session.event_count,
          merkle_root: dag.merkle_root,
        })).toString('base64');

        try {
          const workflow = await config.submitWork({
            studio_address: session.studio_address,
            epoch: session.epoch ?? parseInt(process.env.CURRENT_EPOCH ?? '1', 10),
            agent_address: session.agent_address,
            data_hash: dataHash,
            dkg_evidence: dkgEvidence,
            evidence_content: evidenceContent,
            signer_address: config.signerAddress,
            studio_policy_version: session.studio_policy_version,
            work_mandate_id: session.work_mandate_id,
            task_type: session.task_type,
          });
          workflowId = workflow.id;
        } catch (err) {
          config.logger?.warn(
            { sessionId, error: err instanceof Error ? err.message : String(err) },
            'Failed to submit WorkSubmission workflow for session',
          );
        }
      } else if (finalStatus === 'completed' && !config.submitWork) {
        config.logger?.warn(
          { sessionId },
          'submitWork not configured — session completed without workflow submission',
        );
      }

      await store.updateStatus(sessionId, finalStatus, completedAt, {
        workflow_id: workflowId ?? undefined,
        data_hash: dataHash ?? undefined,
      });

      const updatedSession = await store.get(sessionId);

      res.status(200).json({
        version: API_VERSION,
        data: updatedSession,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: err.message },
        });
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // GET /v1/sessions/:id/context — verifier scoring context (lightweight)
  // =========================================================================

  router.get('/v1/sessions/:id/context', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const session = await store.get(sessionId);

      if (!session) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` },
        });
        return;
      }

      const dag = await store.materializeDAG(sessionId);
      const studioPolicy = DEFAULT_POLICY;
      const workMandate = resolveMandate(session.work_mandate_id);

      res.status(200).json({
        version: API_VERSION,
        data: {
          session_metadata: {
            session_id: session.session_id,
            session_root_event_id: session.session_root_event_id,
            studio_address: session.studio_address,
            studio_policy_version: session.studio_policy_version,
            work_mandate_id: session.work_mandate_id,
            task_type: session.task_type,
            agent_address: session.agent_address,
            status: session.status,
            started_at: session.started_at,
            completed_at: session.completed_at,
            event_count: session.event_count,
            epoch: session.epoch,
            workflow_id: session.workflow_id,
            data_hash: session.data_hash,
          },
          studioPolicy,
          workMandate,
          evidence_summary: {
            merkle_root: dag.merkle_root,
            node_count: dag.nodes.length,
            roots: dag.roots,
            terminals: dag.terminals,
            evidence_uri: `/v1/sessions/${sessionId}/evidence`,
          },
        },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: err.message },
        });
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // GET /v1/sessions/:id/viewer — self-contained HTML evidence viewer
  // =========================================================================

  router.get('/v1/sessions/:id/viewer', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const session = await store.get(sessionId);

      if (!session) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` },
        });
        return;
      }

      const dag = await store.materializeDAG(sessionId);
      const html = renderSessionViewerHTML(session, dag);
      res.status(200).type('html').send(html);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: err.message },
        });
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // GET /v1/sessions/:id/evidence — full Evidence DAG
  // =========================================================================

  router.get('/v1/sessions/:id/evidence', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const session = await store.get(sessionId);

      if (!session) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` },
        });
        return;
      }

      const dag = await store.materializeDAG(sessionId);

      res.status(200).json({
        version: API_VERSION,
        data: {
          evidence_dag: dag,
        },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({
          version: API_VERSION,
          error: { code: 'SESSION_NOT_FOUND', message: err.message },
        });
        return;
      }
      throw err;
    }
  });

  return router;
}

// =============================================================================
// Session Viewer — self-contained HTML renderer
// =============================================================================

const EVENT_CATEGORY: Record<string, string> = {
  task_received: 'context', mandate_attached: 'context', policy_acknowledged: 'context',
  plan_created: 'reasoning', design_decision_made: 'reasoning', strategy_revised: 'reasoning',
  collaborator_selected: 'collab', delegation_created: 'collab', external_input_received: 'collab',
  tool_invoked: 'execution', file_read: 'execution', file_written: 'execution',
  artifact_created: 'execution', command_executed: 'execution',
  test_run: 'validation', test_failed: 'validation', test_passed: 'validation',
  error_observed: 'validation', debug_step: 'validation', revision_made: 'validation',
  submission_created: 'terminal', task_completed: 'terminal',
  verification_started: 'verifier', score_vector_created: 'verifier',
  outcome_evaluated: 'verifier', verification_completed: 'verifier',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSessionViewerHTML(session: SessionMetadata, dag: EvidenceDAG): string {
  const rootSet = new Set(dag.roots);
  const terminalSet = new Set(dag.terminals);
  const childToParents = new Map<string, string[]>();
  for (const e of dag.edges) {
    const arr = childToParents.get(e.child_node_id) ?? [];
    arr.push(e.parent_node_id);
    childToParents.set(e.child_node_id, arr);
  }

  const sorted = [...dag.nodes].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const dataHashLink =
    session.data_hash && session.data_hash.startsWith('0x')
      ? `<a href="https://sepolia.etherscan.io/tx/${esc(session.data_hash)}" style="color:#60a5fa;text-decoration:none">${esc(session.data_hash.slice(0, 18))}…</a>`
      : session.data_hash ? esc(session.data_hash) : '—';

  const workflowDisplay = session.workflow_id ? esc(session.workflow_id) : '—';

  let nodesHtml = '';
  for (const node of sorted) {
    const cat = EVENT_CATEGORY[node.event_type] ?? 'execution';
    const isRoot = rootSet.has(node.node_id);
    const isTerminal = terminalSet.has(node.node_id);

    const marker = isRoot ? '<span class="marker root-m">ROOT</span>'
      : isTerminal ? '<span class="marker term-m">TERMINAL</span>'
      : '';

    const parents = childToParents.get(node.node_id);
    const arrowHtml = parents && parents.length > 0
      ? `<div class="arrow">↓ from ${parents.map(p => esc(p.slice(0, 12)) + '…').join(', ')}</div>`
      : '';

    const metricsHtml = node.metrics
      ? `<div class="metrics">${
          node.metrics.duration_ms != null ? `<span>${node.metrics.duration_ms}ms</span>` : ''
        }${
          node.metrics.tokens_input != null ? `<span>${node.metrics.tokens_input} tok in</span>` : ''
        }${
          node.metrics.tokens_output != null ? `<span>${node.metrics.tokens_output} tok out</span>` : ''
        }${
          node.metrics.tool_calls != null ? `<span>${node.metrics.tool_calls} calls</span>` : ''
        }</div>`
      : '';

    const artifactCount = node.artifacts.length;
    const artifactHtml = artifactCount > 0
      ? `<span class="art-count">${artifactCount} artifact${artifactCount > 1 ? 's' : ''}</span>`
      : '';

    nodesHtml += `${arrowHtml}<div class="node cat-${cat}${isRoot ? ' is-root' : ''}${isTerminal ? ' is-terminal' : ''}">
  <div class="node-head">
    <span class="badge bg-${cat}">${esc(node.event_type)}</span>${marker}
    <span class="ts">${esc(node.timestamp)}</span>
  </div>
  <div class="summary">${esc(node.summary)}</div>
  <div class="node-meta">
    <span class="addr">${esc(node.agent_address.slice(0, 10))}…</span>${artifactHtml}
  </div>${metricsHtml}
</div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session ${esc(session.session_id.slice(0, 18))}… — ChaosChain</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',SFMono-Regular,ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;background:#0a0a0a;color:#d4d4d4;line-height:1.5}
a{color:#60a5fa}
.wrap{max-width:860px;margin:0 auto;padding:24px 20px}

.hdr{border-bottom:1px solid #1e1e1e;padding-bottom:20px;margin-bottom:24px}
.hdr h1{font-size:15px;font-weight:600;color:#fff;margin-bottom:10px}
.hdr-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:12px;color:#888}
.hdr-grid .label{color:#555}
.hdr-grid .val{color:#bbb;word-break:break-all}
.status{display:inline-block;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:700;text-transform:uppercase}
.status-active{background:#1a3a1a;color:#4ade80}
.status-completed{background:#1a2a3a;color:#60a5fa}
.status-failed{background:#3a1a1a;color:#f87171}

.timeline{display:flex;flex-direction:column;gap:0}
.arrow{font-size:11px;color:#444;padding:4px 0 4px 20px}
.node{border:1px solid #1e1e1e;border-radius:6px;padding:12px 16px;background:#111;margin-bottom:2px}
.node.is-root{border-left:3px solid #4ade80}
.node.is-terminal{border-left:3px solid #f59e0b}
.node-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;white-space:nowrap;text-transform:uppercase;letter-spacing:.5px}
.bg-context{background:#1a2a1a;color:#86efac}
.bg-reasoning{background:#2a1a3a;color:#c084fc}
.bg-collab{background:#1a2a3a;color:#7dd3fc}
.bg-execution{background:#1e1e1e;color:#a1a1aa}
.bg-validation{background:#3a2a1a;color:#fbbf24}
.bg-terminal{background:#2a1a1a;color:#fca5a5}
.bg-verifier{background:#1a3a3a;color:#5eead4}
.marker{font-size:9px;font-weight:700;padding:1px 6px;border-radius:2px;letter-spacing:.5px}
.root-m{background:#1a3a1a;color:#4ade80}
.term-m{background:#3a2a1a;color:#f59e0b}
.ts{font-size:11px;color:#555;margin-left:auto}
.summary{font-size:13px;color:#ccc}
.node-meta{display:flex;gap:12px;margin-top:6px;font-size:11px;color:#666}
.art-count{color:#888}
.metrics{display:flex;gap:10px;margin-top:4px;font-size:10px;color:#555}
.metrics span{background:#1a1a1a;padding:1px 6px;border-radius:2px}

.footer{border-top:1px solid #1e1e1e;margin-top:24px;padding-top:16px;display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:#666}
.footer span{color:#888}
.footer code{color:#999;background:#1a1a1a;padding:1px 6px;border-radius:2px;font-size:11px}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Session Viewer</h1>
    <div class="hdr-grid">
      <span class="label">session_id</span><span class="val">${esc(session.session_id)}</span>
      <span class="label">status</span><span class="val"><span class="status status-${session.status}">${esc(session.status)}</span></span>
      <span class="label">agent</span><span class="val">${esc(session.agent_address)}</span>
      <span class="label">studio</span><span class="val">${esc(session.studio_address)}</span>
      <span class="label">task_type</span><span class="val">${esc(session.task_type)}</span>
      <span class="label">started_at</span><span class="val">${esc(session.started_at)}</span>
      <span class="label">completed_at</span><span class="val">${session.completed_at ? esc(session.completed_at) : '—'}</span>
      <span class="label">workflow_id</span><span class="val">${workflowDisplay}</span>
      <span class="label">data_hash</span><span class="val">${dataHashLink}</span>
    </div>
  </div>
  <div class="timeline">
${nodesHtml}  </div>
  <div class="footer">
    <span>merkle_root <code>${esc(dag.merkle_root.slice(0, 24))}…</code></span>
    <span>${dag.nodes.length} nodes</span>
    <span>${dag.roots.length} roots</span>
    <span>${dag.terminals.length} terminals</span>
  </div>
</div>
</body>
</html>`;
}
