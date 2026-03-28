/**
 * Session Store — dual-mode (in-memory only / Postgres write-through)
 *
 * When constructed without a Pool, all data lives in memory only (unit tests).
 * When a Pool is injected, every write goes to Postgres first, and reads
 * fall through to the database on cache miss (lazy load after restart).
 *
 * Guarantees:
 *  - Raw event payloads are deep-cloned on ingest — never mutated.
 *  - Events are returned sorted by event timestamp (not insertion order).
 *  - session_root_event_id is assigned exactly once (first parentless event).
 *  - DAG materialisation is deterministic.
 */

import { randomUUID, createHash } from 'crypto';
import type {
  SessionMetadata,
  SessionStatus,
  CodingSessionEvent,
  StoredEvent,
  EvidenceNode,
  EvidenceEdge,
  EvidenceDAG,
  SessionListItem,
  ListSessionsResult,
} from './types.js';
import { VERIFIER_EVENT_TYPES, TERMINAL_EVENT_TYPES } from './types.js';

// Minimal interface so we don't import the full `pg` module in unit tests.
export interface PoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export class SessionStore {
  private cache = new Map<string, SessionMetadata>();
  private eventsCache = new Map<string, StoredEvent[]>();
  private pool: PoolLike | null;

  constructor(pool?: PoolLike) {
    this.pool = pool ?? null;
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async create(meta: SessionMetadata): Promise<SessionMetadata> {
    if (this.cache.has(meta.session_id)) {
      throw new ConflictError(`Session ${meta.session_id} already exists`);
    }

    if (this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO sessions
            (session_id, session_root_event_id, studio_address, studio_policy_version,
             work_mandate_id, task_type, agent_address, status, started_at,
             completed_at, event_count, epoch, workflow_id, data_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            meta.session_id, meta.session_root_event_id,
            meta.studio_address, meta.studio_policy_version,
            meta.work_mandate_id, meta.task_type, meta.agent_address,
            meta.status, meta.started_at, meta.completed_at,
            meta.event_count, meta.epoch, meta.workflow_id, meta.data_hash,
          ],
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('duplicate key')) {
          throw new ConflictError(`Session ${meta.session_id} already exists`);
        }
        throw err;
      }
    }

