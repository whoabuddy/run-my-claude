# Build Plan: x402 Payment-Gated Claude Code API

**Project Codename**: claude-402
**Goal**: Run Claude Code instances for paying customers via x402 micropayments
**Stack**: Hono.js + Cloudflare Workers + x402-stacks + claude-flow

---

## Overview

Customers pay STX/sBTC/USDCx per-request to execute Claude Code tasks with your preset instructions, knowledge, and scoped prompts. Payment IS authentication - stateful users identified by their paying Stacks address.

### Key Differentiators
- **Your expertise as a product**: Ship your CLAUDE.md, skills, and knowledge as paid endpoints
- **Instant monetization**: No invoicing, no subscriptions - payment settles before execution
- **Anonymous-friendly**: No accounts required, address = identity
- **Multi-token**: STX, sBTC, USDCx support via x402-stacks

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers Edge                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         Hono.js App                               │   │
│  │                                                                   │   │
│  │   [CORS] → [x402 Middleware] → [Metrics] → [Endpoint Handler]    │   │
│  │                  │                              │                 │   │
│  │                  ▼                              ▼                 │   │
│  │           Facilitator                    Claude Executor          │   │
│  │    (x402stacks.xyz)                     (Durable Object)         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │   JobDO         │  │   UserDO        │  │   KV Namespaces         │  │
│  │                 │  │  (from stx402)  │  │                         │  │
│  │  - Job queue    │  │  - History      │  │  - METRICS              │  │
│  │  - Status       │  │  - Preferences  │  │  - PRODUCTS             │  │
│  │  - Results      │  │  - Credits      │  │  - JOB_STATUS (public)  │  │
│  │  - Retries      │  │                 │  │                         │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Claude Code Execution                             │
│                                                                          │
│  Option A: Cloudflare Workers AI (limited but fast)                     │
│  Option B: External API call to your Claude instance                    │
│  Option C: Queue to dedicated Claude Code runner                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Payment Flow

```
Client                          Workers Edge                    Facilitator
  │                                  │                              │
  │  POST /api/claude/summarize      │                              │
  │  { input: "...", effort: "standard" }                           │
  │─────────────────────────────────>│                              │
  │                                  │                              │
  │                                  │ Calculate price:             │
  │                                  │ base + (inputSize * rate)    │
  │                                  │ + effortMultiplier           │
  │                                  │                              │
  │  HTTP 402                        │                              │
  │  {                               │                              │
  │    maxAmountRequired: "0.015",   │                              │
  │    payTo: "SP...",               │                              │
  │    resource: "/api/claude/summarize",                           │
  │    priceBreakdown: {             │                              │
  │      base: "0.005",              │                              │
  │      inputSize: "0.005",         │                              │
  │      effort: "0.005"             │                              │
  │    }                             │                              │
  │  }                               │                              │
  │<─────────────────────────────────│                              │
  │                                  │                              │
  │  (sign payment locally)          │                              │
  │                                  │                              │
  │  POST /api/claude/summarize      │                              │
  │  X-PAYMENT: <signed-tx>          │                              │
  │  { input: "...", effort: "standard" }                           │
  │─────────────────────────────────>│                              │
  │                                  │─────────────────────────────>│
  │                                  │  settlePayment(signedTx)     │
  │                                  │<─────────────────────────────│
  │                                  │  { txId, sender }            │
  │                                  │                              │
  │                                  │ Create job in JobDO          │
  │                                  │ Execute Claude Code          │
  │                                  │                              │
  │  HTTP 200                        │                              │
  │  X-PAYMENT-RESPONSE: { txId }    │                              │
  │  {                               │                              │
  │    jobId: "abc123",              │                              │
  │    status: "completed",          │                              │
  │    result: "...",                │                              │
  │    usage: { inputTokens, outputTokens }                         │
  │  }                               │                              │
  │<─────────────────────────────────│                              │
```

---

## Dynamic Pricing Model

### Pricing Formula

```typescript
price = baseFee + (inputSize * sizeRate) + (effortMultiplier * effortRate)
```

### Effort Levels (maps to max_tokens)

