import type { Job } from "../types";

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  running: "#3b82f6",
  completed: "#10b981",
  failed: "#ef4444",
  retry_eligible: "#f97316",
  dead: "#6b7280",
  delivered: "#10b981",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render job status as HTML page
 * Auto-refreshes while job is running
 */
export function renderStatusPage(job: Job): string {
  const statusColor = STATUS_COLORS[job.status] || "#6b7280";
  const autoRefresh = job.status === "running" || job.status === "pending";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Job Status - ${job.id.slice(0, 8)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${autoRefresh ? '<meta http-equiv="refresh" content="3">' : ""}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 1.5rem;
      line-height: 1.5;
    }
    .container { max-width: 640px; margin: 0 auto; }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: #f8fafc;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
      background: ${statusColor};
      color: white;
    }
    .field { margin-bottom: 1rem; }
    .field:last-child { margin-bottom: 0; }
    .label {
      color: #94a3b8;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .value {
      font-size: 0.9375rem;
      color: #f1f5f9;
    }
    .mono {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      word-break: break-all;
      font-size: 0.875rem;
    }
    .result-box {
      background: #0f172a;
      padding: 1rem;
      border-radius: 8px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.875rem;
      line-height: 1.6;
    }
    .error-box {
      border: 1px solid #ef4444;
      background: rgba(239, 68, 68, 0.1);
    }
    a {
      color: #60a5fa;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .refresh-notice {
      text-align: center;
      color: #64748b;
      font-size: 0.875rem;
      padding: 1rem;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #64748b;
      border-top-color: #60a5fa;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 0.5rem;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    @media (max-width: 480px) {
      .grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Job Status</h1>

    <div class="card">
      <div class="field">
        <div class="label">Job ID</div>
        <div class="value mono">${job.id}</div>
      </div>

      <div class="field">
        <div class="label">Status</div>
        <div class="value"><span class="status-badge">${job.status}</span></div>
      </div>

      <div class="grid-2">
        <div class="field">
          <div class="label">Product</div>
          <div class="value">${escapeHtml(job.product_slug)}</div>
        </div>
        <div class="field">
          <div class="label">Effort</div>
          <div class="value">${escapeHtml(job.effort)}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <div class="label">Price</div>
          <div class="value">${job.price_stx.toFixed(6)} ${escapeHtml(job.token_type)}</div>
        </div>
        <div class="field">
          <div class="label">Input Size</div>
          <div class="value">${job.input_size.toLocaleString()} chars</div>
        </div>
      </div>

      ${job.payment_tx_id ? `
      <div class="field">
        <div class="label">Transaction</div>
        <div class="value">
          <a href="https://explorer.hiro.so/txid/${escapeHtml(job.payment_tx_id)}?chain=${job.token_type === "STX" ? "mainnet" : "mainnet"}" target="_blank" rel="noopener" class="mono">
            ${job.payment_tx_id.slice(0, 20)}...
          </a>
        </div>
      </div>
      ` : ""}

      <div class="grid-2">
        <div class="field">
          <div class="label">Created</div>
          <div class="value">${new Date(job.created_at).toLocaleString()}</div>
        </div>
        ${job.completed_at ? `
        <div class="field">
          <div class="label">Completed</div>
          <div class="value">${new Date(job.completed_at).toLocaleString()}</div>
        </div>
        ` : ""}
      </div>
    </div>

    ${job.status === "completed" && job.result ? `
    <div class="card">
      <div class="field">
        <div class="label">Result${job.result_tokens ? ` (${job.result_tokens} tokens)` : ""}</div>
        <div class="result-box">${escapeHtml(job.result)}</div>
      </div>
    </div>
    ` : ""}

    ${job.error ? `
    <div class="card error-box">
      <div class="field">
        <div class="label">Error</div>
        <div class="value" style="color: #fca5a5;">${escapeHtml(job.error)}</div>
      </div>
      ${job.status === "retry_eligible" && job.retry_after ? `
      <div class="field">
        <div class="label">Retry After</div>
        <div class="value">${new Date(job.retry_after).toLocaleString()}</div>
      </div>
      ` : ""}
    </div>
    ` : ""}

    ${autoRefresh ? `
    <div class="refresh-notice">
      <span class="spinner"></span>
      Processing... page auto-refreshes every 3 seconds
    </div>
    ` : ""}
  </div>
</body>
</html>`;
}

/**
 * Render 404 page for job not found
 */
export function renderNotFoundPage(jobId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Job Not Found</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container { text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    p { color: #94a3b8; }
    code {
      background: #1e293b;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Job Not Found</h1>
    <p>No job exists with ID <code>${escapeHtml(jobId)}</code></p>
  </div>
</body>
</html>`;
}
