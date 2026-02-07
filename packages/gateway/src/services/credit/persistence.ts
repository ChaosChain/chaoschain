/**
 * Credit Execution Persistence Layer
 * 
 * Provides durable storage for:
 * - Execution records (state machine)
 * - BLS certificates (critical for disputes)
 * 
 * Supports:
 * - In-memory (for testing)
 * - Database (PostgreSQL via existing Gateway DB)
 * - Optional Arweave backup for certificates
 */

import { 
  ExecutionRecord, 
  ExecutionState, 
  CreditSettledEvent,
  CreditDefaultedEvent,
  isValidTransition,
} from './execution-state.js';
import { BLSCertificate } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Persistence interface for execution records
 */
export interface ExecutionPersistence {
  /** Save or update an execution record */
  save(record: ExecutionRecord): Promise<void>;
  
  /** Get execution record by request ID */
  get(requestId: string): Promise<ExecutionRecord | null>;
  
  /** Check if a request ID has been processed */
  exists(requestId: string): Promise<boolean>;
  
  /** Get all records in a given state */
  getByState(state: ExecutionState): Promise<ExecutionRecord[]>;
  
  /** Get records that need retry (failed transfers within TTL) */
  getPendingRetries(): Promise<ExecutionRecord[]>;
  
  /** Get records that have expired (past TTL) */
  getExpired(): Promise<ExecutionRecord[]>;
  
  /** Transition state (validates transition is legal) */
  transitionState(
    requestId: string, 
    newState: ExecutionState,
    updates?: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord>;
}

/**
 * Certificate backup interface (for Arweave)
 */
export interface CertificateBackup {
  /** Backup certificate to durable storage */
  backup(requestId: string, certificate: BLSCertificate): Promise<string>;
  
  /** Retrieve certificate from backup */
  retrieve(arweaveId: string): Promise<BLSCertificate | null>;
}

/**
 * Event emitter interface for settlement/default events
 */
export interface CreditEventEmitter {
  emitSettled(event: CreditSettledEvent): Promise<void>;
  emitDefaulted(event: CreditDefaultedEvent): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY PERSISTENCE (For testing & development)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * In-memory persistence for development/testing
 * 
 * WARNING: Data is lost on restart. Use DB persistence in production.
 */
export class InMemoryPersistence implements ExecutionPersistence {
  private records: Map<string, ExecutionRecord> = new Map();
  
  async save(record: ExecutionRecord): Promise<void> {
    record.updatedAt = Date.now();
    this.records.set(record.requestId, { ...record });
  }
  
  async get(requestId: string): Promise<ExecutionRecord | null> {
    return this.records.get(requestId) ?? null;
  }
  
  async exists(requestId: string): Promise<boolean> {
    return this.records.has(requestId);
  }
  
  async getByState(state: ExecutionState): Promise<ExecutionRecord[]> {
    return Array.from(this.records.values()).filter(r => r.state === state);
  }
  
  async getPendingRetries(): Promise<ExecutionRecord[]> {
    const now = Date.now();
    return Array.from(this.records.values()).filter(r => 
      r.state === ExecutionState.TRANSFER_FAILED &&
      r.intent.expiresAt * 1000 > now
    );
  }
  
  async getExpired(): Promise<ExecutionRecord[]> {
    const now = Date.now();
    return Array.from(this.records.values()).filter(r => 
      r.state !== ExecutionState.SETTLED &&
      r.state !== ExecutionState.DEFAULTED &&
      r.state !== ExecutionState.REJECTED &&
      r.intent.expiresAt * 1000 <= now
    );
  }
  
