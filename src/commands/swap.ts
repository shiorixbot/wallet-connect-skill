/**
 * Swap command — fetch a quote from Uniswap Trade API.
 *
 * Usage:
 *   tsx src/cli.ts swap --token ETH --out USDC --amount 0.1 [--chain eip155:1] [--address 0x...] [--topic <topic>]
 *
 * Prints a JSON quote with calldata for the Universal Router.
 * To execute, use: execute-swap --token ETH --out USDC --amount 0.1 --address 0x...
 * Implements issue #5: https://github.com/shiorixbot/wallet-connect-skill/issues/5
 */

import { loadSessions } from "../storage.js";
import { requireSession, findAccount, parseAccount } from "../helpers.js";
import { getTokensForChain } from "./tokens.js";
import { UNIVERSAL_ROUTER_ADDRESS } from "../universal-router.js";
import type { ParsedArgs } from "../types.js";

export const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
// Public demo key from Issue #5 — replace via UNISWAP_API_KEY env var for production
export const UNISWAP_API_KEY =
  process.env.UNISWAP_API_KEY ?? "XHr6wiQY0GVXwqTmQyW83Prk8vJCgIENlpuwCGuTlhQ";

/** Native token address sentinel (ETH / MATIC / BNB on their respective chains) */
export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

/** EVM chain string → Uniswap numeric chain ID */
export const CHAIN_ID_MAP: Record<string, number> = {
  "eip155:1": 1,
  "eip155:42161": 42161,
  "eip155:8453": 8453,
  "eip155:10": 10,
  "eip155:137": 137,
};

/** Native-token symbols per chain */
export const NATIVE_SYMBOLS: Record<string, string> = {
  "eip155:1": "ETH",
  "eip155:42161": "ETH",
  "eip155:8453": "ETH",
  "eip155:10": "ETH",
  "eip155:137": "POL",
};

export interface ResolvedToken {
  address: string;
  decimals: number;
  symbol: string;
}

export function resolveToken(symbol: string, chainId: string): ResolvedToken {
  const native = NATIVE_SYMBOLS[chainId] ?? "ETH";
  if (symbol.toUpperCase() === native.toUpperCase() || symbol.toUpperCase() === "ETH") {
    return { address: NATIVE_ADDRESS, decimals: 18, symbol: native };
  }
  const tokens = getTokensForChain(chainId);
  const found = tokens.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
  if (!found) {
    throw new Error(
      `Unknown token "${symbol}" on chain ${chainId}. Run: tsx src/cli.ts tokens --chain ${chainId}`,
    );
  }
  return { address: found.address, decimals: found.decimals, symbol: found.symbol };
}

/** Convert human-readable amount (e.g. "0.1") to raw integer string */
export function toRaw(amount: string, decimals: number): string {
  const [whole = "0", frac = ""] = amount.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || "0")).toString();
}

/** Convert raw integer string to human-readable (trimmed to 6 significant frac digits) */
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

