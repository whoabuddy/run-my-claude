import type { Context } from "hono";

// Context variables passed between middleware and handlers
export interface Variables {
  parsedBody: Record<string, unknown>;
  inputSize: number;
  effort: EffortLevel;
  priceBreakdown: PriceBreakdown;
  tokenType: TokenType;
  product: Product;
  settleResult: SettleResult;
  signedTx: string;
}

// Environment bindings from wrangler.jsonc
export interface Env {
  // Workers AI
  AI: Ai;

  // Durable Objects
  JOB_DO: DurableObjectNamespace;
  USER_DO: DurableObjectNamespace;

  // KV Namespaces
  METRICS: KVNamespace;
  PRODUCTS: KVNamespace;

  // Environment variables
  X402_NETWORK: "mainnet" | "testnet";
  X402_SERVER_ADDRESS: string;
  X402_FACILITATOR_URL: string;
  CLAUDE_EXECUTOR: "workers-ai" | "anthropic" | "queue";
  MAX_JOB_DURATION_MS: string;
  ANTHROPIC_API_KEY?: string;
}

// Hono context with our bindings and variables
export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// Effort levels for Claude execution
export type EffortLevel = "quick" | "standard" | "detailed" | "comprehensive";

// Token types supported
export type TokenType = "STX" | "sBTC" | "USDCx";

// Job status states
export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "retry_eligible"
  | "dead"
  | "delivered";

// Price breakdown for transparency
export interface PriceBreakdown {
  base: number;
  inputSize: number;
  effort: number;
  total: number;
}

// Job record stored in Durable Object
export interface Job {
  id: string;
  payer_address: string;
  product_slug: string;
  status: JobStatus;

  // Input
  input_hash: string;
  input_size: number;
  effort: EffortLevel;

  // Pricing
  price_stx: number;
  price_breakdown: string; // JSON
  payment_tx_id: string | null;
  token_type: TokenType;

  // Execution
  started_at: string | null;
  completed_at: string | null;

  // Result
  result: string | null;
  result_tokens: number | null;
  error: string | null;

  // Retry handling
  attempt: number;
  max_attempts: number;
  retry_after: string | null;
  retry_ticket_nft: string | null;

  // Metadata
  created_at: string;
  updated_at: string;
}

// Product definition
export interface Product {
  slug: string;
  name: string;
  description: string;
  baseFee: number;
  claudeMd: string;
  systemPrompt: string;
  allowedEfforts: EffortLevel[];
  inputSchema: unknown; // Zod schema
  outputTransform?: (result: string) => string;
}

// Settlement result from x402 facilitator
export interface SettleResult {
  success: boolean;
  txId?: string;
  sender?: string;
  senderAddress?: string;
  sender_address?: string;
  error?: string;
}

// Claude execution request
export interface ClaudeExecutionRequest {
  product: Product;
  input: string;
  effort: EffortLevel;
  payerAddress: string;
  jobId: string;
}

// Claude execution result
export interface ClaudeExecutionResult {
  success: boolean;
  result?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}
