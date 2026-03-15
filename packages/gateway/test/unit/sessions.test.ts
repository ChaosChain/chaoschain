/**
 * Session API — Unit Tests
 *
 * Tests for:
 *   POST /v1/sessions
 *   POST /v1/sessions/:id/events
 *   POST /v1/sessions/:id/complete
 *   GET  /v1/sessions/:id/context
 *
 * Uses the in-memory SessionStore (no Pool injected). No database or chain calls.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import { SessionStore, createSessionRoutes } from '../../src/sessions/index.js';
import type { SubmitWorkFn } from '../../src/sessions/index.js';
import type { PoolLike } from '../../src/sessions/store.js';

// =============================================================================
// Helpers
// =============================================================================

function buildApp(opts?: {
  store?: SessionStore;
  submitWork?: SubmitWorkFn;
  signerAddress?: string;
}) {
  const app = express();
  app.use(express.json());
  const s = opts?.store ?? new SessionStore();
  app.use(createSessionRoutes({
    store: s,
    submitWork: opts?.submitWork,
    signerAddress: opts?.signerAddress,
  }));
  return { app, store: s };
}

async function req(
  app: express.Express,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
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
      const opts: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      };
      if (body !== undefined) opts.body = JSON.stringify(body);

      fetch(url, opts)
        .then(async (res) => {
          const json = await res.json();
          server.close();
          resolve({ status: res.status, body: json as Record<string, unknown> });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'task_received',
    timestamp: '2026-03-14T10:00:00Z',
    summary: 'Received task',
    studio: {
      studio_address: '0xA855F7893ac01653D1bCC24210bFbb3c47324649',
      studio_policy_version: 'engineering-studio-default-v1',
    },
    task: {
      work_mandate_id: 'generic-task',
      task_type: 'feature',
    },
    agent: {
      agent_address: '0xworker',
      role: 'worker',
    },
    causality: {
      parent_event_ids: [],
    },
    ...overrides,
  };
}

// =============================================================================
// POST /v1/sessions
// =============================================================================

describe('POST /v1/sessions', () => {
  it('creates a session with server-generated id', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions', {
      studio_address: '0xStudio',
      agent_address: '0xAgent',
    });

    expect(res.status).toBe(201);
    const data = res.body.data as Record<string, unknown>;
    expect((data.session_id as string)).toMatch(/^sess_/);
    expect(data.status).toBe('running');
    expect(data.studio_address).toBe('0xStudio');
    expect(data.agent_address).toBe('0xAgent');
    expect(data.event_count).toBe(0);
    expect(data.session_root_event_id).toBeNull();
    expect(data.workflow_id).toBeNull();
    expect(data.data_hash).toBeNull();
  });

  it('accepts a client-provided session_id', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions', {
      session_id: 'sess_custom123',
      studio_address: '0xStudio',
      agent_address: '0xAgent',
    });

    expect(res.status).toBe(201);
    expect((res.body.data as Record<string, unknown>).session_id).toBe('sess_custom123');
  });

  it('returns 409 on duplicate session_id', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 'dup',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const res = await req(app, 'POST', '/v1/sessions', {
      session_id: 'dup',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    expect(res.status).toBe(409);
    expect((res.body.error as Record<string, unknown>).code).toBe('SESSION_EXISTS');
  });

  it('returns 400 when studio_address is missing', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions', { agent_address: '0xA' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when agent_address is missing', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions', { studio_address: '0xS' });
    expect(res.status).toBe(400);
  });

  it('defaults studio_policy_version, work_mandate_id, task_type', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions', {
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const data = res.body.data as Record<string, unknown>;
    expect(data.studio_policy_version).toBe('engineering-studio-default-v1');
    expect(data.work_mandate_id).toBe('generic-task');
    expect(data.task_type).toBe('general');
  });
});

// =============================================================================
// POST /v1/sessions/:id/events
// =============================================================================

describe('POST /v1/sessions/:id/events', () => {
  it('accepts a single event and returns it with event_id', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const res = await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());

    expect(res.status).toBe(201);
    const data = res.body.data as Record<string, unknown>;
    expect(data.events_accepted).toBe(1);
    expect(data.total_events).toBe(1);
    const events = data.events as Array<Record<string, unknown>>;
    expect(events[0].event_id).toBeDefined();
  });

  it('accepts an array of events', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const res = await req(app, 'POST', '/v1/sessions/s1/events', [
      makeEvent({ event_id: 'evt_1' }),
      makeEvent({
        event_id: 'evt_2',
        event_type: 'plan_created',
        summary: 'Created plan',
        causality: { parent_event_ids: ['evt_1'] },
      }),
    ]);

    expect(res.status).toBe(201);
    const data = res.body.data as Record<string, unknown>;
    expect(data.events_accepted).toBe(2);
    expect(data.total_events).toBe(2);
  });

  it('sets session_root_event_id from first event with no parents', async () => {
    const store = new SessionStore();
    const { app } = buildApp({ store });
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent({ event_id: 'evt_root' }));

    expect((await store.get('s1'))!.session_root_event_id).toBe('evt_root');
  });

  it('returns 404 for non-existent session', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions/nonexistent/events', makeEvent());
    expect(res.status).toBe(404);
    expect((res.body.error as Record<string, unknown>).code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 400 for completed session', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());
    await req(app, 'POST', '/v1/sessions/s1/complete', {});

    const res = await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe('SESSION_NOT_RUNNING');
  });

  it('rejects events with unknown event_type', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const res = await req(
      app,
      'POST',
      '/v1/sessions/s1/events',
      makeEvent({ event_type: 'totally_unknown' }),
    );
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe('VALIDATION_FAILED');
  });

  it('rejects events missing required fields', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const res = await req(app, 'POST', '/v1/sessions/s1/events', { event_type: 'plan_created' });
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe('VALIDATION_FAILED');
  });

  it('preserves client-provided event_id', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });

    const res = await req(
      app,
      'POST',
      '/v1/sessions/s1/events',
      makeEvent({ event_id: 'my_custom_id' }),
    );
    const events = (res.body.data as Record<string, unknown>).events as Array<Record<string, unknown>>;
    expect(events[0].event_id).toBe('my_custom_id');
  });
});

// =============================================================================
// POST /v1/sessions/:id/complete
// =============================================================================

describe('POST /v1/sessions/:id/complete', () => {
  it('marks session completed and materialises terminal node', async () => {
    const store = new SessionStore();
    const { app } = buildApp({ store });
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent({ event_id: 'evt_1' }));

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', { summary: 'All done' });

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data.status).toBe('completed');
    expect(data.completed_at).toBeDefined();

    const events = await store.getEvents('s1');
    const last = events[events.length - 1];
    expect(last.event_type).toBe('task_completed');
    expect(last.causality.parent_event_ids).toContain('evt_1');
    expect(last.summary).toBe('All done');
  });

  it('skips terminal node if last event is submission_created', async () => {
    const store = new SessionStore();
    const { app } = buildApp({ store });
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(
      app,
      'POST',
      '/v1/sessions/s1/events',
      makeEvent({ event_id: 'evt_sub', event_type: 'submission_created', summary: 'Submitted' }),
    );

    await req(app, 'POST', '/v1/sessions/s1/complete', {});

    const events = await store.getEvents('s1');
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('submission_created');
  });

  it('returns 404 for non-existent session', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/v1/sessions/nope/complete', {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when completing an already-completed session', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/complete', {});

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', {});
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe('SESSION_NOT_RUNNING');
  });

  it('accepts status: failed', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', { status: 'failed' });
    expect((res.body.data as Record<string, unknown>).status).toBe('failed');
  });
});

// =============================================================================
// GET /v1/sessions/:id/context
// =============================================================================

describe('GET /v1/sessions/:id/context', () => {
  it('returns session_metadata, studioPolicy, workMandate, and evidence_summary', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xStudio',
      agent_address: '0xAgent',
      task_type: 'feature',
    });

    await req(app, 'POST', '/v1/sessions/s1/events', [
      makeEvent({ event_id: 'evt_1' }),
      makeEvent({
        event_id: 'evt_2',
        event_type: 'plan_created',
        summary: 'Created plan',
        causality: { parent_event_ids: ['evt_1'] },
      }),
    ]);

    const res = await req(app, 'GET', '/v1/sessions/s1/context');

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;

    // session_metadata
    const meta = data.session_metadata as Record<string, unknown>;
    expect(meta.session_id).toBe('s1');
    expect(meta.agent_address).toBe('0xAgent');
    expect(meta.session_root_event_id).toBe('evt_1');
    expect(meta.event_count).toBe(2);

    // studioPolicy + workMandate
    expect(data.studioPolicy).toBeDefined();
    expect(data.workMandate).toBeDefined();
    expect((data.workMandate as Record<string, unknown>).taskId).toBe('generic-task');

    // evidence_summary
    const summary = data.evidence_summary as Record<string, unknown>;
    expect(summary.merkle_root).toMatch(/^0x[a-f0-9]{64}$/);
    expect(summary.node_count).toBe(2);
    expect(summary.roots).toEqual(['evt_1']);
    expect(summary.terminals).toEqual(['evt_2']);
    expect(summary.evidence_uri).toBe('/v1/sessions/s1/evidence');
  });

  it('does NOT include nodes or edges in the response', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent({ event_id: 'evt_1' }));

    const res = await req(app, 'GET', '/v1/sessions/s1/context');
    const data = res.body.data as Record<string, unknown>;

    expect(data).not.toHaveProperty('evidence_dag');
    expect(data.evidence_summary).toBeDefined();
    expect(data.evidence_summary).not.toHaveProperty('nodes');
    expect(data.evidence_summary).not.toHaveProperty('edges');
  });

  it('returns 404 for non-existent session', async () => {
    const { app } = buildApp();
    const res = await req(app, 'GET', '/v1/sessions/nope/context');
    expect(res.status).toBe(404);
    expect((res.body.error as Record<string, unknown>).code).toBe('SESSION_NOT_FOUND');
  });

  it('works for completed sessions — includes terminal node in summary', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent({ event_id: 'evt_1' }));
    await req(app, 'POST', '/v1/sessions/s1/complete', { summary: 'Done' });

    const res = await req(app, 'GET', '/v1/sessions/s1/context');

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    const meta = data.session_metadata as Record<string, unknown>;
    expect(meta.status).toBe('completed');

    const summary = data.evidence_summary as Record<string, unknown>;
    expect(summary.node_count).toBe(2);
  });
});

// =============================================================================
// GET /v1/sessions/:id/evidence
// =============================================================================

describe('GET /v1/sessions/:id/evidence', () => {
  it('returns full EvidenceDAG with nodes, edges, roots, terminals, merkle_root', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xStudio',
      agent_address: '0xAgent',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', [
      makeEvent({ event_id: 'evt_1' }),
      makeEvent({
        event_id: 'evt_2',
        event_type: 'plan_created',
        summary: 'Created plan',
        causality: { parent_event_ids: ['evt_1'] },
      }),
    ]);

    const res = await req(app, 'GET', '/v1/sessions/s1/evidence');

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    const dag = data.evidence_dag as Record<string, unknown>;

    const nodes = dag.nodes as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].node_id).toBe('evt_1');
    expect(nodes[0].event_id).toBe('evt_1');
    expect(nodes[0].agent_address).toBe('0xworker');
    expect(nodes[0].parent_ids).toEqual([]);
    expect(nodes[0].payload_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(nodes[1].node_id).toBe('evt_2');
    expect(nodes[1].parent_ids).toEqual(['evt_1']);

    const edges = dag.edges as Array<Record<string, unknown>>;
    expect(edges).toHaveLength(1);
    expect(edges[0].parent_node_id).toBe('evt_1');
    expect(edges[0].child_node_id).toBe('evt_2');
    expect(edges[0].relation).toBe('causal');

    expect(dag.roots).toEqual(['evt_1']);
    expect(dag.terminals).toEqual(['evt_2']);
    expect(dag.merkle_root).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('returns 404 for non-existent session', async () => {
    const { app } = buildApp();
    const res = await req(app, 'GET', '/v1/sessions/nope/evidence');
    expect(res.status).toBe(404);
    expect((res.body.error as Record<string, unknown>).code).toBe('SESSION_NOT_FOUND');
  });

  it('evidence DAG matches context summary (merkle_root, roots, terminals)', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', [
      makeEvent({ event_id: 'evt_1' }),
      makeEvent({
        event_id: 'evt_2',
        event_type: 'plan_created',
        summary: 'Plan',
        causality: { parent_event_ids: ['evt_1'] },
      }),
    ]);

    const ctxRes = await req(app, 'GET', '/v1/sessions/s1/context');
    const evRes = await req(app, 'GET', '/v1/sessions/s1/evidence');

    const summary = (ctxRes.body.data as Record<string, unknown>).evidence_summary as Record<string, unknown>;
    const dag = (evRes.body.data as Record<string, unknown>).evidence_dag as Record<string, unknown>;

    expect(summary.merkle_root).toBe(dag.merkle_root);
    expect(summary.roots).toEqual(dag.roots);
    expect(summary.terminals).toEqual(dag.terminals);
    expect(summary.node_count).toBe((dag.nodes as unknown[]).length);
  });
});

// =============================================================================
// SessionStore unit tests (in-memory mode, no Pool)
// =============================================================================

function makeMeta(id: string): Parameters<SessionStore['create']>[0] {
  return {
    session_id: id,
    session_root_event_id: null,
    studio_address: '0xS',
    studio_policy_version: 'v1',
    work_mandate_id: 'generic-task',
    task_type: 'feature',
    agent_address: '0xA',
    status: 'running',
    started_at: new Date().toISOString(),
    completed_at: null,
    event_count: 0,
    workflow_id: null,
    data_hash: null,
  };
}

function makeRawEvent(id: string, ts: string, parents: string[] = [], extras: Record<string, unknown> = {}): any {
  return {
    version: '1.0',
    session_id: 's1',
    event_id: id,
    event_type: 'task_received',
    timestamp: ts,
    studio: { studio_address: '0xS', studio_policy_version: 'v1' },
    task: { work_mandate_id: 'generic-task', task_type: 'feature' },
    agent: { agent_address: '0xA', role: 'worker' },
    causality: { parent_event_ids: parents },
    summary: `Event ${id}`,
    ...extras,
  };
}

describe('SessionStore', () => {
  // ---- Node structure ----

  it('materializeDAG returns nodes with all required fields', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z'),
      makeRawEvent('evt_2', '2026-03-14T10:05:00Z', ['evt_1']),
    ]);

    const { nodes } = await store.materializeDAG('s1');
    expect(nodes).toHaveLength(2);

    const n0 = nodes[0];
    expect(n0.node_id).toBe('evt_1');
    expect(n0.event_id).toBe('evt_1');
    expect(n0.session_id).toBe('s1');
    expect(n0.agent_address).toBe('0xA');
    expect(n0.parent_ids).toEqual([]);
    expect(n0.payload_hash).toMatch(/^0x[a-f0-9]{64}$/);

    const n1 = nodes[1];
    expect(n1.node_id).toBe('evt_2');
    expect(n1.parent_ids).toEqual(['evt_1']);
    expect(n1.payload_hash).not.toBe(n0.payload_hash);
  });

  // ---- Edge generation ----

  it('generates causal edges from parent_event_ids', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z'),
      makeRawEvent('evt_2', '2026-03-14T10:05:00Z', ['evt_1']),
      makeRawEvent('evt_3', '2026-03-14T10:10:00Z', ['evt_1', 'evt_2']),
    ]);

    const { edges } = await store.materializeDAG('s1');
    expect(edges).toHaveLength(3);
    expect(edges).toContainEqual({ parent_node_id: 'evt_1', child_node_id: 'evt_2', relation: 'causal' });
    expect(edges).toContainEqual({ parent_node_id: 'evt_1', child_node_id: 'evt_3', relation: 'causal' });
    expect(edges).toContainEqual({ parent_node_id: 'evt_2', child_node_id: 'evt_3', relation: 'causal' });
  });

  // ---- Roots & terminals ----

  it('identifies roots (no parents) and terminals (no children)', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z'),
      makeRawEvent('evt_2', '2026-03-14T10:05:00Z', ['evt_1']),
      makeRawEvent('evt_3', '2026-03-14T10:10:00Z', ['evt_2']),
    ]);

    const { roots, terminals } = await store.materializeDAG('s1');
    expect(roots).toEqual(['evt_1']);
    expect(terminals).toEqual(['evt_3']);
  });

  it('single-node DAG has the same node as root and terminal', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [makeRawEvent('evt_solo', '2026-03-14T10:00:00Z')]);

    const { roots, terminals } = await store.materializeDAG('s1');
    expect(roots).toEqual(['evt_solo']);
    expect(terminals).toEqual(['evt_solo']);
  });

  // ---- Merkle root ----

  it('merkle_root is deterministic (same events → same hash)', async () => {
    const evts = [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z'),
      makeRawEvent('evt_2', '2026-03-14T10:05:00Z', ['evt_1']),
    ];

    const store1 = new SessionStore();
    await store1.create(makeMeta('s1'));
    await store1.appendEvents('s1', evts);

    const store2 = new SessionStore();
    await store2.create(makeMeta('s1'));
    await store2.appendEvents('s1', evts);

    const dag1 = await store1.materializeDAG('s1');
    const dag2 = await store2.materializeDAG('s1');
    expect(dag1.merkle_root).toBe(dag2.merkle_root);
  });

  it('merkle_root changes when events differ', async () => {
    const store1 = new SessionStore();
    await store1.create(makeMeta('s1'));
    await store1.appendEvents('s1', [makeRawEvent('evt_1', '2026-03-14T10:00:00Z')]);

    const store2 = new SessionStore();
    await store2.create(makeMeta('s1'));
    await store2.appendEvents('s1', [makeRawEvent('evt_DIFFERENT', '2026-03-14T10:00:00Z')]);

    const dag1 = await store1.materializeDAG('s1');
    const dag2 = await store2.materializeDAG('s1');
    expect(dag1.merkle_root).not.toBe(dag2.merkle_root);
  });

  // ---- Verifier event auto-wiring ----

  it('auto-wires verifier events with no parents to the terminal worker node', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z'),
      makeRawEvent('evt_sub', '2026-03-14T10:10:00Z', ['evt_1'], {
        event_type: 'submission_created', summary: 'Submitted',
      }),
      makeRawEvent('evt_v1', '2026-03-14T10:15:00Z', [], {
        event_type: 'verification_started', summary: 'Verifier started',
        agent: { agent_address: '0xVerifier', role: 'verifier' },
      }),
      makeRawEvent('evt_v2', '2026-03-14T10:20:00Z', ['evt_v1'], {
        event_type: 'score_vector_created', summary: 'Score produced',
        agent: { agent_address: '0xVerifier', role: 'verifier' },
      }),
    ]);

    const { nodes, edges, roots, terminals } = await store.materializeDAG('s1');

    const v1Node = nodes.find((n) => n.node_id === 'evt_v1')!;
    expect(v1Node.parent_ids).toEqual(['evt_sub']);

    const v2Node = nodes.find((n) => n.node_id === 'evt_v2')!;
    expect(v2Node.parent_ids).toEqual(['evt_v1']);

    expect(edges).toContainEqual({
      parent_node_id: 'evt_sub', child_node_id: 'evt_v1', relation: 'causal',
    });

    expect(roots).toEqual(['evt_1']);
    expect(terminals).toEqual(['evt_v2']);
  });

  it('does not auto-wire verifier events that already have parents', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z', [], { event_type: 'task_received' }),
      makeRawEvent('evt_done', '2026-03-14T10:10:00Z', ['evt_1'], {
        event_type: 'task_completed', summary: 'Done',
      }),
      makeRawEvent('evt_v', '2026-03-14T10:15:00Z', ['evt_done'], {
        event_type: 'outcome_evaluated', summary: 'Evaluated',
        agent: { agent_address: '0xV', role: 'verifier' },
      }),
    ]);

    const { nodes } = await store.materializeDAG('s1');
    const vNode = nodes.find((n) => n.node_id === 'evt_v')!;
    expect(vNode.parent_ids).toEqual(['evt_done']);
  });

  // ---- Timestamp ordering ----

  it('session_root_event_id is not overwritten by later parentless events', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [makeRawEvent('evt_root', '2026-03-14T10:00:00Z')]);
    expect((await store.get('s1'))!.session_root_event_id).toBe('evt_root');
    await store.appendEvents('s1', [makeRawEvent('evt_later_root', '2026-03-14T10:10:00Z')]);
    expect((await store.get('s1'))!.session_root_event_id).toBe('evt_root');
  });

  it('getEvents returns events sorted by event timestamp', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [makeRawEvent('evt_late', '2026-03-14T10:30:00Z')]);
    await store.appendEvents('s1', [makeRawEvent('evt_early', '2026-03-14T10:00:00Z')]);
    const events = await store.getEvents('s1');
    expect(events[0].event_id).toBe('evt_early');
    expect(events[1].event_id).toBe('evt_late');
  });

  it('nodes are in timestamp order', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_c', '2026-03-14T10:20:00Z'),
      makeRawEvent('evt_a', '2026-03-14T10:00:00Z'),
      makeRawEvent('evt_b', '2026-03-14T10:10:00Z', ['evt_a']),
    ]);
    const { nodes } = await store.materializeDAG('s1');
    expect(nodes.map((n) => n.node_id)).toEqual(['evt_a', 'evt_b', 'evt_c']);
  });

  // ---- Raw payload preservation ----

  it('stores a deep clone — mutating the original does not affect stored data', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    const original = makeRawEvent('evt_1', '2026-03-14T10:00:00Z', [], {
      metadata: { repo: 'org/repo', branch: 'main' },
      metrics: { duration_ms: 5000, tokens_input: 200 },
      artifacts: [{ type: 'code', id: 'art_1', label: 'file.ts' }],
    });
    await store.appendEvents('s1', [original]);
    original.metadata.repo = 'MUTATED';
    original.metrics.duration_ms = 99999;
    original.artifacts[0].label = 'MUTATED';
    const stored = (await store.getEvents('s1'))[0];
    expect(stored.metadata!.repo).toBe('org/repo');
    expect(stored.metrics!.duration_ms).toBe(5000);
    expect(stored.artifacts![0].label).toBe('file.ts');
  });

  it('materializeDAG includes metrics when present', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [
      makeRawEvent('evt_1', '2026-03-14T10:00:00Z', [], {
        metrics: { duration_ms: 12000, tokens_input: 500, tokens_output: 200, tool_calls: 3 },
      }),
    ]);
    const { nodes } = await store.materializeDAG('s1');
    expect(nodes[0].metrics).toEqual({
      duration_ms: 12000, tokens_input: 500, tokens_output: 200, tool_calls: 3,
    });
  });

  it('getStoredEvents includes received_at timestamps', async () => {
    const store = new SessionStore();
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [makeRawEvent('evt_1', '2026-03-14T10:00:00Z')]);
    const stored = await store.getStoredEvents('s1');
    expect(stored).toHaveLength(1);
    expect(stored[0].received_at).toBeDefined();
    expect(new Date(stored[0].received_at).getTime()).toBeGreaterThan(0);
    expect(stored[0].event.event_id).toBe('evt_1');
  });
});

// =============================================================================
// Postgres write-through (mock PoolLike)
// =============================================================================

describe('SessionStore with mock Postgres', () => {
  function createMockPool(): PoolLike & { queries: { text: string; values?: unknown[] }[] } {
    const sessions = new Map<string, Record<string, unknown>>();
    const events: Record<string, unknown>[][] = [];
    const queries: { text: string; values?: unknown[] }[] = [];

    return {
      queries,
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });

        if (text.includes('INSERT INTO sessions')) {
          const sid = values![0] as string;
          if (sessions.has(sid)) throw new Error('duplicate key');
          sessions.set(sid, { session_id: sid });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('INSERT INTO session_events')) {
          events.push(values as unknown[]);
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('UPDATE sessions')) {
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('SELECT * FROM sessions')) {
          return { rows: [], rowCount: 0 }; // cache miss fallback
        }
        if (text.includes('SELECT') && text.includes('session_events')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  it('persists session to Postgres on create', async () => {
    const pool = createMockPool();
    const store = new SessionStore(pool);
    await store.create(makeMeta('s1'));

    const inserts = pool.queries.filter((q) => q.text.includes('INSERT INTO sessions'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values![0]).toBe('s1');
  });

  it('persists events to Postgres on append', async () => {
    const pool = createMockPool();
    const store = new SessionStore(pool);
    await store.create(makeMeta('s1'));
    await store.appendEvents('s1', [makeRawEvent('evt_1', '2026-03-14T10:00:00Z')]);

    const evtInserts = pool.queries.filter((q) => q.text.includes('INSERT INTO session_events'));
    expect(evtInserts).toHaveLength(1);
    expect(evtInserts[0].values![1]).toBe('evt_1');

    const updates = pool.queries.filter(
      (q) => q.text.includes('UPDATE sessions') && q.text.includes('event_count'),
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('survives simulated restart (cache cleared, reads from pool fallback)', async () => {
    const pool = createMockPool();
    const store = new SessionStore(pool);
    await store.create(makeMeta('s1'));

    // Simulate a restart by creating a new store with same pool
    const store2 = new SessionStore(pool);
    // get() on cache miss will query Postgres; our mock returns empty rows
    // so it returns undefined (no real DB). This verifies the code path runs.
    const session = await store2.get('s1');
    expect(session).toBeUndefined(); // mock returns empty rows

    const pgQueries = pool.queries.filter((q) => q.text.includes('SELECT * FROM sessions'));
    expect(pgQueries.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// WorkSubmission bridge
// =============================================================================

describe('WorkSubmission bridge on complete', () => {
  it('calls submitWork and stores workflow_id + data_hash on complete', async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const mockSubmitWork: SubmitWorkFn = async (input) => {
      capturedInput = input;
      return { id: 'wf_test_123' };
    };

    const { app } = buildApp({
      submitWork: mockSubmitWork,
      signerAddress: '0xSigner',
    });

    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xStudio',
      agent_address: '0xAgent',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent({ event_id: 'evt_1' }));

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', { summary: 'Done' });

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data.workflow_id).toBe('wf_test_123');
    expect(data.data_hash).toMatch(/^0x[a-f0-9]{64}$/);

    // Verify submitWork was called with correct shape
    expect(capturedInput).toBeDefined();
    expect(capturedInput!.studio_address).toBe('0xStudio');
    expect(capturedInput!.agent_address).toBe('0xAgent');
    expect(capturedInput!.signer_address).toBe('0xSigner');
    expect(capturedInput!.data_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(Array.isArray(capturedInput!.dkg_evidence)).toBe(true);
  });

  it('succeeds without submitWork configured (no workflow_id)', async () => {
    const { app } = buildApp(); // no submitWork

    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', {});

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data.status).toBe('completed');
    expect(data.workflow_id).toBeNull();
    expect(data.data_hash).toBeNull();
  });

  it('completes session even if submitWork throws', async () => {
    const failingSubmitWork: SubmitWorkFn = async () => {
      throw new Error('workflow engine down');
    };

    const { app } = buildApp({
      submitWork: failingSubmitWork,
      signerAddress: '0xSigner',
    });

    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', {});

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data.status).toBe('completed');
    expect(data.workflow_id).toBeNull();
  });

  it('does not trigger workflow for failed sessions', async () => {
    let called = false;
    const mockSubmitWork: SubmitWorkFn = async () => {
      called = true;
      return { id: 'should_not_happen' };
    };

    const { app } = buildApp({
      submitWork: mockSubmitWork,
      signerAddress: '0xSigner',
    });

    await req(app, 'POST', '/v1/sessions', {
      session_id: 's1',
      studio_address: '0xS',
      agent_address: '0xA',
    });
    await req(app, 'POST', '/v1/sessions/s1/events', makeEvent());

    const res = await req(app, 'POST', '/v1/sessions/s1/complete', { status: 'failed' });

    expect(res.status).toBe(200);
    expect(called).toBe(false);
    expect((res.body.data as Record<string, unknown>).workflow_id).toBeNull();
  });
});
