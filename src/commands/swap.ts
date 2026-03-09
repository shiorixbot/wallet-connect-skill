/**
 * Swap command — execute a swap via WalletConnect.
 * EVM: Uniswap Trade API → eth_sendTransaction
 * Solana: Jupiter Ultra /order → solana_signTransaction → /execute
 *
 * Usage:
 *   tsx src/cli.ts swap --token ETH --out USDC --amount 0.1 --address 0x... [--chain eip155:1] [--slippage 0.5]
 *   tsx src/cli.ts swap --token SOL --out USDC --amount 1 --address <solana-addr> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
 *
 * Implements issue #12: https://github.com/shiorixbot/wallet-connect-skill/issues/12
 */

import { getClient } from "../client.js";
import { loadSessions } from "../storage.js";
import { requireSession, requestWithTimeout } from "../helpers.js";
import {
  resolveToken,
  toRaw,
  fromRaw,
  fetchUniswapQuote,
  fetchJupiterOrder,
  resolveSwapper,
  isSupportedChain,
  SUPPORTED_CHAINS,
  NATIVE_ADDRESS,
  JUPITER_API_BASE,
  JUPITER_API_KEY,
} from "./quote.js";
import type { SignClient } from "@walletconnect/sign-client";
import type { ParsedArgs } from "../types.js";

const EXPLORER_URLS: Record<string, string> = {
  "eip155:1": "https://etherscan.io/tx/",
  "eip155:42161": "https://arbiscan.io/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  "eip155:10": "https://optimistic.etherscan.io/tx/",
  "eip155:137": "https://polygonscan.com/tx/",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://solscan.io/tx/",
};