| Effort | max_tokens | Multiplier | Use Case |
|--------|------------|------------|----------|
| `quick` | 500 | 1x | Short answers, yes/no |
| `standard` | 2000 | 2x | Normal responses |
| `detailed` | 4000 | 4x | In-depth analysis |
| `comprehensive` | 8000 | 8x | Full reports |

### Input Size Tiers

| Tier | Characters | Rate |
|------|------------|------|
| Small | < 1,000 | 0.001 STX |
| Medium | 1,000 - 5,000 | 0.003 STX |
| Large | 5,000 - 20,000 | 0.008 STX |
| XL | 20,000+ | 0.015 STX |

### Example Pricing

```typescript
// Summarize a 3,000 char document with standard effort
baseFee:      0.005 STX
inputSize:    0.003 STX  (medium tier)
effort:       0.006 STX  (standard = 2x * 0.003)
─────────────────────────
total:        0.014 STX  (~$0.02 at $1.50/STX)
```

### Pricing Implementation

```typescript
// src/utils/claude-pricing.ts

export const EFFORT_LEVELS = {
  quick:         { maxTokens: 500,  multiplier: 1 },
  standard:      { maxTokens: 2000, multiplier: 2 },
  detailed:      { maxTokens: 4000, multiplier: 4 },
  comprehensive: { maxTokens: 8000, multiplier: 8 },
} as const;

export const INPUT_TIERS = [
  { maxChars: 1000,   rate: 0.001 },
  { maxChars: 5000,   rate: 0.003 },
  { maxChars: 20000,  rate: 0.008 },
  { maxChars: Infinity, rate: 0.015 },
];

export function calculatePrice(
  inputSize: number,
  effort: keyof typeof EFFORT_LEVELS,
  product: Product
): PriceBreakdown {
  const baseFee = product.baseFee;
  const inputTier = INPUT_TIERS.find(t => inputSize <= t.maxChars)!;
  const effortConfig = EFFORT_LEVELS[effort];

  return {
    base: baseFee,
    inputSize: inputTier.rate,
    effort: effortConfig.multiplier * 0.003,
    total: baseFee + inputTier.rate + (effortConfig.multiplier * 0.003),
  };
}
```

---

## Product Catalog

Each product is a pre-configured Claude Code task:

```typescript
// src/products/index.ts

interface Product {
  slug: string;              // URL path segment
  name: string;              // Display name
  description: string;       // What it does
  baseFee: number;           // STX
  claudeMd: string;          // Path to CLAUDE.md preset
  systemPrompt: string;      // Scoped instructions
  allowedEfforts: string[];  // Which effort levels allowed
  inputSchema: ZodSchema;    // Validate input
  outputTransform?: Function; // Post-process result
}

export const PRODUCTS: Record<string, Product> = {
  'summarize': {
    slug: 'summarize',
    name: 'Smart Summarizer',
    description: 'Condense any text to key points',
    baseFee: 0.005,
    claudeMd: './presets/summarize/CLAUDE.md',
    systemPrompt: `You are a summarization expert. Extract key points and present them clearly.

Rules:
- Be concise but complete
- Preserve critical details
- Use bullet points for clarity
- Never add information not in the source`,
    allowedEfforts: ['quick', 'standard', 'detailed'],
    inputSchema: z.object({
      text: z.string().min(10).max(100000),
      format: z.enum(['bullets', 'paragraph', 'outline']).optional(),
    }),
  },

  'code-review': {
    slug: 'code-review',
    name: 'Code Reviewer',
    description: 'Professional code review with actionable feedback',
    baseFee: 0.010,
    claudeMd: './presets/code-review/CLAUDE.md',
    systemPrompt: `You are a senior code reviewer. Analyze code for:
- Bugs and potential issues
- Security vulnerabilities (OWASP top 10)
- Performance concerns
- Code style and best practices
- Clarity and maintainability

Provide specific, actionable feedback with line references.`,
    allowedEfforts: ['standard', 'detailed', 'comprehensive'],
    inputSchema: z.object({
      code: z.string().min(10).max(50000),
      language: z.string().optional(),
      context: z.string().optional(),
    }),
  },

  'clarity-audit': {
    slug: 'clarity-audit',
    name: 'Clarity Contract Auditor',
    description: 'Security audit for Clarity smart contracts',
    baseFee: 0.020,
    claudeMd: './presets/clarity-audit/CLAUDE.md',
    systemPrompt: `You are a Clarity smart contract security auditor.

