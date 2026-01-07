import { DurableObject } from "cloudflare:workers";

/**
 * User Durable Object - per-user state management
 * Keyed by payer Stacks address
 */
export class UserDurableObject extends DurableObject {
  private sql: SqlStorage;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  /**
   * Initialize SQLite schema on first use
   */
  private ensureSchema(): void {
    if (this.initialized) return;

    this.sql.exec(`
      -- User preferences and settings
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Usage history (aggregated)
      CREATE TABLE IF NOT EXISTS usage_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_slug TEXT NOT NULL,
        job_count INTEGER DEFAULT 1,
        total_spent_stx REAL DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        period TEXT NOT NULL, -- YYYY-MM format
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_slug, period)
      );

      -- Retry tickets owned by user
      CREATE TABLE IF NOT EXISTS retry_tickets (
        id TEXT PRIMARY KEY,
        original_job_id TEXT NOT NULL,
        product_slug TEXT NOT NULL,
        original_price REAL NOT NULL,
        token_type TEXT NOT NULL,
        issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        redeemed_at TEXT,
        redeemed_job_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_expires ON retry_tickets(expires_at);
      CREATE INDEX IF NOT EXISTS idx_tickets_redeemed ON retry_tickets(redeemed_at);
    `);

    this.initialized = true;
  }

  /**
   * Record usage for a completed job
   */
  async recordUsage(params: {
    productSlug: string;
    priceStx: number;
    tokens: number;
  }): Promise<void> {
    this.ensureSchema();

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    this.sql.exec(`
      INSERT INTO usage_history (product_slug, job_count, total_spent_stx, total_tokens, period)
      VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(product_slug, period) DO UPDATE SET
        job_count = job_count + 1,
        total_spent_stx = total_spent_stx + excluded.total_spent_stx,
        total_tokens = total_tokens + excluded.total_tokens,
        updated_at = datetime('now')
    `, params.productSlug, params.priceStx, params.tokens, period);
  }

  /**
   * Get usage summary
   */
  async getUsageSummary(): Promise<{
    totalJobs: number;
    totalSpentStx: number;
    totalTokens: number;
    byProduct: Record<string, { jobs: number; spent: number; tokens: number }>;
  }> {
    this.ensureSchema();

    const rows = this.sql.exec<{
      product_slug: string;
      jobs: number;
      spent: number;
      tokens: number;
    }>(`
      SELECT
        product_slug,
        SUM(job_count) as jobs,
        SUM(total_spent_stx) as spent,
        SUM(total_tokens) as tokens
      FROM usage_history
      GROUP BY product_slug
    `).toArray();

    const byProduct: Record<string, { jobs: number; spent: number; tokens: number }> = {};
    let totalJobs = 0;
    let totalSpentStx = 0;
    let totalTokens = 0;

    for (const row of rows) {
      byProduct[row.product_slug] = {
        jobs: row.jobs,
        spent: row.spent,
        tokens: row.tokens,
      };
      totalJobs += row.jobs;
      totalSpentStx += row.spent;
      totalTokens += row.tokens;
    }

    return { totalJobs, totalSpentStx, totalTokens, byProduct };
  }

  /**
   * Set user preference
   */
  async setPreference(key: string, value: string): Promise<void> {
    this.ensureSchema();

    this.sql.exec(`
      INSERT INTO preferences (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `, key, value);
  }

  /**
   * Get user preference
   */
  async getPreference(key: string): Promise<string | null> {
    this.ensureSchema();

    const [row] = this.sql.exec<{ value: string }>(`
      SELECT value FROM preferences WHERE key = ?
    `, key).toArray();

    return row?.value || null;
  }

  /**
   * Issue retry ticket for failed job
   */
  async issueRetryTicket(params: {
    originalJobId: string;
    productSlug: string;
    originalPrice: number;
    tokenType: string;
    expiresInDays?: number;
  }): Promise<{ ticketId: string; expiresAt: string }> {
    this.ensureSchema();

    const ticketId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + (params.expiresInDays || 30) * 24 * 60 * 60 * 1000
    ).toISOString();

    this.sql.exec(`
      INSERT INTO retry_tickets (
        id, original_job_id, product_slug, original_price, token_type, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      ticketId,
      params.originalJobId,
      params.productSlug,
      params.originalPrice,
      params.tokenType,
      expiresAt
    );

    return { ticketId, expiresAt };
  }

  /**
   * Get valid retry tickets
   */
  async getValidTickets(): Promise<Array<{
    id: string;
    productSlug: string;
    originalPrice: number;
    expiresAt: string;
  }>> {
    this.ensureSchema();

    return this.sql.exec<{
      id: string;
      productSlug: string;
      originalPrice: number;
      expiresAt: string;
    }>(`
      SELECT id, product_slug as productSlug, original_price as originalPrice, expires_at as expiresAt
      FROM retry_tickets
      WHERE redeemed_at IS NULL
        AND expires_at > datetime('now')
      ORDER BY expires_at ASC
    `).toArray();
  }

  /**
   * Redeem retry ticket
   */
  async redeemTicket(
    ticketId: string,
    newJobId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureSchema();

    const [ticket] = this.sql.exec<{ id: string; redeemed_at: string | null; expires_at: string }>(`
      SELECT id, redeemed_at, expires_at FROM retry_tickets WHERE id = ?
    `, ticketId).toArray();

    if (!ticket) {
      return { success: false, error: "Ticket not found" };
    }

    if (ticket.redeemed_at) {
      return { success: false, error: "Ticket already redeemed" };
    }

    if (new Date(ticket.expires_at) < new Date()) {
      return { success: false, error: "Ticket expired" };
    }

    this.sql.exec(`
      UPDATE retry_tickets
      SET redeemed_at = datetime('now'), redeemed_job_id = ?
      WHERE id = ?
    `, newJobId, ticketId);

    return { success: true };
  }
}
