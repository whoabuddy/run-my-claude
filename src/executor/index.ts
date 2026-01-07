import type { AppContext, ClaudeExecutionRequest, ClaudeExecutionResult } from "../types";
import { executeWithWorkersAI } from "./workers-ai";
// import { executeWithAnthropicAPI } from "./anthropic-api";

/**
 * Execute Claude task using configured executor
 *
 * Executors:
 * - workers-ai: Cloudflare Workers AI (fast, limited models)
 * - anthropic: Direct Anthropic API (full Claude, requires API key)
 * - queue: Queue for dedicated runner (future)
 */
export async function executeClaudeTask(
  c: AppContext,
  request: ClaudeExecutionRequest
): Promise<ClaudeExecutionResult> {
  const executor = c.env.CLAUDE_EXECUTOR || "workers-ai";

  switch (executor) {
    case "workers-ai":
      return executeWithWorkersAI(c, request);

    case "anthropic":
      // TODO: Implement Anthropic API executor
      // return executeWithAnthropicAPI(c, request);
      return {
        success: false,
        error: "Anthropic API executor not yet implemented",
      };

    case "queue":
      // TODO: Implement queue-based executor
      return {
        success: false,
        error: "Queue executor not yet implemented",
      };

    default:
      return {
        success: false,
        error: `Unknown executor: ${executor}`,
      };
  }
}
