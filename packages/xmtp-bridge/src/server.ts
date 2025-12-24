/**
 * XMTP Bridge Server
 * 
 * HTTP/WebSocket server that bridges XMTP network to any language.
 * Python, Rust, and other agents can use this service via HTTP/WS.
 * 
 * Architecture:
 *   Python Agent ─┬─ HTTP/WS ─┬─> XMTP Bridge ─> XMTP Network
 *   Rust Agent   ─┘           │
 *   TS Agent ─── Direct ──────┘
 * 
 * Protocol Spec Compliance:
 *   - §1.1: DKG Graph Structure (DKGNode in messages)
 *   - §1.2: Thread Root computation (Merkle root)
 *   - §1.3: VLC computation (Verifiable Logical Clock)
 *   - §1.5: Causal Audit support (thread reconstruction)
 * 
 * @author ChaosChain Labs
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import { config } from 'dotenv';
import { AgentManager } from './agent-manager.js';
import type {
  RegisterAgentRequest,
  RegisterAgentResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetThreadRequest,
  GetThreadResponse,
  HealthResponse,
  WSMessage,
  ReceivedMessage,
} from './types.js';

// Load environment variables
config();

const PORT = parseInt(process.env.XMTP_BRIDGE_PORT || '3847', 10);
const XMTP_ENV = (process.env.XMTP_ENV || 'dev') as 'dev' | 'production';
const API_KEY = process.env.XMTP_BRIDGE_API_KEY || '';

// Initialize
const app: Express = express();
const httpServer: Server = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const agentManager = new AgentManager(XMTP_ENV);

// Track WebSocket connections
const wsConnections: Map<string, Set<WebSocket>> = new Map();

// Startup time
const startTime = Date.now();

// ============ Middleware ============

app.use(cors());
app.use(express.json());

// API Key authentication (optional)
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  if (API_KEY) {
    const providedKey = req.headers['x-api-key'] || req.query.api_key;
    if (providedKey !== API_KEY) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
  }
  next();
};

// ============ REST API Routes ============

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  const health: HealthResponse = {
    status: 'healthy',
    version: '0.1.0',
    xmtp_env: XMTP_ENV,
    connected_agents: agentManager.getConnectedCount(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  };
  res.json(health);
});

/**
 * Register an agent with XMTP
 * 
 * POST /v1/agents/register
 * Body: { private_key: string, agent_id?: number, env?: string }
 */
