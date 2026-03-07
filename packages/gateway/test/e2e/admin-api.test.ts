import { describe, it, expect, beforeAll } from 'vitest';
import { GATEWAY_URL, ADMIN_KEY, getAddresses } from './helpers';

let studioProxy: string;

beforeAll(async () => {
  const res = await fetch(`${GATEWAY_URL}/health`);
  expect(res.status).toBe(200);
  studioProxy = getAddresses().STUDIO_PROXY;
});

describe('Admin API E2E', () => {
  // ─── Auth ──────────────────────────────────────────────────────────────

  describe('Admin auth', () => {
    it('rejects requests without admin key', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('rejects requests with wrong admin key', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Key Lifecycle ─────────────────────────────────────────────────────

  describe('Key lifecycle (create → list → revoke)', () => {
    let createdKey: string;

    it('creates a new API key', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ADMIN_KEY,
        },
        body: JSON.stringify({ name: 'e2e-test-key', role: 'verifier' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.key).toBeDefined();
      expect(body.key).toContain('cc_verifier_');
      expect(body.name).toBe('e2e-test-key');
      expect(body.role).toBe('verifier');
      createdKey = body.key;
    });

    it('lists active keys including the new one', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        headers: { 'x-api-key': ADMIN_KEY },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toBeDefined();
      expect(body.total).toBeGreaterThan(0);

      const found = body.keys.find(
        (k: { name: string }) => k.name === 'e2e-test-key',
      );
      expect(found).toBeDefined();
      expect(found.role).toBe('verifier');
    });

    it('revokes the key', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys/${createdKey}`, {
        method: 'DELETE',
        headers: { 'x-api-key': ADMIN_KEY },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revoked).toBe(true);
    });

    it('key no longer appears in list after revocation', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        headers: { 'x-api-key': ADMIN_KEY },
      });

      const body = await res.json();
      const found = body.keys.find(
        (k: { name: string }) => k.name === 'e2e-test-key',
      );
      expect(found).toBeUndefined();
    });

    it('returns 404 when revoking already-revoked key', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys/${createdKey}`, {
        method: 'DELETE',
        headers: { 'x-api-key': ADMIN_KEY },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('KEY_NOT_FOUND');
    });
  });

  // ─── Key Creation Validation ───────────────────────────────────────────

  describe('Key creation validation', () => {
    it('returns 400 when name is missing', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ADMIN_KEY,
        },
        body: JSON.stringify({ role: 'agent' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_REQUEST');
    });

    it('defaults to verifier role when role is invalid', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ADMIN_KEY,
        },
        body: JSON.stringify({ name: 'e2e-default-role', role: 'invalid' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.role).toBe('verifier');
      expect(body.key).toContain('cc_verifier_');

      // Cleanup
      await fetch(`${GATEWAY_URL}/admin/keys/${body.key}`, {
        method: 'DELETE',
        headers: { 'x-api-key': ADMIN_KEY },
      });
    });

    it('creates keys with agent role prefix', async () => {
      const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ADMIN_KEY,
        },
        body: JSON.stringify({ name: 'e2e-agent-key', role: 'agent' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.key).toContain('cc_agent_');

      // Cleanup
      await fetch(`${GATEWAY_URL}/admin/keys/${body.key}`, {
        method: 'DELETE',
        headers: { 'x-api-key': ADMIN_KEY },
      });
    });
  });

  // ─── Seed Demo ─────────────────────────────────────────────────────────

  describe('POST /admin/seed-demo', () => {
    it('seeds demo workflows and they appear in public API', async () => {
      const demoStudio = '0xA855F7893ac01653D1bCC24210bFbb3c47324649';

      const seedRes = await fetch(`${GATEWAY_URL}/admin/seed-demo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ADMIN_KEY,
        },
        body: JSON.stringify({ studio_address: demoStudio }),
      });

      expect(seedRes.status).toBe(201);
      const seedBody = await seedRes.json();
      expect(seedBody.seeded).toBe(3);
      expect(seedBody.sessions).toHaveLength(3);

      // Verify seeded data appears in public API
      const workRes = await fetch(
        `${GATEWAY_URL}/v1/studio/${demoStudio}/work`,
      );
      expect(workRes.status).toBe(200);
      const workBody = await workRes.json();
      expect(workBody.data).toBeDefined();
    });
  });
});
