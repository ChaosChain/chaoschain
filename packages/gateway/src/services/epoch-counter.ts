/**
 * Epoch Counter — auto-incrementing epoch allocation for sessions.
 *
 * Each session gets its own epoch (1 session = 1 epoch).
 * The counter persists in Postgres to survive restarts.
 * CURRENT_EPOCH env var is used as seed on first boot only.
 */

export interface EpochCounterPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export class EpochCounter {
  private pool: EpochCounterPool | null;
  private nextEpoch: number;

  constructor(pool?: EpochCounterPool, initialEpoch: number = 1) {
    this.pool = pool ?? null;
    this.nextEpoch = initialEpoch;
  }

  /**
   * Initialize from Postgres. Creates epoch_state table if needed.
   * Seeds from initialEpoch if no state exists.
   */
  async initialize(): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS epoch_state (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        next_epoch INTEGER NOT NULL DEFAULT 1
      );
    `);

    const result = await this.pool.query('SELECT next_epoch FROM epoch_state WHERE id = 1');
    if (result.rows.length === 0) {
      await this.pool.query('INSERT INTO epoch_state (id, next_epoch) VALUES (1, $1)', [this.nextEpoch]);
    } else {
      this.nextEpoch = Number(result.rows[0].next_epoch);
    }
  }

  /**
   * Allocate an epoch for a new session.
   * Returns the current epoch and increments the counter.
   * Persists to Postgres atomically.
   */
  async allocate(): Promise<number> {
    const allocated = this.nextEpoch;
    this.nextEpoch++;

    if (this.pool) {
      await this.pool.query(
        'UPDATE epoch_state SET next_epoch = $1 WHERE id = 1',
        [this.nextEpoch],
      );
    }

    return allocated;
  }

  /**
   * Get the next epoch that will be allocated (read-only).
   */
  current(): number {
    return this.nextEpoch;
  }
}