export interface UniswapQuoteResponse {
  quote?: {
    chainId?: number;
    swapper?: string;
    input?: { amount: string; token: string };
    output?: { amount: string; token: string; minimumAmount: string };
    gasFeeUSD?: string;
    priceImpact?: string;
  };
  methodParameters?: {
    calldata: string;
    value: string;
    to: string;
  };
  routing?: string;
  requestId?: string;
  permit2?: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    values: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface QuoteRequest {
  chainId: string;
  tokenIn: ResolvedToken;
  tokenOut: ResolvedToken;
  amount: string;
  rawAmount: string;
  swapper: string;
  slippage?: string;
}

/**
 * Resolve the swapper address from args (address, topic/session, or placeholder).
 * Returns { swapper, isPlaceholder }.
 */
export function resolveSwapper(args: ParsedArgs, chainId: string): { swapper: string; isPlaceholder: boolean } {
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
  // vitalik.eth as public placeholder — routing works, gas estimates approximate
  return { swapper: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", isPlaceholder: true };
}

/**
 * Fetch a quote (with calldata) from the Uniswap Trade API.
 * Shared by both `swap` (quote-only) and `execute-swap` (quote + send).
 */
export async function fetchUniswapQuote(req: QuoteRequest): Promise<UniswapQuoteResponse> {
  const numericChainId = CHAIN_ID_MAP[req.chainId];
  if (!numericChainId) {
    throw new Error(`Unsupported chain: ${req.chainId}`);
  }

  const quoteBody: Record<string, unknown> = {
    type: "EXACT_INPUT",
    amount: req.rawAmount,
    tokenInChainId: numericChainId,
    tokenOutChainId: numericChainId,
    tokenIn: req.tokenIn.address,
    tokenOut: req.tokenOut.address,
    swapper: req.swapper,
    autoSlippage: "DEFAULT",
    routingPreference: "BEST_PRICE",
    generatePermitAsTransaction: false,
  };

  if (req.slippage && req.slippage !== "auto") {
    quoteBody.autoSlippage = undefined;
    quoteBody.slippageTolerance = Number(req.slippage) / 100;
  }

  const feeBps = Number(process.env.UNISWAP_FEE_BPS ?? "25");
  const feeRecipient =
    process.env.UNISWAP_FEE_RECIPIENT ?? "0x349862C428A86660826966fDbC6a2b5A03c57420";
  if (feeBps > 0) {
    quoteBody.integratorFees = [{ bips: feeBps, recipient: feeRecipient }];
  }

  const response = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNISWAP_API_KEY,
      "x-universal-router-version": "2.0",
    },
    body: JSON.stringify(quoteBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Uniswap API error ${response.status}: ${text}`);
  }

  return (await response.json()) as UniswapQuoteResponse;
}

export async function cmdSwap(args: ParsedArgs): Promise<void> {
  const chainId = args.chain ?? "eip155:1";

  if (!CHAIN_ID_MAP[chainId]) {
    console.error(
      JSON.stringify({
        error: `Unsupported chain: ${chainId}`,
        supported: Object.keys(CHAIN_ID_MAP),
      }),
    );
    process.exit(1);
  }

  const fromSymbol = args.token ?? "ETH";
  const toSymbol = args.out;
  if (!toSymbol) {
    console.error(JSON.stringify({ error: "Missing required flag: --out <token-symbol>" }));
    process.exit(1);
  }

  const amount = args.amount;
  if (!amount) {
    console.error(JSON.stringify({ error: "Missing required flag: --amount <amount>" }));
    process.exit(1);
  }

  let tokenIn: ResolvedToken;
  let tokenOut: ResolvedToken;
  try {
    tokenIn = resolveToken(fromSymbol, chainId);
    tokenOut = resolveToken(toSymbol, chainId);
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }

  const rawAmount = toRaw(amount, tokenIn.decimals);
  const { swapper, isPlaceholder } = resolveSwapper(args, chainId);

  let quoteData: UniswapQuoteResponse;
  try {
    quoteData = await fetchUniswapQuote({
      chainId,
      tokenIn,
      tokenOut,
      amount,
      rawAmount,
      swapper,
      slippage: args.slippage,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "Failed to fetch Uniswap quote",
        detail: (err as Error).message,
      }),
    );
    process.exit(1);
  }

  const q = quoteData.quote ?? {};
  const outputRaw = q.output?.amount ?? "0";
  const minOutputRaw = q.output?.minimumAmount ?? "0";

  const feeBps = Number(process.env.UNISWAP_FEE_BPS ?? "25");
  const feeRecipient =
    process.env.UNISWAP_FEE_RECIPIENT ?? "0x349862C428A86660826966fDbC6a2b5A03c57420";

  const mp = quoteData.methodParameters;

  console.log(
    JSON.stringify(
      {
        swap: {
          from: {
            symbol: tokenIn.symbol,
            address: tokenIn.address,
            amount,
            rawAmount,
          },
          to: {
            symbol: tokenOut.symbol,
            address: tokenOut.address,
            amount: fromRaw(outputRaw, tokenOut.decimals),
            minAmount: fromRaw(minOutputRaw, tokenOut.decimals),
            rawAmount: outputRaw,
          },
          chain: chainId,
          swapper: isPlaceholder ? null : swapper,
          swapperIsPlaceholder: isPlaceholder,
          gasFeeUSD: q.gasFeeUSD ?? null,
          priceImpact: q.priceImpact ?? null,
          ...(feeBps > 0 ? { integratorFee: { bips: feeBps, recipient: feeRecipient } } : {}),
          routing: quoteData.routing ?? "unknown",
          requestId: quoteData.requestId ?? null,
        },
        ...(mp
          ? {
              execution: {
                routerAddress: mp.to || UNIVERSAL_ROUTER_ADDRESS,
                calldata: mp.calldata,
                value: mp.value,
              },
            }
          : {}),
        note: mp
          ? "Quote includes calldata. Use execute-swap to send this swap to your wallet for signing."
          : "Quote only — to execute, use execute-swap with the same parameters.",
      },
      null,
      2,
    ),
  );
}
