import type { EffortLevel, PriceBreakdown, Product, TokenType } from "../types";

/**
 * Effort level configuration
 * Maps effort to max_tokens and price multiplier
 */
export const EFFORT_LEVELS: Record<
  EffortLevel,
  { maxTokens: number; multiplier: number }
> = {
  quick: { maxTokens: 500, multiplier: 1 },
  standard: { maxTokens: 2000, multiplier: 2 },
  detailed: { maxTokens: 4000, multiplier: 4 },
  comprehensive: { maxTokens: 8000, multiplier: 8 },
};

/**
 * Input size tiers
 * Price increases with input length
 */
export const INPUT_TIERS = [
  { maxChars: 1000, rate: 0.001 },
  { maxChars: 5000, rate: 0.003 },
  { maxChars: 20000, rate: 0.008 },
  { maxChars: Infinity, rate: 0.015 },
];

/**
 * Base effort rate (multiplied by effort multiplier)
 */
const EFFORT_BASE_RATE = 0.003;

/**
 * Calculate dynamic price based on input size and effort
 */
export function calculatePrice(
  inputSize: number,
  effort: EffortLevel,
  product: Product
): PriceBreakdown {
  const baseFee = product.baseFee;
  const inputTier = INPUT_TIERS.find((t) => inputSize <= t.maxChars)!;
  const effortConfig = EFFORT_LEVELS[effort];

  const inputSizePrice = inputTier.rate;
  const effortPrice = effortConfig.multiplier * EFFORT_BASE_RATE;
  const total = baseFee + inputSizePrice + effortPrice;

  return {
    base: baseFee,
    inputSize: inputSizePrice,
    effort: effortPrice,
    total,
  };
}

/**
 * Convert STX to microSTX (6 decimals)
 */
export function stxToMicroStx(stx: number): bigint {
  return BigInt(Math.round(stx * 1_000_000));
}

/**
 * Convert microSTX to STX string
 */
export function microStxToStx(microStx: bigint): string {
  return (Number(microStx) / 1_000_000).toFixed(6);
}

/**
 * Convert price to smallest unit for token type
 */
export function toSmallestUnit(amount: number, tokenType: TokenType): bigint {
  switch (tokenType) {
    case "STX":
      return stxToMicroStx(amount);
    case "sBTC":
      // sBTC uses 8 decimals (satoshis)
      return BigInt(Math.round(amount * 100_000_000));
    case "USDCx":
      // USDCx uses 6 decimals
      return BigInt(Math.round(amount * 1_000_000));
    default:
      throw new Error(`Unknown token type: ${tokenType}`);
  }
}

/**
 * Format price for display
 */
export function formatPrice(amount: number, tokenType: TokenType): string {
  const decimals = tokenType === "sBTC" ? 8 : 6;
  return `${amount.toFixed(decimals)} ${tokenType}`;
}

/**
 * Get max tokens for effort level
 */
export function getMaxTokens(effort: EffortLevel): number {
  return EFFORT_LEVELS[effort].maxTokens;
}

/**
 * Validate effort level is allowed for product
 */
export function validateEffort(
  effort: EffortLevel,
  product: Product
): boolean {
  return product.allowedEfforts.includes(effort);
}
