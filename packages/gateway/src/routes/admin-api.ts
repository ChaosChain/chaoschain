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
}

export function createAdminRoutes(config: AdminApiConfig): Router {
  const router = Router();
  const { keyStore } = config;
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

  return router;
}
