/**
 * Swap abstraction layer — common types and helpers shared by all providers.
 */

import { loadSessions } from "../../storage.js";
import { requireSession, findAccount, parseAccount } from "../../helpers.js";
import { getTokensForChain } from "../tokens.js";
import type { SignClient } from "@walletconnect/sign-client";
import type { ParsedArgs } from "../../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedToken {
  address: string;
  decimals: number;
  symbol: string;
}

export interface SwapRequest {
  chainId: string;
  tokenIn: ResolvedToken;
  tokenOut: ResolvedToken;
  amount: string;
  rawAmount: string;
  swapper: string;
  slippage?: string;
}

/** Normalized quote result returned by every provider. */
export interface SwapQuote {
  inAmount: string;
  outAmount: string;
  outAmountMin?: string;
  priceImpact: string | null;
  gasEstimate: string | null;
  router: string | null;
  requestId: string | null;
  /** Provider-specific metadata (fee info, routing details, etc.) */
  providerMeta?: Record<string, unknown>;
}

/** Data needed to execute the swap. Shape varies by provider. */
export interface SwapExecution {
  /** For EVM: the raw calldata hex. For Solana: base64 unsigned transaction. */
  data: string;
  /** For EVM: the router contract address to send the tx to. */
  to?: string;
  /** For EVM: hex value to send (native token swaps). */
  value?: string;
  /** Provider-specific ID needed for execution (e.g. Jupiter requestId). */
  requestId?: string;
}

/** Combined quote + execution data from a provider. */
export interface SwapOrder {
  quote: SwapQuote;
  execution: SwapExecution | null;
}

/** Result of submitting a swap for execution. */
export interface SwapResult {
  txHash: string;
  explorer: string;
  /** Actual output amount if known post-execution. */
  actualOutAmount?: string;
}

/**
 * A swap provider adapter. Each DEX aggregator implements this interface.
 */
export interface SwapProvider {
  /** Human-readable name (e.g. "Uniswap", "Jupiter"). */
  name: string;

  /** CAIP-2 chain IDs this provider supports. */
  supportedChains: string[];

  /** Resolve a token symbol to address/decimals for this provider's chains. */
  resolveToken(symbol: string, chainId: string): ResolvedToken;

  /** Default native token symbol for a chain (e.g. "ETH", "SOL"). */
  nativeSymbol(chainId: string): string;

  /** Placeholder swapper address for quote-only requests, or null if none. */
  placeholderSwapper(chainId: string): string | null;

  /** Fetch a quote (and optionally execution data) from the provider. */
  fetchOrder(req: SwapRequest): Promise<SwapOrder>;

  /**
   * Execute a swap: sign via WalletConnect and submit.
   * Returns the result or null if the user rejected.
   */
  execute(
    order: SwapOrder,
    req: SwapRequest,
    client: InstanceType<typeof SignClient>,
    topic: string,
  ): Promise<SwapResult | null>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Convert human-readable amount (e.g. "0.1") to raw integer string. */
export function toRaw(amount: string, decimals: number): string {
  const [whole = "0", frac = ""] = amount.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || "0")).toString();
}

/** Convert raw integer string to human-readable (trimmed to 8 significant frac digits). */
export function fromRaw(raw: string, decimals: number): string {
  const val = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = val / divisor;
  const frac = val % divisor;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, 8)
    .replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Resolve the swapper address from args (address, topic/session, or placeholder).
 */
export function resolveSwapper(
  args: ParsedArgs,
  chainId: string,
  provider: SwapProvider,
): { swapper: string; isPlaceholder: boolean } {
  if (args.address) {
    return { swapper: args.address, isPlaceholder: false };
  }
  if (args.topic) {
    const sessions = loadSessions();
    const session = requireSession(sessions, args.topic);
    const acct = findAccount(session.accounts, chainId);
    if (acct) {
      const { address } = parseAccount(acct);
      return { swapper: address, isPlaceholder: false };
    }
  }
  const placeholder = provider.placeholderSwapper(chainId);
  if (placeholder) {
    return { swapper: placeholder, isPlaceholder: true };
  }
  return { swapper: "", isPlaceholder: true };
}

/** Resolve a token symbol generically (looks up in the token registry). */
export function resolveTokenFromRegistry(symbol: string, chainId: string): ResolvedToken {
  const tokens = getTokensForChain(chainId);
  const found = tokens.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
  if (!found) {
    throw new Error(
      `Unknown token "${symbol}" on chain ${chainId}. Run: tsx src/cli.ts tokens --chain ${chainId}`,
    );
  }
  return { address: found.address, decimals: found.decimals, symbol: found.symbol };
}

export const EXPLORER_URLS: Record<string, string> = {
  "eip155:1": "https://etherscan.io/tx/",
  "eip155:42161": "https://arbiscan.io/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  "eip155:10": "https://optimistic.etherscan.io/tx/",
  "eip155:137": "https://polygonscan.com/tx/",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://solscan.io/tx/",
};

export function explorerUrl(chainId: string, txHash: string): string {
  const base = EXPLORER_URLS[chainId] ?? "https://etherscan.io/tx/";
  return `${base}${txHash}`;
}
