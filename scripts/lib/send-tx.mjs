/**
 * Send transaction command — native or ERC-20 token transfers (EVM + Solana).
 */

import { getClient, loadSessions } from "./client.mjs";
import { requireSession, requireAccount, parseAccount } from "./helpers.mjs";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Solana RPC endpoints
const SOLANA_RPC = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
};

// Common ERC-20 token addresses by chain
const TOKEN_ADDRESSES = {
  USDC: {
    "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  USDT: {
    "eip155:1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "eip155:56": "0x55d398326f99059fF775485246999027B3197955",
  },
};

const TOKEN_DECIMALS = { USDC: 6, USDT: 6 };

// SPL token mint addresses on Solana mainnet
const SPL_MINTS = {
  USDC: {
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  USDT: {
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
};

// --- Solana send ---

async function sendSolana(client, args, sessionData, chain) {
  const accountStr = requireAccount(sessionData, chain, "Solana");
  const { address: fromAddr } = parseAccount(accountStr);

  const rpcUrl = SOLANA_RPC[chain];
  if (!rpcUrl) {
    console.error(JSON.stringify({ error: `No RPC for chain ${chain}` }));
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const fromPubkey = new PublicKey(fromAddr);
  const toPubkey = new PublicKey(args.to);

  const instructions = [];
  let tokenLabel = "SOL";

  if (args.token && args.token !== "SOL") {
    // SPL token transfer
    const mintAddr = SPL_MINTS[args.token]?.[chain];
    if (!mintAddr) {
      console.error(
        JSON.stringify({ error: `SPL token ${args.token} not supported on ${chain}` })
      );
      process.exit(1);
    }

    const mintPubkey = new PublicKey(mintAddr);
    const decimals = TOKEN_DECIMALS[args.token] || 6;
    const amount = BigInt(Math.round(parseFloat(args.amount) * 10 ** decimals));

    const fromAta = getAssociatedTokenAddressSync(mintPubkey, fromPubkey);
    const toAta = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

    // Check if recipient ATA exists, create if not
    const toAtaInfo = await connection.getAccountInfo(toAta);
    if (!toAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          fromPubkey,  // payer
          toAta,       // ata
          toPubkey,    // owner
          mintPubkey   // mint
        )
      );
    }

    instructions.push(
      createTransferInstruction(fromAta, toAta, fromPubkey, amount)
    );
    tokenLabel = args.token;
  } else {
    // Native SOL transfer
    const lamports = Math.round(parseFloat(args.amount || "0") * LAMPORTS_PER_SOL);
    instructions.push(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));
  }

  // Fetch recent blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // Build as VersionedTransaction (v0)
  const messageV0 = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const vtx = new VersionedTransaction(messageV0);
  const serialized = Buffer.from(vtx.serialize()).toString("base64");

  // Request wallet to sign AND send (wallet broadcasts)
  const result = await client.request({
    topic: args.topic,
    chainId: chain,
    request: {
      method: "solana_signAndSendTransaction",
      params: { transaction: serialized },
    },
  });

  const txid = result.signature || result;

  console.log(
    JSON.stringify({
      status: "sent",
      txHash: txid,
      chain,
      from: fromAddr,
      to: args.to,
      amount: args.amount,
      token: tokenLabel,
      explorer: `https://solscan.io/tx/${txid}`,
    })
  );
}

// --- EVM send ---

async function sendEvm(client, args, sessionData, chain) {
  const accountStr = requireAccount(sessionData, chain, "EVM");
  const { address: from } = parseAccount(accountStr);

  let tx;
  if (args.token && args.token !== "ETH") {
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
    const weiAmount = BigInt(Math.round(parseFloat(args.amount || "0") * 1e18));
    tx = {
      from,
      to: args.to,
      value: "0x" + weiAmount.toString(16),
    };
  }

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
}

// --- Entry ---

export async function cmdSendTx(args) {
  if (!args.topic) {
    console.error(JSON.stringify({ error: "--topic required" }));
    process.exit(1);
  }

  const client = await getClient();
  const sessionData = requireSession(loadSessions(), args.topic);
  const chain = args.chain || "eip155:1";

  try {
    if (chain.startsWith("solana:")) {
      await sendSolana(client, args, sessionData, chain);
    } else {
      await sendEvm(client, args, sessionData, chain);
    }
  } catch (err) {
    console.log(JSON.stringify({ status: "rejected", error: err.message }));
  }

  await client.core.relayer.transportClose();
}
