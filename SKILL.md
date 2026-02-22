---
name: wallet-connect
description: Connect AI agents to crypto wallets via WalletConnect. Use when the agent needs to pair with a wallet, sign messages, or send transactions (EVM and Solana). Triggers on wallet pairing, crypto payments, transaction signing, or wallet connection requests.
license: MIT
compatibility: Requires Node.js >= 18 and bash. Needs WALLETCONNECT_PROJECT_ID environment variable (free at cloud.walletconnect.com). Works with any agent that can run shell commands.
metadata:
  author: shiorixbot
  version: "0.2"
  repo: https://github.com/shiorixbot/wallet-connect-skill
---

# Wallet Connect Skill

Connect to user's crypto wallet via WalletConnect v2. Supports EVM chains and Solana.

## Project Structure

```
wallet-connect-skill/
├── SKILL.md              # This file — agent instructions
├── README.md             # Project overview
├── LICENSE
├── package.json          # Root deps (runtime + dev)
├── tsconfig.json         # TypeScript config (noEmit — tsx runs directly)
├── .env.example          # Required env vars template
├── .github/workflows/
│   └── ci.yml            # CI: lint + typecheck + check on Node 20/22
├── src/
│   ├── cli.ts            # CLI entry point
│   ├── types.ts          # Shared TypeScript interfaces
│   ├── storage.ts        # Session persistence (load/save)
│   ├── client.ts         # WC SignClient singleton + address lookup
│   ├── helpers.ts        # Shared utils (ENS, timeout, encoding, account lookup)
│   └── commands/
│       ├── pair.ts       # Pairing command
│       ├── auth.ts       # Authentication (consent sign)
│       ├── sign.ts       # Message signing (EVM + Solana)
│       ├── sign-typed-data.ts # EIP-712 typed data signing (EVM only)
│       ├── swap.ts       # Uniswap quote fetching (EVM only, issue #5)
│       ├── send-tx.ts    # Transaction sending (native + token, EVM + Solana)
│       ├── balance.ts    # Balance checking (EVM + Solana)
│       ├── health.ts     # Session health detection (wc_ping)
│       ├── sessions.ts   # Session management (list, whoami, delete)
│       └── tokens.ts     # Token metadata (addresses, decimals)
└── references/
    └── chains.md         # Supported chain IDs and tokens
```

## Install

```bash
npm install
```

Requires:
- Node.js ≥ 18
- `WALLETCONNECT_PROJECT_ID` environment variable set

## Quick Start

```bash
tsx src/cli.ts <command> [args]
```

## Commands

### Pair (one-time onboarding)
```bash
tsx src/cli.ts pair --chains eip155:1,eip155:42161,solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```
Output: `{ uri, qrPath, topic }`

### Authenticate (consent sign)
```bash
tsx src/cli.ts auth --topic <topic>
```
Output: `{ address, signature, nonce }` after user approves in wallet.

### Check Balances (no wallet interaction)
```bash
# All balances for all accounts in a session
tsx src/cli.ts balance --topic <topic>

# Single chain
tsx src/cli.ts balance --topic <topic> --chain eip155:42161

# Direct address (no session needed)
tsx src/cli.ts balance --address 0xC36edF48e21cf395B206352A1819DE658fD7f988 --chain eip155:1

# All sessions, all chains
tsx src/cli.ts balance
```
Output: `[{ chain, address, balances: [{ token, balance, raw }] }]`

Queries public RPC endpoints — no wallet approval needed.

### List Supported Tokens
```bash
# Default: Ethereum mainnet
tsx src/cli.ts tokens

# Other chains
tsx src/cli.ts tokens --chain eip155:42161    # Arbitrum
tsx src/cli.ts tokens --chain eip155:10       # Optimism
tsx src/cli.ts tokens --chain eip155:137      # Polygon
tsx src/cli.ts tokens --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```
Output: `{ chain, tokens: [{ symbol, name, decimals, address }] }`

### Delete Session
```bash
tsx src/cli.ts delete-session --topic <topic>
tsx src/cli.ts delete-session --address 0xADDRESS
```
Removes the session from `~/.agent-wallet/sessions.json`.
Output: `{ status: "deleted", topic, peerName, accounts }`

### Check Session Health
```bash
# Ping a specific session
tsx src/cli.ts health --topic <topic>
tsx src/cli.ts health --address 0xADDR

# Ping all sessions
tsx src/cli.ts health --all

# Ping all and remove dead sessions automatically
tsx src/cli.ts health --all --clean
```

