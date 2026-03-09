/**
 * Quote command — fetch a swap quote (EVM via Uniswap, Solana via Jupiter).
 *
 * Usage:
 *   tsx src/cli.ts quote --token ETH --out USDC --amount 0.1 [--chain eip155:1] [--address 0x...] [--topic <topic>]
 *   tsx src/cli.ts quote --token SOL --out USDC --amount 1 --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp [--address <addr>]
 *
 * Prints a JSON quote. To execute, use: swap --token SOL --out USDC --amount 1 --address <addr>
 */

import { loadSessions } from "../storage.js";
import { requireSession, findAccount, parseAccount } from "../helpers.js";
import { getTokensForChain } from "./tokens.js";
import type { ParsedArgs } from "../types.js";

// ---------------------------------------------------------------------------
// Uniswap (EVM)
// ---------------------------------------------------------------------------

export const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
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

// ---------------------------------------------------------------------------
// Jupiter (Solana)
// ---------------------------------------------------------------------------

export const JUPITER_API_BASE = "https://api.jup.ag/ultra/v1";
export const JUPITER_API_KEY = process.env.JUPITER_API_KEY ?? "";

/** SOL native mint address used by Jupiter */
export const SOL_NATIVE_MINT = "So11111111111111111111111111111111111111112";

/** Solana chain ID in CAIP-2 format */
export const SOLANA_CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ResolvedToken {
  address: string;
  decimals: number;
  symbol: string;
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

export interface JupiterOrderResponse {
  transaction?: string;
  requestId?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpact?: number;
  feeBps?: number;
  platformFee?: { amount: string; feeBps: number };
  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
  router?: string;
  gasless?: boolean;
  errorCode?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export function resolveToken(symbol: string, chainId: string): ResolvedToken {
  if (chainId.startsWith("solana:")) {
    return resolveSolanaToken(symbol, chainId);
  }
  return resolveEvmToken(symbol, chainId);
}

function resolveEvmToken(symbol: string, chainId: string): ResolvedToken {
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

function resolveSolanaToken(symbol: string, chainId: string): ResolvedToken {
  if (symbol.toUpperCase() === "SOL") {
    return { address: SOL_NATIVE_MINT, decimals: 9, symbol: "SOL" };
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

/** Convert raw integer string to human-readable (trimmed to 8 significant frac digits) */
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

// ---------------------------------------------------------------------------
// Swapper resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the swapper address from args (address, topic/session, or placeholder).
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
  if (chainId.startsWith("solana:")) {
    // No good placeholder for Solana — quote requires a real taker
    return { swapper: "", isPlaceholder: true };
  }
  // vitalik.eth as public placeholder for EVM
  return { swapper: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", isPlaceholder: true };
}

// ---------------------------------------------------------------------------
// Supported chains
// ---------------------------------------------------------------------------

export const SUPPORTED_CHAINS = [
  ...Object.keys(CHAIN_ID_MAP),
  SOLANA_CHAIN_ID,
];

export function isSupportedChain(chainId: string): boolean {
  return !!CHAIN_ID_MAP[chainId] || chainId === SOLANA_CHAIN_ID;
}

// ---------------------------------------------------------------------------
// Uniswap quote fetcher (EVM)
// ---------------------------------------------------------------------------

export async function fetchUniswapQuote(req: QuoteRequest): Promise<UniswapQuoteResponse> {
  const numericChainId = CHAIN_ID_MAP[req.chainId];
  if (!numericChainId) {
    throw new Error(`Unsupported EVM chain: ${req.chainId}`);
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

// ---------------------------------------------------------------------------
// Jupiter quote fetcher (Solana)
// ---------------------------------------------------------------------------

export async function fetchJupiterOrder(req: QuoteRequest): Promise<JupiterOrderResponse> {
  const params = new URLSearchParams({
    inputMint: req.tokenIn.address,
    outputMint: req.tokenOut.address,
    amount: req.rawAmount,
  });

  if (req.swapper) {
    params.set("taker", req.swapper);
  }

  const referralAccount = process.env.JUPITER_REFERRAL_ACCOUNT;
  const referralFee = process.env.JUPITER_REFERRAL_FEE;
  if (referralAccount) {
    params.set("referralAccount", referralAccount);
    if (referralFee) params.set("referralFee", referralFee);
  }

  const headers: Record<string, string> = {};
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }

  const response = await fetch(`${JUPITER_API_BASE}/order?${params.toString()}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jupiter API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as JupiterOrderResponse;
  if (data.errorCode) {
    throw new Error(`Jupiter error ${data.errorCode}: ${data.errorMessage}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Quote command
// ---------------------------------------------------------------------------

export async function cmdQuote(args: ParsedArgs): Promise<void> {
  const chainId = args.chain ?? "eip155:1";

  if (!isSupportedChain(chainId)) {
    console.error(
      JSON.stringify({
        error: `Unsupported chain: ${chainId}`,
        supported: SUPPORTED_CHAINS,
      }),
    );
    process.exit(1);
  }

  const isSolana = chainId.startsWith("solana:");
  const fromSymbol = args.token ?? (isSolana ? "SOL" : "ETH");
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

  if (isSolana) {
    await quoteSolana({ chainId, tokenIn, tokenOut, amount, rawAmount, swapper, isPlaceholder });
  } else {
    await quoteEvm({ chainId, tokenIn, tokenOut, amount, rawAmount, swapper, isPlaceholder, slippage: args.slippage });
  }
}

// ---------------------------------------------------------------------------
// EVM quote output
// ---------------------------------------------------------------------------

interface QuoteContext {
  chainId: string;
  tokenIn: ResolvedToken;
  tokenOut: ResolvedToken;
  amount: string;
  rawAmount: string;
  swapper: string;
  isPlaceholder: boolean;
  slippage?: string;
}

async function quoteEvm(ctx: QuoteContext): Promise<void> {
  let quoteData: UniswapQuoteResponse;
  try {
    quoteData = await fetchUniswapQuote({
      chainId: ctx.chainId,
      tokenIn: ctx.tokenIn,
      tokenOut: ctx.tokenOut,
      amount: ctx.amount,
      rawAmount: ctx.rawAmount,
      swapper: ctx.swapper,
      slippage: ctx.slippage,
    });
  } catch (err) {
    console.error(
      JSON.stringify({ error: "Failed to fetch Uniswap quote", detail: (err as Error).message }),
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
          from: { symbol: ctx.tokenIn.symbol, address: ctx.tokenIn.address, amount: ctx.amount, rawAmount: ctx.rawAmount },
          to: {
            symbol: ctx.tokenOut.symbol,
            address: ctx.tokenOut.address,
            amount: fromRaw(outputRaw, ctx.tokenOut.decimals),
            minAmount: fromRaw(minOutputRaw, ctx.tokenOut.decimals),
            rawAmount: outputRaw,
          },
          chain: ctx.chainId,
          swapper: ctx.isPlaceholder ? null : ctx.swapper,
          swapperIsPlaceholder: ctx.isPlaceholder,
          gasFeeUSD: q.gasFeeUSD ?? null,
          priceImpact: q.priceImpact ?? null,
          ...(feeBps > 0 ? { integratorFee: { bips: feeBps, recipient: feeRecipient } } : {}),
          routing: quoteData.routing ?? "unknown",
          requestId: quoteData.requestId ?? null,
        },
        ...(mp
          ? {
              execution: {
                routerAddress: mp.to,
                calldata: mp.calldata,
                value: mp.value,
              },
            }
          : {}),
        note: mp
          ? "Quote includes calldata. Use swap to send this swap to your wallet for signing."
          : "Quote only — to execute, use swap with the same parameters.",
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// Solana quote output
// ---------------------------------------------------------------------------

async function quoteSolana(ctx: Omit<QuoteContext, "slippage">): Promise<void> {
  let order: JupiterOrderResponse;
  try {
    order = await fetchJupiterOrder({
      chainId: ctx.chainId,
      tokenIn: ctx.tokenIn,
      tokenOut: ctx.tokenOut,
      amount: ctx.amount,
      rawAmount: ctx.rawAmount,
      swapper: ctx.swapper,
    });
  } catch (err) {
    console.error(
      JSON.stringify({ error: "Failed to fetch Jupiter quote", detail: (err as Error).message }),
    );
    process.exit(1);
  }

  const outAmount = order.outAmount ?? "0";

  console.log(
    JSON.stringify(
      {
        swap: {
          from: { symbol: ctx.tokenIn.symbol, address: ctx.tokenIn.address, amount: ctx.amount, rawAmount: ctx.rawAmount },
          to: {
            symbol: ctx.tokenOut.symbol,
            address: ctx.tokenOut.address,
            amount: fromRaw(outAmount, ctx.tokenOut.decimals),
            rawAmount: outAmount,
          },
          chain: ctx.chainId,
          swapper: ctx.isPlaceholder ? null : ctx.swapper,
          swapperIsPlaceholder: ctx.isPlaceholder,
          priceImpact: order.priceImpact ?? null,
          feeBps: order.feeBps ?? null,
          router: order.router ?? null,
          requestId: order.requestId ?? null,
        },
        ...(order.transaction
          ? { execution: { transaction: order.transaction, requestId: order.requestId } }
          : {}),
        note: order.transaction
          ? "Quote includes transaction. Use swap to sign and execute via Jupiter."
          : "Quote only — to execute, use swap with the same parameters.",
      },
      null,
      2,
    ),
  );
}
