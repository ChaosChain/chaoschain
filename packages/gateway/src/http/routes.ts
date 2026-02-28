/**
 * HTTP API Routes
 * 
 * Thin controllers - validate input, call engine, return state.
 * No business logic here.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { WorkflowEngine } from '../workflows/engine.js';
import { WorkflowPersistence } from '../workflows/persistence.js';
import { createWorkSubmissionWorkflow } from '../workflows/work-submission.js';
import { createScoreSubmissionWorkflow } from '../workflows/score-submission.js';
import { createCloseEpochWorkflow } from '../workflows/close-epoch.js';
import { WorkSubmissionInput, ScoreSubmissionInput, CloseEpochInput, WorkflowRecord } from '../workflows/index.js';
import type { DKGEvidencePackage } from '../workflows/types.js';
import { trackWorkflowCreated } from '../metrics/index.js';
import { Logger } from '../utils/logger.js';

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

interface CreateWorkSubmissionRequest {
  studio_address: string;
  epoch: number;
  agent_address: string;
  data_hash: string;
  dkg_evidence: DKGEvidencePackage[];
  evidence_content: string; // base64 encoded
  signer_address: string;
}

interface CreateScoreSubmissionRequest {
  studio_address: string;
  epoch: number;
  validator_address: string;
  data_hash: string;
  scores: number[];       // Array of scores (0-10000 basis points)
  salt: string;           // bytes32 hex (required for commit_reveal, optional for direct)
  signer_address: string;
  worker_address?: string;  // Required for direct mode - the worker being scored
  mode?: 'direct' | 'commit_reveal';  // Default: "direct"
}

interface CreateCloseEpochRequest {
  studio_address: string;
  epoch: number;
  signer_address: string;
}

interface WorkflowResponse {
  id: string;
  type: string;
  state: string;
  step: string;
  created_at: number;
  updated_at: number;
  progress: Record<string, unknown>;
  error?: {
    step: string;
    message: string;
    code: string;
  };
}

// =============================================================================
// VALIDATION
// =============================================================================

function validateHexString(value: unknown, fieldName: string, length?: number): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  if (!value.startsWith('0x')) {
    throw new ValidationError(`${fieldName} must start with 0x`);
  }
  if (length && value.length !== length) {
    throw new ValidationError(`${fieldName} must be ${length} characters`);
  }
  return value;
}

function validateAddress(value: unknown, fieldName: string): string {
  return validateHexString(value, fieldName, 42);
}

function validateBytes32(value: unknown, fieldName: string): string {
  return validateHexString(value, fieldName, 66);
}

function validatePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function validateBase64(value: unknown, fieldName: string): Buffer {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a base64 string`);
  }
  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw new ValidationError(`${fieldName} must be valid base64`);
  }
}

function validateScoresArray(value: unknown, fieldName: string): number[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }
  if (value.length === 0) {
    throw new ValidationError(`${fieldName} must not be empty`);
  }
  for (let i = 0; i < value.length; i++) {
    const score = value[i];
    if (typeof score !== 'number' || !Number.isInteger(score)) {
      throw new ValidationError(`${fieldName}[${i}] must be an integer`);
    }
    if (score < 0 || score > 10000) {
      throw new ValidationError(`${fieldName}[${i}] must be between 0 and 10000`);
    }
  }
  return value as number[];
}

function validateDkgEvidence(value: unknown, fieldName: string): DKGEvidencePackage[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }
  if (value.length === 0) {
    throw new ValidationError(`${fieldName} must not be empty`);
  }
  for (let i = 0; i < value.length; i++) {
    const pkg = value[i];
    if (!pkg || typeof pkg !== 'object') {
      throw new ValidationError(`${fieldName}[${i}] must be an object`);
    }
    if (typeof pkg.arweave_tx_id !== 'string' || !pkg.arweave_tx_id) {
      throw new ValidationError(`${fieldName}[${i}].arweave_tx_id must be a non-empty string`);
    }
    if (typeof pkg.author !== 'string' || !pkg.author) {
      throw new ValidationError(`${fieldName}[${i}].author must be a non-empty string`);
    }
    if (typeof pkg.timestamp !== 'number') {
      throw new ValidationError(`${fieldName}[${i}].timestamp must be a number`);
    }
    if (!Array.isArray(pkg.parent_ids)) {
      throw new ValidationError(`${fieldName}[${i}].parent_ids must be an array`);
    }
    if (typeof pkg.payload_hash !== 'string') {
      throw new ValidationError(`${fieldName}[${i}].payload_hash must be a string`);
    }
    if (!Array.isArray(pkg.artifact_ids)) {
      throw new ValidationError(`${fieldName}[${i}].artifact_ids must be an array`);
    }
    if (typeof pkg.signature !== 'string') {
      throw new ValidationError(`${fieldName}[${i}].signature must be a string`);
    }
  }
  return value as DKGEvidencePackage[];
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// =============================================================================
// ROUTE FACTORY
// =============================================================================

export function createRoutes(
  engine: WorkflowEngine,
  persistence: WorkflowPersistence,
  logger: Logger
): Router {
  const router = Router();

  // ===========================================================================
  // POST /workflows/work-submission
  // Create a new WorkSubmission workflow
  // ===========================================================================
  router.post(
    '/workflows/work-submission',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateWorkSubmissionRequest;

        // Validate input
        const input: WorkSubmissionInput = {
          studio_address: validateAddress(body.studio_address, 'studio_address'),
          epoch: validatePositiveInteger(body.epoch, 'epoch'),
          agent_address: validateAddress(body.agent_address, 'agent_address'),
          data_hash: validateBytes32(body.data_hash, 'data_hash'),
          dkg_evidence: validateDkgEvidence(body.dkg_evidence, 'dkg_evidence'),
          evidence_content: validateBase64(body.evidence_content, 'evidence_content'),
          signer_address: validateAddress(body.signer_address, 'signer_address'),
        };

        // Create workflow record
        const workflow = createWorkSubmissionWorkflow(input);

        logger.info({ workflowId: workflow.id, type: workflow.type }, 'Creating workflow');
        trackWorkflowCreated(workflow.id, workflow.type);

        // Persist and start
        await engine.createWorkflow(workflow);
        
        // Start workflow (non-blocking - engine runs it)
        engine.startWorkflow(workflow.id).catch((err) => {
          logger.error({ workflowId: workflow.id, error: err }, 'Workflow execution failed');
        });

        // Return created workflow
        res.status(201).json(toWorkflowResponse(workflow));
      } catch (error) {
        next(error);
      }
    }
  );

  // ===========================================================================
  // POST /workflows/score-submission
  // Create a new ScoreSubmission workflow
  // 
  // Supports two modes:
  // - "direct" (default): Simpler, no timing constraints
  // - "commit_reveal": Prevents last-mover bias but has timing windows
  // ===========================================================================
  router.post(
    '/workflows/score-submission',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateScoreSubmissionRequest;
        
        // Validate mode
        const mode = body.mode ?? 'direct';
        if (mode !== 'direct' && mode !== 'commit_reveal') {
          throw new ValidationError('mode must be "direct" or "commit_reveal"');
        }

        // Validate input based on mode
        const input: ScoreSubmissionInput = {
          studio_address: validateAddress(body.studio_address, 'studio_address'),
          epoch: validatePositiveInteger(body.epoch, 'epoch'),
          validator_address: validateAddress(body.validator_address, 'validator_address'),
          data_hash: validateBytes32(body.data_hash, 'data_hash'),
          scores: validateScoresArray(body.scores, 'scores'),
          salt: body.salt ? validateBytes32(body.salt, 'salt') : '0x' + '0'.repeat(64), // Optional for direct mode
          signer_address: validateAddress(body.signer_address, 'signer_address'),
          mode,
        };
        
        // Direct mode requires worker_address
        if (mode === 'direct') {
          if (!body.worker_address) {
            throw new ValidationError('worker_address is required for direct scoring mode');
          }
          input.worker_address = validateAddress(body.worker_address, 'worker_address');
        }

        // Create workflow record
        const workflow = createScoreSubmissionWorkflow(input);

        logger.info({ 
          workflowId: workflow.id, 
          type: workflow.type,
          mode,
          step: workflow.step 
        }, 'Creating score submission workflow');
        trackWorkflowCreated(workflow.id, workflow.type);

        // Persist and start
        await engine.createWorkflow(workflow);
        
        // Start workflow (non-blocking - engine runs it)
        engine.startWorkflow(workflow.id).catch((err) => {
          logger.error({ workflowId: workflow.id, error: err }, 'Workflow execution failed');
        });

        // Return created workflow
        res.status(201).json(toWorkflowResponse(workflow));
      } catch (error) {
        next(error);
      }
    }
  );

  // ===========================================================================
  // POST /workflows/close-epoch
  // Create a new CloseEpoch workflow
  // ===========================================================================
  router.post(
    '/workflows/close-epoch',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateCloseEpochRequest;

        // Validate input
        const input: CloseEpochInput = {
          studio_address: validateAddress(body.studio_address, 'studio_address'),
          epoch: validatePositiveInteger(body.epoch, 'epoch'),
          signer_address: validateAddress(body.signer_address, 'signer_address'),
        };

        // Create workflow record
        const workflow = createCloseEpochWorkflow(input);

        logger.info({ workflowId: workflow.id, type: workflow.type, epoch: input.epoch }, 'Creating workflow');
        trackWorkflowCreated(workflow.id, workflow.type);

        // Persist and start
        await engine.createWorkflow(workflow);
        
        // Start workflow (non-blocking - engine runs it)
        engine.startWorkflow(workflow.id).catch((err) => {
          logger.error({ workflowId: workflow.id, error: err }, 'Workflow execution failed');
        });

        // Return created workflow
        res.status(201).json(toWorkflowResponse(workflow));
      } catch (error) {
        next(error);
      }
    }
  );

  // ===========================================================================
  // GET /workflows/:id
  // Get workflow by ID
  // ===========================================================================
  router.get(
    '/workflows/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        const workflow = await persistence.load(id);
        if (!workflow) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }

        res.json(toWorkflowResponse(workflow));
      } catch (error) {
        next(error);
      }
    }
  );

  // ===========================================================================
  // GET /workflows
  // List workflows with optional filters
  // ===========================================================================
  router.get(
    '/workflows',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { studio, state, type } = req.query;

        let workflows;

        if (studio && typeof studio === 'string') {
          // Filter by studio
          const pgPersistence = persistence as { findByStudio?: (s: string) => Promise<unknown[]> };
          if (pgPersistence.findByStudio) {
            workflows = await pgPersistence.findByStudio(studio);
          } else {
            // Fallback: not supported by in-memory persistence
            res.status(400).json({ error: 'Studio filter not supported' });
            return;
          }
        } else if (type && state && typeof type === 'string' && typeof state === 'string') {
          // Filter by type and state
          workflows = await persistence.findByTypeAndState(type, state as any);
        } else if (state === 'active') {
          // Get all active workflows
          workflows = await persistence.findActiveWorkflows();
        } else {
          // No filter - return error (don't allow listing all)
          res.status(400).json({ 
            error: 'Query parameter required: studio, state=active, or type+state' 
          });
          return;
        }

        res.json({
          workflows: (workflows as WorkflowRecord[]).map(toWorkflowResponse),
          count: workflows.length,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // ===========================================================================
  // Health check
  // ===========================================================================
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  return router;
}

// =============================================================================
// RESPONSE MAPPING
// =============================================================================

function toWorkflowResponse(workflow: { 
  id: string;
  type: string;
  state: string;
  step: string;
  created_at: number;
  updated_at: number;
  progress: unknown;
  error?: { step: string; message: string; code: string };
}): WorkflowResponse {
  return {
    id: workflow.id,
    type: workflow.type,
    state: workflow.state,
    step: workflow.step,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
    progress: workflow.progress as Record<string, unknown>,
    error: workflow.error ? {
      step: workflow.error.step,
      message: workflow.error.message,
      code: workflow.error.code,
    } : undefined,
  };
}

// =============================================================================
// ERROR HANDLER MIDDLEWARE
// =============================================================================

export function errorHandler(logger: Logger) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }

    logger.error({ error: err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  };
}