Output:
```json
{
  "checked": 2,
  "alive": 1,
  "dead": 1,
  "cleaned": 1,
  "sessions": [
    { "topic": "abc123…", "peerName": "Gem Wallet", "accounts": ["0xC36ed…"], "alive": true },
    { "topic": "def456…", "peerName": "MetaMask", "accounts": ["0xABC…"], "alive": false, "error": "ping timeout" }
  ]
}
```

Uses `wc_sessionPing` (15s timeout per session). A dead session means the wallet is offline or the session was disconnected — safe to `--clean`.

### Swap Quote (Uniswap)
Fetch a price quote from the Uniswap Trade API. **Quote only — does not execute the swap.**

```bash
# Quote 0.1 ETH → USDC on Ethereum mainnet
tsx src/cli.ts swap --token ETH --out USDC --amount 0.1

# With chain (default: eip155:1 Ethereum mainnet)
tsx src/cli.ts swap --token ETH --out USDC --amount 0.1 --chain eip155:1

# Include swapper address for more accurate gas/routing
tsx src/cli.ts swap --token ETH --out USDC --amount 0.1 --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

# USDC → WETH on Arbitrum
tsx src/cli.ts swap --token USDC --out WETH --amount 100 --chain eip155:42161
```

Output:
```json
{
  "swap": {
    "from": { "symbol": "ETH", "address": "0x0000...0000", "amount": "0.1", "rawAmount": "100000000000000000" },
    "to": { "symbol": "USDC", "address": "0xA0b8...eB48", "amount": "189.45", "minAmount": "188.56", "rawAmount": "189450000" },
    "chain": "eip155:1",
    "swapper": null,
    "gasFeeUSD": "2.15",
    "priceImpact": "0.05",
    "routing": "CLASSIC",
    "requestId": "..."
  },
  "note": "Quote only — to execute, use send-tx with the calldata returned by the Uniswap Universal Router."
}
```

Supported chains: `eip155:1` (Ethereum), `eip155:42161` (Arbitrum), `eip155:8453` (Base), `eip155:10` (Optimism), `eip155:137` (Polygon).
Uses `UNISWAP_API_KEY` env var if set; falls back to the demo key from Issue #5.

### Send Transaction
```bash
# EVM: send ETH (supports ENS names)
tsx src/cli.ts send-tx --topic <topic> --chain eip155:1 \
  --to vitalik.eth --amount 0.01

# EVM: send USDC on Arbitrum
tsx src/cli.ts send-tx --topic <topic> --chain eip155:42161 \
  --to 0xRECIPIENT --token USDC --amount 5.0

# EVM: send WETH on Optimism
tsx src/cli.ts send-tx --topic <topic> --chain eip155:10 \
  --to 0xRECIPIENT --token WETH --amount 0.01

# EVM: send DAI on Polygon
tsx src/cli.ts send-tx --topic <topic> --chain eip155:137 \
  --to 0xRECIPIENT --token DAI --amount 100.0

# Solana: send native SOL
tsx src/cli.ts send-tx --topic <topic> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp \
  --to <PUBKEY> --amount 0.01

# Solana: send SPL USDC
tsx src/cli.ts send-tx --topic <topic> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp \
  --to <PUBKEY> --token USDC --amount 1.0
```

### Sign Message
```bash
# EVM (personal_sign)
tsx src/cli.ts sign --topic <topic> --message "Hello World"

# Solana (solana_signMessage, bs58-encoded)
tsx src/cli.ts sign --topic <topic> --message "Hello World" --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```

### Sign Typed Data (EIP-712)
Signs structured data via `eth_signTypedData_v4`. EVM only.

```bash
# Inline JSON
tsx src/cli.ts sign-typed-data --topic <topic> --data '{"domain":{"name":"MyApp","version":"1","chainId":1},"types":{"Mail":[{"name":"from","type":"address"},{"name":"contents","type":"string"}]},"message":{"from":"0xabc...","contents":"Hello"}}'

# From file
tsx src/cli.ts sign-typed-data --topic <topic> --data @/path/to/typed-data.json

# Explicit chain
tsx src/cli.ts sign-typed-data --topic <topic> --data @payload.json --chain eip155:137
```

`primaryType` is inferred automatically from the `types` object (first non-`EIP712Domain` key) if not provided.

Output: `{ status, address, signature, chain, primaryType }`

## Features

### ENS Resolution
EVM `--to` addresses accept ENS names (e.g. `vitalik.eth`). Resolved via viem + Ethereum mainnet RPC. Resolution is logged to stderr.

