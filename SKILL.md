---
name: agent-wallet
description: Connect AI agents to crypto wallets via WalletConnect. Use when the agent needs to pair with a wallet, sign messages, or send transactions (EVM and Solana). Triggers on wallet pairing, crypto payments, transaction signing, or wallet connection requests.
---

# Agent Wallet

Connect to user's crypto wallet via WalletConnect v2. Supports EVM chains and Solana.

## Quick Start

```bash
node scripts/wallet.mjs <command> [args]
```

## Commands

### Pair (one-time onboarding)
```bash
# Create pairing session — returns WC URI + QR image path
node scripts/wallet.mjs pair --chains eip155:1,solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```
Output: `{ uri, qrPath, topic }`

Send the QR image + deep link to user. After wallet approves:
```bash
# Check session status
node scripts/wallet.mjs status --topic <topic>
```

### Authenticate (consent sign)
```bash
# Send personal_sign with consent message + nonce
node scripts/wallet.mjs auth --topic <topic>
```
Output: `{ address, signature, verified }` after user approves in wallet.

### Send Transaction
```bash
# EVM: send USDC transfer
node scripts/wallet.mjs send-tx --topic <topic> --chain eip155:1 \
  --to 0xRECIPIENT --token USDC --amount 5.0

# Solana: send SOL
node scripts/wallet.mjs send-tx --topic <topic> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp \
  --to <pubkey> --amount 0.1
```

### Sign Message
```bash
node scripts/wallet.mjs sign --topic <topic> --message "Hello World"
```

## Workflow

### Onboarding
1. Run `pair` → get URI + QR
2. Send QR image + WC deep link to user via chat
3. User taps → wallet opens → approves pairing
4. Run `auth` → sends consent message for user to sign
5. User approves → agent has verified wallet address
6. Store session topic + address for future use

### Transaction
1. Agent decides a payment is needed
2. Message user: "I need to send X USDC to 0xABC for [reason]"
3. Run `send-tx` → user gets push notification in wallet
4. User approves/rejects → agent gets result
5. Continue based on outcome

## Session Persistence

Sessions are stored in `~/.agent-wallet/sessions.json`. They persist across agent restarts and are valid until the user disconnects from their wallet.

## Environment

- `WALLETCONNECT_PROJECT_ID` — required, get from cloud.walletconnect.com

## Chain Reference

See [references/chains.md](references/chains.md) for supported chain IDs and token addresses.
