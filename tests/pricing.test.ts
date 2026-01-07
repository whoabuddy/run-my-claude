import { describe, it, expect } from "vitest";
import {
  calculatePrice,
  stxToMicroStx,
  microStxToStx,
  toSmallestUnit,
  formatPrice,
  getMaxTokens,
  validateEffort,
  EFFORT_LEVELS,
  INPUT_TIERS,
} from "../src/utils/claude-pricing";
import type { Product, EffortLevel } from "../src/types";

// Mock product for testing
const mockProduct: Product = {
  slug: "test",
  name: "Test Product",
  description: "Test description",
  baseFee: 0.005,
  claudeMd: "./test.md",
  systemPrompt: "Test prompt",
  allowedEfforts: ["quick", "standard", "detailed"],
  inputSchema: {} as any,
};

describe("calculatePrice", function () {
  it("calculates price for small input with quick effort", function () {
    const result = calculatePrice(500, "quick", mockProduct);

    expect(result.base).toBe(0.005);
    expect(result.inputSize).toBe(0.001); // < 1000 chars
    expect(result.effort).toBe(0.003); // 1x multiplier
    expect(result.total).toBeCloseTo(0.009, 6);
  });

  it("calculates price for medium input with standard effort", function () {
    const result = calculatePrice(3000, "standard", mockProduct);

    expect(result.base).toBe(0.005);
    expect(result.inputSize).toBe(0.003); // 1000-5000 chars
    expect(result.effort).toBe(0.006); // 2x multiplier
    expect(result.total).toBeCloseTo(0.014, 6);
  });

  it("calculates price for large input with detailed effort", function () {
    const result = calculatePrice(15000, "detailed", mockProduct);

    expect(result.base).toBe(0.005);
    expect(result.inputSize).toBe(0.008); // 5000-20000 chars
    expect(result.effort).toBe(0.012); // 4x multiplier
    expect(result.total).toBeCloseTo(0.025, 6);
  });

  it("calculates price for XL input with comprehensive effort", function () {
    const result = calculatePrice(50000, "comprehensive", mockProduct);

    expect(result.base).toBe(0.005);
    expect(result.inputSize).toBe(0.015); // > 20000 chars
    expect(result.effort).toBe(0.024); // 8x multiplier
    expect(result.total).toBeCloseTo(0.044, 6);
  });

  it("uses product baseFee correctly", function () {
    const expensiveProduct = { ...mockProduct, baseFee: 0.02 };
    const result = calculatePrice(500, "quick", expensiveProduct);

    expect(result.base).toBe(0.02);
    expect(result.total).toBeCloseTo(0.024, 6); // 0.02 + 0.001 + 0.003
  });

  it("handles edge case at tier boundary", function () {
    // Exactly 1000 chars should be in first tier
    const result1000 = calculatePrice(1000, "quick", mockProduct);
    expect(result1000.inputSize).toBe(0.001);

    // 1001 chars should be in second tier
    const result1001 = calculatePrice(1001, "quick", mockProduct);
    expect(result1001.inputSize).toBe(0.003);
  });
});

describe("stxToMicroStx", function () {
  it("converts STX to microSTX", function () {
    expect(stxToMicroStx(1)).toBe(BigInt(1_000_000));
    expect(stxToMicroStx(0.5)).toBe(BigInt(500_000));
    expect(stxToMicroStx(0.000001)).toBe(BigInt(1));
  });

  it("handles zero", function () {
    expect(stxToMicroStx(0)).toBe(BigInt(0));
  });

  it("rounds fractional microSTX", function () {
    expect(stxToMicroStx(0.0000015)).toBe(BigInt(2)); // rounds up
    expect(stxToMicroStx(0.0000014)).toBe(BigInt(1)); // rounds down
  });
});

