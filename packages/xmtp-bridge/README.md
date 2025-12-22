# @chaoschain/xmtp-bridge

XMTP Bridge Service for ChaosChain Protocol - enables cross-language agent communication via [XMTP](https://xmtp.org).

## Why a Bridge?

XMTP only provides a Node.js/TypeScript SDK (`@xmtp/agent-sdk`). This bridge service enables **any language** (Python, Rust, Go, etc.) to use XMTP for agent-to-agent communication.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     XMTP BRIDGE ARCHITECTURE                                │
│                                                                             │
│   Python Agent         TypeScript Agent         Rust Agent                  │
│       │                      │                      │                       │
│       │ HTTP/WS              │ Direct               │ HTTP/WS               │
│       ▼                      ▼                      ▼                       │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                   XMTP Bridge Service                                │  │
│   │                   (Node.js / TypeScript)                             │  │
│   │                                                                       │  │
│   │  • @xmtp/agent-sdk integration                                       │  │
│   │  • HTTP REST API for cross-language access                          │  │
│   │  • WebSocket for real-time message streaming                        │  │
│   │  • ERC-8004 identity mapping                                        │  │
│   │  • DKG node construction                                            │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                     XMTP Network                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Protocol Spec v0.1 Compliance

| Section | Feature | Status |
|---------|---------|--------|
| §1.1 | DKG Graph Structure | ✅ |
| §1.2 | Thread Root (Merkle) | ✅ |
| §1.3 | Verifiable Logical Clock (VLC) | ✅ |
| §1.4 | DataHash Pattern | ✅ |
| §1.5 | Causal Audit Support | ✅ |

## Installation

```bash
cd packages/xmtp-bridge
npm install
```

## Configuration

Create a `.env` file:

```env
# XMTP environment: 'dev' or 'production'
XMTP_ENV=dev

# Bridge server port
XMTP_BRIDGE_PORT=3847

# Optional API key for authentication
XMTP_BRIDGE_API_KEY=your-secret-key
```

## Running

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

## API Reference

### Health Check

```bash
GET /health

Response:
{
  "status": "healthy",
  "version": "0.1.0",
  "xmtp_env": "dev",
  "connected_agents": 5,
  "uptime_seconds": 3600
}
```

### Register Agent

Connect an agent to XMTP using their Ethereum private key.

```bash
POST /v1/agents/register
Content-Type: application/json

{
  "private_key": "0x...",
  "agent_id": 4487  // Optional ERC-8004 agent ID
}

Response:
{
  "success": true,
  "address": "0x61f50942...",
  "inbox_id": "abcd1234...",
  "session_token": "uuid-session-token"
}
```

### Send Message

Send an XMTP message with DKG metadata (causal links, artifact CIDs).

```bash
POST /v1/messages/send
Content-Type: application/json

{
  "session_token": "uuid-session-token",
  "to": "0xRecipientAddress",
  "content": {
    "type": "task_request",
    "task": "Analyze market data",
    "deadline": 1234567890
  },
  "parent_ids": ["prev-msg-id"],  // For causal DAG
  "artifact_ids": ["ipfs://Qm..."]  // Evidence CIDs
}

Response:
{
  "success": true,
  "message_id": "xmtp-msg-123",
  "dkg_node": {
    "author": "0x61f50942...",
    "ts": 1703097600000,
    "xmtp_msg_id": "xmtp-msg-123",
    "artifact_ids": ["ipfs://Qm..."],
    "payload_hash": "0x...",
    "parents": ["prev-msg-id"],
    "vlc": "0x..."
  }
}
```

### Get Thread (DKG)

Fetch a conversation thread as a Decentralized Knowledge Graph.

```bash
POST /v1/threads/get
Content-Type: application/json

{
  "session_token": "uuid-session-token",
  "peer_address": "0xPeerAddress",
  "limit": 100
}

Response:
{
  "success": true,
  "nodes": [
    {
      "author": "0x61f50942...",
      "ts": 1703097600000,
      "xmtp_msg_id": "msg-1",
      "parents": [],
      "artifact_ids": [],
      "payload_hash": "0x...",
      "vlc": "0x..."
    },
    {
      "author": "0x121407e7...",
      "ts": 1703097660000,
      "xmtp_msg_id": "msg-2",
      "parents": ["msg-1"],
      "artifact_ids": ["ipfs://Qm..."],
      "payload_hash": "0x...",
      "vlc": "0x..."
    }
  ],
  "thread_root": "0x...",  // Merkle root (§1.2)
  "edges": [
    { "from": "msg-1", "to": "msg-2" }
  ]
}
```

### List Conversations

```bash
GET /v1/conversations?session_token=uuid-session-token

Response:
{
  "success": true,
  "conversations": [
    {
      "id": "conv-1",
      "peer_address": "0xPeerAddress",
      "created_at": 1703097600000,
      "updated_at": 1703097660000
    }
  ]
}
```

### Disconnect Agent

```bash
POST /v1/agents/disconnect
Content-Type: application/json

{
  "session_token": "uuid-session-token"
}

Response:
{
  "success": true
}
```

## WebSocket API

For real-time message streaming:

```javascript
const ws = new WebSocket('ws://localhost:3847');

// Subscribe to messages
ws.send(JSON.stringify({
  type: 'subscribe',
  session_token: 'uuid-session-token',
  request_id: '1'
}));

// Receive messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'message') {
    console.log('Received:', data.payload);
    // {
    //   id: 'msg-id',
    //   sender: '0x...',
    //   content: {...},
    //   timestamp: 1703097660000,
    //   conversation_id: 'conv-1',
    //   dkg_node: {...}
    // }
  }
};
```

## Python Client Usage

Use the ChaosChain SDK's `XMTPBridgeClient`:

```python
from chaoschain_sdk import ChaosChainAgentSDK

sdk = ChaosChainAgentSDK(
    agent_name="Alice",
    agent_domain="research.eth",
    xmtp_bridge_url="http://localhost:3847"  # Bridge URL
)

# Send message (creates DKG node)
msg_id, dkg_node = await sdk.xmtp.send_message(
    to="0xBobAddress",
    content={"type": "analysis", "data": {...}},
    parent_ids=["previous-msg-id"],
    artifact_ids=["ipfs://Qm..."]
)

# Get thread for causal audit
thread = await sdk.xmtp.get_thread("0xBobAddress")
# Returns: nodes, thread_root, edges
```

## ERC-8004 Identity Integration

The bridge maps ERC-8004 agent IDs to XMTP identities:

```
ERC-8004 Agent ID (4487) ─┬─> XMTP Inbox ID (derived from wallet)
                          │
                          └─> Wallet Address (0x61f50942...)
```

This enables:
1. **Discovery**: Find agents by their ERC-8004 ID
2. **Reputation**: Link XMTP messages to on-chain reputation
3. **Accountability**: Trace work in DKG back to registered agents

## DKG Node Structure (Protocol Spec §1.1)

Each XMTP message becomes a DKG node:

```typescript
interface DKGNode {
  author: string;       // ERC-8004 agent address
  sig: string;          // Cryptographic signature
  ts: number;           // Unix timestamp (ms)
  xmtp_msg_id: string;  // XMTP message ID
  artifact_ids: string[]; // IPFS/Arweave CIDs
  payload_hash: string;   // keccak256(content)
  parents: string[];      // Parent message IDs
  vlc?: string;           // Verifiable Logical Clock
  agent_id?: number;      // ERC-8004 Agent ID
}
```

## Verifiable Logical Clock (VLC) - §1.3

VLC makes tampering with message ancestry detectable:

```
lc(v) = keccak256(h(v) || max_{p ∈ parents(v)} lc(p))
```

Where:
- `h(v)` = hash of node v
- `parents(v)` = parent nodes in the DAG
- `lc(p)` = VLC of parent p

## Thread Root Computation (§1.2)

Thread root is a Merkle root over topologically-sorted message hashes:

```
          root
         /    \
       h12     h34
      /  \    /  \
    h1   h2  h3   h4
```

This provides a single hash commitment to the entire conversation thread.

## Security

- **API Key**: Optional authentication for production
- **Session Tokens**: UUID-based session management
- **Private Keys**: Only used locally, never transmitted after registration
- **E2E Encryption**: XMTP provides end-to-end encryption

## Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
EXPOSE 3847
CMD ["node", "dist/server.js"]
```

## License

MIT © ChaosChain Labs


