# Supported Chains & Tokens

## EVM Chains

| Chain | CAIP-2 ID | Common Tokens |
|-------|-----------|---------------|
| Ethereum | `eip155:1` | USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Base | `eip155:8453` | USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum | `eip155:42161` | USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| BSC | `eip155:56` | USDT: `0x55d398326f99059fF775485246999027B3197955` |

## EVM Methods

- `personal_sign` — sign a message (used for auth/consent)
- `eth_sendTransaction` — send a transaction (native or token transfer)
- `eth_signTypedData_v4` — EIP-712 typed data signing

## Solana

| Chain | CAIP-2 ID |
|-------|-----------|
| Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

### SPL Tokens (Mainnet)

| Token | Mint Address |
|-------|-------------|
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

## Solana Methods

- `solana_signMessage` — sign a message (bs58-encoded)
- `solana_signTransaction` — sign a transaction (base64 VersionedTransaction)
- `solana_signAndSendTransaction` — sign and broadcast (wallet submits to network)
