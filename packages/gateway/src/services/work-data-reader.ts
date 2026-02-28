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
  ScoreSubmissionProgress,
  CloseEpochInput,
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

// =============================================================================
// PERSISTENCE QUERY INTERFACE (read-only subset)
// =============================================================================

export interface WorkflowQuerySource {
  findWorkByDataHash(dataHash: string): Promise<WorkflowRecord | null>;
  findLatestCompletedWorkForAgent(agentAddress: string): Promise<WorkflowRecord | null>;
  findAllCompletedWorkflowsForAgent(agentAddress: string, limit: number, offset: number): Promise<{ records: WorkflowRecord[]; total: number }>;
  hasCompletedScoreForDataHash(dataHash: string): Promise<boolean>;
  hasCompletedCloseEpoch(studioAddress: string, epoch: number): Promise<boolean>;
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