    this.cache.set(meta.session_id, { ...meta });
    this.eventsCache.set(meta.session_id, []);
    return meta;
  }

  async get(sessionId: string): Promise<SessionMetadata | undefined> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    if (this.pool) {
      const result = await this.pool.query(
        `SELECT * FROM sessions WHERE session_id = $1`, [sessionId],
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const meta = this.rowToMeta(row);
        this.cache.set(sessionId, meta);
        return meta;
      }
    }

    return undefined;
  }

  async updateStatus(
    sessionId: string,
    status: SessionStatus,
    completedAt?: string,
    extra?: { workflow_id?: string; data_hash?: string },
  ): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    session.status = status;
    if (completedAt) session.completed_at = completedAt;
    if (extra?.workflow_id) session.workflow_id = extra.workflow_id;
    if (extra?.data_hash) session.data_hash = extra.data_hash;

    if (this.pool) {
      await this.pool.query(
        `UPDATE sessions
         SET status = $2, completed_at = $3, workflow_id = $4, data_hash = $5
         WHERE session_id = $1`,
        [sessionId, session.status, session.completed_at, session.workflow_id, session.data_hash],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // List (paginated)
  // ---------------------------------------------------------------------------

  async list(opts: {
    limit?: number;
    offset?: number;
    status?: SessionStatus;
    studio_address?: string;
    agent_address?: string;
  } = {}): Promise<ListSessionsResult> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);

    if (this.pool) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (opts.status) {
        conditions.push(`status = $${paramIdx++}`);
        values.push(opts.status);
      }
      if (opts.studio_address) {
        conditions.push(`studio_address = $${paramIdx++}`);
        values.push(opts.studio_address);
      }
      if (opts.agent_address) {
        conditions.push(`agent_address = $${paramIdx++}`);
        values.push(opts.agent_address);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await this.pool.query(
        `SELECT COUNT(*) AS total FROM sessions ${where}`,
        values,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const dataResult = await this.pool.query(
        `SELECT session_id, status, epoch, agent_address, studio_address,
                COALESCE(created_at, started_at) AS created_at, event_count
         FROM sessions ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        [...values, limit, offset],
      );

      const sessions: SessionListItem[] = dataResult.rows.map((row) => ({
        session_id: String(row.session_id),
        status: String(row.status) as SessionStatus,
        epoch: row.epoch != null ? Number(row.epoch) : null,
        agent_address: String(row.agent_address),
        studio_address: String(row.studio_address),
        created_at: row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
        node_count: Number(row.event_count),
      }));

      return { sessions, total };
    }

    // In-memory fallback (unit tests)
    let all = Array.from(this.cache.values());

    if (opts.status) all = all.filter((s) => s.status === opts.status);
    if (opts.studio_address) all = all.filter((s) => s.studio_address === opts.studio_address);
    if (opts.agent_address) all = all.filter((s) => s.agent_address === opts.agent_address);

    all.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

    const total = all.length;
    const page = all.slice(offset, offset + limit);

    const sessions: SessionListItem[] = page.map((s) => ({
      session_id: s.session_id,
      status: s.status,
      epoch: s.epoch,
      agent_address: s.agent_address,
      studio_address: s.studio_address,
      created_at: s.started_at,
      node_count: s.event_count,
    }));

    return { sessions, total };
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  async appendEvents(sessionId: string, incoming: CodingSessionEvent[]): Promise<CodingSessionEvent[]> {
    const session = await this.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    const bucket = this.eventsCache.get(sessionId) ?? [];
    if (!this.eventsCache.has(sessionId)) this.eventsCache.set(sessionId, bucket);

    const now = new Date().toISOString();
    const added: CodingSessionEvent[] = [];

    for (const evt of incoming) {
      const cloned: CodingSessionEvent = structuredClone(evt);

      if (!cloned.event_id) {
        cloned.event_id = `evt_${randomUUID().replace(/-/g, '')}`;
      }

      const stored: StoredEvent = { received_at: now, event: cloned };
      bucket.push(stored);
      added.push(cloned);

      if (this.pool) {
        await this.pool.query(
          `INSERT INTO session_events (session_id, event_id, event_type, received_at, event_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, cloned.event_id, cloned.event_type, now, JSON.stringify(cloned)],
        );
      }

      // Root detection — assign exactly once
      if (session.session_root_event_id !== null) continue;
      const parents = cloned.causality?.parent_event_ids;
      if (!parents || parents.length === 0) {
        session.session_root_event_id = cloned.event_id;
      }
    }

    session.event_count = bucket.length;

    if (this.pool) {
      await this.pool.query(
        `UPDATE sessions SET event_count = $2, session_root_event_id = $3 WHERE session_id = $1`,
        [sessionId, session.event_count, session.session_root_event_id],
      );
    }

    return added;
  }

  async getEvents(sessionId: string): Promise<CodingSessionEvent[]> {
    const session = await this.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    // If cache has events, use them
    const cached = this.eventsCache.get(sessionId);
    if (cached && cached.length > 0) {
      return sortStored(cached).map((s) => s.event);
    }

    // Lazy-load from Postgres on cache miss
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT event_id, event_type, received_at, event_payload
         FROM session_events
         WHERE session_id = $1
         ORDER BY (event_payload->>'timestamp')::timestamptz ASC, received_at ASC`,
        [sessionId],
      );
      const loaded: StoredEvent[] = result.rows.map((row) => ({
        received_at: String(row.received_at),
        event: row.event_payload as unknown as CodingSessionEvent,
      }));
      this.eventsCache.set(sessionId, loaded);
      return loaded.map((s) => s.event);
    }

    return [];
  }

  async getStoredEvents(sessionId: string): Promise<StoredEvent[]> {
    const session = await this.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    const cached = this.eventsCache.get(sessionId);
    if (cached && cached.length > 0) {
      return sortStored(cached);
    }

    if (this.pool) {
      const result = await this.pool.query(
        `SELECT event_id, event_type, received_at, event_payload
         FROM session_events
         WHERE session_id = $1
         ORDER BY (event_payload->>'timestamp')::timestamptz ASC, received_at ASC`,
        [sessionId],
      );
      const loaded: StoredEvent[] = result.rows.map((row) => ({
        received_at: String(row.received_at),
        event: row.event_payload as unknown as CodingSessionEvent,
      }));
      this.eventsCache.set(sessionId, loaded);
      return loaded;
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Evidence DAG materialisation (1 event → 1 node, deterministic)
  // ---------------------------------------------------------------------------

  async materializeDAG(sessionId: string): Promise<EvidenceDAG> {
    const events = await this.getEvents(sessionId);

    let terminalWorkerNodeId: string | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (TERMINAL_EVENT_TYPES.has(events[i].event_type)) {
        terminalWorkerNodeId = events[i].event_id;
        break;
      }
    }

    const nodes: EvidenceNode[] = events.map((evt) => {
      let parentIds = evt.causality.parent_event_ids ?? [];

      if (
        parentIds.length === 0 &&
        VERIFIER_EVENT_TYPES.has(evt.event_type) &&
        terminalWorkerNodeId !== null
      ) {
        parentIds = [terminalWorkerNodeId];
      }

      return {
        node_id: evt.event_id,
        event_id: evt.event_id,
        session_id: sessionId,
        event_type: evt.event_type,
        agent_address: evt.agent.agent_address,
        timestamp: evt.timestamp,
        parent_ids: parentIds,
        payload_hash: '0x' + createHash('sha256').update(JSON.stringify(evt)).digest('hex'),
        summary: evt.summary,
        artifacts: evt.artifacts ?? [],
        metadata: evt.metadata ?? {},
        metrics: evt.metrics,
      };
    });

    const edges: EvidenceEdge[] = [];
    for (const node of nodes) {
      for (const parentId of node.parent_ids) {
        edges.push({
          parent_node_id: parentId,
          child_node_id: node.node_id,
          relation: 'causal',
        });
      }
    }

    const childSet = new Set(edges.map((e) => e.child_node_id));
    const parentSet = new Set(edges.map((e) => e.parent_node_id));
    const nodeIds = nodes.map((n) => n.node_id);

    const roots = nodeIds.filter((id) => !childSet.has(id));
    const terminals = nodeIds.filter((id) => !parentSet.has(id));

    const sortedHashes = nodes.map((n) => n.payload_hash).sort();
    const merkle_root =
      '0x' + createHash('sha256').update(sortedHashes.join('')).digest('hex');

    return { nodes, edges, roots, terminals, merkle_root };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rowToMeta(row: Record<string, unknown>): SessionMetadata {
    return {
      session_id: String(row.session_id),
      session_root_event_id: row.session_root_event_id ? String(row.session_root_event_id) : null,
      studio_address: String(row.studio_address),
      studio_policy_version: String(row.studio_policy_version),
      work_mandate_id: String(row.work_mandate_id),
      task_type: String(row.task_type),
      agent_address: String(row.agent_address),
      status: String(row.status) as SessionStatus,
      started_at: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
      completed_at: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)) : null,
      event_count: Number(row.event_count),
      epoch: row.epoch != null ? Number(row.epoch) : null,
      workflow_id: row.workflow_id ? String(row.workflow_id) : null,
      data_hash: row.data_hash ? String(row.data_hash) : null,
    };
  }
}

// =============================================================================
// Sorting helper (shared between cache and DB paths)
// =============================================================================

function sortStored(stored: StoredEvent[]): StoredEvent[] {
  return [...stored].sort((a, b) => {
    const ta = new Date(a.event.timestamp).getTime();
    const tb = new Date(b.event.timestamp).getTime();
    if (ta !== tb) return ta - tb;
    return new Date(a.received_at).getTime() - new Date(b.received_at).getTime();
  });
}

// =============================================================================
// Error helpers
// =============================================================================

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
