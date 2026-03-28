/**
 * Stall Cycle Limit Tests
 *
 * Proves that STALLED workflows are eventually marked FAILED after
 * MAX_STALL_CYCLES reconciliation cycles, preventing infinite retry
 * loops on gateway restarts.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  WorkflowEngine,
  InMemoryWorkflowPersistence,
  WorkflowReconciler,
} from '../../src/workflows/index.js';
import type {
  StepExecutor,
  WorkflowDefinition,
} from '../../src/workflows/index.js';

function createMinimalEngine(persistence: InMemoryWorkflowPersistence) {
  const reconciler = {
    reconcileWorkSubmission: vi.fn().mockResolvedValue({ action: 'NO_CHANGE' }),
    applyReconciliationResult: vi.fn((workflow: unknown) => ({
      workflow,
      stateChanged: false,
    })),
  } as unknown as WorkflowReconciler;
  return new WorkflowEngine(persistence, reconciler);
}

function registerNoOpWorkflow(
  engine: WorkflowEngine,
  execute: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ type: 'SUCCESS', nextStep: null })
) {
  const stepExecutor: StepExecutor<any> = {
    execute,
    isIrreversible: () => false,
  };

  const definition: WorkflowDefinition<any> = {
    type: 'WorkSubmission',
    initialStep: 'TEST_STEP',
    steps: new Map([['TEST_STEP', stepExecutor]]),
    stepOrder: ['TEST_STEP'],
  };

  engine.registerWorkflow(definition);
  return execute;
}

function createDeferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('Stall Cycle Limit', () => {
  it('should mark STALLED workflow as FAILED after MAX_STALL_CYCLES (3)', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);

    // Create a workflow already at max stall count
    const workflow = {
      id: 'wf-stall-test',
      type: 'WorkSubmission' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'STALLED' as const,
      step: 'SUBMIT_WORK_ONCHAIN',
      step_attempts: 5,
      input: {},
      progress: { _stall_count: 3 },
      signer: '0xSigner',
      error: { step: 'SUBMIT_WORK_ONCHAIN', message: 'network timeout', code: 'STALLED' },
    };

    await persistence.create(workflow as any);
    await engine.resumeWorkflow('wf-stall-test');

    const after = await persistence.load('wf-stall-test');
    expect(after?.state).toBe('FAILED');
    expect(after?.error?.code).toBe('MAX_STALL_CYCLES_EXCEEDED');
  });

  it('should NOT mark as FAILED if stall_count < MAX_STALL_CYCLES', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);

    const workflow = {
      id: 'wf-stall-2',
      type: 'WorkSubmission' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'STALLED' as const,
      step: 'SUBMIT_WORK_ONCHAIN',
      step_attempts: 5,
      input: {},
      progress: { _stall_count: 1 },
      signer: '0xSigner',
    };

    await persistence.create(workflow as any);

    // resumeWorkflow will reset to RUNNING and try to run,
    // but since no workflow definition is registered, it will error.
    // The key assertion is that it did NOT immediately FAIL with MAX_STALL_CYCLES.
    try {
      await engine.resumeWorkflow('wf-stall-2');
    } catch {
      // Expected: no registered workflow definition
    }

    const after = await persistence.load('wf-stall-2');
    // Should NOT be FAILED with MAX_STALL_CYCLES
    if (after?.state === 'FAILED') {
      expect(after?.error?.code).not.toBe('MAX_STALL_CYCLES_EXCEEDED');
    }
    // stall_count should have incremented
    const progress = after?.progress as Record<string, unknown>;
    expect(progress._stall_count).toBe(2);
  });

  it('should increment _stall_count from 0 on first resume', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);

    const workflow = {
      id: 'wf-stall-first',
      type: 'WorkSubmission' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'STALLED' as const,
      step: 'SUBMIT_WORK_ONCHAIN',
      step_attempts: 5,
      input: {},
      progress: {},  // No _stall_count yet
      signer: '0xSigner',
    };

    await persistence.create(workflow as any);

    try {
      await engine.resumeWorkflow('wf-stall-first');
    } catch {
      // Expected
    }

    const after = await persistence.load('wf-stall-first');
    const progress = after?.progress as Record<string, unknown>;
    expect(progress._stall_count).toBe(1);
  });

  it('should not touch COMPLETED workflows', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);

    const workflow = {
      id: 'wf-completed',
      type: 'WorkSubmission' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'COMPLETED' as const,
      step: 'COMPLETED',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    };

    await persistence.create(workflow as any);
    await engine.resumeWorkflow('wf-completed');

    const after = await persistence.load('wf-completed');
    expect(after?.state).toBe('COMPLETED');
    const progress = after?.progress as Record<string, unknown>;
    expect(progress._stall_count).toBeUndefined();
  });

  it('should not touch FAILED workflows', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);

    const workflow = {
      id: 'wf-failed',
      type: 'WorkSubmission' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'FAILED' as const,
      step: 'SUBMIT_WORK_ONCHAIN',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    };

    await persistence.create(workflow as any);
    await engine.resumeWorkflow('wf-failed');

    const after = await persistence.load('wf-failed');
    expect(after?.state).toBe('FAILED');
    const progress = after?.progress as Record<string, unknown>;
    expect(progress._stall_count).toBeUndefined();
  });

  it('should skip recently updated RUNNING workflows on startup handoff', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);
    const execute = registerNoOpWorkflow(engine);
    const now = 1_700_000_000_000;

    await persistence.create({
      id: 'wf-running-recent',
      type: 'WorkSubmission',
      created_at: now - 30_000,
      updated_at: now - 10_000,
      state: 'RUNNING',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    await engine.reconcileAllActive({
      runningWorkflowMinAgeMs: 60_000,
      now,
    });

    expect(execute).not.toHaveBeenCalled();
    const after = await persistence.load('wf-running-recent');
    expect(after?.state).toBe('RUNNING');
    expect(after?.step).toBe('TEST_STEP');
  });

  it('should resume stale RUNNING workflows on startup after grace window', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);
    const execute = registerNoOpWorkflow(engine);
    const now = 1_700_000_000_000;

    await persistence.create({
      id: 'wf-running-stale',
      type: 'WorkSubmission',
      created_at: now - 120_000,
      updated_at: now - 61_000,
      state: 'RUNNING',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    await engine.reconcileAllActive({
      runningWorkflowMinAgeMs: 60_000,
      now,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const after = await persistence.load('wf-running-stale');
    expect(after?.state).toBe('COMPLETED');
  });

  it('should still resume STALLED workflows immediately during startup handoff', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);
    const execute = registerNoOpWorkflow(engine);
    const now = 1_700_000_000_000;

    await persistence.create({
      id: 'wf-stalled-recent',
      type: 'WorkSubmission',
      created_at: now - 30_000,
      updated_at: now - 5_000,
      state: 'STALLED',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    await engine.reconcileAllActive({
      runningWorkflowMinAgeMs: 60_000,
      now,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const after = await persistence.load('wf-stalled-recent');
    expect(after?.state).toBe('COMPLETED');
    const progress = after?.progress as Record<string, unknown>;
    expect(progress._stall_count).toBe(1);
  });

  it('should wait for in-flight workflow execution to drain before shutdown', async () => {
    const persistence = new InMemoryWorkflowPersistence();
    const engine = createMinimalEngine(persistence);
    const gate = createDeferred<void>();
    const execute = registerNoOpWorkflow(
      engine,
      vi.fn().mockImplementation(async () => {
        await gate.promise;
        return { type: 'SUCCESS', nextStep: null };
      })
    );

    await persistence.create({
      id: 'wf-drain',
      type: 'WorkSubmission',
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'CREATED',
      step: 'TEST_STEP',
      step_attempts: 0,
      input: {},
      progress: {},
      signer: '0xSigner',
    } as any);

    const runPromise = engine.startWorkflow('wf-drain');
    await Promise.resolve();

    expect(engine.activeExecutionCount()).toBeGreaterThan(0);
    await expect(engine.waitForIdle(10)).resolves.toBe(false);

    gate.resolve();
    await runPromise;

    await expect(engine.waitForIdle(100)).resolves.toBe(true);
    expect(engine.activeExecutionCount()).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
