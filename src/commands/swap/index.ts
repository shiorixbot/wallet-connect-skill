/**
 * Swap commands — quote and execute swaps across chains.
 *
 * Provider dispatch: the correct adapter (Uniswap, Jupiter, ...) is chosen
 * based on the --chain flag. Adding a new provider means implementing
 * SwapProvider and registering it in PROVIDERS below.
 */

import { getClient } from "../../client.js";
import { loadSessions } from "../../storage.js";
import { requireSession } from "../../helpers.js";
import type { SignClient } from "@walletconnect/sign-client";
import type { ParsedArgs } from "../../types.js";
import type { SwapProvider, SwapRequest } from "./lib.js";
import { toRaw, fromRaw, resolveSwapper } from "./lib.js";
import { uniswap } from "./uniswap.js";
import { jupiter } from "./jupiter.js";

// Re-export for external consumers (send-tx, tests)
export { toRaw, fromRaw } from "./lib.js";
export type { ResolvedToken, SwapProvider, SwapOrder, SwapQuote } from "./lib.js";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: SwapProvider[] = [uniswap, jupiter];

function getProvider(chainId: string): SwapProvider | undefined {
  return PROVIDERS.find((p) => p.supportedChains.includes(chainId));
}

function allSupportedChains(): string[] {
  return PROVIDERS.flatMap((p) => p.supportedChains);
}

// ---------------------------------------------------------------------------
// Quote command
// ---------------------------------------------------------------------------

export async function cmdQuote(args: ParsedArgs): Promise<void> {
  const chainId = args.chain ?? "eip155:1";
  const provider = getProvider(chainId);

  if (!provider) {
    console.error(
      JSON.stringify({ error: `Unsupported chain: ${chainId}`, supported: allSupportedChains() }),
    );
    process.exit(1);
  }

  const fromSymbol = args.token ?? provider.nativeSymbol(chainId);
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

  let tokenIn, tokenOut;
  try {
    tokenIn = provider.resolveToken(fromSymbol, chainId);
    tokenOut = provider.resolveToken(toSymbol, chainId);
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }

  const rawAmount = toRaw(amount, tokenIn.decimals);
  const { swapper, isPlaceholder } = resolveSwapper(args, chainId, provider);

  let order;
  try {
    order = await provider.fetchOrder({
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
      JSON.stringify({ error: `Failed to fetch ${provider.name} quote`, detail: (err as Error).message }),
    );
    process.exit(1);
  }

  const q = order.quote;

  console.log(
    JSON.stringify(
      {
        swap: {
          from: { symbol: tokenIn.symbol, address: tokenIn.address, amount, rawAmount },
          to: {
            symbol: tokenOut.symbol,
            address: tokenOut.address,
            amount: fromRaw(q.outAmount, tokenOut.decimals),
            ...(q.outAmountMin ? { minAmount: fromRaw(q.outAmountMin, tokenOut.decimals) } : {}),
            rawAmount: q.outAmount,
          },
          chain: chainId,
          provider: provider.name,
          swapper: isPlaceholder ? null : swapper,
          swapperIsPlaceholder: isPlaceholder,
          priceImpact: q.priceImpact,
          ...(q.gasEstimate ? { gasFeeUSD: q.gasEstimate } : {}),
          router: q.router,
          requestId: q.requestId,
          ...(q.providerMeta && Object.keys(q.providerMeta).length > 0
            ? q.providerMeta
            : {}),
        },
        ...(order.execution ? { hasExecution: true } : {}),
        note: order.execution
          ? `Quote includes execution data. Use swap to sign and execute via ${provider.name}.`
          : "Quote only — to execute, use swap with the same parameters.",
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// Swap command
// ---------------------------------------------------------------------------

export async function cmdSwap(args: ParsedArgs): Promise<void> {
  const chainId = args.chain ?? "eip155:1";
  const provider = getProvider(chainId);

  if (!provider) {
    console.error(
      JSON.stringify({ error: `Unsupported chain: ${chainId}`, supported: allSupportedChains() }),
    );
    process.exit(1);
  }

  if (!args.topic && !args.address) {
    console.error(
      JSON.stringify({ error: "swap requires --topic or --address to sign the transaction" }),
    );
    process.exit(1);
  }

  const fromSymbol = args.token ?? provider.nativeSymbol(chainId);
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

  const { swapper, isPlaceholder } = resolveSwapper(args, chainId, provider);
  if (isPlaceholder) {
    console.error(
      JSON.stringify({ error: "Cannot execute swap with placeholder address. Provide --address or --topic." }),
    );
    process.exit(1);
  }

  let tokenIn, tokenOut;
  try {
    tokenIn = provider.resolveToken(fromSymbol, chainId);
    tokenOut = provider.resolveToken(toSymbol, chainId);
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }

  const rawAmount = toRaw(amount, tokenIn.decimals);

  const req: SwapRequest = { chainId, tokenIn, tokenOut, amount, rawAmount, swapper, slippage: args.slippage };

  // Fetch order
  console.error(JSON.stringify({ status: "fetching_quote", provider: provider.name, from: fromSymbol, to: toSymbol, amount }));

  let order;
  try {
    order = await provider.fetchOrder(req);
  } catch (err) {
    console.error(
      JSON.stringify({ error: `Failed to fetch ${provider.name} order`, detail: (err as Error).message }),
    );
    process.exit(1);
  }

  if (!order.execution) {
    console.error(
      JSON.stringify({ error: `${provider.name} did not return execution data` }),
    );
    process.exit(1);
  }

  const q = order.quote;
  console.error(
    JSON.stringify({
      status: "quote_received",
      from: `${amount} ${tokenIn.symbol}`,
      to: `${fromRaw(q.outAmount, tokenOut.decimals)} ${tokenOut.symbol}`,
      ...(q.outAmountMin ? { minOutput: `${fromRaw(q.outAmountMin, tokenOut.decimals)} ${tokenOut.symbol}` } : {}),
      ...(q.gasEstimate ? { gasFeeUSD: q.gasEstimate } : {}),
    }),
  );

  // Execute
  const client = await getClient();
  const topic = args.topic!;

  const sessions = loadSessions();
  requireSession(sessions, topic);

  console.error(JSON.stringify({ status: "awaiting_wallet_approval" }));

  try {
    const result = await provider.execute(order, req, client, topic);

    if (!result) {
      console.log(
        JSON.stringify({
          status: "rejected",
          swap: { from: `${amount} ${tokenIn.symbol}`, to: tokenOut.symbol },
        }),
      );
      return;
    }

    console.log(
      JSON.stringify(
        {
          status: "sent",
          txHash: result.txHash,
          chain: chainId,
          provider: provider.name,
          from: swapper,
          swap: {
            from: { symbol: tokenIn.symbol, amount },
            to: {
              symbol: tokenOut.symbol,
              amount: fromRaw(result.actualOutAmount ?? q.outAmount, tokenOut.decimals),
              ...(q.outAmountMin ? { minAmount: fromRaw(q.outAmountMin, tokenOut.decimals) } : {}),
            },
          },
          explorer: result.explorer,
          requestId: q.requestId,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        status: "failed",
        error: (err as Error).message,
        swap: { from: `${amount} ${tokenIn.symbol}`, to: tokenOut.symbol },
      }),
    );
  }

  await (client as InstanceType<typeof SignClient>).core.relayer.transportClose();
}