Check for:
- Reentrancy vulnerabilities
- Integer overflow/underflow
- Authorization bypasses (tx-sender vs contract-caller)
- Improper error handling
- Asset safety issues
- Denial of service vectors

Reference the Clarity security handbook patterns.`,
    allowedEfforts: ['detailed', 'comprehensive'],
    inputSchema: z.object({
      contract: z.string().min(50).max(100000),
      deploymentContext: z.string().optional(),
    }),
  },

  'debug': {
    slug: 'debug',
    name: 'Debug Assistant',
    description: 'Diagnose and fix code errors',
    baseFee: 0.008,
    claudeMd: './presets/debug/CLAUDE.md',
    systemPrompt: `You are a debugging expert. Given an error and code context:
1. Identify the root cause
2. Explain why it's happening
3. Provide a fix with code
4. Suggest how to prevent similar issues`,
    allowedEfforts: ['quick', 'standard', 'detailed'],
    inputSchema: z.object({
      error: z.string(),
      code: z.string().optional(),
      stackTrace: z.string().optional(),
      context: z.string().optional(),
    }),
  },
};
```

---

## Job State Management

### Job Lifecycle

```
[created] → [pending] → [running] → [completed]
                │                        │
                │                        └→ [delivered]
                │
                └→ [failed] → [retry_eligible] → [pending]
                        │
                        └→ [dead] → [refund_eligible]
```

### Job Schema (Durable Object SQLite)

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  payer_address TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',

  -- Input
  input_hash TEXT NOT NULL,        -- SHA256 of input for dedup
  input_size INTEGER NOT NULL,
  effort TEXT NOT NULL,

  -- Pricing
  price_stx REAL NOT NULL,
  price_breakdown TEXT,            -- JSON
  payment_tx_id TEXT,
  token_type TEXT NOT NULL,

  -- Execution
  started_at TEXT,
  completed_at TEXT,

  -- Result
  result TEXT,                     -- JSON or plain text
  result_tokens INTEGER,
  error TEXT,

  -- Retry handling
  attempt INTEGER DEFAULT 1,
  max_attempts INTEGER DEFAULT 3,
  retry_after TEXT,
  retry_ticket_nft TEXT,           -- Future: NFT contract ID

  -- Metadata
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  UNIQUE(payer_address, input_hash, product_slug)
);

CREATE INDEX idx_jobs_payer ON jobs(payer_address);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created_at);
```

### Job Operations

```typescript
// src/durable-objects/JobDO.ts

export class JobDurableObject extends DurableObject {

  async createJob(params: CreateJobParams): Promise<Job> {
    const id = crypto.randomUUID();
    const inputHash = await sha256(JSON.stringify(params.input));

    // Check for duplicate (same input within 5 minutes)
    const existing = this.sql.exec(`
      SELECT * FROM jobs
      WHERE payer_address = ?
        AND input_hash = ?
        AND product_slug = ?
        AND created_at > datetime('now', '-5 minutes')
    `, [params.payerAddress, inputHash, params.productSlug]);

    if (existing.length > 0) {
      return existing[0] as Job; // Return existing job (idempotent)
    }

    this.sql.exec(`
      INSERT INTO jobs (id, payer_address, product_slug, input_hash, input_size, effort, price_stx, price_breakdown, payment_tx_id, token_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [id, params.payerAddress, params.productSlug, inputHash, params.inputSize, params.effort, params.price, JSON.stringify(params.priceBreakdown), params.txId, params.tokenType]);

    return this.getJob(id);
  }

  async startJob(jobId: string): Promise<Job> {
    this.sql.exec(`
      UPDATE jobs
      SET status = 'running', started_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `, [jobId]);
    return this.getJob(jobId);
  }

  async completeJob(jobId: string, result: string, tokens: number): Promise<Job> {
    this.sql.exec(`
      UPDATE jobs
      SET status = 'completed', result = ?, result_tokens = ?, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [result, tokens, jobId]);
    return this.getJob(jobId);
  }

