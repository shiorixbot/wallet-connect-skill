---
name: wallet-connect
description: Connect AI agents to crypto wallets via WalletConnect. Use when the agent needs to pair with a wallet, sign messages, or send transactions (EVM and Solana). Triggers on wallet pairing, crypto payments, transaction signing, or wallet connection requests.
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
├── eslint.config.js      # ESLint 9 flat config
├── .env.example          # Required env vars template
├── .github/workflows/
│   └── ci.yml            # CI: lint + check on Node 20/22
├── scripts/
│   ├── wallet.mjs        # CLI entry point
│   └── lib/
│       ├── client.mjs    # WC SignClient singleton + session persistence
│       ├── helpers.mjs   # Shared utils (ENS, timeout, encoding, account lookup)
│       ├── pair.mjs      # Pairing command
│       ├── auth.mjs      # Authentication (consent sign)
│       ├── sign.mjs      # Message signing (EVM + Solana)
│       ├── send-tx.mjs   # Transaction sending (native + token, EVM + Solana)
│       └── tokens.mjs    # Token metadata (addresses, decimals)
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
node scripts/wallet.mjs <command> [args]
```

## Commands

### Pair (one-time onboarding)
```bash
node scripts/wallet.mjs pair --chains eip155:1,eip155:42161,solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```
Output: `{ uri, qrPath, topic }`

### Authenticate (consent sign)
```bash
node scripts/wallet.mjs auth --topic <topic>
```
Output: `{ address, signature, nonce }` after user approves in wallet.

### Send Transaction
```bash
# EVM: send ETH (supports ENS names)
node scripts/wallet.mjs send-tx --topic <topic> --chain eip155:1 \
  --to vitalik.eth --amount 0.01

# EVM: send USDC on Arbitrum
node scripts/wallet.mjs send-tx --topic <topic> --chain eip155:42161 \
  --to 0xRECIPIENT --token USDC --amount 5.0

# Solana: send native SOL
node scripts/wallet.mjs send-tx --topic <topic> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp \
  --to <PUBKEY> --amount 0.01

# Solana: send SPL USDC
node scripts/wallet.mjs send-tx --topic <topic> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp \
  --to <PUBKEY> --token USDC --amount 1.0
```

### Sign Message
```bash
# EVM (personal_sign)
node scripts/wallet.mjs sign --topic <topic> --message "Hello World"

# Solana (solana_signMessage, bs58-encoded)
node scripts/wallet.mjs sign --topic <topic> --message "Hello World" --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```

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

## Heartbeat Integration

When running wallet tasks (pairing, signing, transactions), update `HEARTBEAT.md` to monitor for pending WalletConnect messages and session events.

```markdown
## WalletConnect Session Monitor
- Check for pending WalletConnect messages/events
- If a signing request result or session event came in, report to user
- Check running exec sessions related to wallet.mjs (process list)
```

## Adding New Tokens

Token metadata is centralized in `scripts/lib/tokens.mjs`. To add a new token:

1. Open `scripts/lib/tokens.mjs`
2. Add an entry to the `TOKENS` object:

```js
WETH: {
  name: "Wrapped Ether",
  decimals: 18,
  addresses: {
    "eip155:1": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "eip155:42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "<mint_pubkey>",
  },
},
```

3. The token is immediately available for `send-tx --token WETH`

Helper functions exported from `tokens.mjs`:
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
npm run lint          # ESLint check
npm run lint:fix      # Auto-fix lint issues
npm run check         # Verify CLI loads
```

CI runs on every push/PR to main (Node 20 + 22).

## Environment

- `WALLETCONNECT_PROJECT_ID` — required
- `WC_METADATA_NAME` — optional (default: "ShioriX")
- `WC_METADATA_URL` — optional (default: "https://shiorix.com")

## Chain Reference

See [references/chains.md](references/chains.md) for supported chain IDs and token addresses.
