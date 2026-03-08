/**
 * Execute-swap command — fetch a Uniswap quote and send the swap transaction via WalletConnect.
 *
 * Usage:
 *   tsx src/cli.ts execute-swap --token ETH --out USDC --amount 0.1 --address 0x... [--chain eip155:1] [--slippage 0.5] [--deadline 1800]
 *
 * Flow: quote → calldata → eth_sendTransaction → wallet signs → tx hash
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
  resolveSwapper,
  CHAIN_ID_MAP,
  NATIVE_ADDRESS,
} from "./swap.js";
import { UNIVERSAL_ROUTER_ADDRESS } from "../universal-router.js";
import type { SignClient } from "@walletconnect/sign-client";
import type { ParsedArgs } from "../types.js";

const EXPLORER_URLS: Record<string, string> = {
  "eip155:1": "https://etherscan.io/tx/",
  "eip155:42161": "https://arbiscan.io/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  "eip155:10": "https://optimistic.etherscan.io/tx/",
  "eip155:137": "https://polygonscan.com/tx/",
};

export async function cmdExecuteSwap(args: ParsedArgs): Promise<void> {
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

  // Require a connected wallet for execution
  if (!args.topic && !args.address) {
    console.error(
      JSON.stringify({ error: "execute-swap requires --topic or --address to sign the transaction" }),
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

  // Resolve swapper from session
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

  // Fetch quote with calldata from Uniswap Trade API
  console.error(JSON.stringify({ status: "fetching_quote", from: fromSymbol, to: toSymbol, amount }));

  let quoteData;
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
      JSON.stringify({ error: "Failed to fetch Uniswap quote", detail: (err as Error).message }),
    );
    process.exit(1);
  }

  const mp = quoteData.methodParameters;
  if (!mp || !mp.calldata) {
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

  // Log the quote to stderr before sending
  console.error(
    JSON.stringify({
      status: "quote_received",
      from: `${amount} ${tokenIn.symbol}`,
      to: `${fromRaw(outputRaw, tokenOut.decimals)} ${tokenOut.symbol}`,
      minOutput: `${fromRaw(minOutputRaw, tokenOut.decimals)} ${tokenOut.symbol}`,
      gasFeeUSD: q.gasFeeUSD ?? "unknown",
    }),
  );

  // Build the transaction
  const routerAddress = mp.to || UNIVERSAL_ROUTER_ADDRESS;
  const tx: Record<string, string> = {
    from: swapper,
    to: routerAddress,
    data: mp.calldata,
  };

  // Include value if swapping native token (ETH)
  if (mp.value && mp.value !== "0x0" && mp.value !== "0x00" && mp.value !== "0") {
    tx.value = mp.value;
  } else if (tokenIn.address === NATIVE_ADDRESS) {
    // Sending native token — set value to the input amount
    tx.value = "0x" + BigInt(rawAmount).toString(16);
  }

  // Send via WalletConnect
  const client = await getClient();
  const topic = args.topic!;

  // Verify session is valid
  const sessions = loadSessions();
  requireSession(sessions, topic);

  console.error(JSON.stringify({ status: "awaiting_wallet_approval" }));

  try {
    const txHash = await requestWithTimeout(client, {
      topic,
      chainId,
      request: {
        method: "eth_sendTransaction",
        params: [tx],
      },
    });

    const explorerBase = EXPLORER_URLS[chainId] ?? "https://etherscan.io/tx/";

    console.log(
      JSON.stringify(
        {
          status: "sent",
          txHash,
          chain: chainId,
          from: swapper,
          swap: {
            from: { symbol: tokenIn.symbol, amount },
            to: {
              symbol: tokenOut.symbol,
              amount: fromRaw(outputRaw, tokenOut.decimals),
              minAmount: fromRaw(minOutputRaw, tokenOut.decimals),
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
        swap: { from: `${amount} ${tokenIn.symbol}`, to: tokenOut.symbol },
      }),
    );
  }

  await (client as InstanceType<typeof SignClient>).core.relayer.transportClose();
}
