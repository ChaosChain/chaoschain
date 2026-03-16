/**
 * OpenAPI Spec Sync Test
 *
 * Ensures the openapi.yaml stays in sync with the actual Express routes.
 * If a route is added/removed in code but not reflected in the spec, this test fails.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createRoutes } from '../../src/http/routes.js';
import { createPublicApiRoutes } from '../../src/routes/public-api.js';
import { ReputationReader } from '../../src/services/reputation-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '../../openapi.yaml');

// Admin routes require a pg Pool so we can't register them in the test app.
// We verify they exist in the spec via a hardcoded list instead.
const ADMIN_PATHS = new Set([
  '/admin/keys',
  '/admin/keys/{key}',
  '/admin/seed-demo',
]);

// =============================================================================
// YAML parser (no library — works because the YAML is consistently formatted)
// =============================================================================

/**
 * Single-pass extraction of paths and their HTTP methods from the `paths:` section.
 * Assumes: path keys at 2-space indent, method keys at 4-space indent, unquoted or quoted.
 */
function extractSpecMethods(yamlContent: string): Map<string, Set<string>> {
  const pathMethods = new Map<string, Set<string>>();
  let inPaths = false;
  let currentPath = '';

  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trimEnd();

    // Detect top-level sections
    if (/^\S/.test(trimmed) && !trimmed.startsWith('#')) {
      inPaths = trimmed === 'paths:';
      continue;
    }

    if (!inPaths || trimmed === '' || /^\s*#/.test(trimmed)) continue;

    // Path entry: 2-space indent, optionally quoted, e.g. `  /v1/work/{hash}:`
    const pathMatch = trimmed.match(/^  ['"]?(\/\S+?)['"]?:$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      if (!pathMethods.has(currentPath)) pathMethods.set(currentPath, new Set());
      continue;
    }

    // Method entry: 4-space indent, e.g. `    get:`
    const methodMatch = trimmed.match(/^    ([a-z]+):$/);
    if (methodMatch && currentPath) {
      pathMethods.get(currentPath)!.add(methodMatch[1].toUpperCase());
    }
  }

  if (pathMethods.size === 0) {
    throw new Error('YAML parser found no paths — spec format may have changed');
  }

  return pathMethods;
}

// =============================================================================
// Express route extraction
// =============================================================================

function extractExpressRoutes(app: express.Express): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];

  function walkStack(stack: any[], prefix: string) {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walkStack(layer.handle.stack, prefix);
      }
    }
  }

  walkStack(app._router?.stack || [], '');
  return routes;
}

/** Convert Express `:param` to OpenAPI `{param}` */
function expressToOpenAPIPath(path: string): string {
  return path.replace(/:([a-zA-Z_]+)/g, '{$1}');
}

// =============================================================================
// Minimal mocks — we only need routers to register, not to run
// =============================================================================

const nullLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
const mockEngine = { createWorkflow: async () => {}, startWorkflow: async () => {} } as any;
const mockPersistence = {
  load: async () => null,
  findByTypeAndState: async () => [],
  findActiveWorkflows: async () => [],
  findByStudio: async () => [],
} as any;

// =============================================================================
// Tests
// =============================================================================

describe('OpenAPI Spec Sync', () => {
  let specPaths: Set<string>;
  let specMethods: Map<string, Set<string>>;
  let expressRoutes: Array<{ method: string; path: string }>;

  beforeAll(() => {
    const yamlContent = readFileSync(SPEC_PATH, 'utf-8');
    specMethods = extractSpecMethods(yamlContent);
    specPaths = new Set(specMethods.keys());

    const app = express();
    app.use(express.json());
    app.use(createRoutes(mockEngine, mockPersistence, nullLogger));
    app.use(createPublicApiRoutes({
      reputationReader: { agentExists: async () => false, getReputation: async () => ({}), resolveAddress: async () => null } as unknown as ReputationReader,
      network: 'test',
      identityRegistryAddress: '0x0000000000000000000000000000000000000000',
      reputationRegistryAddress: '0x0000000000000000000000000000000000000000',
    }));

    expressRoutes = extractExpressRoutes(app);
  });

  it('every Express route should exist in the OpenAPI spec', () => {
    const missing = expressRoutes
      .map((r) => ({ label: `${r.method} ${expressToOpenAPIPath(r.path)}`, path: expressToOpenAPIPath(r.path) }))
      .filter((r) => !specPaths.has(r.path))
      .map((r) => r.label);

    expect(missing).toEqual([]);
  });

  it('every OpenAPI spec path should have a matching Express route or be a known admin path', () => {
    const expressPaths = new Set(expressRoutes.map((r) => expressToOpenAPIPath(r.path)));
    const orphaned = [...specPaths].filter((p) => !expressPaths.has(p) && !ADMIN_PATHS.has(p));

    expect(orphaned).toEqual([]);
  });

  it('HTTP methods should match between spec and Express for each path', () => {
    const mismatches = expressRoutes
      .filter((r) => {
        const methods = specMethods.get(expressToOpenAPIPath(r.path));
        return methods && !methods.has(r.method);
      })
      .map((r) => `${r.method} ${expressToOpenAPIPath(r.path)} not in spec (has: ${[...specMethods.get(expressToOpenAPIPath(r.path))!].join(', ')})`);

    expect(mismatches).toEqual([]);
  });

  it('admin paths should exist in the spec with correct methods', () => {
    const adminRoutes = [
      { method: 'POST', path: '/admin/keys' },
      { method: 'GET', path: '/admin/keys' },
      { method: 'DELETE', path: '/admin/keys/{key}' },
      { method: 'POST', path: '/admin/seed-demo' },
    ];

    const missing = adminRoutes
      .filter(({ method, path }) => !specMethods.get(path)?.has(method))
      .map(({ method, path }) => `${method} ${path}`);

    expect(missing).toEqual([]);
  });
});