### Solana Priority Fees
Solana transactions automatically include priority fees. Fetches recent prioritization fees from RPC and uses the median (p50) value via `ComputeBudgetProgram.setComputeUnitPrice`. Skips gracefully if RPC fails.

### Request Timeout
All wallet requests (auth, sign, send-tx) poll every 10 seconds with status updates to stderr. Timeout after 5 minutes if the user doesn't respond in their wallet.

## Onboarding Workflow

When user asks to pair their wallet:

1. Run `pair` → get URI + QR path
2. Send **two messages** to the user:
   - **Message 1:** "🔗 Pair your wallet" + QR code image as attachment
   - **Message 2:** The raw `wc:` URI wrapped in backticks (tap-to-copy on mobile)
3. User scans QR or copies URI into wallet app → approves pairing
4. Run `auth` → wallet receives consent sign request
5. User approves → agent stores session topic + verified address
6. Confirm to user: "✅ Wallet connected"

**UX rules:**
- Message 2 must contain ONLY the backtick-wrapped URI — no other text
- QR code is for desktop/scanning; URI copy is for mobile users
- The pair command blocks waiting for approval (5 min timeout)
- Kill the pair process after receiving the paired response, then run auth separately

## Transaction Workflow

1. Agent decides a payment is needed
2. Message user: "Sending X USDC to 0xABC for [reason]. Please approve in your wallet."
3. Run `send-tx` → user gets push notification in wallet
4. User approves/rejects → agent gets tx hash or rejection
5. Continue based on outcome

## Background Monitoring

When running wallet tasks (pairing, signing, transactions), set up periodic monitoring for pending WalletConnect messages and session events. Poll by re-running the relevant `cli.ts` commands or checking for active `cli.ts` processes.

**OpenClaw agents:** Add a monitor entry to `HEARTBEAT.md`:

```markdown
## WalletConnect Session Monitor
- Check for pending WalletConnect messages/events
- If a signing request result or session event came in, report to user
- Check running exec sessions related to cli.ts (process list)
```

**Other agents:** Use whatever periodic task mechanism your platform provides (cron, background loop, etc.) to poll for session updates.

## Supported Tokens

Tokens supported out of the box:

| Token | EVM Chains | Solana |
|-------|-----------|--------|
| USDC | ETH, Base, Arbitrum, Optimism, Polygon | ✅ Mainnet |
| USDT | ETH, Optimism, Polygon, BSC | ✅ Mainnet |
| WETH | ETH, Arbitrum, Base, Optimism, Polygon | — |
| DAI | ETH, Arbitrum, Base, Optimism, Polygon | — |
| WBTC | ETH, Arbitrum, Optimism, Polygon | — |

## Adding New Tokens

Token metadata is centralized in `src/commands/tokens.ts`. To add a new token:

1. Open `src/commands/tokens.ts`
2. Add an entry to the `TOKENS` object:

```ts
OP: {
  name: "Optimism",
  decimals: 18,
  addresses: {
    "eip155:10": "0x4200000000000000000000000000000000000042",
  },
},
```

3. The token is immediately available for `send-tx --token OP` and shown in `balance` and `tokens` commands

Helper functions exported from `tokens.ts`:
- `getTokenAddress(symbol, chainId)` — contract/mint address for a chain
- `getTokenDecimals(symbol)` — decimal places (defaults to 18)
- `isSplToken(symbol, chainId)` — check if it's an SPL token
- `getTokensForChain(chainId)` — list all tokens on a chain

## Session Persistence

- WC client sessions: `~/.agent-wallet/wc-store/` (persistent across runs)
- App session data: `~/.agent-wallet/sessions.json` (accounts, auth status)
- Sessions are valid until user disconnects from their wallet

## Development

```bash
npm run lint          # oxlint check
npm run lint:fix      # oxlint auto-fix
npm run format        # oxfmt format
npm run format:check  # oxfmt check (CI)
npm run typecheck     # TypeScript type checking (tsc --noEmit)
npm run check         # Verify CLI loads
```

CI runs on every push/PR to main (Node 20 + 22).

## Environment

- `WALLETCONNECT_PROJECT_ID` — required
- `WC_METADATA_NAME` — optional (default: "Agent Wallet")
- `WC_METADATA_URL` — optional (default: "https://shiorix.com")

## Chain Reference

See [references/chains.md](references/chains.md) for supported chain IDs and token addresses.
