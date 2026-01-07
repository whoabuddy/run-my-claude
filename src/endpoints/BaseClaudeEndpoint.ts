import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext, TokenType } from "../types";

/**
 * Base class for Claude endpoints
 * Provides common utilities for paid endpoints
 */
export abstract class BaseClaudeEndpoint {
  /**
   * Get token type from request (query param or header)
   */
  protected getTokenType(c: AppContext): TokenType {
    const fromQuery = c.req.query("tokenType");
    const fromHeader = c.req.header("X-PAYMENT-TOKEN-TYPE");
    const token = (fromQuery || fromHeader || "STX").toUpperCase();

    if (token === "STX" || token === "SBTC" || token === "USDCX") {
      return token === "SBTC" ? "sBTC" : token === "USDCX" ? "USDCx" : "STX";
    }
    return "STX";
  }

  /**
   * Get payer address from settlement result
   */
  protected getPayerAddress(c: AppContext): string | null {
    const settleResult = c.get("settleResult");

    if (settleResult) {
      return settleResult.sender || null;
    }

    return null;
  }

  /**
   * Return standardized error response
   */
  protected errorResponse(
    c: AppContext,
    error: string,
    status: ContentfulStatusCode = 400
  ): Response {
    const tokenType = this.getTokenType(c);
    return c.json({ error, tokenType }, status);
  }

  /**
   * Validate required string field
   */
  protected validateString(
    value: unknown,
    fieldName: string,
    minLength = 1,
    maxLength = 100000
  ): { valid: true; value: string } | { valid: false; error: string } {
    if (typeof value !== "string") {
      return { valid: false, error: `${fieldName} must be a string` };
    }
    if (value.length < minLength) {
      return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
    }
    if (value.length > maxLength) {
      return { valid: false, error: `${fieldName} must be at most ${maxLength} characters` };
    }
    return { valid: true, value };
  }
}
