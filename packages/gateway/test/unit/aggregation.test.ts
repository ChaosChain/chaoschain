/**
 * Aggregation layer unit tests — queryLeaderboardRows + classifyAgents pipeline
 *
 * Tests the leaderboard SQL query (via mock pool), per-agent aggregation,
 * malformed data handling, confidence thresholds, and the compare endpoint
 * consuming aggregated values rather than raw session payloads.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  queryLeaderboardRows,
  classifyAgents,
  CONFIDENCE_LOW_MAX,
  CONFIDENCE_MEDIUM_MAX,
  type LeaderboardRow,
} from '../../src/sessions/routes.js';
import type { Scenario } from '../../src/sessions/types.js';

// =============================================================================
// Mock pool helper — captures SQL and returns canned rows
// =============================================================================

interface MockQueryResult {
  rows: Record<string, unknown>[];
}

function createMockPool(rows: Record<string, unknown>[] = []) {
  const querySpy = vi.fn().mockResolvedValue({ rows } as MockQueryResult);
  return { query: querySpy };
}

function makeRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    agent_address: overrides.agent_address ?? '0xAgent1',
    agent_name: overrides.agent_name ?? null,
    sessions: overrides.sessions ?? 5,
    initiative: overrides.initiative ?? 50,
    collaboration: overrides.collaboration ?? 50,
    reasoning: overrides.reasoning ?? 50,
    compliance: overrides.compliance ?? 50,
    efficiency: overrides.efficiency ?? 50,
    last_scored_at: overrides.last_scored_at ?? '2026-03-31T00:00:00.000Z',
  };
}

// =============================================================================
// queryLeaderboardRows — SQL query shape & data mapping
// =============================================================================

describe('queryLeaderboardRows', () => {
  it('passes correct SQL conditions to the pool', async () => {
    const pool = createMockPool([]);
    await queryLeaderboardRows(pool);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql: string = pool.query.mock.calls[0][0];
    expect(sql).toContain(`w.type = 'ScoreSubmission'`);
    expect(sql).toContain(`w.state = 'COMPLETED'`);
    expect(sql).toContain(`jsonb_array_length(w.input->'scores') >= 5`);
    expect(sql).toContain(`agent_address IS NOT NULL`);
    expect(sql).toContain(`agent_address != ''`);
  });

  it('adds studio_address filter when provided', async () => {
    const pool = createMockPool([]);
    await queryLeaderboardRows(pool, '0xStudio');

    const sql: string = pool.query.mock.calls[0][0];
    expect(sql).toContain(`LOWER(w.input->>'studio_address')`);
    const params = pool.query.mock.calls[0][1];
    expect(params).toEqual(['0xstudio']);
  });

  it('maps rows with correct field names and types', async () => {
    const pool = createMockPool([{
      agent_address: '0xAlice',
      agent_name: 'Alice',
      scored_sessions: '3',
      avg_initiative: 72,
      avg_collaboration: 65,
      avg_reasoning: 81,
      avg_compliance: 90,
      avg_efficiency: 55,
      last_scored_at: '1711843200000',
    }]);

    const rows = await queryLeaderboardRows(pool);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      agent_address: '0xAlice',
      agent_name: 'Alice',
      sessions: 3,
      initiative: 72,
      collaboration: 65,
      reasoning: 81,
      compliance: 90,
      efficiency: 55,
      last_scored_at: expect.any(String),
    });
    expect(rows[0].last_scored_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clamps scores to 0-100 range', async () => {
    const pool = createMockPool([{
      agent_address: '0xEdge',
      agent_name: null,
      scored_sessions: '1',
      avg_initiative: 150,
      avg_collaboration: -10,
      avg_reasoning: 0,
      avg_compliance: 100,
      avg_efficiency: 200,
      last_scored_at: null,
    }]);

    const rows = await queryLeaderboardRows(pool);
    expect(rows[0].initiative).toBe(100);
    expect(rows[0].collaboration).toBe(0);
    expect(rows[0].reasoning).toBe(0);
    expect(rows[0].compliance).toBe(100);
    expect(rows[0].efficiency).toBe(100);
    expect(rows[0].last_scored_at).toBeNull();
  });

  it('handles null avg values gracefully', async () => {
    const pool = createMockPool([{
      agent_address: '0xNull',
      agent_name: null,
      scored_sessions: '0',
      avg_initiative: null,
      avg_collaboration: null,
      avg_reasoning: null,
      avg_compliance: null,
      avg_efficiency: null,
      last_scored_at: null,
    }]);

    const rows = await queryLeaderboardRows(pool);
    expect(rows[0].initiative).toBe(0);
    expect(rows[0].collaboration).toBe(0);
    expect(rows[0].reasoning).toBe(0);
    expect(rows[0].compliance).toBe(0);
    expect(rows[0].efficiency).toBe(0);
  });

  it('returns empty array when no rows match', async () => {
    const pool = createMockPool([]);
    const rows = await queryLeaderboardRows(pool);
    expect(rows).toEqual([]);
  });

  it('SQL includes LEAST/GREATEST clamp for each dimension', async () => {
    const pool = createMockPool([]);
    await queryLeaderboardRows(pool);

    const sql: string = pool.query.mock.calls[0][0];
    expect(sql).toContain('LEAST(100, GREATEST(0,');
  });
});

// =============================================================================
// Multiple scores for same agent aggregate correctly
// =============================================================================

describe('aggregation: multiple scores for same agent', () => {
  it('classifyAgents receives averaged values from multiple sessions', () => {
    const row = makeRow({
      agent_address: '0xAlice',
      sessions: 4,
      initiative: 60,
      collaboration: 70,
      reasoning: 80,
      compliance: 90,
      efficiency: 50,
    });

    const result = classifyAgents([row], 'default');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].session_count).toBe(4);
    expect(result.agents[0].scores.reasoning).toBe(80);
    expect(result.agents[0].scores.collaboration).toBe(70);
    expect(result.agents[0].scores.efficiency).toBe(50);
    expect(result.agents[0].scores.compliance).toBe(90);
    expect(result.agents[0].scores.initiative).toBe(60);
  });
});

// =============================================================================
// Different agents remain separate
// =============================================================================

describe('aggregation: different agents remain separate', () => {
  it('two agents with different addresses produce two rows', () => {
    const alice = makeRow({ agent_address: '0xAlice', reasoning: 90, sessions: 5 });
    const bob = makeRow({ agent_address: '0xBob', reasoning: 60, sessions: 3 });

    const result = classifyAgents([alice, bob], 'default');
    expect(result.agents).toHaveLength(2);

    const aliceResult = result.agents.find(a => a.agent_address === '0xAlice')!;
    const bobResult = result.agents.find(a => a.agent_address === '0xBob')!;

    expect(aliceResult.scores.reasoning).toBe(90);
    expect(bobResult.scores.reasoning).toBe(60);
    expect(aliceResult.session_count).toBe(5);
    expect(bobResult.session_count).toBe(3);
  });

  it('agents sorted by overall_score descending', () => {
    const high = makeRow({ agent_address: '0xHigh', reasoning: 90, collaboration: 90, efficiency: 90, compliance: 90, sessions: 5 });
    const low = makeRow({ agent_address: '0xLow', reasoning: 30, collaboration: 30, efficiency: 30, compliance: 30, sessions: 5 });
    const mid = makeRow({ agent_address: '0xMid', reasoning: 60, collaboration: 60, efficiency: 60, compliance: 60, sessions: 5 });

    const result = classifyAgents([low, mid, high], 'default');
    expect(result.agents.map(a => a.agent_address)).toEqual(['0xHigh', '0xMid', '0xLow']);
  });
});

// =============================================================================
// Malformed or missing score arrays are ignored (SQL-level filtering)
// =============================================================================

describe('aggregation: malformed data handling', () => {
  it('SQL query filters out workflows with < 5 scores', async () => {
    const pool = createMockPool([]);
    await queryLeaderboardRows(pool);
    const sql: string = pool.query.mock.calls[0][0];
    expect(sql).toContain(`jsonb_array_length(w.input->'scores') >= 5`);
  });

  it('SQL excludes null agent_address rows', async () => {
    const pool = createMockPool([]);
    await queryLeaderboardRows(pool);
    const sql: string = pool.query.mock.calls[0][0];
    expect(sql).toContain(`agent_address IS NOT NULL`);
    expect(sql).toContain(`agent_address != ''`);
  });

  it('SQL auto-scales basis-point scores (> 100) to 0-100', async () => {
    const pool = createMockPool([]);
    await queryLeaderboardRows(pool);
    const sql: string = pool.query.mock.calls[0][0];
    expect(sql).toContain('GREATEST(r0,r1,r2,r3,r4) > 100');
    expect(sql).toContain('/ 100.0');
  });
});

// =============================================================================
// Confidence thresholds behave correctly
// =============================================================================

describe('aggregation: confidence thresholds', () => {
  it('constants are correct', () => {
    expect(CONFIDENCE_LOW_MAX).toBe(2);
    expect(CONFIDENCE_MEDIUM_MAX).toBe(10);
  });

  const cases: Array<[number, 'low' | 'medium' | 'high']> = [
    [0, 'low'],
    [1, 'low'],
    [2, 'low'],
    [3, 'medium'],
    [5, 'medium'],
    [10, 'medium'],
    [11, 'high'],
    [50, 'high'],
  ];

  for (const [sessions, expected] of cases) {
    it(`${sessions} session(s) → ${expected} confidence`, () => {
      const row = makeRow({ sessions, reasoning: 70, collaboration: 70, efficiency: 70, compliance: 70 });
      const result = classifyAgents([row], 'default');
      expect(result.agents[0].confidence).toBe(expected);
    });
  }

  it('single session: result exists but confidence is low', () => {
    const row = makeRow({ sessions: 1, reasoning: 90, collaboration: 90, efficiency: 90, compliance: 90 });
    const result = classifyAgents([row], 'default');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].confidence).toBe('low');
    expect(result.agents[0].classification).not.toBe('default_choice');
  });
});

// =============================================================================
// Compare endpoint uses aggregated values, not raw individual session payloads
// =============================================================================

describe('compare pipeline uses aggregated LeaderboardRow values', () => {
  it('overall_score is computed from aggregated dimension scores', () => {
    const row = makeRow({
      agent_address: '0xAgent',
      reasoning: 80,
      collaboration: 60,
      efficiency: 70,
      compliance: 90,
      sessions: 5,
    });
    const result = classifyAgents([row], 'default');
    // default weights: reasoning 0.30, compliance 0.25, efficiency 0.25, collaboration 0.20
    // 0.30*80 + 0.25*90 + 0.25*70 + 0.20*60 = 24 + 22.5 + 17.5 + 12 = 76.0
    expect(result.agents[0].overall_score).toBe(76);
  });

  it('last_scored_at is included in agent results', () => {
    const row = makeRow({
      sessions: 3,
      last_scored_at: '2026-03-30T12:00:00.000Z',
    });
    const result = classifyAgents([row], 'default');
    expect(result.agents[0].last_scored_at).toBe('2026-03-30T12:00:00.000Z');
  });

  it('default_choice is conservative: not assigned to low-confidence #1', () => {
    const row = makeRow({
      sessions: 1,
      reasoning: 90,
      collaboration: 90,
      efficiency: 90,
      compliance: 90,
    });
    const result = classifyAgents([row], 'default');
    expect(result.default_choice).toBeNull();
  });

  it('default_choice assigned to #1 with medium+ confidence and no risks', () => {
    const row = makeRow({
      agent_address: '0xGood',
      sessions: 5,
      reasoning: 80,
      collaboration: 80,
      efficiency: 80,
      compliance: 80,
    });
    const result = classifyAgents([row], 'default');
    expect(result.default_choice).toBe('0xGood');
    expect(result.agents[0].classification).toBe('default_choice');
  });

  it('scenario weights change ranking between agents', () => {
    const complianceHeavy = makeRow({
      agent_address: '0xProd',
      reasoning: 60, collaboration: 50, efficiency: 50, compliance: 95,
      sessions: 5,
    });
    const efficiencyHeavy = makeRow({
      agent_address: '0xProto',
      reasoning: 60, collaboration: 50, efficiency: 95, compliance: 50,
      sessions: 5,
    });

    const prod = classifyAgents([complianceHeavy, efficiencyHeavy], 'production');
    expect(prod.agents[0].agent_address).toBe('0xProd');

    const proto = classifyAgents([complianceHeavy, efficiencyHeavy], 'prototyping');
    expect(proto.agents[0].agent_address).toBe('0xProto');
  });

  it('multiple agents: each gets independent confidence from their session count', () => {
    const veteran = makeRow({ agent_address: '0xVet', sessions: 20, reasoning: 70, collaboration: 70, efficiency: 70, compliance: 70 });
    const newbie = makeRow({ agent_address: '0xNew', sessions: 1, reasoning: 80, collaboration: 80, efficiency: 80, compliance: 80 });

    const result = classifyAgents([veteran, newbie], 'default');
    const vet = result.agents.find(a => a.agent_address === '0xVet')!;
    const newb = result.agents.find(a => a.agent_address === '0xNew')!;

    expect(vet.confidence).toBe('high');
    expect(newb.confidence).toBe('low');
  });
});
