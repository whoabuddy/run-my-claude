import { describe, it, expect } from "vitest";
import { renderStatusPage, renderNotFoundPage } from "../src/components/status-page";
import type { Job } from "../src/types";

// Factory for creating test jobs
function createMockJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "test-job-id-12345678",
    payer_address: "SP31JEZWX4S131326VKM05QKJ0TDGNVVE0CDWWVA2",
    product_slug: "summarize",
    status: "pending",
    input_hash: "abc123hash",
    input_size: 500,
    effort: "standard",
    price_stx: 0.014,
    price_breakdown: JSON.stringify({ base: 0.005, inputSize: 0.003, effort: 0.006 }),
    payment_tx_id: null,
    token_type: "STX",
    started_at: null,
    completed_at: null,
    result: null,
    result_tokens: null,
    error: null,
    attempt: 1,
    max_attempts: 3,
    retry_after: null,
    retry_ticket_nft: null,
    created_at: "2024-01-15T10:30:00Z",
    updated_at: "2024-01-15T10:30:00Z",
    ...overrides,
  };
}

describe("renderStatusPage", function () {
  it("renders basic job info", function () {
    const job = createMockJob();
    const html = renderStatusPage(job);

    expect(html).toContain("test-job-id-12345678");
    expect(html).toContain("summarize");
    expect(html).toContain("standard");
    expect(html).toContain("0.014000 STX");
    expect(html).toContain("500");
  });

  it("includes auto-refresh for pending jobs", function () {
    const job = createMockJob({ status: "pending" });
    const html = renderStatusPage(job);

    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("auto-refreshes every 3 seconds");
  });

  it("includes auto-refresh for running jobs", function () {
    const job = createMockJob({ status: "running" });
    const html = renderStatusPage(job);

    expect(html).toContain('http-equiv="refresh"');
  });

  it("does not auto-refresh completed jobs", function () {
    const job = createMockJob({ status: "completed" });
    const html = renderStatusPage(job);

    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain("auto-refreshes");
  });

  it("shows result for completed jobs", function () {
    const job = createMockJob({
      status: "completed",
      result: "This is the summarized result.",
      result_tokens: 42,
      completed_at: "2024-01-15T10:31:00Z",
    });
    const html = renderStatusPage(job);

    expect(html).toContain("This is the summarized result.");
    expect(html).toContain("42 tokens");
    expect(html).toContain("Completed");
  });

  it("shows error for failed jobs", function () {
    const job = createMockJob({
      status: "failed",
      error: "API rate limit exceeded",
    });
    const html = renderStatusPage(job);

    expect(html).toContain("API rate limit exceeded");
    expect(html).toContain("Error");
  });

  it("shows retry info for retry_eligible jobs", function () {
    const job = createMockJob({
      status: "retry_eligible",
      error: "Temporary failure",
      retry_after: "2024-01-15T10:35:00Z",
    });
    const html = renderStatusPage(job);

    expect(html).toContain("Temporary failure");
    expect(html).toContain("Retry After");
  });

  it("shows transaction link when payment_tx_id exists", function () {
    const job = createMockJob({
      payment_tx_id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    });
    const html = renderStatusPage(job);

    expect(html).toContain("explorer.hiro.so");
    expect(html).toContain("0x1234567890abcdef12");
  });

  it("applies correct status color for each status", function () {
    const statuses = ["pending", "running", "completed", "failed", "retry_eligible", "dead"];
    const expectedColors: Record<string, string> = {
      pending: "#f59e0b",
      running: "#3b82f6",
      completed: "#10b981",
      failed: "#ef4444",
      retry_eligible: "#f97316",
      dead: "#6b7280",
    };

    for (const status of statuses) {
      const job = createMockJob({ status: status as Job["status"] });
      const html = renderStatusPage(job);
      expect(html).toContain(expectedColors[status]);
    }
  });

  it("escapes HTML in user-controlled content", function () {
    const job = createMockJob({
      product_slug: "<script>alert('xss')</script>",
      result: "<img onerror='alert(1)' src='x'>",
      status: "completed",
    });
    const html = renderStatusPage(job);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("handles special characters in error messages", function () {
    const job = createMockJob({
      status: "failed",
      error: "Error: 'foo' && \"bar\" < baz > qux",
    });
    const html = renderStatusPage(job);

    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).toContain("&#039;");
    expect(html).toContain("&quot;");
  });

  it("generates valid HTML structure", function () {
    const job = createMockJob();
    const html = renderStatusPage(job);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
  });

  it("includes responsive meta viewport", function () {
    const job = createMockJob();
    const html = renderStatusPage(job);

    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
  });
});

describe("renderNotFoundPage", function () {
  it("renders job ID in error message", function () {
    const html = renderNotFoundPage("missing-job-id");

    expect(html).toContain("Job Not Found");
    expect(html).toContain("missing-job-id");
  });

  it("escapes HTML in job ID", function () {
    const html = renderNotFoundPage("<script>alert('xss')</script>");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("generates valid HTML structure", function () {
    const html = renderNotFoundPage("test-id");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});
