# Run My Claude

Payment-gated Claude Code API via x402 micropayments on Stacks blockchain.

## What Is This?

Pay STX, sBTC, or USDCx to run Claude tasks with curated prompts and expertise. Each API call is a micropayment - no accounts, no subscriptions. Your Stacks address is your identity.

## How It Works

```
1. POST /api/claude/summarize { text: "..." }

2. ← 402 Payment Required
   {
     maxAmountRequired: "0.014",
     payTo: "SP...",
     priceBreakdown: { base, inputSize, effort }
   }

3. Sign STX transaction (client-side, not broadcast)

4. POST /api/claude/summarize
   X-PAYMENT: <signed-tx>
   { text: "..." }

5. ← 200 OK
   {
     jobId: "abc-123",
     result: "Key points: ...",
     statusUrl: "/status/abc-123"
   }
```

## Products

| Endpoint | Base Fee | Description |
|----------|----------|-------------|
| `/api/claude/summarize` | 0.005 STX | Condense text to key points |
| `/api/claude/code-review` | 0.010 STX | Professional code review |
| `/api/claude/clarity-audit` | 0.020 STX | Clarity smart contract security audit |
| `/api/claude/debug` | 0.008 STX | Diagnose and fix code errors |

### Dynamic Pricing

Final price = `base + inputSize + effort`

**Input Size Tiers:**
- < 1,000 chars: +0.001 STX
- 1,000 - 5,000: +0.003 STX
- 5,000 - 20,000: +0.008 STX
- 20,000+: +0.015 STX

**Effort Levels:**
| Level | max_tokens | Multiplier |
|-------|------------|------------|
| `quick` | 500 | +0.003 STX |
| `standard` | 2,000 | +0.006 STX |
| `detailed` | 4,000 | +0.012 STX |
| `comprehensive` | 8,000 | +0.024 STX |

## Free Endpoints

- `GET /api/health` - Health check
- `GET /api/products` - List products with pricing
- `GET /api/job/:id` - Job status (JSON)
- `GET /status/:id` - Job status page (HTML)

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono.js
- **Payments**: [x402-stacks](https://github.com/tony1908/x402Stacks)
- **State**: Durable Objects (SQLite)
- **AI**: Workers AI (Claude via Anthropic API planned)

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Type check
npm run typecheck

# Deploy to staging (testnet)
npm run deploy:staging

# Deploy to production (mainnet)
npm run deploy
```

## Configuration

Environment variables in `wrangler.jsonc`:

```
X402_NETWORK=mainnet|testnet
X402_SERVER_ADDRESS=SP...        # Your payment address
X402_FACILITATOR_URL=https://facilitator.x402stacks.xyz
CLAUDE_EXECUTOR=workers-ai       # or "anthropic"
```

## Client Usage

Using [x402-stacks](https://www.npmjs.com/package/x402-stacks):

```typescript
import axios from 'axios';
import { withPaymentInterceptor, privateKeyToAccount } from 'x402-stacks';

const account = privateKeyToAccount(process.env.STX_PRIVATE_KEY!, 'mainnet');
const api = withPaymentInterceptor(
  axios.create({ baseURL: 'https://run-my-claude.example.com' }),
  account
);

// Automatic 402 handling - signs and retries transparently
const response = await api.post('/api/claude/summarize', {
  text: 'Your long document here...',
  effort: 'standard'
});

console.log(response.data.result);
```

## Architecture

```
Request → CORS → x402 Middleware → Claude Executor → Response
                      │                    │
                      ▼                    ▼
                 Facilitator          Workers AI
                 (settlement)         (or Anthropic)
                      │
                      ▼
              JobDO (state) ←→ UserDO (history)
```

## Roadmap

- [x] Core payment flow with x402-stacks
- [x] Dynamic pricing engine
- [x] Job state management
- [x] HTML status pages
- [ ] Anthropic API executor (full Claude)
- [ ] Streaming for long jobs
- [ ] Retry tickets (NFT-based)
- [ ] Usage analytics dashboard

## License

MIT

## Related

- [x402-stacks](https://github.com/tony1908/x402Stacks) - HTTP 402 payment protocol for Stacks
- [stx402](https://github.com/whoabuddy/stx402) - Reference x402 API implementation
