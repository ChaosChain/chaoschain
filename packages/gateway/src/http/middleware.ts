/**
 * HTTP Middleware — Auth & Rate Limiting
 *
 * API key authentication is applied ONLY to write (POST) workflow endpoints.
 * Rate limiting uses an in-memory sliding window per IP.
 */

import { Request, Response, NextFunction } from 'express';

// =============================================================================
// API KEY AUTHENTICATION
// =============================================================================

export interface ApiKeyAuthConfig {
  keys: Set<string>;
}

/**
 * Middleware that validates `x-api-key` header against a set of allowed keys.
 * Returns 401 if missing or invalid.
 */
export function apiKeyAuth(config: ApiKeyAuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.headers['x-api-key'];

    if (!key || typeof key !== 'string' || !config.keys.has(key)) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid or missing API key',
      });
      return;
    }

    next();
  };
}

/**
 * Parse CHAOSCHAIN_API_KEYS env var into a Set of keys.
 * Returns an empty set if not configured.
 */
export function parseApiKeys(envValue?: string): Set<string> {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  );
}

// =============================================================================
// RATE LIMITING (in-memory, per-IP, sliding window)
// =============================================================================

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export class InMemoryRateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private config: RateLimitConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.cleanupInterval = setInterval(() => this.cleanup(), config.windowMs);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  isAllowed(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    let entry = this.store.get(ip);

    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(ip, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.config.maxRequests) {
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }

  destroy(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.config.windowMs;
    for (const [ip, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) this.store.delete(ip);
    }
  }
}

/**
 * Express middleware factory for rate limiting.
 */
export function rateLimit(limiter: InMemoryRateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    if (!limiter.isAllowed(ip)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
      return;
    }

    next();
  };
}
