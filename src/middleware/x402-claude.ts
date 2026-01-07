import type { MiddlewareHandler } from "hono";
import { X402PaymentVerifier } from "x402-stacks";
import type { AppContext, TokenType, PriceBreakdown, EffortLevel } from "../types";
import { getProduct, validateProductInput } from "../products";
import { calculatePrice, toSmallestUnit } from "../utils/claude-pricing";

// Token contracts for SIP-010 tokens
const TOKEN_CONTRACTS = {
  mainnet: {
    sBTC: {
      address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
      name: "sbtc-token",
      assetName: "sbtc",
    },
    USDCx: {
      address: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE",
      name: "usdc-token",
      assetName: "usdc",
    },
  },
  testnet: {
    sBTC: {
      address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT",
      name: "sbtc-token",
      assetName: "sbtc",
    },
    USDCx: {
      address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT",
      name: "usdc-token",
      assetName: "usdc",
    },
  },
};

/**
 * Extract token type from request
 */
function getTokenType(c: AppContext): TokenType {
  const fromQuery = c.req.query("tokenType");
  const fromHeader = c.req.header("X-PAYMENT-TOKEN-TYPE");
  const token = (fromQuery || fromHeader || "STX").toUpperCase();

  if (token === "STX" || token === "SBTC" || token === "USDCX") {
    return token === "SBTC" ? "sBTC" : token === "USDCX" ? "USDCx" : "STX";
  }
  return "STX";
}

/**
 * Build 402 payment required response
 */
function build402Response(
  c: AppContext,
  productSlug: string,
  priceBreakdown: PriceBreakdown,
  tokenType: TokenType
): Response {
  const network = c.env.X402_NETWORK;
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const response: Record<string, unknown> = {
    maxAmountRequired: priceBreakdown.total.toFixed(6),
    payTo: c.env.X402_SERVER_ADDRESS,
    network,
    tokenType,
    resource: c.req.path,
    nonce,
    expiresAt,
    priceBreakdown: {
      base: priceBreakdown.base.toFixed(6),
      inputSize: priceBreakdown.inputSize.toFixed(6),
      effort: priceBreakdown.effort.toFixed(6),
    },
    pricingTier: "dynamic",
  };

  // Add token contract for SIP-010 tokens
  if (tokenType !== "STX") {
    const contracts = TOKEN_CONTRACTS[network];
    const contract = contracts[tokenType as keyof typeof contracts];
    if (contract) {
      response.tokenContract = contract;
    }
  }

  return c.json(response, 402);
}

/**
 * X402 payment middleware with dynamic pricing for Claude endpoints
 *
 * Flow:
 * 1. Parse request to determine input size and effort
 * 2. Calculate dynamic price
 * 3. If no X-PAYMENT header, return 402 with price
 * 4. If X-PAYMENT present, verify and settle via facilitator
 * 5. Store settlement result in context for handler
 */
export function x402ClaudeMiddleware(productSlug: string): MiddlewareHandler {
  return async (c: AppContext, next) => {
    const product = getProduct(productSlug);
    if (!product) {
      return c.json({ error: "Product not found" }, 404);
    }

    // Parse request body to calculate price
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate input
    const validation = validateProductInput(product, body);
    if (!validation.success) {
      return c.json({ error: validation.error }, 400);
    }

    // Extract input for size calculation
    const input = body.text || body.code || body.contract || body.error || "";
    const inputSize = typeof input === "string" ? input.length : 0;

    // Get effort level (default to first allowed)
    const effort = (body.effort as EffortLevel) || product.allowedEfforts[0];
    if (!product.allowedEfforts.includes(effort)) {
      return c.json(
        { error: `Invalid effort level. Allowed: ${product.allowedEfforts.join(", ")}` },
        400
      );
    }

    // Calculate dynamic price
    const tokenType = getTokenType(c);
    const priceBreakdown = calculatePrice(inputSize, effort, product);

    // Store parsed data for handler
    c.set("parsedBody", body);
    c.set("inputSize", inputSize);
    c.set("effort", effort);
    c.set("priceBreakdown", priceBreakdown);
    c.set("tokenType", tokenType);
    c.set("product", product);

    // Check for payment header
    const paymentHeader = c.req.header("X-PAYMENT");
    if (!paymentHeader) {
      return build402Response(c, productSlug, priceBreakdown, tokenType);
    }

    // Verify and settle payment
    try {
      const verifier = new X402PaymentVerifier(
        c.env.X402_FACILITATOR_URL,
        c.env.X402_NETWORK
      );

      const minAmount = toSmallestUnit(priceBreakdown.total, tokenType);

      const settleResult = await verifier.settlePayment(paymentHeader, {
        expectedRecipient: c.env.X402_SERVER_ADDRESS,
        minAmount,
        tokenType,
      });

      if (!settleResult.isValid) {
        return c.json(
          {
            error: "Payment settlement failed",
            details: settleResult.validationError,
          },
          402
        );
      }

      // Store settlement result for handler
      c.set("settleResult", {
        success: true,
        txId: settleResult.txId,
        sender: settleResult.sender,
      });
      c.set("signedTx", paymentHeader);

      // Add payment response header
      c.header("X-PAYMENT-RESPONSE", JSON.stringify({
        txId: settleResult.txId,
        status: "settled",
      }));

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment verification failed";

      // Classify error for appropriate response
      if (message.includes("network") || message.includes("timeout")) {
        return c.json(
          { error: "Payment service temporarily unavailable", retryAfter: 5 },
          502,
          { "Retry-After": "5" }
        );
      }

      if (message.includes("facilitator")) {
        return c.json(
          { error: "Facilitator unavailable", retryAfter: 30 },
          503,
          { "Retry-After": "30" }
        );
      }

      return c.json({ error: message }, 400);
    }
  };
}

/**
 * Extract payer address from settlement result or signed transaction
 */
export function getPayerAddress(c: AppContext): string | null {
  const settleResult = c.get("settleResult");

  if (settleResult) {
    // Try various field names (facilitator may use different conventions)
    return (
      settleResult.sender ||
      settleResult.senderAddress ||
      settleResult.sender_address ||
      null
    );
  }

  // Fallback: extract from signed transaction
  // This requires deserializing the transaction which is more complex
  // For now, return null and let handler deal with it
  return null;
}
