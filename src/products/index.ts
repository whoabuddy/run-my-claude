import { z } from "zod";
import type { EffortLevel, Product } from "../types";

/**
 * Product catalog - each product is a pre-configured Claude Code task
 * Your expertise packaged as paid API endpoints
 */
export const PRODUCTS: Record<string, Product> = {
  summarize: {
    slug: "summarize",
    name: "Smart Summarizer",
    description: "Condense any text to key points",
    baseFee: 0.005,
    claudeMd: "./presets/summarize/CLAUDE.md",
    systemPrompt: `You are a summarization expert. Extract key points and present them clearly.

Rules:
- Be concise but complete
- Preserve critical details
- Use bullet points for clarity
- Never add information not in the source
- Match output length to the "effort" level requested`,
    allowedEfforts: ["quick", "standard", "detailed"] as EffortLevel[],
    inputSchema: z.object({
      text: z.string().min(10).max(100000),
      format: z.enum(["bullets", "paragraph", "outline"]).optional(),
    }),
  },

  "code-review": {
    slug: "code-review",
    name: "Code Reviewer",
    description: "Professional code review with actionable feedback",
    baseFee: 0.01,
    claudeMd: "./presets/code-review/CLAUDE.md",
    systemPrompt: `You are a senior code reviewer. Analyze code for:
- Bugs and potential issues
- Security vulnerabilities (OWASP top 10)
- Performance concerns
- Code style and best practices
- Clarity and maintainability

Provide specific, actionable feedback with line references where applicable.
Be constructive, not harsh. Prioritize issues by severity.`,
    allowedEfforts: ["standard", "detailed", "comprehensive"] as EffortLevel[],
    inputSchema: z.object({
      code: z.string().min(10).max(50000),
      language: z.string().optional(),
      context: z.string().optional(),
    }),
  },

  "clarity-audit": {
    slug: "clarity-audit",
    name: "Clarity Contract Auditor",
    description: "Security audit for Clarity smart contracts on Stacks",
    baseFee: 0.02,
    claudeMd: "./presets/clarity-audit/CLAUDE.md",
    systemPrompt: `You are a Clarity smart contract security auditor with deep expertise in Stacks blockchain.

Check for:
- Reentrancy vulnerabilities
- Integer overflow/underflow
- Authorization bypasses (tx-sender vs contract-caller)
- Improper error handling (try! vs unwrap!)
- Asset safety issues
- Denial of service vectors
- Post-condition failures
- SIP-010/SIP-009 compliance issues

Use stacks-block-height (not block-height) for current block.
Reference Clarity best practices and security handbook patterns.
Provide severity ratings: Critical, High, Medium, Low, Informational.`,
    allowedEfforts: ["detailed", "comprehensive"] as EffortLevel[],
    inputSchema: z.object({
      contract: z.string().min(50).max(100000),
      contractName: z.string().optional(),
      deploymentContext: z.string().optional(),
    }),
  },

  debug: {
    slug: "debug",
    name: "Debug Assistant",
    description: "Diagnose and fix code errors",
    baseFee: 0.008,
    claudeMd: "./presets/debug/CLAUDE.md",
    systemPrompt: `You are a debugging expert. Given an error and code context:
1. Identify the root cause
2. Explain why it's happening in plain terms
3. Provide a fix with code
4. Suggest how to prevent similar issues

Be systematic. If you need more context, say what would help.
Don't guess - if the cause is unclear, explain the most likely scenarios.`,
    allowedEfforts: ["quick", "standard", "detailed"] as EffortLevel[],
    inputSchema: z.object({
      error: z.string().min(5),
      code: z.string().optional(),
      stackTrace: z.string().optional(),
      context: z.string().optional(),
    }),
  },
};

/**
 * Get product by slug
 */
export function getProduct(slug: string): Product | undefined {
  return PRODUCTS[slug];
}

/**
 * List all products (for discovery endpoint)
 */
export function listProducts(): Array<{
  slug: string;
  name: string;
  description: string;
  baseFee: number;
  allowedEfforts: EffortLevel[];
}> {
  return Object.values(PRODUCTS).map((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    baseFee: p.baseFee,
    allowedEfforts: p.allowedEfforts,
  }));
}

/**
 * Validate input against product schema
 */
export function validateProductInput(
  product: Product,
  input: unknown
): { success: true; data: unknown } | { success: false; error: string } {
  try {
    const schema = product.inputSchema as z.ZodSchema;
    const data = schema.parse(input);
    return { success: true, data };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { success: false, error: e.errors.map((e) => e.message).join(", ") };
    }
    return { success: false, error: "Invalid input" };
  }
}
