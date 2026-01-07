import { DurableObject } from "cloudflare:workers";
import type { Job, JobStatus, EffortLevel, TokenType, PriceBreakdown, Env } from "../types";

/**
 * Job Durable Object - manages job state with SQLite
 * Each instance can handle multiple jobs (not per-job isolation)
 */
export class JobDurableObject extends DurableObject<Env> {
  private sql: SqlStorage;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  /**
   * Initialize SQLite schema on first use
   */
  private ensureSchema(): void {
    if (this.initialized) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        payer_address TEXT NOT NULL,
        product_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',

        -- Input
        input_hash TEXT NOT NULL,
        input_size INTEGER NOT NULL,
        effort TEXT NOT NULL,

        -- Pricing
        price_stx REAL NOT NULL,
        price_breakdown TEXT,
        payment_tx_id TEXT,
        token_type TEXT NOT NULL,

        -- Execution
        started_at TEXT,
        completed_at TEXT,

        -- Result
        result TEXT,
        result_tokens INTEGER,
        error TEXT,

        -- Retry handling
        attempt INTEGER DEFAULT 1,
        max_attempts INTEGER DEFAULT 3,
        retry_after TEXT,
        retry_ticket_nft TEXT,

        -- Metadata
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

        -- Dedupe constraint
        UNIQUE(payer_address, input_hash, product_slug)
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_payer ON jobs(payer_address);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
    `);

    this.initialized = true;
  }

  /**
   * Create a new job (idempotent - returns existing if duplicate)
   */
  async createJob(params: {
    payerAddress: string;
    productSlug: string;
    inputHash: string;
    inputSize: number;
    effort: EffortLevel;
    price: number;
    priceBreakdown: PriceBreakdown;
    txId: string;
    tokenType: TokenType;
  }): Promise<Job> {
    this.ensureSchema();

    const id = crypto.randomUUID();

    // Check for duplicate (same input within 5 minutes)
    const existing = this.sql.exec(`
      SELECT * FROM jobs
      WHERE payer_address = ?
        AND input_hash = ?
        AND product_slug = ?
        AND created_at > datetime('now', '-5 minutes')
      LIMIT 1
    `, params.payerAddress, params.inputHash, params.productSlug).toArray() as unknown as Job[];

    if (existing.length > 0) {
      return existing[0];
    }

    this.sql.exec(`
      INSERT INTO jobs (
        id, payer_address, product_slug, input_hash, input_size, effort,
        price_stx, price_breakdown, payment_tx_id, token_type, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `,
      id,
      params.payerAddress,
      params.productSlug,
      params.inputHash,
      params.inputSize,
      params.effort,
      params.price,
      JSON.stringify(params.priceBreakdown),
      params.txId,
      params.tokenType
    );

    return this.getJob(id) as Promise<Job>;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    this.ensureSchema();

    const results = this.sql.exec(`
      SELECT * FROM jobs WHERE id = ?
    `, jobId).toArray() as unknown as Job[];

    return results[0] || null;
  }

  /**
   * Start job execution
   */
  async startJob(jobId: string): Promise<Job | null> {
    this.ensureSchema();

    this.sql.exec(`
      UPDATE jobs
      SET status = 'running',
          started_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `, jobId);

    return this.getJob(jobId);
  }

  /**
   * Complete job with result
   */
  async completeJob(
    jobId: string,
    result: string,
    tokens: number
  ): Promise<Job | null> {
    this.ensureSchema();

    this.sql.exec(`
      UPDATE jobs
      SET status = 'completed',
          result = ?,
          result_tokens = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, result, tokens, jobId);

    return this.getJob(jobId);
  }

  /**
   * Fail job with error (handles retry logic)
   */
  async failJob(jobId: string, error: string): Promise<Job | null> {
    this.ensureSchema();

    const job = await this.getJob(jobId);
    if (!job) return null;

    if (job.attempt < job.max_attempts) {
      // Retry eligible - exponential backoff
      const backoff = Math.min(Math.pow(2, job.attempt) * 30, 300);
      this.sql.exec(`
        UPDATE jobs
        SET status = 'retry_eligible',
            error = ?,
            attempt = attempt + 1,
            retry_after = datetime('now', '+' || ? || ' seconds'),
            updated_at = datetime('now')
        WHERE id = ?
      `, error, backoff, jobId);
    } else {
      // Dead - eligible for refund/retry ticket
      this.sql.exec(`
        UPDATE jobs
        SET status = 'dead',
            error = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `, error, jobId);
    }

    return this.getJob(jobId);
  }

  /**
   * Update job status
   */
  async updateStatus(jobId: string, status: JobStatus): Promise<Job | null> {
    this.ensureSchema();

    this.sql.exec(`
      UPDATE jobs
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `, status, jobId);

    return this.getJob(jobId);
  }

  /**
   * Get jobs by payer address
   */
  async getJobsByPayer(payerAddress: string, limit = 50): Promise<Job[]> {
    this.ensureSchema();

    return this.sql.exec(`
      SELECT * FROM jobs
      WHERE payer_address = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, payerAddress, limit).toArray() as unknown as Job[];
  }

  /**
   * Get pending jobs ready for retry
   */
  async getRetryableJobs(): Promise<Job[]> {
    this.ensureSchema();

    return this.sql.exec(`
      SELECT * FROM jobs
      WHERE status = 'retry_eligible'
        AND retry_after <= datetime('now')
      ORDER BY retry_after ASC
      LIMIT 10
    `).toArray() as unknown as Job[];
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }> {
    this.ensureSchema();

    const [stats] = this.sql.exec<{
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    }>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status IN ('failed', 'dead') THEN 1 ELSE 0 END) as failed
      FROM jobs
    `).toArray();

    return stats;
  }
}