describe("microStxToStx", function () {
  it("converts microSTX to STX string", function () {
    expect(microStxToStx(BigInt(1_000_000))).toBe("1.000000");
    expect(microStxToStx(BigInt(500_000))).toBe("0.500000");
    expect(microStxToStx(BigInt(1))).toBe("0.000001");
  });

  it("handles zero", function () {
    expect(microStxToStx(BigInt(0))).toBe("0.000000");
  });
});

describe("toSmallestUnit", function () {
  it("converts STX amounts", function () {
    expect(toSmallestUnit(1, "STX")).toBe(BigInt(1_000_000));
    expect(toSmallestUnit(0.009, "STX")).toBe(BigInt(9_000));
  });

  it("converts sBTC amounts (8 decimals)", function () {
    expect(toSmallestUnit(1, "sBTC")).toBe(BigInt(100_000_000));
    expect(toSmallestUnit(0.00000001, "sBTC")).toBe(BigInt(1));
  });

  it("converts USDCx amounts (6 decimals)", function () {
    expect(toSmallestUnit(1, "USDCx")).toBe(BigInt(1_000_000));
    expect(toSmallestUnit(0.01, "USDCx")).toBe(BigInt(10_000));
  });

  it("throws for unknown token type", function () {
    expect(() => toSmallestUnit(1, "UNKNOWN" as any)).toThrow("Unknown token type");
  });
});

describe("formatPrice", function () {
  it("formats STX with 6 decimals", function () {
    expect(formatPrice(0.009, "STX")).toBe("0.009000 STX");
    expect(formatPrice(1, "STX")).toBe("1.000000 STX");
  });

  it("formats sBTC with 8 decimals", function () {
    expect(formatPrice(0.001, "sBTC")).toBe("0.00100000 sBTC");
  });

  it("formats USDCx with 6 decimals", function () {
    expect(formatPrice(10.5, "USDCx")).toBe("10.500000 USDCx");
  });
});

describe("getMaxTokens", function () {
  it("returns correct max tokens for each effort level", function () {
    expect(getMaxTokens("quick")).toBe(500);
    expect(getMaxTokens("standard")).toBe(2000);
    expect(getMaxTokens("detailed")).toBe(4000);
    expect(getMaxTokens("comprehensive")).toBe(8000);
  });
});

describe("validateEffort", function () {
  it("returns true for allowed effort levels", function () {
    expect(validateEffort("quick", mockProduct)).toBe(true);
    expect(validateEffort("standard", mockProduct)).toBe(true);
    expect(validateEffort("detailed", mockProduct)).toBe(true);
  });

  it("returns false for disallowed effort levels", function () {
    expect(validateEffort("comprehensive", mockProduct)).toBe(false);
  });
});

describe("EFFORT_LEVELS constant", function () {
  it("has all four effort levels defined", function () {
    expect(Object.keys(EFFORT_LEVELS)).toEqual([
      "quick",
      "standard",
      "detailed",
      "comprehensive",
    ]);
  });

  it("has correct multipliers", function () {
    expect(EFFORT_LEVELS.quick.multiplier).toBe(1);
    expect(EFFORT_LEVELS.standard.multiplier).toBe(2);
    expect(EFFORT_LEVELS.detailed.multiplier).toBe(4);
    expect(EFFORT_LEVELS.comprehensive.multiplier).toBe(8);
  });
});

describe("INPUT_TIERS constant", function () {
  it("has four tiers with increasing rates", function () {
    expect(INPUT_TIERS.length).toBe(4);
    expect(INPUT_TIERS[0].rate).toBeLessThan(INPUT_TIERS[1].rate);
    expect(INPUT_TIERS[1].rate).toBeLessThan(INPUT_TIERS[2].rate);
    expect(INPUT_TIERS[2].rate).toBeLessThan(INPUT_TIERS[3].rate);
  });

  it("has final tier with Infinity maxChars", function () {
    expect(INPUT_TIERS[3].maxChars).toBe(Infinity);
  });
});
