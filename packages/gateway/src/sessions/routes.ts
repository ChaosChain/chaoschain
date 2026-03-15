/**
 * Session API Routes — Engineering Studio MVP
 *
 * POST /v1/sessions              — Create a new coding session
 * POST /v1/sessions/:id/events   — Append canonical session events
 * POST /v1/sessions/:id/complete — Mark session complete; bridge to WorkSubmission
 * GET  /v1/sessions/:id/context  — Verifier scoring context (lightweight)
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

export interface SessionApiConfig {
  store: SessionStore;
  apiKeys?: Set<string>;
  submitWork?: SubmitWorkFn;
  signerAddress?: string;
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
}

export function createSessionRoutes(config: SessionApiConfig): Router {
  const router = Router();
  const { store } = config;

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

        const dkgEvidence = dag.nodes.map((node) => ({
          arweave_tx_id: `session_${sessionId}_${node.node_id}`,
          author: node.agent_address,
          timestamp: new Date(node.timestamp).getTime(),
          parent_ids: node.parent_ids,
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
            epoch: 0,
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