  async failJob(jobId: string, error: string): Promise<Job> {
    const job = this.getJob(jobId);

    if (job.attempt < job.max_attempts) {
      // Retry eligible
      const backoff = Math.min(Math.pow(2, job.attempt) * 30, 300); // 30s, 60s, 120s, max 300s
      this.sql.exec(`
        UPDATE jobs
        SET status = 'retry_eligible',
            error = ?,
            attempt = attempt + 1,
            retry_after = datetime('now', '+${backoff} seconds'),
            updated_at = datetime('now')
        WHERE id = ?
      `, [error, jobId]);
    } else {
      // Dead - eligible for refund/retry ticket
      this.sql.exec(`
        UPDATE jobs
        SET status = 'dead', error = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [error, jobId]);
    }

    return this.getJob(jobId);
  }

  async getJobsByPayer(payerAddress: string, limit = 50): Promise<Job[]> {
    return this.sql.exec(`
      SELECT * FROM jobs
      WHERE payer_address = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [payerAddress, limit]) as Job[];
  }

  async getJob(jobId: string): Promise<Job> {
    const [job] = this.sql.exec(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
    return job as Job;
  }
}
```

---

## Job Status UI

### Public Status Page

Simple web page to check job status (no auth required - job ID is the secret):

```
GET /status/:jobId
```

```html
<!-- src/components/status-page.ts -->

export function renderStatusPage(job: Job): string {
  const statusColors = {
    pending: '#f59e0b',
    running: '#3b82f6',
    completed: '#10b981',
    failed: '#ef4444',
    dead: '#6b7280',
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Job Status - ${job.id.slice(0, 8)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 600px; margin: 0 auto; }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
      background: ${statusColors[job.status] || '#6b7280'};
      color: white;
    }
    .label { color: #94a3b8; font-size: 0.875rem; margin-bottom: 0.25rem; }
    .value { font-size: 1rem; margin-bottom: 1rem; }
    .mono { font-family: monospace; word-break: break-all; }
    .result {
      background: #0f172a;
      padding: 1rem;
      border-radius: 8px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
    }
    h1 { margin-bottom: 1.5rem; }
    .refresh { color: #60a5fa; text-decoration: none; }
    .refresh:hover { text-decoration: underline; }
  </style>
  ${job.status === 'running' ? '<meta http-equiv="refresh" content="3">' : ''}
</head>
<body>
  <div class="container">
    <h1>Job Status</h1>

    <div class="card">
      <div class="label">Job ID</div>
      <div class="value mono">${job.id}</div>

      <div class="label">Status</div>
      <div class="value"><span class="status-badge">${job.status}</span></div>

      <div class="label">Product</div>
      <div class="value">${job.product_slug}</div>

      <div class="label">Effort</div>
      <div class="value">${job.effort}</div>

      <div class="label">Price</div>
      <div class="value">${job.price_stx} ${job.token_type}</div>

      ${job.payment_tx_id ? `
      <div class="label">Transaction</div>
      <div class="value">
        <a href="https://explorer.hiro.so/txid/${job.payment_tx_id}" target="_blank" class="refresh mono">
          ${job.payment_tx_id.slice(0, 16)}...
        </a>
      </div>
      ` : ''}

      <div class="label">Created</div>
      <div class="value">${new Date(job.created_at).toLocaleString()}</div>

      ${job.completed_at ? `
      <div class="label">Completed</div>
      <div class="value">${new Date(job.completed_at).toLocaleString()}</div>
      ` : ''}
    </div>

    ${job.status === 'completed' && job.result ? `
    <div class="card">
      <div class="label">Result (${job.result_tokens} tokens)</div>
      <div class="result">${escapeHtml(job.result)}</div>
    </div>
    ` : ''}

    ${job.error ? `
    <div class="card" style="border: 1px solid #ef4444;">
      <div class="label">Error</div>
      <div class="value" style="color: #fca5a5;">${escapeHtml(job.error)}</div>
    </div>
    ` : ''}

    ${job.status === 'running' ? `
    <p style="text-align: center; color: #94a3b8;">
      <a href="" class="refresh">Auto-refreshing...</a>
    </p>
    ` : ''}
  </div>
</body>
</html>
  `;
}
```

### API Endpoints for Status

```typescript
// GET /api/job/:jobId - Get single job status
// GET /api/jobs - Get jobs for payer (requires X-PAYMENT for auth)
// GET /status/:jobId - HTML status page (public)
```

---

## Retry Tickets (NFT - TBD)

### Concept

When a job fails permanently (dead state), issue an NFT that grants:
- Free retry of the same job
- Transferable to another user
- Expiration date (30 days?)

### Placeholder Implementation

```typescript
// src/utils/retry-tickets.ts

interface RetryTicket {
  jobId: string;
  payerAddress: string;
  productSlug: string;
  originalPrice: number;
  tokenType: string;
  issuedAt: string;
  expiresAt: string;
  nftContractId?: string;  // Future: actual NFT
  nftTokenId?: number;
}

export async function issueRetryTicket(job: Job): Promise<RetryTicket> {
  // For now, store in KV with a signed ticket
  const ticket: RetryTicket = {
    jobId: job.id,
    payerAddress: job.payer_address,
    productSlug: job.product_slug,
    originalPrice: job.price_stx,
    tokenType: job.token_type,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  // TODO: Mint actual NFT when contract is ready
  // ticket.nftContractId = 'SP.../retry-ticket';
  // ticket.nftTokenId = await mintRetryNFT(ticket);

  return ticket;
}

export async function redeemRetryTicket(ticketId: string, newInput: any): Promise<Job> {
  // Validate ticket exists and not expired
  // Create new job with retry_ticket reference
  // Mark ticket as used
  throw new Error('Not implemented - NFT contract TBD');
}
```

---

## File Structure

```
src/
├── index.ts                      # Hono app setup, routes
├── types.ts                      # Shared types
│
├── middleware/
│   ├── x402-claude.ts            # Extended x402 with dynamic pricing
│   └── metrics.ts                # From stx402
│
├── endpoints/
│   ├── BaseClaudeEndpoint.ts     # Base class for Claude endpoints
│   ├── claude/
│   │   ├── summarize.ts
│   │   ├── code-review.ts
│   │   ├── clarity-audit.ts
│   │   └── debug.ts
│   ├── job/
│   │   ├── status.ts             # GET /api/job/:id
│   │   └── list.ts               # GET /api/jobs (by payer)
│   └── health.ts                 # Free health check
│
├── durable-objects/
│   ├── JobDO.ts                  # Job state management
│   └── UserDO.ts                 # From stx402 (history, prefs)
│
├── products/
│   ├── index.ts                  # Product catalog
│   └── presets/                  # CLAUDE.md files per product
│       ├── summarize/
│       │   └── CLAUDE.md
│       ├── code-review/
│       │   └── CLAUDE.md
│       ├── clarity-audit/
│       │   └── CLAUDE.md
│       └── debug/
│           └── CLAUDE.md
│
├── executor/
│   ├── index.ts                  # Claude execution router
│   ├── workers-ai.ts             # Cloudflare Workers AI backend
│   ├── anthropic-api.ts          # Direct Anthropic API backend
│   └── claude-code-runner.ts     # Full Claude Code via queue
│
├── utils/
│   ├── claude-pricing.ts         # Dynamic pricing calculator
│   ├── retry-tickets.ts          # NFT retry system (TBD)
│   └── [from stx402]             # addresses, signatures, etc.
│
├── components/
│   └── status-page.ts            # HTML job status UI
│
└── tests/
    ├── pricing.test.ts
    ├── job-lifecycle.test.ts
    └── e2e/
        └── payment-flow.test.ts
```

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Fork/copy x402 middleware from stx402
- [ ] Create JobDO with SQLite schema
- [ ] Implement dynamic pricing calculator
- [ ] Create BaseClaudeEndpoint class
- [ ] Add job status API + HTML page

### Phase 2: First Product
- [ ] Implement `/summarize` endpoint
- [ ] Create summarize CLAUDE.md preset
- [ ] Wire up Workers AI as initial executor
- [ ] Test full payment → execution → result flow
- [ ] Deploy to staging (testnet)

### Phase 3: Product Expansion
- [ ] Add code-review product
- [ ] Add clarity-audit product (your specialty!)
- [ ] Add debug product
- [ ] Create product discovery endpoint

### Phase 4: Enhanced Execution
- [ ] Add Anthropic API executor option
- [ ] Implement Claude Code runner via queue
- [ ] Add streaming support for long jobs
- [ ] Implement job timeout handling

### Phase 5: Retry System
- [ ] Track failed jobs properly
- [ ] Issue retry tickets (KV-based initially)
- [ ] Design NFT contract for retry tickets
- [ ] Implement ticket redemption flow

### Phase 6: Polish
- [ ] Metrics dashboard
- [ ] Rate limiting (if needed)
- [ ] User history endpoint
- [ ] API documentation (OpenAPI)

---

## Configuration

### wrangler.jsonc additions

```jsonc
{
  "vars": {
    // From stx402
    "X402_NETWORK": "mainnet",
    "X402_SERVER_ADDRESS": "SP...",
    "X402_FACILITATOR_URL": "https://facilitator.x402stacks.xyz",

    // New for claude-402
    "CLAUDE_EXECUTOR": "workers-ai",  // or "anthropic" or "queue"
    "ANTHROPIC_API_KEY": "",          // If using Anthropic direct
    "MAX_JOB_DURATION_MS": "60000"
  },
  "durable_objects": {
    "bindings": [
      { "name": "JOB_DO", "class_name": "JobDurableObject" },
      { "name": "USER_DO", "class_name": "UserDurableObject" }
    ]
  },
  "kv_namespaces": [
    { "binding": "METRICS", "id": "..." },
    { "binding": "PRODUCTS", "id": "..." },
    { "binding": "JOB_STATUS", "id": "..." }
  ]
}
```

---

## API Reference

### Paid Endpoints

```
POST /api/claude/summarize
POST /api/claude/code-review
POST /api/claude/clarity-audit
POST /api/claude/debug
```

**Request Body:**
```json
{
  "input": "...",           // Required: text/code to process
  "effort": "standard",     // Optional: quick|standard|detailed|comprehensive
  "options": {}             // Optional: product-specific options
}
```

**402 Response (no payment):**
```json
{
  "maxAmountRequired": "0.015000",
  "payTo": "SP31JEZWX4S131326VKM05QKJ0TDGNVVE0CDWWVA2",
  "network": "mainnet",
  "tokenType": "STX",
  "resource": "/api/claude/summarize",
  "priceBreakdown": {
    "base": "0.005000",
    "inputSize": "0.003000",
    "effort": "0.007000"
  },
  "nonce": "uuid",
  "expiresAt": "2024-..."
}
```

**200 Response (paid):**
```json
{
  "jobId": "abc-123",
  "status": "completed",
  "result": "...",
  "usage": {
    "inputTokens": 450,
    "outputTokens": 892
  },
  "tokenType": "STX"
}
```

### Free Endpoints

```
GET  /api/health              # Health check
GET  /api/products            # List available products with pricing
GET  /api/job/:jobId          # Get job status (JSON)
GET  /status/:jobId           # Job status page (HTML)
```

### Authenticated by Payment

```
GET  /api/jobs                # List jobs for payer (X-PAYMENT required)
POST /api/job/:jobId/retry    # Retry failed job (with retry ticket)
```

---

## Revenue Projections

Assuming average job price of 0.01 STX ($0.015 at $1.50/STX):

| Daily Jobs | Daily Revenue | Monthly Revenue |
|------------|---------------|-----------------|
| 100 | 1 STX ($1.50) | 30 STX ($45) |
| 1,000 | 10 STX ($15) | 300 STX ($450) |
| 10,000 | 100 STX ($150) | 3,000 STX ($4,500) |

---

## Open Questions

1. **Executor choice**: Start with Workers AI (fast, limited) or Anthropic API (full power, slower)?
2. **Streaming**: Support SSE for long-running jobs?
3. **Retry ticket NFT**: Which contract pattern? SIP-009?
4. **Knowledge files**: Bundle in Worker or fetch from KV/R2?
5. **Multi-product pricing**: Per-product base fees or unified?

---

## References

- **stx402 repo**: ~/dev/whoabuddy/stx402 (patterns, middleware, DO structure)
- **x402-stacks**: https://github.com/tony1908/x402Stacks
- **claude-flow**: Current repo (execution orchestration)
- **Clarity reference**: ~/dev/whoabuddy/claude-knowledge/context/clarity-reference.md
