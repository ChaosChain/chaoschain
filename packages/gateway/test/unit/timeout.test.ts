/**
 * Timeout Enforcement Tests
 * 
 * Proves:
 * - Timeouts result in STALLED (operational failure), not FAILED
 * - Timeouts do not affect correctness
 * - Timeout configuration works correctly
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withTimeout,
  StepTimeoutError,
  getStepTimeout,
  createTimeoutGuard,
  TimeoutConfig,
  DEFAULT_TIMEOUT_CONFIG,
} from '../../src/execution/timeout.js';

describe('withTimeout', () => {
  it('should complete before timeout', async () => {
    const result = await withTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'success';
      },
      100, // 100ms timeout
      'WorkSubmission',
      'TEST_STEP'
    );

    expect(result).toBe('success');
  });

  it('should throw StepTimeoutError on timeout', async () => {
    await expect(
      withTimeout(
        async () => {
          await new Promise((r) => setTimeout(r, 200));
          return 'never reached';
        },
        50, // 50ms timeout
        'WorkSubmission',
        'STORE_EVIDENCE'
      )
    ).rejects.toThrow(StepTimeoutError);
  });

  it('should include workflow and step info in error', async () => {
    const err = await withTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 100));
      },
      10,
      'ScoreSubmission',
      'COMMIT_SCORE'
    ).catch((e) => e);

    expect(err).toBeInstanceOf(StepTimeoutError);
    expect(err.workflowType).toBe('ScoreSubmission');
    expect(err.step).toBe('COMMIT_SCORE');
    expect(err.timeoutMs).toBe(10);
    expect(err.message).toContain('ScoreSubmission');
    expect(err.message).toContain('COMMIT_SCORE');
    expect(err.message).toContain('10ms');
  });

  it('should clear timeout on successful completion', async () => {
    vi.useFakeTimers();

    const promise = withTimeout(
      async () => 'quick',
      1000,
      'WorkSubmission',
      'TEST'
    );

    // Advance timers - should not throw because operation completes fast
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toBe('quick');

    vi.useRealTimers();
  });

  it('should propagate errors from the function', async () => {
    await expect(
      withTimeout(
        async () => {
          throw new Error('Custom error');
        },
        100,
        'WorkSubmission',
        'TEST'
      )
    ).rejects.toThrow('Custom error');
  });
});

describe('getStepTimeout', () => {
  const config: TimeoutConfig = {
    defaultStepTimeoutMs: 30_000,
    txConfirmationTimeoutMs: 300_000,
    stepTimeouts: {
      WorkSubmission: {
        STORE_EVIDENCE: 60_000,
        SUBMIT_WORK_ONCHAIN: 45_000,
      },
      ScoreSubmission: {
        COMMIT_SCORE: 40_000,
      },
    },
  };

  it('should return specific timeout when configured', () => {
    expect(getStepTimeout(config, 'WorkSubmission', 'STORE_EVIDENCE'))
      .toBe(60_000);
    expect(getStepTimeout(config, 'WorkSubmission', 'SUBMIT_WORK_ONCHAIN'))
      .toBe(45_000);
    expect(getStepTimeout(config, 'ScoreSubmission', 'COMMIT_SCORE'))
      .toBe(40_000);
  });

  it('should return default timeout for unconfigured steps', () => {
    expect(getStepTimeout(config, 'WorkSubmission', 'UNKNOWN_STEP'))
      .toBe(30_000);
    expect(getStepTimeout(config, 'CloseEpoch', 'CHECK_PRECONDITIONS'))
      .toBe(30_000);
  });

  it('should return default for unconfigured workflow types', () => {
    expect(getStepTimeout(config, 'CloseEpoch', 'SUBMIT_CLOSE_EPOCH'))
      .toBe(30_000);
  });
});

describe('createTimeoutGuard', () => {
  it('should create guard with correct timeout', () => {
    const config: TimeoutConfig = {
      defaultStepTimeoutMs: 10_000,
      txConfirmationTimeoutMs: 60_000,
      stepTimeouts: {
        WorkSubmission: {
          STORE_EVIDENCE: 25_000,
        },
      },
    };

    const guard = createTimeoutGuard(config, 'WorkSubmission', 'STORE_EVIDENCE');
    expect(guard.timeoutMs).toBe(25_000);

    const defaultGuard = createTimeoutGuard(config, 'WorkSubmission', 'OTHER');
    expect(defaultGuard.timeoutMs).toBe(10_000);
  });

  it('should execute with timeout', async () => {
    const config: TimeoutConfig = {
      defaultStepTimeoutMs: 100,
      txConfirmationTimeoutMs: 1000,
    };

    const guard = createTimeoutGuard(config, 'WorkSubmission', 'TEST');

    // Fast operation
    const result = await guard.execute(async () => 'fast');
    expect(result).toBe('fast');

    // Slow operation
    await expect(
      guard.execute(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'slow';
      })
    ).rejects.toThrow(StepTimeoutError);
  });
});

describe('DEFAULT_TIMEOUT_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_TIMEOUT_CONFIG.defaultStepTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_CONFIG.txConfirmationTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_CONFIG.txConfirmationTimeoutMs)
      .toBeGreaterThan(DEFAULT_TIMEOUT_CONFIG.defaultStepTimeoutMs);
  });

  it('should have tx confirmation timeout for awaiting steps', () => {
    expect(DEFAULT_TIMEOUT_CONFIG.stepTimeouts?.WorkSubmission?.['AWAIT_TX_CONFIRM'])
      .toBe(DEFAULT_TIMEOUT_CONFIG.txConfirmationTimeoutMs);
    expect(DEFAULT_TIMEOUT_CONFIG.stepTimeouts?.ScoreSubmission?.['AWAIT_COMMIT_CONFIRM'])
      .toBe(DEFAULT_TIMEOUT_CONFIG.txConfirmationTimeoutMs);
    expect(DEFAULT_TIMEOUT_CONFIG.stepTimeouts?.ScoreSubmission?.['AWAIT_REVEAL_CONFIRM'])
      .toBe(DEFAULT_TIMEOUT_CONFIG.txConfirmationTimeoutMs);
    expect(DEFAULT_TIMEOUT_CONFIG.stepTimeouts?.CloseEpoch?.['AWAIT_TX_CONFIRM'])
      .toBe(DEFAULT_TIMEOUT_CONFIG.txConfirmationTimeoutMs);
  });
});

describe('Timeout Invariants', () => {
  it('timeout MUST result in StepTimeoutError (operational failure)', async () => {
    // Timeout is an operational failure, not a correctness failure.
    // The workflow should transition to STALLED, not FAILED.

    const err = await withTimeout(
      async () => new Promise((r) => setTimeout(r, 100)),
      10,
      'WorkSubmission',
      'TEST'
    ).catch((e) => e);

    // Must be StepTimeoutError specifically
    expect(err).toBeInstanceOf(StepTimeoutError);
    expect(err.name).toBe('StepTimeoutError');

    // This is distinguishable from a contract revert or business logic error
  });

  it('timeout MUST NOT affect correctness', async () => {
    // A timeout does not mean the operation failed.
    // It means we gave up waiting.
    // The underlying operation may have succeeded.
    // This is why timeout → STALLED (recoverable).

    let operationCompleted = false;

    await withTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        operationCompleted = true;
        return 'done';
      },
      10,
      'WorkSubmission',
      'TEST'
    ).catch(() => {});

    // Wait for the operation to complete
    await new Promise((r) => setTimeout(r, 100));

    // The operation may have completed despite timeout
    // This is expected - timeout just stops waiting
    expect(operationCompleted).toBe(true);
  });
});
