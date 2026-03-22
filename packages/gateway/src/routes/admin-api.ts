/**
 * Admin API Routes
 *
 * Key management for the gateway. Protected by a single ADMIN_KEY.
 *
 *   POST /admin/keys         — generate a new API key
 *   GET  /admin/keys         — list all active keys (names only, not secrets)
 *   DELETE /admin/keys/:key  — revoke a key
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Pool } from 'pg';

// =============================================================================
// TYPES
// =============================================================================

export type KeyRole = 'verifier' | 'agent' | 'internal';

const VALID_ROLES: KeyRole[] = ['verifier', 'agent', 'internal'];

const ROLE_PREFIX: Record<KeyRole, string> = {
  verifier: 'cc_verifier_',
  agent: 'cc_agent_',
  internal: 'cc_internal_',
};

export interface ApiKeyRecord {
  key: string;
  name: string;
  role: KeyRole;
  created_at: string;
}

// =============================================================================
// KEY STORE (Postgres-backed, in-memory cache)
// =============================================================================

export class ApiKeyStore {
  private pool: Pool;
  private cache: Set<string> = new Set();

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        revoked BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_role ON api_keys (role) WHERE NOT revoked;
    `);

    const result = await this.pool.query(
      `SELECT key FROM api_keys WHERE NOT revoked`,
    );
    for (const row of result.rows) {
      this.cache.add(row.key as string);
    }
  }

  /** Seed keys from CHAOSCHAIN_API_KEYS env var (idempotent). */
  async seedFromEnv(envValue: string | undefined): Promise<void> {
    if (!envValue) return;
    const keys = envValue.split(',').map((k) => k.trim()).filter(Boolean);
    for (const key of keys) {
      if (this.cache.has(key)) continue;
      await this.pool.query(
        `INSERT INTO api_keys (key, name, role) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
        [key, 'env-seed', 'internal'],
      );
      this.cache.add(key);
    }
  }

  generate(name: string, role: KeyRole): string {
    const random = crypto.randomBytes(16).toString('hex');
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 20);
    return `${ROLE_PREFIX[role]}${slug}_${random}`;
  }

  async create(key: string, name: string, role: KeyRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_keys (key, name, role) VALUES ($1, $2, $3)`,
      [key, name, role],
    );
    this.cache.add(key);
  }

  async revoke(key: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE api_keys SET revoked = TRUE WHERE key = $1 AND NOT revoked`,
      [key],
    );
    this.cache.delete(key);
    return (result.rowCount ?? 0) > 0;
  }

  async list(): Promise<Array<{ name: string; role: string; created_at: string; prefix: string }>> {
    const result = await this.pool.query(
      `SELECT name, role, created_at, LEFT(key, 20) AS prefix FROM api_keys WHERE NOT revoked ORDER BY created_at DESC`,
    );
    return result.rows.map((r) => ({
      name: r.name as string,
      role: r.role as string,
      created_at: (r.created_at as Date).toISOString(),
      prefix: `${r.prefix as string}...`,
    }));
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** Return the cache as a Set for use with existing middleware. */
  asSet(): Set<string> {
    return this.cache;
  }
}

// =============================================================================
// ADMIN AUTH MIDDLEWARE
// =============================================================================

function adminAuth(adminKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.headers['x-api-key'];
    if (!key || key !== adminKey) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Admin key required',
      });
      return;
    }
    next();
  };
}

// =============================================================================
// ROUTES
// =============================================================================

export interface AdminApiConfig {
  adminKey: string;
  keyStore: ApiKeyStore;
  pool: Pool;
}

export function createAdminRoutes(config: AdminApiConfig): Router {
  const router = Router();
  const { keyStore, pool } = config;
  const requireAdmin = adminAuth(config.adminKey);

  // POST /admin/keys — generate a new key
  router.post('/admin/keys', requireAdmin, async (req: Request, res: Response) => {
    const { name, role } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        error: 'INVALID_REQUEST',
        message: '"name" is required (string)',
      });
      return;
    }

    const resolvedRole: KeyRole = VALID_ROLES.includes(role) ? role : 'verifier';

    try {
      const key = keyStore.generate(name.trim(), resolvedRole);
      await keyStore.create(key, name.trim(), resolvedRole);

      res.status(201).json({
        key,
        name: name.trim(),
        role: resolvedRole,
        message: 'Add this key to your CHAOSCHAIN_API_KEYS env var or share it with the team. It is already active.',
      });
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to create key',
      });
    }
  });

  // GET /admin/keys — list active keys (names + prefixes only)
  router.get('/admin/keys', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const keys = await keyStore.list();
      res.json({ keys, total: keys.length });
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to list keys',
      });
    }
  });

  // DELETE /admin/keys/:key — revoke a key
  router.delete('/admin/keys/:key', requireAdmin, async (req: Request, res: Response) => {
    const key = req.params.key;
    try {
      const revoked = await keyStore.revoke(key);
      if (!revoked) {
        res.status(404).json({
          error: 'KEY_NOT_FOUND',
          message: 'Key not found or already revoked',
        });
        return;
      }
      res.json({ revoked: true });
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to revoke key',
      });
    }
  });

  // POST /admin/seed-demo — insert demo workflow records for testing
  router.post('/admin/seed-demo', requireAdmin, async (req: Request, res: Response) => {
    const studioAddress = (req.body?.studio_address as string)
      ?? '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';

    try {
      const now = Date.now();
      const sessions = [
        {
          name: 'devin-session-001',
          agent: 'Devin',
          task: 'Refactor authentication middleware to support JWT verification and role-based access control',
          repo: 'github.com/acme-corp/enterprise-api',
          epoch: 1,
          commits: [
            { sha: 'a1b2c3d', msg: 'Add JWT validation core logic', files: ['src/auth/jwt-validator.ts', 'src/auth/types.ts'], parents: [] },
            { sha: 'e4f5g6h', msg: 'Add role-based access control middleware', files: ['src/auth/middleware.ts', 'src/auth/rbac.ts'], parents: [] },
            { sha: 'i7j8k9l', msg: 'Add integration tests and fix edge cases', files: ['tests/auth/middleware.test.ts', 'tests/auth/rbac.test.ts'], parents: ['a1b2c3d', 'e4f5g6h'] },
          ],
        },
        {
          name: 'claude-code-session-001',
          agent: 'Claude Code',
          task: 'Optimize database query performance for the analytics dashboard',
          repo: 'github.com/acme-corp/data-pipeline',
          epoch: 2,
          commits: [
            { sha: 'b2c3d4e', msg: 'Add query result caching layer', files: ['src/db/cache.ts', 'src/db/query-builder.ts'], parents: [] },
            { sha: 'f5g6h7i', msg: 'Add database indexes for frequent query patterns', files: ['migrations/add_analytics_indexes.sql'], parents: [] },
            { sha: 'j8k9l0m', msg: 'Benchmark and validate performance improvements', files: ['tests/performance/dashboard.bench.ts'], parents: ['b2c3d4e', 'f5g6h7i'] },
          ],
        },
        {
          name: 'cursor-session-001',
          agent: 'Cursor',
          task: 'Add retry logic and circuit breaker to payment processor',
          repo: 'github.com/acme-corp/payments-service',
          epoch: 3,
          commits: [
            { sha: 'c3d4e5f', msg: 'Implement exponential backoff retry logic', files: ['src/payments/retry.ts'], parents: [] },
            { sha: 'g6h7i8j', msg: 'Add circuit breaker pattern', files: ['src/payments/circuit-breaker.ts', 'src/payments/processor.ts'], parents: ['c3d4e5f'] },
            { sha: 'k9l0m1n', msg: 'Add failure simulation tests', files: ['tests/payments/resilience.test.ts'], parents: ['g6h7i8j'] },
          ],
        },
      ];

      const inserted: string[] = [];

      for (const session of sessions) {
        const agentAddress = '0x' + crypto.randomBytes(20).toString('hex');
        const dataHash = '0x' + crypto.createHash('sha256')
          .update(`${session.name}-${studioAddress}-${session.epoch}`)
          .digest('hex');
        const threadRoot = '0x' + crypto.createHash('sha256')
          .update(`thread-${session.name}`)
          .digest('hex');
        const evidenceRoot = '0x' + crypto.createHash('sha256')
          .update(`evidence-${session.name}`)
          .digest('hex');

        const dkgEvidence = session.commits.map((c, i) => ({
          arweave_tx_id: `demo_${session.name}_${c.sha}`,
          author: agentAddress,
          timestamp: now - (session.commits.length - i) * 60_000,
          parent_ids: c.parents.map(p => `demo_${session.name}_${p}`),
          payload_hash: '0x' + crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex'),
          artifact_ids: c.files,
          signature: '0xdemo_signature',
        }));

        const workflowId = crypto.randomUUID();
        const createdAt = now - 3600_000 + session.epoch * 1000;

        await pool.query(`
          INSERT INTO workflows (id, type, created_at, updated_at, state, step, step_attempts, input, progress, error, signer)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING
        `, [
          workflowId,
          'WorkSubmission',
          createdAt,
          createdAt + 30_000,
          'COMPLETED',
          'REGISTER_WORK',
          0,
          JSON.stringify({
            studio_address: studioAddress,
            epoch: session.epoch,
            agent_address: agentAddress,
            data_hash: dataHash,
            dkg_evidence: dkgEvidence,
            signer_address: agentAddress,
          }),
          JSON.stringify({
            dkg_thread_root: threadRoot,
            dkg_evidence_root: evidenceRoot,
            arweave_tx_id: `demo_evidence_${session.name}`,
            arweave_confirmed: true,
            onchain_tx_hash: '0x' + crypto.randomBytes(32).toString('hex'),
            onchain_confirmed: true,
            register_tx_hash: '0x' + crypto.randomBytes(32).toString('hex'),
            register_confirmed: true,
            session_name: session.name,
            agent_name: session.agent,
            task: session.task,
            repository: session.repo,
          }),
          null,
          agentAddress,
        ]);

        inserted.push(`${session.agent} (${session.name}) → epoch ${session.epoch}`);
      }

      res.status(201).json({
        seeded: inserted.length,
        studio: studioAddress,
        sessions: inserted,
        query: `GET /v1/studio/${studioAddress}/work`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'SEED_FAILED', message: msg });
    }
  });

  return router;
}
