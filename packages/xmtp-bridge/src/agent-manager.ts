/**
 * XMTP Agent Manager
 * 
 * Manages XMTP agent instances for the bridge service.
 * Each agent has its own XMTP client and can send/receive messages.
 */

import { Agent } from '@xmtp/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import { keccak256, toUtf8Bytes, hexlify } from 'ethers';
import type { DKGNode, ReceivedMessage, Conversation } from './types.js';

// Message handler callback type
type MessageHandler = (message: ReceivedMessage) => void;

/**
 * Managed agent instance
 */
interface ManagedAgent {
  agent: Agent;
  address: string;
  inboxId?: string;
  agentId?: number;
  sessionToken: string;
  createdAt: number;
  messageHandlers: Set<MessageHandler>;
}

/**
 * AgentManager - Manages multiple XMTP agent instances
 */
export class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map();
  private xmtpEnv: 'dev' | 'production';
  
  constructor(xmtpEnv: 'dev' | 'production' = 'dev') {
    this.xmtpEnv = xmtpEnv;
    console.log(`[AgentManager] Initialized with XMTP env: ${xmtpEnv}`);
  }
  
  /**
   * Register a new agent with XMTP
   * 
   * @param privateKey - Ethereum private key (hex)
   * @param agentId - Optional ERC-8004 agent ID
   * @returns Session token for subsequent requests
   */
  async registerAgent(
    privateKey: string,
    agentId?: number
  ): Promise<{ sessionToken: string; address: string; inboxId?: string }> {
    // Normalize private key
    const normalizedKey = privateKey.startsWith('0x') 
      ? privateKey 
      : `0x${privateKey}`;
    
    try {
      // Create XMTP agent from private key
      const agent = await Agent.create({
        walletKey: normalizedKey,
        env: this.xmtpEnv,
      });
      
      // Generate session token
      const sessionToken = uuidv4();
      
      // Store managed agent
      const managedAgent: ManagedAgent = {
        agent,
        address: agent.address,
        inboxId: agent.client?.inboxId,
        agentId,
        sessionToken,
        createdAt: Date.now(),
        messageHandlers: new Set(),
      };
      
      this.agents.set(sessionToken, managedAgent);
      
      // Set up message listener
      this.setupMessageListener(managedAgent);
      
      console.log(`[AgentManager] Registered agent: ${agent.address}`);
      
      return {
        sessionToken,
        address: agent.address,
        inboxId: managedAgent.inboxId,
      };
    } catch (error) {
      console.error('[AgentManager] Failed to register agent:', error);
      throw error;
    }
  }
  
  /**
   * Get agent by session token
   */
  getAgent(sessionToken: string): ManagedAgent | undefined {
    return this.agents.get(sessionToken);
  }
  
  /**
   * Send a message via XMTP
   * 
   * @param sessionToken - Agent's session token
   * @param to - Recipient address
   * @param content - Message content
   * @param parentIds - Parent message IDs (for causal DAG)
   * @param artifactIds - Artifact CIDs
   * @returns Message ID and DKG node
   */
  async sendMessage(
    sessionToken: string,
    to: string,
    content: Record<string, unknown>,
    parentIds?: string[],
    artifactIds?: string[]
  ): Promise<{ messageId: string; dkgNode: DKGNode }> {
    const managedAgent = this.agents.get(sessionToken);
    if (!managedAgent) {
      throw new Error('Invalid session token');
    }
    
    const { agent, address, agentId } = managedAgent;
    
    // Build message with DKG metadata (Protocol Spec §1.1)
    const timestamp = Date.now();
    const messageData = {
      ...content,
      _chaoschain: {
        version: '0.1',
        author: address,
        agent_id: agentId,
        ts: timestamp,
        parent_ids: parentIds || [],
        artifact_ids: artifactIds || [],
      },
    };
    
    // Compute payload hash
    const payloadHash = keccak256(toUtf8Bytes(JSON.stringify(content)));
    
    try {
      // Get or create conversation
      const conversation = await agent.client?.conversations.newDm(to);
      if (!conversation) {
        throw new Error('Failed to create conversation');
      }
      
      // Send message
      const sentMessage = await conversation.send(JSON.stringify(messageData));
      
      // Create DKG node
      const dkgNode: DKGNode = {
        author: address,
        sig: '', // Would be signed in production
        ts: timestamp,
        xmtp_msg_id: sentMessage.id,
        artifact_ids: artifactIds || [],
        payload_hash: payloadHash,
        parents: parentIds || [],
        agent_id: agentId,
      };
      
      // Compute VLC (§1.3)
      dkgNode.vlc = this.computeVLC(dkgNode, parentIds || []);
      
      console.log(`[AgentManager] Sent message ${sentMessage.id} to ${to}`);
      
      return {
        messageId: sentMessage.id,
        dkgNode,
      };
    } catch (error) {
      console.error('[AgentManager] Failed to send message:', error);
      throw error;
    }
  }
  
  /**
   * Get conversation thread as DKG nodes
   * 
   * @param sessionToken - Agent's session token
   * @param peerAddress - Conversation peer address
   * @param limit - Max messages to fetch
   * @returns Array of DKG nodes and computed thread root
   */
  async getThread(
    sessionToken: string,
    peerAddress: string,
    limit: number = 100
  ): Promise<{ nodes: DKGNode[]; threadRoot: string; edges: Array<{ from: string; to: string }> }> {
    const managedAgent = this.agents.get(sessionToken);
    if (!managedAgent) {
      throw new Error('Invalid session token');
    }
    
    const { agent } = managedAgent;
    
    try {
      // Get conversation
      const conversations = await agent.client?.conversations.list();
      const conversation = conversations?.find(c => 
        c.peerAddress?.toLowerCase() === peerAddress.toLowerCase()
      );
      
      if (!conversation) {
        return { nodes: [], threadRoot: '', edges: [] };
      }
      
      // Fetch messages
      const messages = await conversation.messages({ limit });
      
      // Convert to DKG nodes
      const nodes: DKGNode[] = [];
      const edges: Array<{ from: string; to: string }> = [];
      
      for (const msg of messages) {
        try {
          const parsed = JSON.parse(msg.content as string);
          const chaoschain = parsed._chaoschain || {};
          
          const node: DKGNode = {
            author: msg.senderAddress,
            sig: '',
            ts: chaoschain.ts || new Date(msg.sentAt).getTime(),
            xmtp_msg_id: msg.id,
            artifact_ids: chaoschain.artifact_ids || [],
            payload_hash: keccak256(toUtf8Bytes(JSON.stringify(parsed))),
            parents: chaoschain.parent_ids || [],
            agent_id: chaoschain.agent_id,
          };
          
          nodes.push(node);
          
          // Build edges
          for (const parentId of node.parents) {
            edges.push({ from: parentId, to: node.xmtp_msg_id });
          }
        } catch (e) {
          // Skip malformed messages
          console.warn(`[AgentManager] Skipping malformed message: ${msg.id}`);
        }
      }
      
      // Compute thread root (§1.2)
      const threadRoot = this.computeThreadRoot(nodes);
      
      return { nodes, threadRoot, edges };
    } catch (error) {
      console.error('[AgentManager] Failed to get thread:', error);
      throw error;
    }
  }
  
  /**
   * List all conversations for an agent
   */
  async listConversations(sessionToken: string): Promise<Conversation[]> {
    const managedAgent = this.agents.get(sessionToken);
    if (!managedAgent) {
      throw new Error('Invalid session token');
    }
    
    const { agent } = managedAgent;
    
    try {
      const conversations = await agent.client?.conversations.list();
      
      return (conversations || []).map(c => ({
        id: c.id || '',
        peer_address: c.peerAddress || '',
        created_at: new Date(c.createdAt || 0).getTime(),
        updated_at: Date.now(), // Would need to fetch last message
      }));
    } catch (error) {
      console.error('[AgentManager] Failed to list conversations:', error);
      throw error;
    }
  }
  
  /**
   * Subscribe to incoming messages
   */
  subscribeToMessages(sessionToken: string, handler: MessageHandler): void {
    const managedAgent = this.agents.get(sessionToken);
    if (!managedAgent) {
      throw new Error('Invalid session token');
    }
    
    managedAgent.messageHandlers.add(handler);
  }
  
  /**
   * Unsubscribe from messages
   */
  unsubscribeFromMessages(sessionToken: string, handler: MessageHandler): void {
    const managedAgent = this.agents.get(sessionToken);
    if (managedAgent) {
      managedAgent.messageHandlers.delete(handler);
    }
  }
  
  /**
   * Disconnect agent
   */
  async disconnectAgent(sessionToken: string): Promise<void> {
    const managedAgent = this.agents.get(sessionToken);
    if (!managedAgent) {
      return;
    }
    
    try {
      await managedAgent.agent.stop();
      this.agents.delete(sessionToken);
      console.log(`[AgentManager] Disconnected agent: ${managedAgent.address}`);
    } catch (error) {
      console.error('[AgentManager] Error disconnecting agent:', error);
    }
  }
  
  /**
   * Get number of connected agents
   */
  getConnectedCount(): number {
    return this.agents.size;
  }
  
  // ============ Private Methods ============
  
  /**
   * Set up message listener for an agent
   */
  private setupMessageListener(managedAgent: ManagedAgent): void {
    const { agent, address } = managedAgent;
    
    agent.on('text', async (ctx) => {
      try {
        const parsed = JSON.parse(ctx.message.content as string);
        const chaoschain = parsed._chaoschain || {};
        
        const dkgNode: DKGNode = {
          author: ctx.message.senderAddress || '',
          sig: '',
          ts: chaoschain.ts || Date.now(),
          xmtp_msg_id: ctx.message.id,
          artifact_ids: chaoschain.artifact_ids || [],
          payload_hash: keccak256(toUtf8Bytes(JSON.stringify(parsed))),
          parents: chaoschain.parent_ids || [],
          agent_id: chaoschain.agent_id,
        };
        
        const receivedMessage: ReceivedMessage = {
          id: ctx.message.id,
          sender: ctx.message.senderAddress || '',
          content: parsed,
          timestamp: dkgNode.ts,
          conversation_id: ctx.conversation?.id || '',
          dkg_node: dkgNode,
        };
        
        // Notify all handlers
        for (const handler of managedAgent.messageHandlers) {
          try {
            handler(receivedMessage);
          } catch (e) {
            console.error('[AgentManager] Error in message handler:', e);
          }
        }
      } catch (e) {
        console.warn('[AgentManager] Failed to parse incoming message');
      }
    });
  }
  
  /**
   * Compute Verifiable Logical Clock (§1.3)
   * 
   * VLC makes tampering with ancestry detectable:
   * lc(v) = keccak256(h(v) || max_{p ∈ parents(v)} lc(p))
   */
  private computeVLC(node: DKGNode, parentVLCs: string[]): string {
    const nodeHash = this.computeNodeHash(node);
    
    // Find max parent VLC (or zero if no parents)
    let maxParentVLC = '0x' + '0'.repeat(64);
    for (const vlc of parentVLCs) {
      if (vlc > maxParentVLC) {
        maxParentVLC = vlc;
      }
    }
    
    // VLC = keccak256(nodeHash || maxParentVLC)
    const combined = nodeHash + maxParentVLC.slice(2);
    return keccak256(toUtf8Bytes(combined));
  }
  
  /**
   * Compute canonical hash for a node (§1.2)
   */
  private computeNodeHash(node: DKGNode): string {
    const canonical = `${node.author}|${node.ts}|${node.xmtp_msg_id}|${node.payload_hash}|${node.parents.join(',')}`;
    return keccak256(toUtf8Bytes(canonical));
  }
  
  /**
   * Compute thread root (Merkle root) (§1.2)
   */
  private computeThreadRoot(nodes: DKGNode[]): string {
    if (nodes.length === 0) {
      return '0x' + '0'.repeat(64);
    }
    
    // Sort topologically (by timestamp, then by ID)
    const sorted = [...nodes].sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.xmtp_msg_id.localeCompare(b.xmtp_msg_id);
    });
    
    // Compute hashes
    const hashes = sorted.map(node => this.computeNodeHash(node));
    
    // Build Merkle tree
    let currentLevel = hashes;
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left; // Duplicate if odd
        const combined = left + right.slice(2);
        nextLevel.push(keccak256(toUtf8Bytes(combined)));
      }
      currentLevel = nextLevel;
    }
    
    return currentLevel[0];
  }
}


