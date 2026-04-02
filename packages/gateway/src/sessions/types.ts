/**
 * Engineering Studio — Canonical Session & Event Types
 *
 * These types mirror the schema in EngineeringStudioCanonical_Coding-Session_Event.md.
 * Agents emit CodingSessionEvents; the gateway normalises them into an Evidence DAG.
 */

// =============================================================================
// CANONICAL EVENT TYPES (the set accepted during MVP)
// =============================================================================

export const CANONICAL_EVENT_TYPES = [
  // Task / context
  'task_received',
  'mandate_attached',
  'policy_acknowledged',
  // Planning / reasoning
  'plan_created',
  'design_decision_made',
  'strategy_revised',
  // Collaboration
  'collaborator_selected',
  'delegation_created',
  'external_input_received',
  // Execution
  'tool_invoked',
  'file_read',
  'file_written',
  'artifact_created',
  'command_executed',
  // Validation / debugging
  'test_run',
  'test_failed',
  'test_passed',
  'error_observed',
  'debug_step',
  'revision_made',
  // Completion
  'submission_created',
  'task_completed',
  // Verifier-side
  'verification_started',
  'score_vector_created',
  'outcome_evaluated',
  'verification_completed',
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

// =============================================================================
// ARTIFACT
// =============================================================================

export interface EventArtifact {
  type: string; // code | diff | test_result | plan | log | command_output | message | file_bundle
  id: string;
  label: string;
  uri?: string;
  hash?: string;
}

// =============================================================================
// CODING SESSION EVENT (canonical envelope)
// =============================================================================

export interface CodingSessionEvent {
  version: string;
  session_id: string;
  event_id: string;
  event_type: CanonicalEventType;
  timestamp: string; // ISO-8601

  studio: {
    studio_address: string;
    studio_policy_version: string;
  };

  task: {
    work_mandate_id: string;
    task_type: string;
    task_id?: string;
  };

  agent: {
    agent_address: string;
    role: 'worker' | 'verifier' | 'collaborator';
  };

  causality: {
    parent_event_ids: string[];
    thread_id?: string;
  };

  summary: string;

  artifacts?: EventArtifact[];
  metadata?: Record<string, unknown>;
  metrics?: {
    duration_ms?: number;
    tokens_input?: number;
    tokens_output?: number;
    tool_calls?: number;
  };
}

// =============================================================================
// SESSION STATUS
// =============================================================================

export type SessionStatus = 'running' | 'completed' | 'failed';

// =============================================================================
// SESSION METADATA (stored alongside events)
// =============================================================================

export interface SessionMetadata {
  session_id: string;
  session_root_event_id: string | null;
  studio_address: string;
  studio_policy_version: string;
  work_mandate_id: string;
  task_type: string;
  agent_address: string;
  agent_name?: string | null;
  status: SessionStatus;
  started_at: string; // ISO-8601
  completed_at: string | null;
  event_count: number;
  epoch: number | null;
  workflow_id: string | null;
  data_hash: string | null;
}

// =============================================================================
// CREATE SESSION INPUT
// =============================================================================

export interface CreateSessionInput {
  session_id?: string; // client-generated, server falls back to UUID
  studio_address: string;
  studio_policy_version?: string;
  work_mandate_id?: string;
  task_type?: string;
  agent_address: string;
  agent_name?: string;
}

// =============================================================================
// COMPLETE SESSION INPUT
// =============================================================================

export interface CompleteSessionInput {
  status?: 'completed' | 'failed';
  summary?: string;
}

// =============================================================================
// STORED EVENT (raw payload + gateway receipt timestamp)
// =============================================================================

/**
 * Wrapper around the raw event as received from the agent.
 * `received_at` is set by the gateway; everything else is the
 * unmodified client payload (deep-cloned on ingest).
 */
export interface StoredEvent {
  received_at: string; // ISO-8601, gateway clock
  event: CodingSessionEvent;
}

// =============================================================================
// EVIDENCE DAG NODE (materialised from a CodingSessionEvent)
// =============================================================================

export interface EvidenceNode {
  node_id: string;
  event_id: string;       // same as node_id — explicit for DKG consumers
  session_id: string;
  event_type: CanonicalEventType;
  agent_address: string;
  timestamp: string;
  parent_ids: string[];   // from causality.parent_event_ids
  payload_hash: string;   // sha256 of the raw event JSON
  summary: string;
  artifacts: EventArtifact[];
  metadata: Record<string, unknown>;
  metrics?: {
    duration_ms?: number;
    tokens_input?: number;
    tokens_output?: number;
    tool_calls?: number;
  };
}

// =============================================================================
// EVIDENCE DAG EDGE
// =============================================================================

export interface EvidenceEdge {
  parent_node_id: string;
  child_node_id: string;
  relation: 'causal';
}

// =============================================================================
// EVIDENCE DAG (complete materialised structure)
// =============================================================================

/** Verifier-side event types that auto-attach to the terminal worker node. */
export const VERIFIER_EVENT_TYPES: ReadonlySet<CanonicalEventType> = new Set([
  'verification_started',
  'score_vector_created',
  'outcome_evaluated',
  'verification_completed',
]);

/** Worker terminal event types. */
export const TERMINAL_EVENT_TYPES: ReadonlySet<CanonicalEventType> = new Set([
  'submission_created',
  'task_completed',
]);

export interface EvidenceDAG {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  roots: string[];      // node_ids with no parents
  terminals: string[];  // node_ids with no children
  merkle_root: string;  // sha256 of sorted payload_hashes
}

// =============================================================================
// SESSION LIST (paginated list response)
// =============================================================================

export interface SessionListItem {
  session_id: string;
  status: SessionStatus;
  epoch: number | null;
  agent_address: string;
  agent_name?: string | null;
  studio_address: string;
  created_at: string;
  node_count: number;
}

export interface ListSessionsResult {
  sessions: SessionListItem[];
  total: number;
}

// =============================================================================
// AGENT COMPARE (decision-logic-v1)
// =============================================================================

export type Scenario = 'default' | 'production' | 'prototyping' | 'code_review';
export type Classification = 'default_choice' | 'specialist' | 'use_with_caution' | 'not_recommended' | 'solid_option';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface AgentCompareResult {
  agent_address: string;
  agent_name: string | null;
  scores: {
    reasoning: number;
    collaboration: number;
    efficiency: number;
    compliance: number;
    initiative: number;
  };
  session_count: number;
  overall_score: number;
  scenario: Scenario;
  classification: Classification;
  specialist_area: string | null;
  best_for: string[];
  weakness: { dimension: string; label: string; score: number };
  confidence: ConfidenceLevel;
  risk_flags: { dimension: string; message: string }[];
}

export interface CompareResponse {
  scenario: Scenario;
  default_choice: string | null;
  agents: AgentCompareResult[];
}