app.post('/v1/agents/register', authenticate, async (req: Request, res: Response) => {
  try {
    const body: RegisterAgentRequest = req.body;
    
    if (!body.private_key) {
      res.status(400).json({ 
        success: false, 
        error: 'private_key is required' 
      } as RegisterAgentResponse);
      return;
    }
    
    const result = await agentManager.registerAgent(
      body.private_key,
      body.agent_id
    );
    
    const response: RegisterAgentResponse = {
      success: true,
      address: result.address,
      inbox_id: result.inboxId,
      session_token: result.sessionToken,
    };
    
    res.json(response);
  } catch (error) {
    console.error('[Server] Register error:', error);
    const response: RegisterAgentResponse = {
      success: false,
      address: '',
      session_token: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    res.status(500).json(response);
  }
});

/**
 * Send a message via XMTP
 * 
 * POST /v1/messages/send
 * Body: { session_token, to, content, parent_ids?, artifact_ids? }
 */
app.post('/v1/messages/send', authenticate, async (req: Request, res: Response) => {
  try {
    const body: SendMessageRequest = req.body;
    
    if (!body.session_token || !body.to || !body.content) {
      res.status(400).json({
        success: false,
        error: 'session_token, to, and content are required',
      } as SendMessageResponse);
      return;
    }
    
    const result = await agentManager.sendMessage(
      body.session_token,
      body.to,
      body.content,
      body.parent_ids,
      body.artifact_ids
    );
    
    const response: SendMessageResponse = {
      success: true,
      message_id: result.messageId,
      dkg_node: result.dkgNode,
    };
    
    res.json(response);
  } catch (error) {
    console.error('[Server] Send message error:', error);
    const response: SendMessageResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    res.status(500).json(response);
  }
});

/**
 * Get conversation thread as DKG
 * 
 * POST /v1/threads/get
 * Body: { session_token, peer_address, limit? }
 */
app.post('/v1/threads/get', authenticate, async (req: Request, res: Response) => {
  try {
    const body: GetThreadRequest = req.body;
    
    if (!body.session_token || !body.peer_address) {
      res.status(400).json({
        success: false,
        nodes: [],
        edges: [],
        error: 'session_token and peer_address are required',
      } as GetThreadResponse);
      return;
    }
    
    const result = await agentManager.getThread(
      body.session_token,
      body.peer_address,
      body.limit
    );
    
    const response: GetThreadResponse = {
      success: true,
      nodes: result.nodes,
      thread_root: result.threadRoot,
      edges: result.edges,
    };
    
    res.json(response);
  } catch (error) {
    console.error('[Server] Get thread error:', error);
    const response: GetThreadResponse = {
      success: false,
      nodes: [],
      edges: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    res.status(500).json(response);
  }
});

/**
 * List conversations
 * 
 * GET /v1/conversations?session_token=xxx
 */
app.get('/v1/conversations', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionToken = req.query.session_token as string;
    
    if (!sessionToken) {
      res.status(400).json({ error: 'session_token is required' });
      return;
    }
    
    const conversations = await agentManager.listConversations(sessionToken);
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('[Server] List conversations error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Disconnect agent
 * 
 * POST /v1/agents/disconnect
 * Body: { session_token }
 */
app.post('/v1/agents/disconnect', authenticate, async (req: Request, res: Response) => {
  try {
    const { session_token } = req.body;
    
    if (!session_token) {
      res.status(400).json({ error: 'session_token is required' });
      return;
    }
    
    await agentManager.disconnectAgent(session_token);
    
    // Close WebSocket connections for this session
    const wsSet = wsConnections.get(session_token);
    if (wsSet) {
      for (const ws of wsSet) {
        ws.close();
      }
      wsConnections.delete(session_token);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Server] Disconnect error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============ WebSocket Handler ============

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] New connection');
  
  let sessionToken: string | null = null;
  
  ws.on('message', async (data: Buffer) => {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'subscribe':
          // Subscribe to messages for a session
          sessionToken = message.session_token;
          
          // Track connection
          if (!wsConnections.has(sessionToken)) {
            wsConnections.set(sessionToken, new Set());
          }
          wsConnections.get(sessionToken)!.add(ws);
          
          // Set up message handler
          const handler = (msg: ReceivedMessage) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'message',
                payload: msg,
              }));
            }
          };
          
          agentManager.subscribeToMessages(sessionToken, handler);
          
          // Store handler for cleanup
          (ws as any)._messageHandler = handler;
          
          ws.send(JSON.stringify({
            type: 'ack',
            request_id: message.request_id,
            payload: { subscribed: true },
          }));
          break;
          
        case 'unsubscribe':
          if (sessionToken && (ws as any)._messageHandler) {
            agentManager.unsubscribeFromMessages(sessionToken, (ws as any)._messageHandler);
          }
          
          ws.send(JSON.stringify({
            type: 'ack',
            request_id: message.request_id,
            payload: { unsubscribed: true },
          }));
          break;
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            request_id: message.request_id,
            payload: { error: `Unknown message type: ${message.type}` },
          }));
      }
    } catch (error) {
      console.error('[WS] Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        payload: { error: 'Invalid message format' },
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('[WS] Connection closed');
    
    // Cleanup
    if (sessionToken) {
      const wsSet = wsConnections.get(sessionToken);
      if (wsSet) {
        wsSet.delete(ws);
        if (wsSet.size === 0) {
          wsConnections.delete(sessionToken);
        }
      }
      
      if ((ws as any)._messageHandler) {
        agentManager.unsubscribeFromMessages(sessionToken, (ws as any)._messageHandler);
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('[WS] WebSocket error:', error);
  });
});

// ============ Start Server ============

httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         CHAOSCHAIN XMTP BRIDGE SERVICE                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  HTTP API:    http://localhost:${PORT}/v1                       ║`);
  console.log(`║  WebSocket:   ws://localhost:${PORT}                            ║`);
  console.log(`║  Health:      http://localhost:${PORT}/health                   ║`);
  console.log(`║  XMTP Env:    ${XMTP_ENV.padEnd(47)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Protocol Spec v0.1 Compliance:                              ║');
  console.log('║    • §1.1 DKG Graph Structure ✓                              ║');
  console.log('║    • §1.2 Thread Root (Merkle) ✓                             ║');
  console.log('║    • §1.3 Verifiable Logical Clock ✓                         ║');
  console.log('║    • §1.5 Causal Audit Support ✓                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  
  // Close WebSocket connections
  for (const [, wsSet] of wsConnections) {
    for (const ws of wsSet) {
      ws.close();
    }
  }
  
  httpServer.close(() => {
    console.log('[Server] Goodbye!');
    process.exit(0);
  });
});


