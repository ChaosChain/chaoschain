/**
 * OpenAPI Spec Sync Test
 *
 * Ensures the openapi.yaml stays in sync with the actual Express routes.
 * If a route is added/removed in code but not reflected in the spec, this test fails.
 *
 * Two checks:
 *   1. Every route registered in Express exists in the OpenAPI spec
 *   2. Every path in the OpenAPI spec corresponds to a real route
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Router } from 'express';
import { createRoutes } from '../../src/http/routes.js';
import { createPublicApiRoutes } from '../../src/routes/public-api.js';
import { ReputationReader } from '../../src/services/reputation-reader.js';

// =============================================================================
// Helpers
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SPEC_PATH = resolve(__dirname, '../../openapi.yaml');

/** Extract paths from openapi.yaml without a YAML parser */
function extractSpecPaths(yamlContent: string): Set<string> {
  const paths = new Set<string>();
  const lines = yamlContent.split('\n');
  let inPaths = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Track top-level sections (no indentation)
    if (/^\S/.test(trimmed) && !trimmed.startsWith('#')) {
      inPaths = trimmed === 'paths:';
      continue;
    }

    if (!inPaths) continue;

    // Skip comments and blank lines
    if (trimmed === '' || /^\s*#/.test(trimmed)) continue;

    // Path entries are indented exactly 2 spaces and start with /
    const match = trimmed.match(/^  (\/\S+):$/);
    if (match) {
      paths.add(match[1]);
    }
  }
  return paths;
}

/** Extract methods for each path from the spec */
function extractSpecMethods(yamlContent: string): Map<string, Set<string>> {
  const pathMethods = new Map<string, Set<string>>();
  const lines = yamlContent.split('\n');
  let inPaths = false;
  let currentPath = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (/^\S/.test(trimmed) && !trimmed.startsWith('#')) {
      inPaths = trimmed === 'paths:';
      if (!inPaths) currentPath = '';
      continue;
    }

    if (!inPaths) continue;
    if (trimmed === '' || /^\s*#/.test(trimmed)) continue;

    const pathMatch = trimmed.match(/^  (\/\S+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      if (!pathMethods.has(currentPath)) {
        pathMethods.set(currentPath, new Set());
      }
      continue;
    }

    const methodMatch = trimmed.match(/^    (get|post|put|delete|patch):$/);
    if (methodMatch && currentPath) {
      pathMethods.get(currentPath)!.add(methodMatch[1].toUpperCase());
    }
  }
  return pathMethods;
}

/**
 * Walk an Express app/router and extract all registered routes.
 * Returns entries like { method: 'GET', path: '/v1/agent/:id/reputation' }
 */
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
        const routerPrefix = layer.keys?.length
          ? prefix + layer.regexp?.source?.replace(/\\\//g, '/').replace(/\?\(\?=.*$/, '') || ''
          : prefix;
        walkStack(layer.handle.stack, routerPrefix);
      }
    }
  }

  walkStack(app._router?.stack || [], '');
  return routes;
}

/** Convert Express :param to OpenAPI {param} */
function expressToOpenAPIPath(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z_]+)/g, '{$1}');
}

// =============================================================================
// Minimal mocks — we only need the routers to register, not to run
// =============================================================================

const nullLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const mockEngine = {
  createWorkflow: async () => {},
  startWorkflow: async () => {},
} as any;

const mockPersistence = {
  load: async () => null,
  findByTypeAndState: async () => [],
  findActiveWorkflows: async () => [],
  findByStudio: async () => [],
} as any;

const mockReputationReader = {
  agentExists: async () => false,
  getReputation: async () => ({}),
  resolveAddress: async () => null,
} as unknown as ReputationReader;

// =============================================================================
// Tests
// =============================================================================

describe('OpenAPI Spec Sync', () => {
  let specPaths: Set<string>;
  let specMethods: Map<string, Set<string>>;
  let expressRoutes: Array<{ method: string; path: string }>;

  beforeAll(() => {
    // Parse spec
    const yamlContent = readFileSync(SPEC_PATH, 'utf-8');
    specPaths = extractSpecPaths(yamlContent);
    specMethods = extractSpecMethods(yamlContent);

    // Build Express app with all routers
    const app = express();
    app.use(express.json());

    const workflowRouter = createRoutes(mockEngine, mockPersistence, nullLogger);
    app.use(workflowRouter);

    const publicRouter = createPublicApiRoutes({
      reputationReader: mockReputationReader,
      network: 'test',
      identityRegistryAddress: '0x0000000000000000000000000000000000000000',
      reputationRegistryAddress: '0x0000000000000000000000000000000000000000',
    });
    app.use(publicRouter);

    // Note: Admin routes require a real pg Pool, so we skip them here
    // and verify admin paths exist in the spec manually below.

    expressRoutes = extractExpressRoutes(app);
  });

  it('every Express route should exist in the OpenAPI spec', () => {
    const missing: string[] = [];

    for (const route of expressRoutes) {
      const openApiPath = expressToOpenAPIPath(route.path);

      // Skip the root health if it's the shadowed public-api one
      // (routes.ts /health takes precedence, which IS in the spec)
      if (specPaths.has(openApiPath)) continue;

      missing.push(`${route.method} ${openApiPath}`);
    }

    if (missing.length > 0) {
      console.log('Routes in Express but NOT in OpenAPI spec:');
      missing.forEach((r) => console.log(`  - ${r}`));
    }

    expect(missing).toEqual([]);
  });

  it('every OpenAPI spec path should correspond to a real Express route or be an admin/comment path', () => {
    const expressOpenApiPaths = new Set(
      expressRoutes.map((r) => expressToOpenAPIPath(r.path))
    );

    // Admin paths are not registered in our test app (requires pg Pool)
    const knownAdminPaths = new Set([
      '/admin/keys',
      '/admin/keys/{key}',
      '/admin/seed-demo',
    ]);

    const orphaned: string[] = [];

    for (const specPath of specPaths) {
      if (expressOpenApiPaths.has(specPath)) continue;
      if (knownAdminPaths.has(specPath)) continue;

      orphaned.push(specPath);
    }

    if (orphaned.length > 0) {
      console.log('Paths in OpenAPI spec but NOT registered in Express:');
      orphaned.forEach((p) => console.log(`  - ${p}`));
    }

    expect(orphaned).toEqual([]);
  });

  it('HTTP methods should match between spec and Express for each path', () => {
    const mismatches: string[] = [];

    for (const route of expressRoutes) {
      const openApiPath = expressToOpenAPIPath(route.path);
      const specMethodsForPath = specMethods.get(openApiPath);

      if (!specMethodsForPath) continue; // Covered by the "every route should exist" test

      if (!specMethodsForPath.has(route.method)) {
        mismatches.push(`${route.method} ${openApiPath} exists in Express but spec only has: ${[...specMethodsForPath].join(', ')}`);
      }
    }

    if (mismatches.length > 0) {
      console.log('Method mismatches:');
      mismatches.forEach((m) => console.log(`  - ${m}`));
    }

    expect(mismatches).toEqual([]);
  });

  it('admin paths should exist in the spec', () => {
    const adminPaths = [
      { method: 'POST', path: '/admin/keys' },
      { method: 'GET', path: '/admin/keys' },
      { method: 'DELETE', path: '/admin/keys/{key}' },
      { method: 'POST', path: '/admin/seed-demo' },
    ];

    const missing: string[] = [];
    for (const { method, path } of adminPaths) {
      const methods = specMethods.get(path);
      if (!methods || !methods.has(method)) {
        missing.push(`${method} ${path}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
