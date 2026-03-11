/**
 * Work Data Reader — Read-only DB queries for work visibility
 *
 * Source of truth: workflow persistence records.
 * No on-chain queries. No event scanning.
 */

import type {
  WorkflowRecord,
  WorkSubmissionInput,
  WorkSubmissionProgress,
  ScoreSubmissionInput,
} from '../workflows/types.js';
import type { EvidencePackage } from '../services/dkg/types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface AgentWorkSummary {
  evidence_anchor: string | null;
  derivation_root: string | null;
}

export interface WorkDetail {
  work_id: string;
  agent_id: number;
  studio: string;
  epoch: number | null;
  status: 'pending' | 'scored' | 'finalized';
  consensus_score: number | null;
  evidence_anchor: string | null;
  derivation_root: string | null;
  submitted_at: string;
}

export interface WorkEvidenceDetail {
  work_id: string;
  dkg_evidence: EvidencePackage[];
  thread_root: string | null;
}

export interface WorkContextDetail {
  work_id: string;
  data_hash: string;
  worker_address: string;
  studio_address: string;
  task_type: string;
  studio_policy_version: string;
  work_mandate_id: string;
  evidence: EvidencePackage[];
  studioPolicy: Record<string, unknown> | null;
  workMandate: Record<string, unknown>;
}

export interface AgentHistoryEntry {
  epoch: number | null;
  studio: string;
  role: 'worker' | 'verifier';
  evidence_anchor: string | null;
  derivation_root: string | null;
  submitted_at: string;
  work_id: string;
}

export interface AgentHistoryResult {
  agent_id: number;
  entries: AgentHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeaderboardEntry {
  worker_address: string;
  agent_id: number;
  submissions: number;
  avg_scores: number[] | null;
  last_submitted: string;
}

export interface LeaderboardResult {
  studio: string;
  entries: LeaderboardEntry[];
  total: number;
}

export interface EvidenceViewerData {
  work_id: string;
  worker_address: string;
  studio_address: string;
  nodes: Array<{
    id: string;
    label: string;
    type: 'root' | 'child' | 'integration';
    artifacts: string[];
    timestamp: number;
  }>;
  edges: Array<{ from: string; to: string }>;
}

// =============================================================================
// PERSISTENCE QUERY INTERFACE (read-only subset)
// =============================================================================

export interface PendingWorkItem {
  work_id: string;
  data_hash: string;
  agent_id: number;
  worker_address: string;
  studio_address: string;
  epoch: number | null;
  submitted_at: string;
  evidence_anchor: string | null;
  derivation_root: string | null;
  studio_policy_version: string;
  work_mandate_id: string;
  task_type: string;
}

export interface PendingWorkResult {
  studio: string;
  work: PendingWorkItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkflowQuerySource {
  findWorkByDataHash(dataHash: string): Promise<WorkflowRecord | null>;
  findLatestCompletedWorkForAgent(agentAddress: string): Promise<WorkflowRecord | null>;
  findAllCompletedWorkflowsForAgent(agentAddress: string, limit: number, offset: number): Promise<{ records: WorkflowRecord[]; total: number }>;
  hasCompletedScoreForDataHash(dataHash: string): Promise<boolean>;
  hasCompletedCloseEpoch(studioAddress: string, epoch: number): Promise<boolean>;
  findPendingWorkForStudio(studioAddress: string, limit: number, offset: number): Promise<{ records: WorkflowRecord[]; total: number }>;
  findAllWorkForStudio(studioAddress: string, limit: number, offset: number): Promise<{ records: WorkflowRecord[]; total: number }>;
  findScoresForDataHash(dataHash: string): Promise<WorkflowRecord[]>;
}

// =============================================================================
// WORK DATA READER
// =============================================================================

export class WorkDataReader {
  private querySource: WorkflowQuerySource;
  private agentIdResolver: ((address: string) => Promise<number>) | null;

  constructor(
    querySource: WorkflowQuerySource,
    agentIdResolver?: (address: string) => Promise<number>,
  ) {
    this.querySource = querySource;
    this.agentIdResolver = agentIdResolver ?? null;
  }

  async getLatestWorkForAgent(agentAddress: string): Promise<AgentWorkSummary | null> {
    const workflow = await this.querySource.findLatestCompletedWorkForAgent(
      agentAddress.toLowerCase(),
    );
    if (!workflow) return null;

    const progress = workflow.progress as WorkSubmissionProgress;
    return {
      evidence_anchor: progress.arweave_tx_id ?? null,
      derivation_root: progress.dkg_thread_root ?? null,
    };
  }

