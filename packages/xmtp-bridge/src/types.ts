/**
 * XMTP Bridge Types
 * 
 * Type definitions for the ChaosChain XMTP Bridge Service.
 * Enables cross-language agent communication via XMTP.
 */

/**
 * DKG Node structure (Protocol Spec §1.1)
 * 
 * Represents a node in the Decentralized Knowledge Graph.
 * Each XMTP message becomes a DKG node with causal links.
 */
export interface DKGNode {
  /** ERC-8004 agent address (author of this node) */
  author: string;
  
  /** Cryptographic signature over node contents */
  sig: string;
  
  /** Unix timestamp in milliseconds */
  ts: number;
  
  /** XMTP message ID (unique identifier) */
  xmtp_msg_id: string;
  
  /** Array of artifact CIDs (IPFS/Arweave) */
  artifact_ids: string[];
  
  /** keccak256 hash of the payload */
  payload_hash: string;
  
  /** Parent XMTP message IDs (for causal DAG) */
  parents: string[];
  
  /** Verifiable Logical Clock value (§1.3) */
  vlc?: string;
  
  /** ERC-8004 Agent ID (if registered) */
  agent_id?: number;
}

/**
 * XMTP Message for sending/receiving
 */
export interface XMTPMessage {
  /** Message content (JSON) */
  content: Record<string, unknown>;
  
  /** Recipient address */
  to: string;
  
  /** Parent message IDs (for causal DAG) */
  parent_ids?: string[];
  
  /** Artifact CIDs to include */
  artifact_ids?: string[];
  
  /** Message type for routing */
  type?: string;
}

/**
 * Message received from XMTP
 */
export interface ReceivedMessage {
  /** XMTP message ID */
  id: string;
  
  /** Sender address */
  sender: string;
  
  /** Message content (JSON) */
  content: Record<string, unknown>;
  
  /** Timestamp */
  timestamp: number;
  
  /** Conversation ID */
  conversation_id: string;
  
  /** DKG node representation */
  dkg_node: DKGNode;
}

/**
 * Conversation thread (XMTP conversation)
 */
export interface Conversation {
  /** Conversation ID */
  id: string;
  
  /** Peer address */
  peer_address: string;
  
  /** Creation timestamp */
  created_at: number;
  
  /** Latest message timestamp */
  updated_at: number;
}

/**
 * Agent registration request
 */
export interface RegisterAgentRequest {
  /** Private key (hex, with or without 0x prefix) */
  private_key: string;
  
  /** ERC-8004 Agent ID (optional) */
  agent_id?: number;
  
  /** XMTP environment: 'dev' | 'production' */
  env?: 'dev' | 'production';
}

/**
 * Agent registration response
 */
export interface RegisterAgentResponse {
  /** Success flag */
  success: boolean;
  
  /** Agent's XMTP address */
  address: string;
  
  /** Inbox ID (XMTP identity) */
  inbox_id?: string;
  
  /** Session token for subsequent requests */
  session_token: string;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Send message request
 */
export interface SendMessageRequest {
  /** Session token from registration */
  session_token: string;
  
  /** Recipient address */
  to: string;
  
  /** Message content */
  content: Record<string, unknown>;
  
  /** Parent message IDs (for causal DAG) */
  parent_ids?: string[];
  
  /** Artifact CIDs (IPFS/Arweave) */
  artifact_ids?: string[];
}

/**
 * Send message response
 */
export interface SendMessageResponse {
  /** Success flag */
  success: boolean;
  
  /** XMTP message ID */
  message_id?: string;
  
  /** DKG node created */
  dkg_node?: DKGNode;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Get thread request
 */
export interface GetThreadRequest {
  /** Session token */
  session_token: string;
  
  /** Conversation peer address */
  peer_address: string;
  
  /** Limit number of messages */
  limit?: number;
  
  /** Cursor for pagination */
  cursor?: string;
}

/**
 * Thread response (array of DKG nodes)
 */
export interface GetThreadResponse {
  /** Success flag */
  success: boolean;
  
  /** DKG nodes (messages) */
  nodes: DKGNode[];
  
  /** Computed thread root (§1.2) */
  thread_root?: string;
  
  /** Causal edges (parent -> child) */
  edges: Array<{ from: string; to: string }>;
  
  /** Next cursor for pagination */
  next_cursor?: string;
  
  /** Error message if failed */
  error?: string;
}

/**
 * WebSocket message types
 */
export type WSMessageType = 
  | 'subscribe'
  | 'unsubscribe'
  | 'message'
  | 'ack'
  | 'error';

/**
 * WebSocket message envelope
 */
export interface WSMessage {
  /** Message type */
  type: WSMessageType;
  
  /** Session token */
  session_token: string;
  
  /** Payload data */
  payload: Record<string, unknown>;
  
  /** Request ID for correlation */
  request_id?: string;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  xmtp_env: string;
  connected_agents: number;
  uptime_seconds: number;
}


