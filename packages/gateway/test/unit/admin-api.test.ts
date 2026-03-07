/**
 * Admin API — Unit Tests
 *
 * Tests for key management endpoints:
 *   POST /admin/keys
 *   GET  /admin/keys
 *   DELETE /admin/keys/:key
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createAdminRoutes, ApiKeyStore, KeyRole } from '../../src/routes/admin-api.js';

// =============================================================================
// Helpers
// =============================================================================

function createMockPool() {
  const rows: Array<Record<string, unknown>> = [];

  return {
    rows,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('CREATE TABLE')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('SELECT key FROM api_keys')) {
        return { rows: rows.filter((r) => !r.revoked).map((r) => ({ key: r.key })) };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO api_keys')) {
        const key = (params as string[])[0];
        const name = (params as string[])[1];
        const role = (params as string[])[2];
        rows.push({ key, name, role, created_at: new Date(), revoked: false });
        return { rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE api_keys SET revoked')) {
        const key = (params as string[])[0];
        const idx = rows.findIndex((r) => r.key === key && !r.revoked);
        if (idx >= 0) {
          rows[idx].revoked = true;
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('SELECT name, role')) {
        return {
          rows: rows
            .filter((r) => !r.revoked)
            .map((r) => ({
              name: r.name,
              role: r.role,
              created_at: r.created_at,
              prefix: (r.key as string).slice(0, 20),
            })),
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

async function request(
  app: express.Express,
  opts: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}${opts.path}`;
      fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers ?? {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
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
// Tests
// =============================================================================

describe('Admin API', () => {
  const ADMIN_KEY = 'cc_admin_test_secret';
  let mockPool: ReturnType<typeof createMockPool>;
  let keyStore: ApiKeyStore;
  let app: express.Express;

  beforeEach(async () => {
    mockPool = createMockPool();
    keyStore = new ApiKeyStore(mockPool as any);
    await keyStore.initialize();

    app = express();
    app.use(express.json());
    app.use(createAdminRoutes({ adminKey: ADMIN_KEY, keyStore }));
  });

  // =========================================================================
  // Auth
  // =========================================================================

  it('POST /admin/keys returns 401 without admin key', async () => {
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      body: { name: 'Test' },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('POST /admin/keys returns 401 with wrong admin key', async () => {
    const { status } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': 'wrong_key' },
      body: { name: 'Test' },
    });
    expect(status).toBe(401);
  });

  it('GET /admin/keys returns 401 without admin key', async () => {
    const { status } = await request(app, {
      path: '/admin/keys',
    });
    expect(status).toBe(401);
  });

  // =========================================================================
  // Key generation
  // =========================================================================

  it('POST /admin/keys creates a verifier key by default', async () => {
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: { name: 'Acme Verifier' },
    });
    expect(status).toBe(201);
    expect(body.role).toBe('verifier');
    expect((body.key as string).startsWith('cc_verifier_acme_verifier_')).toBe(true);
    expect((body.key as string).length).toBeGreaterThan(30);
  });

  it('POST /admin/keys creates agent key when role=agent', async () => {
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: { name: 'Devin Worker', role: 'agent' },
    });
    expect(status).toBe(201);
    expect((body.key as string).startsWith('cc_agent_')).toBe(true);
  });

  it('POST /admin/keys creates internal key when role=internal', async () => {
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: { name: 'Gateway Service', role: 'internal' },
    });
    expect(status).toBe(201);
    expect((body.key as string).startsWith('cc_internal_')).toBe(true);
  });

  it('POST /admin/keys returns 400 without name', async () => {
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_REQUEST');
  });

  it('newly generated key is immediately active in the store', async () => {
    const { body } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: { name: 'Active Test' },
    });

    expect(keyStore.has(body.key as string)).toBe(true);
    expect(keyStore.asSet().has(body.key as string)).toBe(true);
  });

  // =========================================================================
  // Key listing
  // =========================================================================

  it('GET /admin/keys returns list with names and prefixes', async () => {
    await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: { name: 'Team Alpha', role: 'verifier' },
    });

    const { status, body } = await request(app, {
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(status).toBe(200);
    const keys = body.keys as Array<Record<string, string>>;
    expect(keys.length).toBe(1);
    expect(keys[0].name).toBe('Team Alpha');
    expect(keys[0].role).toBe('verifier');
    expect(keys[0].prefix.endsWith('...')).toBe(true);
  });

  // =========================================================================
  // Key revocation
  // =========================================================================

  it('DELETE /admin/keys/:key revokes a key', async () => {
    const { body: created } = await request(app, {
      method: 'POST',
      path: '/admin/keys',
      headers: { 'x-api-key': ADMIN_KEY },
      body: { name: 'Revoke Me' },
    });

    const key = created.key as string;
    expect(keyStore.has(key)).toBe(true);

    const { status } = await request(app, {
      method: 'DELETE',
      path: `/admin/keys/${key}`,
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(status).toBe(200);
    expect(keyStore.has(key)).toBe(false);
  });

  it('DELETE /admin/keys/:key returns 404 for unknown key', async () => {
    const { status, body } = await request(app, {
      method: 'DELETE',
      path: '/admin/keys/cc_verifier_nonexistent',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(status).toBe(404);
    expect(body.error).toBe('KEY_NOT_FOUND');
  });

  // =========================================================================
  // Env seeding
  // =========================================================================

  it('seedFromEnv loads keys into the store', async () => {
    await keyStore.seedFromEnv('cc_internal_seed_one,cc_internal_seed_two');
    expect(keyStore.has('cc_internal_seed_one')).toBe(true);
    expect(keyStore.has('cc_internal_seed_two')).toBe(true);
  });

  // =========================================================================
  // Key prefix format
  // =========================================================================

  it('generated key has correct prefix format', () => {
    const key = keyStore.generate('My Test Team', 'verifier');
    expect(key).toMatch(/^cc_verifier_my_test_team_[a-f0-9]{32}$/);
  });

  it('generated key slugifies special characters', () => {
    const key = keyStore.generate('Acme Corp!!! @@@', 'agent');
    expect(key.startsWith('cc_agent_acme_corp_')).toBe(true);
    expect(key).toMatch(/^cc_agent_[a-z0-9_]+_[a-f0-9]{32}$/);
  });
});