  async getWorkByHash(dataHash: string): Promise<WorkDetail | null> {
    const workflow = await this.querySource.findWorkByDataHash(dataHash);
    if (!workflow) return null;

    const input = workflow.input as WorkSubmissionInput;
    const progress = workflow.progress as WorkSubmissionProgress;

    const status = await this.deriveStatus(workflow, input);

    let agentId = 0;
    if (this.agentIdResolver) {
      try {
        agentId = await this.agentIdResolver(input.agent_address);
      } catch {
        // Resolver failed — return 0 (requires address→agentId indexer)
      }
    }

    return {
      work_id: input.data_hash,
      agent_id: agentId,
      studio: input.studio_address,
      epoch: input.epoch ?? null,
      status,
      consensus_score: null,
      evidence_anchor: progress.arweave_tx_id ?? null,
      derivation_root: progress.dkg_thread_root ?? null,
      submitted_at: new Date(workflow.created_at).toISOString(),
    };
  }

  async getWorkEvidence(dataHash: string): Promise<WorkEvidenceDetail | null> {
    const workflow = await this.querySource.findWorkByDataHash(dataHash);
    if (!workflow) return null;

    const input = workflow.input as WorkSubmissionInput;
    const progress = workflow.progress as WorkSubmissionProgress;

    return {
      work_id: input.data_hash,
      dkg_evidence: input.dkg_evidence ?? [],
      thread_root: progress.dkg_thread_root ?? null,
    };
  }

  async getAgentHistory(
    agentAddress: string,
    agentId: number,
    limit: number,
    offset: number,
  ): Promise<AgentHistoryResult> {
    const { records, total } = await this.querySource.findAllCompletedWorkflowsForAgent(
      agentAddress.toLowerCase(),
      limit,
      offset,
    );

    const entries: AgentHistoryEntry[] = records.map((record) => {
      if (record.type === 'ScoreSubmission') {
        const input = record.input as ScoreSubmissionInput;
        return {
          epoch: input.epoch ?? null,
          studio: input.studio_address,
          role: 'verifier' as const,
          evidence_anchor: null,
          derivation_root: null,
          submitted_at: new Date(record.created_at).toISOString(),
          work_id: input.data_hash,
        };
      }

      const input = record.input as WorkSubmissionInput;
      const progress = record.progress as WorkSubmissionProgress;
      return {
        epoch: input.epoch ?? null,
        studio: input.studio_address,
        role: 'worker' as const,
        evidence_anchor: progress.arweave_tx_id ?? null,
        derivation_root: progress.dkg_thread_root ?? null,
        submitted_at: new Date(record.created_at).toISOString(),
        work_id: input.data_hash,
      };
    });

    return { agent_id: agentId, entries, total, limit, offset };
  }

  async getPendingWorkForStudio(
    studioAddress: string,
    limit: number,
    offset: number,
  ): Promise<PendingWorkResult> {
    const { records, total } = await this.querySource.findPendingWorkForStudio(
      studioAddress.toLowerCase(),
      limit,
      offset,
    );

    const work: PendingWorkItem[] = [];
    for (const record of records) {
      const input = record.input as WorkSubmissionInput;
      const progress = record.progress as WorkSubmissionProgress;

      let agentId = 0;
      if (this.agentIdResolver) {
        try {
          agentId = await this.agentIdResolver(input.agent_address);
        } catch {
          // Resolver unavailable
        }
      }

      work.push({
        work_id: input.data_hash,
        data_hash: input.data_hash,
        agent_id: agentId,
        worker_address: input.agent_address,
        studio_address: input.studio_address,
        epoch: input.epoch ?? null,
        submitted_at: new Date(record.created_at).toISOString(),
        evidence_anchor: progress.arweave_tx_id ?? null,
        derivation_root: progress.dkg_thread_root ?? null,
        studio_policy_version: input.studio_policy_version ?? 'engineering-studio-default-v1',
        work_mandate_id: input.work_mandate_id ?? 'generic-task',
        task_type: input.task_type ?? 'general',
      });
    }

    return { studio: studioAddress, work, total, limit, offset };
  }

