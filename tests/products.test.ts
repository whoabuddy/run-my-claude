import { describe, it, expect } from "vitest";
import {
  PRODUCTS,
  getProduct,
  listProducts,
  validateProductInput,
} from "../src/products/index";

describe("PRODUCTS catalog", function () {
  it("has all expected products", function () {
    expect(Object.keys(PRODUCTS)).toEqual([
      "summarize",
      "code-review",
      "clarity-audit",
      "debug",
    ]);
  });

  it("each product has required fields", function () {
    for (const [slug, product] of Object.entries(PRODUCTS)) {
      expect(product.slug).toBe(slug);
      expect(product.name).toBeTruthy();
      expect(product.description).toBeTruthy();
      expect(product.baseFee).toBeGreaterThan(0);
      expect(product.claudeMd).toBeTruthy();
      expect(product.systemPrompt).toBeTruthy();
      expect(product.allowedEfforts.length).toBeGreaterThan(0);
      expect(product.inputSchema).toBeTruthy();
    }
  });

  it("products have sensible base fees", function () {
    // clarity-audit should be most expensive (specialized)
    expect(PRODUCTS["clarity-audit"].baseFee).toBeGreaterThan(PRODUCTS.summarize.baseFee);
    // code-review more expensive than summarize
    expect(PRODUCTS["code-review"].baseFee).toBeGreaterThan(PRODUCTS.summarize.baseFee);
  });
});

describe("getProduct", function () {
  it("returns product by slug", function () {
    const product = getProduct("summarize");
    expect(product).toBeDefined();
    expect(product?.name).toBe("Smart Summarizer");
  });

  it("returns undefined for unknown slug", function () {
    expect(getProduct("nonexistent")).toBeUndefined();
  });

  it("returns correct product for each slug", function () {
    expect(getProduct("code-review")?.name).toBe("Code Reviewer");
    expect(getProduct("clarity-audit")?.name).toBe("Clarity Contract Auditor");
    expect(getProduct("debug")?.name).toBe("Debug Assistant");
  });
});

describe("listProducts", function () {
  it("returns array of product summaries", function () {
    const products = listProducts();
    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBe(4);
  });

  it("includes essential fields only", function () {
    const products = listProducts();
    const product = products.find((p) => p.slug === "summarize");

    expect(product).toEqual({
      slug: "summarize",
      name: "Smart Summarizer",
      description: "Condense any text to key points",
      baseFee: 0.005,
      allowedEfforts: ["quick", "standard", "detailed"],
    });
  });

  it("does not expose sensitive fields", function () {
    const products = listProducts();
    for (const product of products) {
      expect(product).not.toHaveProperty("systemPrompt");
      expect(product).not.toHaveProperty("claudeMd");
      expect(product).not.toHaveProperty("inputSchema");
    }
  });
});

describe("validateProductInput", function () {
  describe("summarize product", function () {
    const product = PRODUCTS.summarize;

    it("accepts valid input", function () {
      const result = validateProductInput(product, {
        text: "This is a valid text to summarize.",
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional format field", function () {
      const result = validateProductInput(product, {
        text: "This is a valid text to summarize.",
        format: "bullets",
      });
      expect(result.success).toBe(true);
    });

    it("rejects text too short", function () {
      const result = validateProductInput(product, { text: "short" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("at least");
    });

    it("rejects missing text field", function () {
      const result = validateProductInput(product, {});
      expect(result.success).toBe(false);
    });

    it("rejects invalid format enum", function () {
      const result = validateProductInput(product, {
        text: "This is a valid text to summarize.",
        format: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("code-review product", function () {
    const product = PRODUCTS["code-review"];

    it("accepts valid code input", function () {
      const result = validateProductInput(product, {
        code: "function hello() { return 'world'; }",
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional language and context", function () {
      const result = validateProductInput(product, {
        code: "function hello() { return 'world'; }",
        language: "javascript",
        context: "This is a greeting function",
      });
      expect(result.success).toBe(true);
    });

    it("rejects code too short", function () {
      const result = validateProductInput(product, { code: "x=1" });
      expect(result.success).toBe(false);
    });
  });

  describe("clarity-audit product", function () {
    const product = PRODUCTS["clarity-audit"];

    it("accepts valid Clarity contract", function () {
      const contract = `
        (define-public (transfer (amount uint) (recipient principal))
          (stx-transfer? amount tx-sender recipient)
        )
      `;
      const result = validateProductInput(product, { contract });
      expect(result.success).toBe(true);
    });

    it("accepts optional contractName and deploymentContext", function () {
      const contract = `
        (define-public (transfer (amount uint) (recipient principal))
          (stx-transfer? amount tx-sender recipient)
        )
      `;
      const result = validateProductInput(product, {
        contract,
        contractName: "my-token",
        deploymentContext: "Mainnet deployment",
      });
      expect(result.success).toBe(true);
    });

    it("rejects contract too short", function () {
      const result = validateProductInput(product, {
        contract: "(define-public (x) (ok true))",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("debug product", function () {
    const product = PRODUCTS.debug;

    it("accepts error message only", function () {
      const result = validateProductInput(product, {
        error: "TypeError: Cannot read property 'x' of undefined",
      });
      expect(result.success).toBe(true);
    });

    it("accepts full debug context", function () {
      const result = validateProductInput(product, {
        error: "TypeError: Cannot read property 'x' of undefined",
        code: "const result = obj.x.y;",
        stackTrace: "at Object.<anonymous> (file.js:10:15)",
        context: "This happens when loading user data",
      });
      expect(result.success).toBe(true);
    });

    it("rejects error too short", function () {
      const result = validateProductInput(product, { error: "err" });
      expect(result.success).toBe(false);
    });

    it("rejects missing error field", function () {
      const result = validateProductInput(product, { code: "some code" });
      expect(result.success).toBe(false);
    });
  });
});
