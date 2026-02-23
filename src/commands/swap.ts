/**
 * Swap command — fetch a quote from Uniswap Trade API.
 *
 * Usage:
 *   tsx src/cli.ts swap --token ETH --out USDC --amount 0.1 [--chain eip155:1] [--address 0x...] [--topic <topic>]
 *
 * Prints a JSON quote. Does NOT execute the swap (use send-tx with the router calldata for that).
 * Implements issue #5: https://github.com/shiorixbot/wallet-connect-skill/issues/5
 */

import { loadSessions } from "../storage.js";
import { requireSession, findAccount, parseAccount } from "../helpers.js";
import { getTokensForChain } from "./tokens.js";
import type { ParsedArgs } from "../types.js";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
// Public demo key from Issue #5 — replace via UNISWAP_API_KEY env var for production
const UNISWAP_API_KEY =
  process.env.UNISWAP_API_KEY ?? "XHr6wiQY0GVXwqTmQyW83Prk8vJCgIENlpuwCGuTlhQ";

/** Native token address sentinel (ETH / MATIC / BNB on their respective chains) */
const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

/** EVM chain string → Uniswap numeric chain ID */
const CHAIN_ID_MAP: Record<string, number> = {
  "eip155:1": 1,
  "eip155:42161": 42161,
  "eip155:8453": 8453,
  "eip155:10": 10,
  "eip155:137": 137,
};

/** Native-token symbols per chain */
const NATIVE_SYMBOLS: Record<string, string> = {
  "eip155:1": "ETH",
  "eip155:42161": "ETH",
  "eip155:8453": "ETH",
  "eip155:10": "ETH",
  "eip155:137": "POL",
};

interface ResolvedToken {
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

interface UniswapQuoteResponse {
  quote?: {
    chainId?: number;
    swapper?: string;
    input?: { amount: string; token: string };
    output?: { amount: string; token: string; minimumAmount: string };
    gasFeeUSD?: string;
    priceImpact?: string;
  };
  routing?: string;
  requestId?: string;
  [key: string]: unknown;
}

export async function cmdSwap(args: ParsedArgs): Promise<void> {
  const chainId = args.chain ?? "eip155:1";

  const numericChainId = CHAIN_ID_MAP[chainId];
  if (!numericChainId) {
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

  // Resolve session → swapper address (optional; quote still works without it)
  let swapper: string | undefined;
  if (args.address) {
    swapper = args.address;
  } else if (args.topic) {
    const sessions = loadSessions();
    const session = requireSession(sessions, args.topic);
    const acct = findAccount(session.accounts, chainId);
    if (acct) ({ address: swapper } = parseAccount(acct));
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

  // Uniswap Trade API requires a swapper address.
  // If no session/address is provided, use a well-known placeholder so routing still works.
  // Gas estimates will be approximate.
  const effectiveSwapper =
    swapper ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth (public placeholder)

  const quoteBody = {
    type: "EXACT_INPUT",
    amount: rawAmount,
    tokenInChainId: numericChainId,
    tokenOutChainId: numericChainId,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    swapper: effectiveSwapper,
    autoSlippage: "DEFAULT",
    routingPreference: "BEST_PRICE",
    generatePermitAsTransaction: false,
  };

  let quoteData: UniswapQuoteResponse;
  try {
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
      console.error(
        JSON.stringify({ error: `Uniswap API error ${response.status}`, detail: text }),
      );
      process.exit(1);
    }

    quoteData = (await response.json()) as UniswapQuoteResponse;
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "Failed to reach Uniswap Trade API",
        detail: (err as Error).message,
      }),
    );
    process.exit(1);
  }

  const q = quoteData.quote ?? {};
  const outputRaw = q.output?.amount ?? "0";
  const minOutputRaw = q.output?.minimumAmount ?? "0";

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
          swapper: swapper ?? null,
          swapperIsPlaceholder: !swapper,
          gasFeeUSD: q.gasFeeUSD ?? null,
          priceImpact: q.priceImpact ?? null,
          routing: quoteData.routing ?? "unknown",
          requestId: quoteData.requestId ?? null,
        },
        note: "Quote only — to execute, use send-tx with the calldata returned by the Uniswap Universal Router.",
      },
      null,
      2,
    ),
  );
}
