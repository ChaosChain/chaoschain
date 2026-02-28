/**
 * Public API Routes — Phase A + B
 *
 * Read-only endpoints for querying agent reputation and work data.
 * No authentication required. No state changes.
 *
 * These routes are independent of the workflow engine and do NOT
 * modify any existing workflow endpoints.
 */

import { Router, Request, Response } from 'express';
import { ReputationReader } from '../services/reputation-reader.js';
import { WorkDataReader } from '../services/work-data-reader.js';

const API_VERSION = '1.0';

export interface PublicApiConfig {
  reputationReader: ReputationReader;
  workDataReader?: WorkDataReader;
  network: string;
  identityRegistryAddress: string;
  reputationRegistryAddress: string;
}

export function createPublicApiRoutes(config: PublicApiConfig): Router {
  const router = Router();
  const { reputationReader, workDataReader } = config;

  // =========================================================================
  // GET /v1/agent/:id/reputation
  // =========================================================================

  router.get(
    '/v1/agent/:id/reputation',
    async (req: Request, res: Response) => {
      const rawId = req.params.id;
      const agentId = Number(rawId);

      if (!Number.isInteger(agentId) || agentId <= 0) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_AGENT_ID',
            message: 'agentId must be a positive integer',
          },
        });
        return;
      }

      try {
        const exists = await reputationReader.agentExists(agentId);
        if (!exists) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'AGENT_NOT_FOUND',
              message: `No agent registered with id ${agentId}`,
            },
          });
          return;
        }

        const data = await reputationReader.getReputation(agentId);

        if (workDataReader) {
          const address = await reputationReader.resolveAddress(agentId);
          if (address) {
            const workSummary = await workDataReader.getLatestWorkForAgent(address);
            if (workSummary) {
              data.evidence_anchor = workSummary.evidence_anchor;
              data.derivation_root = workSummary.derivation_root;
            }
          }
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown error';

        if (
          message.includes('could not detect network') ||
          message.includes('ECONNREFUSED') ||
          message.includes('timeout') ||
          message.includes('SERVER_ERROR')
        ) {
          res.status(503).json({
            version: API_VERSION,
            error: {
              code: 'CHAIN_UNAVAILABLE',
              message: 'Unable to reach the on-chain registry',
            },
          });
          return;
        }

        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/agent/:id/history
  // =========================================================================

  router.get(
    '/v1/agent/:id/history',
    async (req: Request, res: Response) => {
      const rawId = req.params.id;
      const agentId = Number(rawId);

      if (!Number.isInteger(agentId) || agentId <= 0) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_AGENT_ID',
            message: 'agentId must be a positive integer',
          },
        });
        return;
      }

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      try {
        const exists = await reputationReader.agentExists(agentId);
        if (!exists) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'AGENT_NOT_FOUND',
              message: `No agent registered with id ${agentId}`,
            },
          });
          return;
        }

        if (!workDataReader) {
          res.status(503).json({
            version: API_VERSION,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Work data service not configured',
            },
          });
          return;
        }

        const address = await reputationReader.resolveAddress(agentId);
        if (!address) {
          res.json({
            version: API_VERSION,
            data: { agent_id: agentId, entries: [], total: 0, limit, offset },
          });
          return;
        }

        const data = await workDataReader.getAgentHistory(address, agentId, limit, offset);
        res.json({ version: API_VERSION, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (
          message.includes('could not detect network') ||
          message.includes('ECONNREFUSED') ||
          message.includes('timeout') ||
          message.includes('SERVER_ERROR')
        ) {
          res.status(503).json({
            version: API_VERSION,
            error: {
              code: 'CHAIN_UNAVAILABLE',
              message: 'Unable to reach the on-chain registry',
            },
          });
          return;
        }

        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/work/:hash
  // =========================================================================

  router.get(
    '/v1/work/:hash',
    async (req: Request, res: Response) => {
      const hash = req.params.hash;

      if (!hash || !hash.startsWith('0x') || hash.length !== 66) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_WORK_ID',
            message: 'work_id must be a 0x-prefixed bytes32 hex string (66 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      try {
        const data = await workDataReader.getWorkByHash(hash);
        if (!data) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'WORK_NOT_FOUND',
              message: `No work found with id ${hash}`,
            },
          });
          return;
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /v1/work/:hash/evidence
  // =========================================================================

  router.get(
    '/v1/work/:hash/evidence',
    async (req: Request, res: Response) => {
      const hash = req.params.hash;

      if (!hash || !hash.startsWith('0x') || hash.length !== 66) {
        res.status(400).json({
          version: API_VERSION,
          error: {
            code: 'INVALID_WORK_ID',
            message: 'work_id must be a 0x-prefixed bytes32 hex string (66 chars)',
          },
        });
        return;
      }

      if (!workDataReader) {
        res.status(503).json({
          version: API_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Work data service not configured',
          },
        });
        return;
      }

      try {
        const data = await workDataReader.getWorkEvidence(hash);
        if (!data) {
          res.status(404).json({
            version: API_VERSION,
            error: {
              code: 'WORK_NOT_FOUND',
              message: `No work found with id ${hash}`,
            },
          });
          return;
        }

        res.json({ version: API_VERSION, data });
      } catch (err) {
        res.status(500).json({
          version: API_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      }
    },
  );

  // =========================================================================
  // GET /health
  // =========================================================================

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: API_VERSION,
      chain: config.network,
      contracts: {
        identity_registry: config.identityRegistryAddress,
        reputation_registry: config.reputationRegistryAddress,
      },
    });
  });

  return router;
}
