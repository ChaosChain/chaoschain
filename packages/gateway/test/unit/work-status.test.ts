/**
 * Work-list status filtering — unit tests
 *
 * Verifies:
 * - WorkDataReader dispatches to correct query method based on status
 * - Newly completed work appears in pending
 * - Scored work disappears from pending and appears in scored
 * - Finalized work appears only in finalized
 * - status defaults to pending
 * - limit/offset pass through correctly
 * - Integration-style: pending → scored transition for a single data_hash
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkDataReader, type WorkflowQuerySource } from '../../src/services/work-data-reader.js';
import type { WorkflowRecord } from '../../src/workflows/types.js';

// =============================================================================
// Helpers
// =============================================================================

function makeWorkSubmission(overrides: Partial<{
  id: string;
  data_hash: string;
  agent_address: string;
  studio_address: string;
  epoch: number;
  created_at: number;
}>): WorkflowRecord {
  const dataHash = overrides.data_hash ?? '0x' + 'aa'.repeat(32);
  return {
    id: overrides.id ?? 'ws-' + Math.random().toString(36).slice(2),
    type: 'WorkSubmission',
    created_at: overrides.created_at ?? Date.now(),
    updated_at: Date.now(),
    state: 'COMPLETED',
    step: 'SUBMIT_WORK_ONCHAIN',
    step_attempts: 0,
    input: {
      data_hash: dataHash,
      agent_address: overrides.agent_address ?? '0xWorker',
      studio_address: overrides.studio_address ?? '0xStudio',
      epoch: overrides.epoch ?? 1,
      studio_policy_version: 'v1',
      work_mandate_id: 'generic-task',
      task_type: 'general',
    },
    progress: { settlement: 'off-chain' },
    signer: 'off-chain',
  };
}

function createMockQuerySource(overrides: Partial<WorkflowQuerySource> = {}): WorkflowQuerySource {
  return {
    findWorkByDataHash: vi.fn().mockResolvedValue(null),
    findLatestCompletedWorkForAgent: vi.fn().mockResolvedValue(null),
    findAllCompletedWorkflowsForAgent: vi.fn().mockResolvedValue({ records: [], total: 0 }),
    hasCompletedScoreForDataHash: vi.fn().mockResolvedValue(false),
    hasCompletedCloseEpoch: vi.fn().mockResolvedValue(false),
    findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
    findScoredWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
    findFinalizedWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
    findAllWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
    findScoresForDataHash: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// =============================================================================
// WorkDataReader.getWorkForStudio dispatches to correct query
// =============================================================================

describe('WorkDataReader.getWorkForStudio — dispatch', () => {
  it('status=pending calls findPendingWorkForStudio', async () => {
    const qs = createMockQuerySource();
    const reader = new WorkDataReader(qs);
    await reader.getWorkForStudio('0xStudio', 'pending', 20, 0);
    expect(qs.findPendingWorkForStudio).toHaveBeenCalledWith('0xstudio', 20, 0);
    expect(qs.findScoredWorkForStudio).not.toHaveBeenCalled();
    expect(qs.findFinalizedWorkForStudio).not.toHaveBeenCalled();
  });

  it('status=scored calls findScoredWorkForStudio', async () => {
    const qs = createMockQuerySource();
    const reader = new WorkDataReader(qs);
    await reader.getWorkForStudio('0xStudio', 'scored', 10, 5);
    expect(qs.findScoredWorkForStudio).toHaveBeenCalledWith('0xstudio', 10, 5);
    expect(qs.findPendingWorkForStudio).not.toHaveBeenCalled();
  });

  it('status=finalized calls findFinalizedWorkForStudio', async () => {
    const qs = createMockQuerySource();
    const reader = new WorkDataReader(qs);
    await reader.getWorkForStudio('0xStudio', 'finalized', 50, 0);
    expect(qs.findFinalizedWorkForStudio).toHaveBeenCalledWith('0xstudio', 50, 0);
    expect(qs.findPendingWorkForStudio).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Newly completed work appears in pending
// =============================================================================

describe('pending work visibility', () => {
  it('completed WorkSubmission with no score appears in pending', async () => {
    const ws = makeWorkSubmission({ data_hash: '0xhash1' });
    const qs = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
    });
    const reader = new WorkDataReader(qs);
    const result = await reader.getWorkForStudio('0xStudio', 'pending', 20, 0);

    expect(result.work).toHaveLength(1);
    expect(result.work[0].data_hash).toBe('0xhash1');
    expect(result.total).toBe(1);
  });

  it('returns empty when no work exists', async () => {
    const qs = createMockQuerySource();
    const reader = new WorkDataReader(qs);
    const result = await reader.getWorkForStudio('0xStudio', 'pending', 20, 0);
    expect(result.work).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// =============================================================================
// Scored work appears in scored, not pending
// =============================================================================

describe('scored work visibility', () => {
  it('work with completed score appears in scored', async () => {
    const ws = makeWorkSubmission({ data_hash: '0xscored' });
    const qs = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
      findScoredWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
    });
    const reader = new WorkDataReader(qs);

    const pending = await reader.getWorkForStudio('0xStudio', 'pending', 20, 0);
    expect(pending.work).toHaveLength(0);

    const scored = await reader.getWorkForStudio('0xStudio', 'scored', 20, 0);
    expect(scored.work).toHaveLength(1);
    expect(scored.work[0].data_hash).toBe('0xscored');
  });
});

// =============================================================================
// Finalized work appears only in finalized
// =============================================================================

describe('finalized work visibility', () => {
  it('epoch-closed work appears in finalized, not pending or scored', async () => {
    const ws = makeWorkSubmission({ data_hash: '0xfinal' });
    const qs = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
      findScoredWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
      findFinalizedWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
    });
    const reader = new WorkDataReader(qs);

    const pending = await reader.getWorkForStudio('0xStudio', 'pending', 20, 0);
    expect(pending.work).toHaveLength(0);

    const scored = await reader.getWorkForStudio('0xStudio', 'scored', 20, 0);
    expect(scored.work).toHaveLength(0);

    const finalized = await reader.getWorkForStudio('0xStudio', 'finalized', 20, 0);
    expect(finalized.work).toHaveLength(1);
    expect(finalized.work[0].data_hash).toBe('0xfinal');
  });
});

// =============================================================================
// Limit / offset pass through
// =============================================================================

describe('pagination', () => {
  it('limit and offset are passed to query source', async () => {
    const qs = createMockQuerySource();
    const reader = new WorkDataReader(qs);
    await reader.getWorkForStudio('0xStudio', 'pending', 7, 14);
    expect(qs.findPendingWorkForStudio).toHaveBeenCalledWith('0xstudio', 7, 14);
  });

  it('result includes limit and offset in metadata', async () => {
    const qs = createMockQuerySource();
    const reader = new WorkDataReader(qs);
    const result = await reader.getWorkForStudio('0xStudio', 'scored', 5, 10);
    expect(result.limit).toBe(5);
    expect(result.offset).toBe(10);
  });
});

// =============================================================================
// getPendingWorkForStudio backward compat delegates to getWorkForStudio
// =============================================================================

describe('backward compatibility', () => {
  it('getPendingWorkForStudio calls getWorkForStudio with pending', async () => {
    const ws = makeWorkSubmission({});
    const qs = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
    });
    const reader = new WorkDataReader(qs);
    const result = await reader.getPendingWorkForStudio('0xStudio', 20, 0);
    expect(result.work).toHaveLength(1);
    expect(qs.findPendingWorkForStudio).toHaveBeenCalled();
  });
});

// =============================================================================
// Integration-style: pending → scored transition for a single data_hash
// =============================================================================

describe('pending → scored transition', () => {
  it('work moves from pending to scored when ScoreSubmission completes', async () => {
    const ws = makeWorkSubmission({ data_hash: '0xtransition' });

    // Phase 1: no score exists → work is pending
    const qs1 = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
      findScoredWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
    });
    const reader1 = new WorkDataReader(qs1);

    const beforeScore = await reader1.getWorkForStudio('0xStudio', 'pending', 20, 0);
    expect(beforeScore.work).toHaveLength(1);
    expect(beforeScore.work[0].data_hash).toBe('0xtransition');

    const beforeScoreScored = await reader1.getWorkForStudio('0xStudio', 'scored', 20, 0);
    expect(beforeScoreScored.work).toHaveLength(0);

    // Phase 2: score submitted → work moves to scored
    const qs2 = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [], total: 0 }),
      findScoredWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
    });
    const reader2 = new WorkDataReader(qs2);

    const afterScorePending = await reader2.getWorkForStudio('0xStudio', 'pending', 20, 0);
    expect(afterScorePending.work).toHaveLength(0);

    const afterScoreScored = await reader2.getWorkForStudio('0xStudio', 'scored', 20, 0);
    expect(afterScoreScored.work).toHaveLength(1);
    expect(afterScoreScored.work[0].data_hash).toBe('0xtransition');
  });
});

// =============================================================================
// Work item field mapping
// =============================================================================

describe('work item field mapping', () => {
  it('maps all fields from workflow record correctly', async () => {
    const ws = makeWorkSubmission({
      data_hash: '0xhash',
      agent_address: '0xWorker',
      studio_address: '0xStudio',
      epoch: 5,
      created_at: 1700000000000,
    });
    const qs = createMockQuerySource({
      findPendingWorkForStudio: vi.fn().mockResolvedValue({ records: [ws], total: 1 }),
    });
    const reader = new WorkDataReader(qs);
    const result = await reader.getWorkForStudio('0xStudio', 'pending', 20, 0);

    const item = result.work[0];
    expect(item.data_hash).toBe('0xhash');
    expect(item.worker_address).toBe('0xWorker');
    expect(item.studio_address).toBe('0xStudio');
    expect(item.epoch).toBe(5);
    expect(item.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item.studio_policy_version).toBe('v1');
    expect(item.work_mandate_id).toBe('generic-task');
    expect(item.task_type).toBe('general');
  });
});
