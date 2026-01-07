import { Hono } from "hono";
import { cors } from "hono/cors";
import { fromHono } from "chanfana";
import type { Env, AppContext, Variables } from "./types";
import { JobDurableObject } from "./durable-objects/JobDO";
import { UserDurableObject } from "./durable-objects/UserDO";
import { x402ClaudeMiddleware, getPayerAddress } from "./middleware/x402-claude";
import { listProducts, getProduct, validateProductInput } from "./products";
import { executeClaudeTask } from "./executor";
import { calculatePrice, getMaxTokens } from "./utils/claude-pricing";
import { renderStatusPage, renderNotFoundPage } from "./components/status-page";
import type { EffortLevel, TokenType, PriceBreakdown, Product, Job } from "./types";

// Create Hono app with typed bindings and variables
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// OpenAPI documentation via chanfana
const openapi = fromHono(app, {
  docs_url: "/docs",
  schema: {
    info: {
      title: "Run My Claude API",
      version: "0.1.0",
      description: "Payment-gated Claude Code API via x402 micropayments",
    },
  },
});

// CORS middleware
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-PAYMENT", "X-PAYMENT-TOKEN-TYPE"],
    exposeHeaders: ["X-PAYMENT-RESPONSE"],
  })
);

// =============================================================================
// FREE ENDPOINTS
// =============================================================================

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// List available products
app.get("/api/products", (c) => {
  const products = listProducts();
  return c.json({ products });
});

// Get job status (JSON)
app.get("/api/job/:jobId", async (c: AppContext) => {
  const jobId = c.req.param("jobId");

  // Use a single global JobDO for now (can shard later)
  const doId = c.env.JOB_DO.idFromName("global");
  const stub = c.env.JOB_DO.get(doId) as DurableObjectStub<JobDurableObject>;

  const job = await stub.getJob(jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json({ job });
});

// Job status page (HTML)
app.get("/status/:jobId", async (c: AppContext) => {
  const jobId = c.req.param("jobId");

  const doId = c.env.JOB_DO.idFromName("global");
  const stub = c.env.JOB_DO.get(doId) as DurableObjectStub<JobDurableObject>;

  const job = await stub.getJob(jobId);
  if (!job) {
    return c.html(renderNotFoundPage(jobId), 404);
  }

  return c.html(renderStatusPage(job));
});

// =============================================================================
// PAID CLAUDE ENDPOINTS
// =============================================================================

/**
 * Generic Claude endpoint handler
 * Used after x402 middleware has verified payment
 */
async function handleClaudeEndpoint(c: AppContext): Promise<Response> {
  // Get data stored by middleware
  const parsedBody = c.get("parsedBody") as Record<string, unknown>;
  const inputSize = c.get("inputSize") as number;
  const effort = c.get("effort") as EffortLevel;
  const priceBreakdown = c.get("priceBreakdown") as PriceBreakdown;
  const tokenType = c.get("tokenType") as TokenType;
  const product = c.get("product") as Product;
  const settleResult = c.get("settleResult") as { txId?: string; sender?: string };

  // Get payer address
  const payerAddress = getPayerAddress(c);
  if (!payerAddress) {
    return c.json({ error: "Could not determine payer address" }, 400);
  }

  // Get input text
  const input = (parsedBody.text ||
    parsedBody.code ||
    parsedBody.contract ||
    parsedBody.error ||
    "") as string;

  // Create input hash for dedup
  const inputHash = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(input + product.slug + effort))
    .then((buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );

  // Get JobDO
  const jobDoId = c.env.JOB_DO.idFromName("global");
  const jobStub = c.env.JOB_DO.get(jobDoId) as DurableObjectStub<JobDurableObject>;

  // Create job
  const job = await jobStub.createJob({
    payerAddress,
    productSlug: product.slug,
    inputHash,
    inputSize,
    effort,
    price: priceBreakdown.total,
    priceBreakdown,
    txId: settleResult.txId || "",
    tokenType,
  });

  // Start job
  await jobStub.startJob(job.id);

  // Execute Claude task
  const result = await executeClaudeTask(c, {
    product,
    input,
    effort,
    payerAddress,
    jobId: job.id,
  });

  if (result.success && result.result) {
    // Complete job
    const completedJob = await jobStub.completeJob(
      job.id,
      result.result,
      result.outputTokens || 0
    );

    // Record usage in UserDO
    const userDoId = c.env.USER_DO.idFromName(payerAddress);
    const userStub = c.env.USER_DO.get(userDoId) as DurableObjectStub<UserDurableObject>;
    c.executionCtx.waitUntil(
      userStub.recordUsage({
        productSlug: product.slug,
        priceStx: priceBreakdown.total,
        tokens: result.outputTokens || 0,
      })
    );

    return c.json({
      jobId: job.id,
      status: "completed",
      result: result.result,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      tokenType,
      statusUrl: `/status/${job.id}`,
    });
  } else {
    // Fail job
    await jobStub.failJob(job.id, result.error || "Unknown error");

    return c.json(
      {
        jobId: job.id,
        status: "failed",
        error: result.error,
        statusUrl: `/status/${job.id}`,
      },
      500
    );
  }
}

// Register Claude endpoints
app.post(
  "/api/claude/summarize",
  x402ClaudeMiddleware("summarize"),
  handleClaudeEndpoint
);

app.post(
  "/api/claude/code-review",
  x402ClaudeMiddleware("code-review"),
  handleClaudeEndpoint
);

app.post(
  "/api/claude/clarity-audit",
  x402ClaudeMiddleware("clarity-audit"),
  handleClaudeEndpoint
);

app.post(
  "/api/claude/debug",
  x402ClaudeMiddleware("debug"),
  handleClaudeEndpoint
);

// =============================================================================
// USER ENDPOINTS (payment required for auth)
// =============================================================================

// Get user's job history
app.post("/api/jobs", x402ClaudeMiddleware("summarize"), async (c: AppContext) => {
  const payerAddress = getPayerAddress(c);
  if (!payerAddress) {
    return c.json({ error: "Could not determine payer address" }, 400);
  }

  const jobDoId = c.env.JOB_DO.idFromName("global");
  const jobStub = c.env.JOB_DO.get(jobDoId) as DurableObjectStub<JobDurableObject>;

  const jobs = await jobStub.getJobsByPayer(payerAddress);

  return c.json({ jobs });
});

// Get user's usage summary
app.post("/api/usage", x402ClaudeMiddleware("summarize"), async (c: AppContext) => {
  const payerAddress = getPayerAddress(c);
  if (!payerAddress) {
    return c.json({ error: "Could not determine payer address" }, 400);
  }

  const userDoId = c.env.USER_DO.idFromName(payerAddress);
  const userStub = c.env.USER_DO.get(userDoId) as DurableObjectStub<UserDurableObject>;

  const usage = await userStub.getUsageSummary();

  return c.json({ usage, payerAddress });
});

// =============================================================================
// EXPORTS
// =============================================================================

// Export Durable Object classes for wrangler
export { JobDurableObject, UserDurableObject };

// Export Worker handler with explicit typing
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
