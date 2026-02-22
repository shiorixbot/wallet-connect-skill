/**
 * Send transaction command -- native or ERC-20 token transfers (EVM + Solana).
 */

import { getClient } from "../client.js";
import { loadSessions } from "../storage.js";
import {
  requireSession,
  requireAccount,
  parseAccount,
  resolveAddress,
  requestWithTimeout,
} from "../helpers.js";
import { getTokenAddress, getTokenDecimals } from "./tokens.js";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import type { SignClient } from "@walletconnect/sign-client";
import type { ParsedArgs, Session } from "../types.js";

const SOLANA_RPC: Record<string, string> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
};

async function sendSolana(
  client: InstanceType<typeof SignClient>,
  args: ParsedArgs,
  sessionData: Session,
  chain: string,
): Promise<void> {
  const accountStr = requireAccount(sessionData, chain, "Solana");
  const { address: fromAddr } = parseAccount(accountStr);

  const rpcUrl = SOLANA_RPC[chain];
  if (!rpcUrl) {
    console.error(JSON.stringify({ error: `No RPC for chain ${chain}` }));
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const fromPubkey = new PublicKey(fromAddr);
  const toPubkey = new PublicKey(args.to!);

  const instructions = [];
  let tokenLabel = "SOL";

  if (args.token && args.token !== "SOL") {
    const mintAddr = getTokenAddress(args.token, chain);
    if (!mintAddr) {
      console.error(JSON.stringify({ error: `Token ${args.token} not supported on ${chain}` }));
      process.exit(1);
    }

    const mintPubkey = new PublicKey(mintAddr);
    const decimals = getTokenDecimals(args.token);
    const amount = BigInt(Math.round(parseFloat(args.amount!) * 10 ** decimals));

    const fromAta = getAssociatedTokenAddressSync(mintPubkey, fromPubkey);
    const toAta = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

    const toAtaInfo = await connection.getAccountInfo(toAta);
    if (!toAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(fromPubkey, toAta, toPubkey, mintPubkey),
      );
    }

    instructions.push(createTransferInstruction(fromAta, toAta, fromPubkey, amount));
    tokenLabel = args.token;
  } else {
    const lamports = Math.round(parseFloat(args.amount || "0") * LAMPORTS_PER_SOL);
    instructions.push(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));
  }

  try {
    const recentFees = await connection.getRecentPrioritizationFees();
    const feeValues = recentFees
      .map((f) => f.prioritizationFee)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    if (feeValues.length > 0) {
      const medianFee = feeValues[Math.floor(feeValues.length / 2)];
      instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: medianFee }));
    }
  } catch {
    /* skip priority fee on error */
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const vtx = new VersionedTransaction(messageV0);
  const serialized = Buffer.from(vtx.serialize()).toString("base64");

  const result = await requestWithTimeout(client, {
    topic: args.topic!,
    chainId: chain,
    request: {
      method: "solana_signAndSendTransaction",
      params: { transaction: serialized },
    },
  });

  const txResult = result as { signature?: string } | string;
  const txid = typeof txResult === "string" ? txResult : txResult.signature || String(txResult);

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
    }),
  );
}

async function sendEvm(
  client: InstanceType<typeof SignClient>,
  args: ParsedArgs,
  sessionData: Session,
  chain: string,
): Promise<void> {
  const accountStr = requireAccount(sessionData, chain, "EVM");
  const { address: from } = parseAccount(accountStr);

  const resolvedTo = await resolveAddress(args.to!);
  if (resolvedTo !== args.to) {
    console.error(JSON.stringify({ ens: args.to, resolved: resolvedTo }));
  }

  let tx: Record<string, string>;
  if (args.token && args.token !== "ETH") {
    const tokenAddr = getTokenAddress(args.token, chain);
    if (!tokenAddr) {
      console.error(JSON.stringify({ error: `Token ${args.token} not supported on ${chain}` }));
      process.exit(1);
    }

    const decimals = getTokenDecimals(args.token);
    const amount = BigInt(Math.round(parseFloat(args.amount!) * 10 ** decimals));
    const toAddr = resolvedTo.replace("0x", "").padStart(64, "0");
    const amountHex = amount.toString(16).padStart(64, "0");
    const data = `0xa9059cbb${toAddr}${amountHex}`;

    tx = { from, to: tokenAddr, data };
  } else {
    const weiAmount = BigInt(Math.round(parseFloat(args.amount || "0") * 1e18));
    tx = {
      from,
      to: resolvedTo,
      value: "0x" + weiAmount.toString(16),
    };
  }

  const txHash = await requestWithTimeout(client, {
    topic: args.topic!,
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
      to: resolvedTo,
      ...(resolvedTo !== args.to ? { ens: args.to } : {}),
      amount: args.amount,
      token: args.token || "ETH",
    }),
  );
}

export async function cmdSendTx(args: ParsedArgs): Promise<void> {
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
    console.log(JSON.stringify({ status: "rejected", error: (err as Error).message }));
  }

  await client.core.relayer.transportClose();
}
