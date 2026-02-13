/**
 * Send transaction command — native or ERC-20 token transfers.
 */

import { getClient, loadSessions } from "./client.mjs";

// Common ERC-20 token addresses by chain
const TOKEN_ADDRESSES = {
  USDC: {
    "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  USDT: {
    "eip155:1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "eip155:56": "0x55d398326f99059fF775485246999027B3197955",
  },
};

const TOKEN_DECIMALS = {
  USDC: 6,
  USDT: 6,
};

export async function cmdSendTx(args) {
  if (!args.topic) {
    console.error(JSON.stringify({ error: "--topic required" }));
    process.exit(1);
  }

  const client = await getClient();
  const sessions = loadSessions();
  const sessionData = sessions[args.topic];
  if (!sessionData) {
    console.error(JSON.stringify({ error: "Session not found" }));
    process.exit(1);
  }

  const chain = args.chain || "eip155:1";

  if (chain.startsWith("eip155:")) {
    const evmAccount = sessionData.accounts.find((a) => a.startsWith(chain));
    if (!evmAccount) {
      console.error(JSON.stringify({ error: `No account for chain ${chain}` }));
      process.exit(1);
    }

    const [, , from] = evmAccount.split(":");

    let tx;
    if (args.token && args.token !== "ETH") {
      // ERC-20 transfer
      const tokenAddr = TOKEN_ADDRESSES[args.token]?.[chain];
      if (!tokenAddr) {
        console.error(
          JSON.stringify({ error: `Token ${args.token} not supported on ${chain}` })
        );
        process.exit(1);
      }

      const decimals = TOKEN_DECIMALS[args.token] || 18;
      const amount = BigInt(Math.round(parseFloat(args.amount) * 10 ** decimals));
      const toAddr = args.to.replace("0x", "").padStart(64, "0");
      const amountHex = amount.toString(16).padStart(64, "0");
      const data = `0xa9059cbb${toAddr}${amountHex}`;

      tx = { from, to: tokenAddr, data };
    } else {
      // Native ETH transfer
      const weiAmount = BigInt(Math.round(parseFloat(args.amount || "0") * 1e18));
      tx = {
        from,
        to: args.to,
        value: "0x" + weiAmount.toString(16),
      };
    }

    try {
      const txHash = await client.request({
        topic: args.topic,
        chainId: chain,
        request: {
          method: "eth_sendTransaction",
          params: [tx],
        },
      });
      console.log(
        JSON.stringify({
          status: "sent",
          txHash,
          chain,
          from,
          to: args.to,
          amount: args.amount,
          token: args.token || "ETH",
        })
      );
    } catch (err) {
      console.log(JSON.stringify({ status: "rejected", error: err.message }));
    }
  } else if (chain.startsWith("solana:")) {
    console.log(
      JSON.stringify({
        status: "error",
        error: "Solana send-tx not yet implemented. Use sign for message signing.",
      })
    );
  }

  await client.core.relayer.transportClose();
}
