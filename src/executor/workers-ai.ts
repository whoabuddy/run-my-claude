import type { AppContext, ClaudeExecutionRequest, ClaudeExecutionResult } from "../types";
import { getMaxTokens } from "../utils/claude-pricing";

/**
 * Execute Claude task using Cloudflare Workers AI
 *
 * Note: Workers AI doesn't have Claude models directly.
 * Available alternatives (as of Jan 2025):
 * - @cf/meta/llama-3.3-70b-instruct-fp8-fast (best quality, higher latency)
 * - @cf/meta/llama-3.1-8b-instruct (balanced, lower latency)
 * - @cf/openai/gpt-oss-20b (OpenAI open-weight, good for reasoning)
 *
 * For production Claude, use the anthropic executor.
 */
export async function executeWithWorkersAI(
  c: AppContext,
  request: ClaudeExecutionRequest
): Promise<ClaudeExecutionResult> {
  const { product, input, effort, jobId } = request;
  const maxTokens = getMaxTokens(effort);

  try {
    // Build the prompt with system instructions
    const messages = [
      {
        role: "system" as const,
        content: product.systemPrompt,
      },
      {
        role: "user" as const,
        content: input,
      },
    ];

    // Use Workers AI model as Claude substitute
    // Model selection based on effort level for quality/latency tradeoff
    const model = effort === "comprehensive" || effort === "detailed"
      ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast"  // Higher quality for complex tasks
      : "@cf/meta/llama-3.1-8b-instruct-fp8";       // Lower latency for quick tasks

    const response = await c.env.AI.run(model, {
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    if (!response || typeof response !== "object") {
      return {
        success: false,
        error: "Invalid response from AI model",
      };
    }

    // Extract response text
    const result = "response" in response
      ? (response as { response: string }).response
      : JSON.stringify(response);

    // Estimate token counts (rough approximation)
    const inputTokens = Math.ceil(
      (product.systemPrompt.length + input.length) / 4
    );
    const outputTokens = Math.ceil(result.length / 4);

    return {
      success: true,
      result,
      inputTokens,
      outputTokens,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI execution failed";
    return {
      success: false,
      error: message,
    };
  }
}