  async getWorkContext(
    dataHash: string,
    policyLoader: (version: string) => Record<string, unknown> | null,
    mandateLoader: (mandateId: string) => Record<string, unknown>,
  ): Promise<WorkContextDetail | null> {
    const workflow = await this.querySource.findWorkByDataHash(dataHash);
    if (!workflow) return null;

    const input = workflow.input as WorkSubmissionInput;

    const policyVersion = input.studio_policy_version ?? 'engineering-studio-default-v1';
    const mandateId = input.work_mandate_id ?? 'generic-task';
    const taskType = input.task_type ?? 'general';

    return {
      work_id: input.data_hash,
      data_hash: input.data_hash,
      worker_address: input.agent_address,
      studio_address: input.studio_address,
      task_type: taskType,
      studio_policy_version: policyVersion,
      work_mandate_id: mandateId,
      evidence: input.dkg_evidence ?? [],
      studioPolicy: policyLoader(policyVersion),
      workMandate: mandateLoader(mandateId),
    };
  }

  async getLeaderboard(studioAddress: string): Promise<LeaderboardResult> {
    const { records } = await this.querySource.findAllWorkForStudio(
      studioAddress.toLowerCase(), 1000, 0,
    );

    const byWorker = new Map<string, {
      submissions: number;
      scoreArrays: number[][];
      lastCreated: number;
    }>();

    for (const record of records) {
      const input = record.input as WorkSubmissionInput;
      const addr = input.agent_address.toLowerCase();
      const existing = byWorker.get(addr) ?? { submissions: 0, scoreArrays: [], lastCreated: 0 };
      existing.submissions++;
      if (record.created_at > existing.lastCreated) existing.lastCreated = record.created_at;

      const scores = await this.querySource.findScoresForDataHash(input.data_hash);
      for (const scoreWf of scores) {
        const sInput = scoreWf.input as ScoreSubmissionInput;
        if (sInput.scores?.length) existing.scoreArrays.push(sInput.scores);
      }

      byWorker.set(addr, existing);
    }

    const entries: LeaderboardEntry[] = [];
    for (const [addr, data] of byWorker) {
      let agentId = 0;
      if (this.agentIdResolver) {
        try { agentId = await this.agentIdResolver(addr); } catch { /* ignore */ }
      }

      let avgScores: number[] | null = null;
      if (data.scoreArrays.length > 0) {
        const dimCount = data.scoreArrays[0].length;
        avgScores = Array(dimCount).fill(0);
        for (const sa of data.scoreArrays) {
          for (let i = 0; i < dimCount && i < sa.length; i++) avgScores[i] += sa[i];
        }
        avgScores = avgScores.map(v => Math.round(v / data.scoreArrays.length));
      }

      entries.push({
        worker_address: addr,
        agent_id: agentId,
        submissions: data.submissions,
        avg_scores: avgScores,
        last_submitted: new Date(data.lastCreated).toISOString(),
      });
    }

    entries.sort((a, b) => b.submissions - a.submissions);

    return { studio: studioAddress, entries, total: entries.length };
  }

  async getEvidenceViewer(dataHash: string): Promise<EvidenceViewerData | null> {
    const workflow = await this.querySource.findWorkByDataHash(dataHash);
    if (!workflow) return null;

    const input = workflow.input as WorkSubmissionInput;
    const evidence = input.dkg_evidence ?? [];

    const childIds = new Set<string>();
    for (const ep of evidence) {
      for (const pid of ep.parent_ids) childIds.add(pid);
    }

    const nodes = evidence.map(ep => {
      let type: 'root' | 'child' | 'integration' = 'child';
      if (ep.parent_ids.length === 0) type = 'root';
      else if (ep.parent_ids.length >= 2) type = 'integration';

      return {
        id: ep.arweave_tx_id,
        label: ep.payload_hash.slice(0, 14) + '...',
        type,
        artifacts: ep.artifact_ids,
        timestamp: ep.timestamp,
      };
    });

    const edges: Array<{ from: string; to: string }> = [];
    for (const ep of evidence) {
      for (const pid of ep.parent_ids) {
        edges.push({ from: pid, to: ep.arweave_tx_id });
      }
    }

    return {
      work_id: input.data_hash,
      worker_address: input.agent_address,
      studio_address: input.studio_address,
      nodes,
      edges,
    };
  }

  private async deriveStatus(
    workflow: WorkflowRecord,
    input: WorkSubmissionInput,
  ): Promise<'pending' | 'scored' | 'finalized'> {
    if (workflow.state !== 'COMPLETED') return 'pending';

    const hasCloseEpoch = await this.querySource.hasCompletedCloseEpoch(
      input.studio_address,
      input.epoch,
    );
    if (hasCloseEpoch) return 'finalized';

    const hasScore = await this.querySource.hasCompletedScoreForDataHash(
      input.data_hash,
    );
    if (hasScore) return 'scored';

    return 'pending';
  }
}