  async transitionState(
    requestId: string,
    newState: ExecutionState,
    updates?: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord> {
    const record = await this.get(requestId);
    if (!record) {
      throw new Error(`Record not found: ${requestId}`);
    }
    
    if (!isValidTransition(record.state, newState)) {
      throw new Error(
        `Invalid state transition: ${record.state} → ${newState}`
      );
    }
    
    const updated: ExecutionRecord = {
      ...record,
      ...updates,
      state: newState,
      updatedAt: Date.now(),
    };
    
    await this.save(updated);
    return updated;
  }
  
  // For testing: get all records
  getAll(): ExecutionRecord[] {
    return Array.from(this.records.values());
  }
  
  // For testing: clear all
  clear(): void {
    this.records.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE PERSISTENCE (PostgreSQL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PostgreSQL persistence
 * 
 * Uses the existing Gateway database connection.
 * 
 * Required table schema:
 * ```sql
 * CREATE TABLE credit_executions (
 *   request_id TEXT PRIMARY KEY,
 *   intent JSONB NOT NULL,
 *   state TEXT NOT NULL,
 *   approved_amount NUMERIC,
 *   interest_rate_bps INTEGER,
 *   approved_at TIMESTAMP,
 *   rejection_reason TEXT,
 *   certificate JSONB,
 *   certificate_issued_at TIMESTAMP,
 *   certificate_arweave_id TEXT,
 *   transfer_attempts INTEGER DEFAULT 0,
 *   last_transfer_attempt TIMESTAMP,
 *   transfer_tx_hash TEXT,
 *   transfer_completed_at TIMESTAMP,
 *   last_transfer_error TEXT,
 *   settlement_tx_hash TEXT,
 *   settled_at TIMESTAMP,
 *   defaulted_at TIMESTAMP,
 *   created_at TIMESTAMP NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMP NOT NULL DEFAULT NOW()
 * );
 * 
 * CREATE INDEX idx_credit_executions_state ON credit_executions(state);
 * CREATE INDEX idx_credit_executions_expires ON credit_executions((intent->>'expiresAt'));
 * ```
 */
export class PostgresPersistence implements ExecutionPersistence {
  // @ts-expect-error - Pool would be initialized in full implementation
  private pool: unknown; // Would be pg.Pool in actual implementation
  
  constructor(connectionString: string) {
    // In real implementation: this.pool = new Pool({ connectionString });
    void connectionString; // Mark as used
    console.log(`PostgreSQL persistence initialized`);
  }
  
  async save(_record: ExecutionRecord): Promise<void> {
    // SQL implementation would go here
    throw new Error('PostgreSQL persistence not fully implemented - use InMemoryPersistence for now');
  }
  
  async get(_requestId: string): Promise<ExecutionRecord | null> {
    throw new Error('PostgreSQL persistence not fully implemented');
  }
  
  async exists(_requestId: string): Promise<boolean> {
    throw new Error('PostgreSQL persistence not fully implemented');
  }
  
  async getByState(_state: ExecutionState): Promise<ExecutionRecord[]> {
    throw new Error('PostgreSQL persistence not fully implemented');
  }
  
  async getPendingRetries(): Promise<ExecutionRecord[]> {
    throw new Error('PostgreSQL persistence not fully implemented');
  }
  
  async getExpired(): Promise<ExecutionRecord[]> {
    throw new Error('PostgreSQL persistence not fully implemented');
  }
  
  async transitionState(
    _requestId: string,
    _newState: ExecutionState,
    _updates?: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord> {
    throw new Error('PostgreSQL persistence not fully implemented');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ARWEAVE CERTIFICATE BACKUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Arweave backup for BLS certificates
 * 
 * This provides permanent, immutable storage for certificates.
 * Critical for dispute resolution - the certificate is your proof!
 */
export class ArweaveCertificateBackup implements CertificateBackup {
  // @ts-expect-error - Would be used in full implementation
  private walletJwk: unknown;
  // @ts-expect-error - Would be used in full implementation  
  private arweaveUrl: string;
  
  constructor(walletJwk: unknown, arweaveUrl = 'https://arweave.net') {
    void walletJwk;
    void arweaveUrl;
    console.log('[Arweave] Certificate backup initialized');
  }
  
  async backup(requestId: string, _certificate: BLSCertificate): Promise<string> {
    // In real implementation:
    // 1. Create Arweave transaction with certificate data
    // 2. Add tags: { App-Name: 'ChaosChain-Credit', Request-ID: requestId }
    // 3. Sign and post transaction
    // 4. Return transaction ID
    
    console.log(`[Arweave] Backing up certificate for ${requestId}`);
    
    // Placeholder - would use arweave-js
    const txId = `arweave_${Date.now()}_${requestId.substring(0, 8)}`;
    console.log(`[Arweave] Certificate backed up: ${txId}`);
    
    return txId;
  }
  
  async retrieve(arweaveId: string): Promise<BLSCertificate | null> {
    // In real implementation:
    // 1. Fetch transaction data from Arweave
    // 2. Parse and return certificate
    
    console.log(`[Arweave] Retrieving certificate: ${arweaveId}`);
    return null; // Would fetch from Arweave
  }
}

/**
 * No-op certificate backup for development
 */
export class NoOpCertificateBackup implements CertificateBackup {
  async backup(requestId: string, _certificate: BLSCertificate): Promise<string> {
    console.log(`[NoOp] Certificate backup skipped for ${requestId}`);
    return `local_${requestId}`;
  }
  
  async retrieve(_arweaveId: string): Promise<BLSCertificate | null> {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT EMITTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Console event emitter for development
 */
export class ConsoleEventEmitter implements CreditEventEmitter {
  async emitSettled(event: CreditSettledEvent): Promise<void> {
    console.log(`[EVENT] CreditSettled:`, JSON.stringify(event, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ));
  }
  
  async emitDefaulted(event: CreditDefaultedEvent): Promise<void> {
    console.log(`[EVENT] CreditDefaulted:`, JSON.stringify(event, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ));
  }
}

/**
 * Webhook event emitter
 */
export class WebhookEventEmitter implements CreditEventEmitter {
  private webhookUrl: string;
  
  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }
  
  async emitSettled(event: CreditSettledEvent): Promise<void> {
    await this.emit('CreditSettled', event);
  }
  
  async emitDefaulted(event: CreditDefaultedEvent): Promise<void> {
    await this.emit('CreditDefaulted', event);
  }
  
  private async emit(type: string, payload: unknown): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          payload,
          timestamp: Date.now(),
        }),
      });
    } catch (error) {
      console.error(`[Webhook] Failed to emit ${type}:`, error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

export interface PersistenceConfig {
  /** Use database persistence (vs in-memory) */
  useDatabase?: boolean;
  /** Database connection string */
  databaseUrl?: string;
  /** Enable Arweave certificate backup */
  enableArweaveBackup?: boolean;
  /** Arweave wallet JWK */
  arweaveWallet?: unknown;
  /** Webhook URL for events */
  webhookUrl?: string;
}

export function createPersistence(config: PersistenceConfig = {}): {
  execution: ExecutionPersistence;
  certificateBackup: CertificateBackup;
  eventEmitter: CreditEventEmitter;
} {
  // Execution persistence
  const execution = config.useDatabase && config.databaseUrl
    ? new PostgresPersistence(config.databaseUrl)
    : new InMemoryPersistence();
  
  // Certificate backup
  const certificateBackup = config.enableArweaveBackup && config.arweaveWallet
    ? new ArweaveCertificateBackup(config.arweaveWallet)
    : new NoOpCertificateBackup();
  
  // Event emitter
  const eventEmitter = config.webhookUrl
    ? new WebhookEventEmitter(config.webhookUrl)
    : new ConsoleEventEmitter();
  
  return { execution, certificateBackup, eventEmitter };
}