export async function cmdSwap(args: ParsedArgs): Promise<void> {
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

  if (!args.topic && !args.address) {
    console.error(
      JSON.stringify({ error: "swap requires --topic or --address to sign the transaction" }),
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

  const { swapper, isPlaceholder } = resolveSwapper(args, chainId);
  if (isPlaceholder) {
    console.error(
      JSON.stringify({ error: "Cannot execute swap with placeholder address. Provide --address or --topic." }),
    );
    process.exit(1);
  }

  let tokenIn, tokenOut;
  try {
    tokenIn = resolveToken(fromSymbol, chainId);
    tokenOut = resolveToken(toSymbol, chainId);
  } catch (err) {
    console.error(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }

  const rawAmount = toRaw(amount, tokenIn.decimals);

  console.error(JSON.stringify({ status: "fetching_quote", from: fromSymbol, to: toSymbol, amount }));

  if (isSolana) {
    await swapSolana({ args, chainId, tokenIn, tokenOut, amount, rawAmount, swapper });
  } else {
    await swapEvm({ args, chainId, tokenIn, tokenOut, amount, rawAmount, swapper });
  }
}

// ---------------------------------------------------------------------------
// EVM swap (Uniswap)
// ---------------------------------------------------------------------------

interface SwapContext {
  args: ParsedArgs;
  chainId: string;
  tokenIn: { symbol: string; address: string; decimals: number };
  tokenOut: { symbol: string; address: string; decimals: number };
  amount: string;
  rawAmount: string;
  swapper: string;
}

async function swapEvm(ctx: SwapContext): Promise<void> {
  let quoteData;
  try {
    quoteData = await fetchUniswapQuote({
      chainId: ctx.chainId,
      tokenIn: ctx.tokenIn,
      tokenOut: ctx.tokenOut,
      amount: ctx.amount,
      rawAmount: ctx.rawAmount,
      swapper: ctx.swapper,
      slippage: ctx.args.slippage,
    });
  } catch (err) {
    console.error(
      JSON.stringify({ error: "Failed to fetch Uniswap quote", detail: (err as Error).message }),
    );
    process.exit(1);
  }

  const mp = quoteData.methodParameters;
  if (!mp || !mp.calldata || !mp.to) {
    console.error(
      JSON.stringify({
        error: "Uniswap API did not return execution calldata",
        hint: "The Trade API may require a valid swapper address with token approvals",
      }),
    );
    process.exit(1);
  }

  const q = quoteData.quote ?? {};
  const outputRaw = q.output?.amount ?? "0";
  const minOutputRaw = q.output?.minimumAmount ?? "0";

  console.error(
    JSON.stringify({
      status: "quote_received",
      from: `${ctx.amount} ${ctx.tokenIn.symbol}`,
      to: `${fromRaw(outputRaw, ctx.tokenOut.decimals)} ${ctx.tokenOut.symbol}`,
      minOutput: `${fromRaw(minOutputRaw, ctx.tokenOut.decimals)} ${ctx.tokenOut.symbol}`,
      gasFeeUSD: q.gasFeeUSD ?? "unknown",
    }),
  );

  const routerAddress = mp.to;
  const tx: Record<string, string> = {
    from: ctx.swapper,
    to: routerAddress,
    data: mp.calldata,
  };

  if (mp.value && mp.value !== "0x0" && mp.value !== "0x00" && mp.value !== "0") {
    tx.value = mp.value;
  } else if (ctx.tokenIn.address === NATIVE_ADDRESS) {
    tx.value = "0x" + BigInt(ctx.rawAmount).toString(16);
  }

  const client = await getClient();
  const topic = ctx.args.topic!;
  const sessions = loadSessions();
  requireSession(sessions, topic);

  console.error(JSON.stringify({ status: "awaiting_wallet_approval" }));

  try {
    const txHash = await requestWithTimeout(client, {
      topic,
      chainId: ctx.chainId,
      request: {
        method: "eth_sendTransaction",
        params: [tx],
      },
    });

    const explorerBase = EXPLORER_URLS[ctx.chainId] ?? "https://etherscan.io/tx/";

    console.log(
      JSON.stringify(
        {
          status: "sent",
          txHash,
          chain: ctx.chainId,
          from: ctx.swapper,
          swap: {
            from: { symbol: ctx.tokenIn.symbol, amount: ctx.amount },
            to: {
              symbol: ctx.tokenOut.symbol,
              amount: fromRaw(outputRaw, ctx.tokenOut.decimals),
              minAmount: fromRaw(minOutputRaw, ctx.tokenOut.decimals),
            },
          },
          router: routerAddress,
          explorer: `${explorerBase}${txHash}`,
          requestId: quoteData.requestId ?? null,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        status: "rejected",
        error: (err as Error).message,
        swap: { from: `${ctx.amount} ${ctx.tokenIn.symbol}`, to: ctx.tokenOut.symbol },
      }),
    );
  }

  await (client as InstanceType<typeof SignClient>).core.relayer.transportClose();
}

// ---------------------------------------------------------------------------
// Solana swap (Jupiter Ultra)
// ---------------------------------------------------------------------------

async function swapSolana(ctx: SwapContext): Promise<void> {
  // Step 1: Get order (unsigned transaction) from Jupiter
  let order;
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
      JSON.stringify({ error: "Failed to fetch Jupiter order", detail: (err as Error).message }),
    );
    process.exit(1);
  }

  if (!order.transaction || !order.requestId) {
    console.error(
      JSON.stringify({
        error: "Jupiter API did not return a transaction",
        hint: order.errorMessage ?? "Check that the taker address and token mints are valid",
      }),
    );
    process.exit(1);
  }

  const outAmount = order.outAmount ?? "0";

  console.error(
    JSON.stringify({
      status: "quote_received",
      from: `${ctx.amount} ${ctx.tokenIn.symbol}`,
      to: `${fromRaw(outAmount, ctx.tokenOut.decimals)} ${ctx.tokenOut.symbol}`,
      router: order.router ?? "unknown",
    }),
  );

  // Step 2: Sign the transaction via WalletConnect
  const client = await getClient();
  const topic = ctx.args.topic!;
  const sessions = loadSessions();
  requireSession(sessions, topic);

  console.error(JSON.stringify({ status: "awaiting_wallet_approval" }));

  let signedTransaction: string;
  try {
    const result = await requestWithTimeout(client, {
      topic,
      chainId: ctx.chainId,
      request: {
        method: "solana_signTransaction",
        params: { transaction: order.transaction },
      },
    });

    // WalletConnect returns { signature: string } or the signed tx directly
    const resultObj = result as { signature?: string; transaction?: string } | string;
    if (typeof resultObj === "string") {
      signedTransaction = resultObj;
    } else if (resultObj.transaction) {
      signedTransaction = resultObj.transaction;
    } else {
      throw new Error("Wallet did not return a signed transaction");
    }
  } catch (err) {
    console.log(
      JSON.stringify({
        status: "rejected",
        error: (err as Error).message,
        swap: { from: `${ctx.amount} ${ctx.tokenIn.symbol}`, to: ctx.tokenOut.symbol },
      }),
    );
    await (client as InstanceType<typeof SignClient>).core.relayer.transportClose();
    return;
  }

  await (client as InstanceType<typeof SignClient>).core.relayer.transportClose();

  // Step 3: Submit signed transaction to Jupiter /execute
  console.error(JSON.stringify({ status: "submitting_transaction" }));

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (JUPITER_API_KEY) {
      headers["x-api-key"] = JUPITER_API_KEY;
    }

    const execResponse = await fetch(`${JUPITER_API_BASE}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        signedTransaction,
        requestId: order.requestId,
      }),
    });

    if (!execResponse.ok) {
      const text = await execResponse.text();
      console.log(
        JSON.stringify({ status: "failed", error: `Jupiter execute error ${execResponse.status}`, detail: text }),
      );
      return;
    }

    const execResult = (await execResponse.json()) as {
      status: string;
      signature?: string;
      slot?: string;
      code?: number;
      totalInputAmount?: string;
      totalOutputAmount?: string;
      inputAmountResult?: string;
      outputAmountResult?: string;
      error?: string;
    };

    if (execResult.status !== "Success") {
      console.log(
        JSON.stringify({
          status: "failed",
          error: execResult.error ?? "Jupiter execution failed",
          code: execResult.code,
        }),
      );
      return;
    }

    const explorerBase = EXPLORER_URLS[ctx.chainId] ?? "https://solscan.io/tx/";

    console.log(
      JSON.stringify(
        {
          status: "sent",
          txHash: execResult.signature,
          chain: ctx.chainId,
          from: ctx.swapper,
          swap: {
            from: { symbol: ctx.tokenIn.symbol, amount: ctx.amount },
            to: {
              symbol: ctx.tokenOut.symbol,
              amount: fromRaw(execResult.totalOutputAmount ?? outAmount, ctx.tokenOut.decimals),
            },
          },
          explorer: `${explorerBase}${execResult.signature}`,
          requestId: order.requestId,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        status: "failed",
        error: "Failed to submit transaction to Jupiter",
        detail: (err as Error).message,
      }),
    );
  }
}
