/**
 * Middleware — Unit Tests
 *
 * Tests for:
 *   - API key authentication (write endpoints only)
 *   - Rate limiting (per-IP, in-memory)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import {
  apiKeyAuth,
  parseApiKeys,
  rateLimit,
  InMemoryRateLimiter,
} from '../../src/http/middleware.js';

// =============================================================================
// Helpers
// =============================================================================

async function request(
  app: express.Express,
  opts: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    ip?: string;
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
// parseApiKeys
// =============================================================================

describe('parseApiKeys', () => {
  it('parses comma-separated keys', () => {
    const keys = parseApiKeys('key1,key2,key3');
    expect(keys.size).toBe(3);
    expect(keys.has('key1')).toBe(true);
    expect(keys.has('key2')).toBe(true);
    expect(keys.has('key3')).toBe(true);
  });

  it('trims whitespace', () => {
    const keys = parseApiKeys(' key1 , key2 ');
    expect(keys.has('key1')).toBe(true);
    expect(keys.has('key2')).toBe(true);
  });

  it('returns empty set for undefined', () => {
    expect(parseApiKeys(undefined).size).toBe(0);
  });

  it('returns empty set for empty string', () => {
    expect(parseApiKeys('').size).toBe(0);
  });
});

// =============================================================================
// API Key Auth
// =============================================================================

describe('apiKeyAuth middleware', () => {
  function buildAuthApp() {
    const app = express();
    app.use(express.json());

    const keys = new Set(['valid-key-1', 'valid-key-2']);

    // Protected write endpoint
    app.post('/workflows/work-submission', apiKeyAuth({ keys }), (_req, res) => {
      res.json({ ok: true });
    });

    // Unprotected read endpoint
    app.get('/v1/agent/1/reputation', (_req, res) => {
      res.json({ data: 'public' });
    });

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    return app;
  }

  it('allows request with valid API key', async () => {
    const app = buildAuthApp();
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/workflows/work-submission',
      headers: { 'x-api-key': 'valid-key-1' },
      body: {},
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('rejects request with invalid API key', async () => {
    const app = buildAuthApp();
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/workflows/work-submission',
      headers: { 'x-api-key': 'wrong-key' },
      body: {},
    });

    expect(status).toBe(401);
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.message).toBe('Invalid or missing API key');
  });

  it('rejects request with missing API key', async () => {
    const app = buildAuthApp();
    const { status, body } = await request(app, {
      method: 'POST',
      path: '/workflows/work-submission',
      body: {},
    });

    expect(status).toBe(401);
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('GET /v1/agent/1/reputation remains unauthenticated', async () => {
    const app = buildAuthApp();
    const { status, body } = await request(app, {
      path: '/v1/agent/1/reputation',
    });

    expect(status).toBe(200);
    expect(body.data).toBe('public');
  });

  it('GET /health remains unauthenticated', async () => {
    const app = buildAuthApp();
    const { status, body } = await request(app, {
      path: '/health',
    });

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });
});

// =============================================================================
// Rate Limiting
// =============================================================================

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;

  afterEach(() => {
    if (limiter) limiter.destroy();
  });

  it('allows requests within limit', () => {
    limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
  });

  it('blocks requests exceeding limit', () => {
    limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(false);
  });

  it('isolates different IPs', () => {
    limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(limiter.isAllowed('1.2.3.4')).toBe(true);
    expect(limiter.isAllowed('5.6.7.8')).toBe(true);
    expect(limiter.isAllowed('1.2.3.4')).toBe(false);
    expect(limiter.isAllowed('5.6.7.8')).toBe(false);
  });
});

describe('rateLimit middleware', () => {
  let limiter: InMemoryRateLimiter;

  afterEach(() => {
    if (limiter) limiter.destroy();
  });

  it('returns 429 when limit is exceeded', async () => {
    limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    const app = express();
    app.use(rateLimit(limiter));
    app.get('/test', (_req, res) => res.json({ ok: true }));

    const first = await request(app, { path: '/test' });
    expect(first.status).toBe(200);

    const second = await request(app, { path: '/test' });
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('public endpoints accessible within limit', async () => {
    limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 60 });

    const app = express();
    app.use(rateLimit(limiter));
    app.get('/v1/agent/1/reputation', (_req, res) => res.json({ data: 'ok' }));
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));

    const rep = await request(app, { path: '/v1/agent/1/reputation' });
    expect(rep.status).toBe(200);

    const health = await request(app, { path: '/health' });
    expect(health.status).toBe(200);
  });
});
