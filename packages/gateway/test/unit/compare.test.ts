/**
 * Agent Compare — decision-logic v1 classification pipeline unit tests
 *
 * Tests the pure classification function (no DB, no HTTP) covering
 * every edge case from decision-logic-v1.md section 15.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAgents,
  SCENARIO_WEIGHTS,
  SPECIALIST_GAP_THRESHOLD,
  BEST_FOR_THRESHOLD,
  RISK_FLAG_THRESHOLD,
  CONFIDENCE_LOW_MAX,
  CONFIDENCE_MEDIUM_MAX,
  type LeaderboardRow,
} from '../../src/sessions/routes.js';
import type { Scenario, AgentCompareResult } from '../../src/sessions/types.js';

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

describe('classifyAgents — decision-logic v1', () => {
  // =========================================================================
  // Constants are exported with correct values
  // =========================================================================

  describe('constants', () => {
    it('exports SCENARIO_WEIGHTS with four scenarios', () => {
      expect(Object.keys(SCENARIO_WEIGHTS)).toEqual(['default', 'production', 'prototyping', 'code_review']);
      for (const s of Object.keys(SCENARIO_WEIGHTS)) {
        const w = SCENARIO_WEIGHTS[s as Scenario];
        const sum = w.reasoning + w.compliance + w.efficiency + w.collaboration;
        expect(sum).toBeCloseTo(1.0, 10);
      }
    });

    it('exports correct threshold values', () => {
      expect(SPECIALIST_GAP_THRESHOLD).toBe(30);
      expect(BEST_FOR_THRESHOLD).toBe(70);
      expect(RISK_FLAG_THRESHOLD).toBe(30);
      expect(CONFIDENCE_LOW_MAX).toBe(2);
      expect(CONFIDENCE_MEDIUM_MAX).toBe(10);
    });
  });

  // =========================================================================
  // Rule 1: overall_score — 4-dimension weighted average
  // =========================================================================

  describe('Rule 1: overall_score', () => {
    it('computes weighted score for default scenario (spec example)', () => {
      const row = makeRow({ reasoning: 82, collaboration: 65, efficiency: 70, compliance: 88, sessions: 20 });
      const { agents } = classifyAgents([row], 'default');
      // 0.30*82 + 0.25*88 + 0.25*70 + 0.20*65 = 24.6 + 22.0 + 17.5 + 13.0 = 77.1
      expect(agents[0].overall_score).toBe(77.1);
    });

    it('computes weighted score for production scenario', () => {
      const row = makeRow({ reasoning: 82, collaboration: 65, efficiency: 70, compliance: 88, sessions: 20 });
      const { agents } = classifyAgents([row], 'production');
      // 0.25*82 + 0.40*88 + 0.20*70 + 0.15*65 = 20.5 + 35.2 + 14.0 + 9.75 = 79.45 → 79.5
      expect(agents[0].overall_score).toBe(79.5);
    });

    it('computes weighted score for prototyping scenario', () => {
      const row = makeRow({ reasoning: 82, collaboration: 65, efficiency: 70, compliance: 88, sessions: 20 });
      const { agents } = classifyAgents([row], 'prototyping');
      // 0.25*82 + 0.15*88 + 0.40*70 + 0.20*65 = 20.5 + 13.2 + 28.0 + 13.0 = 74.7
      expect(agents[0].overall_score).toBe(74.7);
    });

    it('computes weighted score for code_review scenario', () => {
      const row = makeRow({ reasoning: 82, collaboration: 65, efficiency: 70, compliance: 88, sessions: 20 });
      const { agents } = classifyAgents([row], 'code_review');
      // 0.20*82 + 0.25*88 + 0.15*70 + 0.40*65 = 16.4 + 22.0 + 10.5 + 26.0 = 74.9
      expect(agents[0].overall_score).toBe(74.9);
    });

    it('does NOT include initiative in overall_score', () => {
      const withInit = makeRow({ reasoning: 50, collaboration: 50, efficiency: 50, compliance: 50, initiative: 100, sessions: 5 });
      const withoutInit = makeRow({ reasoning: 50, collaboration: 50, efficiency: 50, compliance: 50, initiative: 0, sessions: 5 });
      const r1 = classifyAgents([withInit], 'default');
      const r2 = classifyAgents([withoutInit], 'default');
      expect(r1.agents[0].overall_score).toBe(r2.agents[0].overall_score);
    });
  });

  // =========================================================================
  // Rule 2: specialist detection
  // =========================================================================

  describe('Rule 2: specialist detection', () => {
    it('detects specialist when gap > 30 (spec example)', () => {
      const row = makeRow({ reasoning: 85, collaboration: 50, efficiency: 45, compliance: 48, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      // gap = 85 - (50+45+48)/3 = 85 - 47.67 = 37.33
      expect(agents[0].specialist_area).toBe('Specialist: Complex Implementation');
    });

    it('does NOT detect specialist when gap <= 30 (spec example)', () => {
      const row = makeRow({ reasoning: 85, collaboration: 70, efficiency: 65, compliance: 60, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      // gap = 85 - 65.0 = 20
      expect(agents[0].specialist_area).toBeNull();
    });

    it('tie-break: reasoning > compliance > efficiency > collaboration', () => {
      // reasoning and compliance both at 80, others at 40 → gap = 80 - (80+40+40)/3 = 80 - 53.33 = 26.67
      // That's not > 30. Let's make it clearer:
      // reasoning=90 compliance=90 efficiency=40 collaboration=40 → max by priority = reasoning
      // gap = 90 - (90+40+40)/3 = 90 - 56.67 = 33.33
      const row = makeRow({ reasoning: 90, compliance: 90, efficiency: 40, collaboration: 40, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].specialist_area).toBe('Specialist: Complex Implementation');
    });
  });

  // =========================================================================
  // Rule 3: best_for labels
  // =========================================================================

  describe('Rule 3: best_for labels', () => {
    it('lists all dimensions > 70', () => {
      const row = makeRow({ reasoning: 82, collaboration: 55, efficiency: 75, compliance: 88, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].best_for).toEqual([
        'Complex Implementation',
        'Prototyping',
        'Production',
      ]);
    });

    it('empty when no dimension exceeds 70', () => {
      const row = makeRow({ reasoning: 60, collaboration: 60, efficiency: 60, compliance: 60, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].best_for).toEqual([]);
    });

    it('exactly 70 does NOT qualify (strictly greater than)', () => {
      const row = makeRow({ reasoning: 70, collaboration: 70, efficiency: 70, compliance: 70, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].best_for).toEqual([]);
    });
  });

  // =========================================================================
  // Rule 4: risk flags
  // =========================================================================

  describe('Rule 4: risk flags', () => {
    it('flags dimensions strictly below 30 (reasoning, collaboration, compliance only)', () => {
      const row = makeRow({ reasoning: 29, collaboration: 29, efficiency: 10, compliance: 29, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].risk_flags).toHaveLength(3);
      const dims = agents[0].risk_flags.map((f) => f.dimension);
      expect(dims).toContain('reasoning');
      expect(dims).toContain('collaboration');
      expect(dims).toContain('compliance');
    });

    it('efficiency < 30 does NOT produce a risk flag', () => {
      const row = makeRow({ reasoning: 80, collaboration: 80, efficiency: 10, compliance: 80, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].risk_flags).toHaveLength(0);
    });

    it('score exactly 30 does NOT trigger a risk flag', () => {
      const row = makeRow({ reasoning: 30, collaboration: 30, efficiency: 30, compliance: 30, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].risk_flags).toHaveLength(0);
    });
  });

  // =========================================================================
  // Rule 5: confidence
  // =========================================================================

  describe('Rule 5: confidence', () => {
    it('0 sessions → low', () => {
      const row = makeRow({ sessions: 0 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('low');
    });

    it('1 session → low', () => {
      const row = makeRow({ sessions: 1 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('low');
    });

    it('2 sessions → low', () => {
      const row = makeRow({ sessions: 2 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('low');
    });

    it('3 sessions → medium', () => {
      const row = makeRow({ sessions: 3 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('medium');
    });

    it('10 sessions → medium', () => {
      const row = makeRow({ sessions: 10 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('medium');
    });

    it('11 sessions → high', () => {
      const row = makeRow({ sessions: 11 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('high');
    });
  });

  // =========================================================================
  // Rule 6: weakness
  // =========================================================================

  describe('Rule 6: weakness', () => {
    it('picks the lowest dimension', () => {
      const row = makeRow({ reasoning: 80, collaboration: 60, efficiency: 70, compliance: 90, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].weakness).toEqual({ dimension: 'collaboration', label: 'Code Review', score: 60 });
    });

    it('tie-break: compliance > reasoning > collaboration > efficiency', () => {
      const row = makeRow({ reasoning: 40, collaboration: 40, efficiency: 40, compliance: 40, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].weakness.dimension).toBe('compliance');
    });

    it('tie between reasoning and efficiency → reasoning wins', () => {
      const row = makeRow({ reasoning: 30, collaboration: 80, efficiency: 30, compliance: 80, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].weakness.dimension).toBe('reasoning');
    });
  });

  // =========================================================================
  // Rule 7: classification
  // =========================================================================

  describe('Rule 7: classification', () => {
    it('not_recommended when 2+ risk flags', () => {
      const row = makeRow({
        agent_address: '0xBad',
        reasoning: 20, collaboration: 20, efficiency: 80, compliance: 80,
        sessions: 20,
      });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].classification).toBe('not_recommended');
    });

    it('use_with_caution when exactly 1 risk flag', () => {
      const row = makeRow({
        agent_address: '0xCaution',
        reasoning: 20, collaboration: 80, efficiency: 80, compliance: 80,
        sessions: 20,
      });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].classification).toBe('use_with_caution');
    });

    it('default_choice for #1 agent with no risk and confidence != low', () => {
      const row = makeRow({
        agent_address: '0xBest',
        reasoning: 80, collaboration: 80, efficiency: 80, compliance: 80,
        sessions: 11,
      });
      const { agents, default_choice } = classifyAgents([row], 'default');
      expect(agents[0].classification).toBe('default_choice');
      expect(default_choice).toBe('0xBest');
    });

    it('specialist when not risk, not #1, but passes specialist detection', () => {
      const best = makeRow({
        agent_address: '0xBest',
        reasoning: 90, collaboration: 90, efficiency: 90, compliance: 90,
        sessions: 11,
      });
      const spec = makeRow({
        agent_address: '0xSpec',
        reasoning: 95, collaboration: 40, efficiency: 40, compliance: 40,
        sessions: 5,
      });
      const { agents } = classifyAgents([best, spec], 'default');
      const specAgent = agents.find((a) => a.agent_address === '0xSpec')!;
      expect(specAgent.classification).toBe('specialist');
    });

    it('solid_option for ordinary agent without risk or specialist', () => {
      const best = makeRow({
        agent_address: '0xBest',
        reasoning: 90, collaboration: 90, efficiency: 90, compliance: 90,
        sessions: 11,
      });
      const ordinary = makeRow({
        agent_address: '0xOrd',
        reasoning: 60, collaboration: 60, efficiency: 60, compliance: 60,
        sessions: 5,
      });
      const { agents } = classifyAgents([best, ordinary], 'default');
      const ordAgent = agents.find((a) => a.agent_address === '0xOrd')!;
      expect(ordAgent.classification).toBe('solid_option');
    });
  });

  // =========================================================================
  // Edge cases from decision-logic-v1.md section 15
  // =========================================================================

  describe('Section 15 edge cases', () => {
    it('all scores equal (50/50/50/50) → not specialist, no risk; #1 is default_choice, others are solid_option', () => {
      const a1 = makeRow({ agent_address: '0xA', reasoning: 50, collaboration: 50, efficiency: 50, compliance: 50, sessions: 5 });
      const a2 = makeRow({ agent_address: '0xB', reasoning: 50, collaboration: 50, efficiency: 50, compliance: 50, sessions: 5 });

      const result = classifyAgents([a1, a2], 'default');
      expect(result.agents[0].specialist_area).toBeNull();
      expect(result.agents[0].risk_flags).toHaveLength(0);
      expect(result.agents[0].classification).toBe('default_choice');
      expect(result.agents[1].classification).toBe('solid_option');
    });

    it('all scores below 30 → not_recommended with 3 risk flags', () => {
      const row = makeRow({ reasoning: 20, collaboration: 20, efficiency: 20, compliance: 20, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].risk_flags).toHaveLength(3);
      expect(agents[0].classification).toBe('not_recommended');
    });

    it('one dimension exactly 30 → should NOT trigger a risk flag', () => {
      const row = makeRow({ reasoning: 30, collaboration: 80, efficiency: 80, compliance: 80, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].risk_flags).toHaveLength(0);
    });

    it('0 sessions → low confidence', () => {
      const row = makeRow({ sessions: 0, reasoning: 80, collaboration: 80, efficiency: 80, compliance: 80 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('low');
    });

    it('switching scenarios updates overall score, sort order, and default_choice', () => {
      const highCompliance = makeRow({
        agent_address: '0xProd',
        reasoning: 60, collaboration: 50, efficiency: 50, compliance: 95,
        sessions: 11,
      });
      const highEfficiency = makeRow({
        agent_address: '0xProto',
        reasoning: 60, collaboration: 50, efficiency: 95, compliance: 50,
        sessions: 11,
      });

      const prod = classifyAgents([highCompliance, highEfficiency], 'production');
      expect(prod.agents[0].agent_address).toBe('0xProd');
      expect(prod.default_choice).toBe('0xProd');

      const proto = classifyAgents([highCompliance, highEfficiency], 'prototyping');
      expect(proto.agents[0].agent_address).toBe('0xProto');
      expect(proto.default_choice).toBe('0xProto');
    });

    it('two dimensions tied for max with gap > 30 → specialist uses priority order', () => {
      // reasoning=85 compliance=85 → tie; priority: reasoning first
      // others_mean = (85+40+40)/3 = 55; gap = 85-55 = 30 → NOT > 30
      // Need bigger gap: reasoning=90 compliance=90 eff=30 collab=30
      // others_mean for reasoning: (90+30+30)/3 = 50; gap = 90-50 = 40 > 30
      const row = makeRow({ reasoning: 90, compliance: 90, efficiency: 30, collaboration: 30, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].specialist_area).toBe('Specialist: Complex Implementation');
    });

    it('two dimensions tied for lowest → weakness uses priority order (compliance first)', () => {
      const row = makeRow({ reasoning: 80, collaboration: 80, efficiency: 40, compliance: 40, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].weakness.dimension).toBe('compliance');
    });

    it('1 risk flag + specialist → primary label is use_with_caution, specialist preserved', () => {
      const row = makeRow({
        reasoning: 10, collaboration: 80, efficiency: 40, compliance: 80,
        sessions: 5,
      });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].classification).toBe('use_with_caution');
      expect(agents[0].risk_flags).toHaveLength(1);
      // compliance=80 and collaboration=80 tied for max; compliance wins by priority
      // others_mean = (10+40+80)/3 = 43.33; gap = 80-43.33 = 36.67
      expect(agents[0].specialist_area).toBe('Specialist: Production');
    });

    it('#1 ranked but confidence=low → should NOT be default_choice', () => {
      const row = makeRow({
        reasoning: 90, collaboration: 90, efficiency: 90, compliance: 90,
        sessions: 1,
      });
      const { agents, default_choice } = classifyAgents([row], 'default');
      expect(agents[0].confidence).toBe('low');
      expect(agents[0].classification).not.toBe('default_choice');
      expect(default_choice).toBeNull();
    });

    it('#1 has risk → no default_choice', () => {
      const row = makeRow({
        reasoning: 20, collaboration: 80, efficiency: 80, compliance: 80,
        sessions: 20,
      });
      const { default_choice } = classifyAgents([row], 'default');
      expect(default_choice).toBeNull();
    });
  });

  // =========================================================================
  // Response shape
  // =========================================================================

  describe('response shape', () => {
    it('returns scenario and default_choice fields', () => {
      const row = makeRow({ sessions: 11, reasoning: 80, collaboration: 80, efficiency: 80, compliance: 80 });
      const result = classifyAgents([row], 'production');
      expect(result.scenario).toBe('production');
      expect(typeof result.default_choice).toBe('string');
    });

    it('agents sorted by overall_score descending', () => {
      const a = makeRow({ agent_address: '0xA', reasoning: 90, collaboration: 90, efficiency: 90, compliance: 90, sessions: 5 });
      const b = makeRow({ agent_address: '0xB', reasoning: 40, collaboration: 40, efficiency: 40, compliance: 40, sessions: 5 });
      const c = makeRow({ agent_address: '0xC', reasoning: 70, collaboration: 70, efficiency: 70, compliance: 70, sessions: 5 });

      const { agents } = classifyAgents([b, c, a], 'default');
      expect(agents.map((ag) => ag.agent_address)).toEqual(['0xA', '0xC', '0xB']);
    });

    it('initiative is passthrough in scores', () => {
      const row = makeRow({ initiative: 99, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      expect(agents[0].scores.initiative).toBe(99);
    });

    it('overall_score is one decimal place', () => {
      const row = makeRow({ reasoning: 77, collaboration: 63, efficiency: 81, compliance: 44, sessions: 5 });
      const { agents } = classifyAgents([row], 'default');
      const str = agents[0].overall_score.toString();
      const parts = str.split('.');
      expect(parts.length <= 2).toBe(true);
      if (parts.length === 2) expect(parts[1].length).toBeLessThanOrEqual(1);
    });

    it('empty input returns empty agents with no default_choice', () => {
      const result = classifyAgents([], 'default');
      expect(result.agents).toEqual([]);
      expect(result.default_choice).toBeNull();
    });
  });
});
