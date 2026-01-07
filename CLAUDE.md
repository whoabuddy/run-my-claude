# Run My Claude - Development Guidelines

## Project Overview

Payment-gated Claude Code API via x402 micropayments on Stacks blockchain.
Customers pay STX/sBTC/USDCx per-request to execute Claude tasks with preset instructions.

## Quick Start

```bash
npm install
npm run dev          # Start local dev server
npm run typecheck    # Check types
npm run test         # Run tests
```

## Architecture

```
src/
├── index.ts                 # Hono app + route registration
├── types.ts                 # Shared TypeScript types
├── middleware/
│   └── x402-claude.ts       # Payment verification + dynamic pricing
├── durable-objects/
│   ├── JobDO.ts             # Job state (SQLite)
│   └── UserDO.ts            # Per-user state (usage, tickets)
├── products/
│   └── index.ts             # Product catalog
├── executor/
│   ├── index.ts             # Executor router
│   └── workers-ai.ts        # Workers AI backend
├── utils/
│   └── claude-pricing.ts    # Dynamic pricing calculator
└── components/
    └── status-page.ts       # HTML job status UI
```

## Key Concepts

### Products
Each product is a pre-configured Claude task with:
- System prompt (your expertise)
- Allowed effort levels
- Base fee
- Input validation schema

### Dynamic Pricing
```
price = baseFee + inputSizeRate + (effortMultiplier × effortRate)
```

### Effort Levels
| Level | max_tokens | Multiplier |
|-------|------------|------------|
| quick | 500 | 1x |
| standard | 2,000 | 2x |
| detailed | 4,000 | 4x |
| comprehensive | 8,000 | 8x |

### Payment Flow
1. Client POSTs to `/api/claude/{product}`
2. Server returns 402 with dynamic price
3. Client signs STX transaction
4. Client retries with `X-PAYMENT` header
5. Server verifies via facilitator, executes task
6. Result returned with job ID

## Adding New Products

1. Add product definition to `src/products/index.ts`
2. Create CLAUDE.md preset in `src/products/presets/{slug}/`
3. Register endpoint in `src/index.ts`

## Environment Variables

```
X402_NETWORK=mainnet|testnet
X402_SERVER_ADDRESS=SP...
X402_FACILITATOR_URL=https://facilitator.x402stacks.xyz
CLAUDE_EXECUTOR=workers-ai|anthropic|queue
```

## Deployment

```bash
# Staging (testnet)
npm run deploy:staging

# Production (mainnet) - CAREFUL!
npm run deploy
```

## Testing Payment Flow

Use testnet with test STX:
1. Get testnet STX from faucet
2. Set `X402_NETWORK=testnet` in wrangler
3. Use testnet facilitator

## File Organization Rules

- Source code → `src/`
- Tests → `tests/`
- Documentation → `docs/`
- Never save files to root directory

## References

- [BUILD_PLAN.md](docs/BUILD_PLAN.md) - Full implementation plan
- [x402-stacks](https://github.com/tony1908/x402Stacks) - Payment protocol
- [stx402](~/dev/whoabuddy/stx402) - Reference implementation
