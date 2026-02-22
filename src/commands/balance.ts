/**
 * Balance command -- check wallet balances via public RPC (no wallet interaction needed).
 * Supports EVM (ETH + ERC-20) and Solana (SOL + SPL tokens).
 */

import { createPublicClient, http, formatUnits, formatEther } from "viem";
import { mainnet, arbitrum, base, optimism, polygon, bsc } from "viem/chains";
import type { Chain } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { loadSessions } from "../storage.js";
import { requireSession, findAccount, parseAccount } from "../helpers.js";
import { getTokensForChain } from "./tokens.js";
import type { ParsedArgs, BalanceResult } from "../types.js";

const EVM_CHAINS: Record<string, { chain: Chain; rpc: string; native: string }> = {
  "eip155:1": { chain: mainnet, rpc: "https://eth.llamarpc.com", native: "ETH" },
  "eip155:42161": { chain: arbitrum, rpc: "https://arb1.arbitrum.io/rpc", native: "ETH" },
  "eip155:8453": { chain: base, rpc: "https://mainnet.base.org", native: "ETH" },
  "eip155:10": { chain: optimism, rpc: "https://mainnet.optimism.io", native: "ETH" },
  "eip155:137": { chain: polygon, rpc: "https://polygon-rpc.com", native: "POL" },
  "eip155:56": { chain: bsc, rpc: "https://bsc-dataseed.binance.org", native: "BNB" },
};

const SOLANA_RPC: Record<string, string> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
};

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function getEvmBalance(address: string, chainId: string): Promise<BalanceResult> {
  const chainConfig = EVM_CHAINS[chainId];
  if (!chainConfig) {
    return { chain: chainId, address, balances: [], error: `Unsupported EVM chain: ${chainId}` };
  }

  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
  });

  const result: BalanceResult = { chain: chainId, address, balances: [] };

  try {
    const rawBalance = await client.getBalance({ address: address as `0x${string}` });
    result.balances.push({
      token: chainConfig.native,
      balance: formatEther(rawBalance),
      raw: rawBalance.toString(),
    });
  } catch (err) {
    result.balances.push({ token: chainConfig.native, error: (err as Error).message });
  }

  const tokens = getTokensForChain(chainId);
  for (const token of tokens) {
    try {
      const rawBalance = await client.readContract({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      result.balances.push({
        token: token.symbol,
        balance: formatUnits(rawBalance, token.decimals),
        raw: rawBalance.toString(),
      });
    } catch (err) {
      result.balances.push({ token: token.symbol, error: (err as Error).message });
    }
  }

  return result;
}

async function getSolanaBalance(address: string, chainId: string): Promise<BalanceResult> {
  const rpcUrl = SOLANA_RPC[chainId];
  if (!rpcUrl) {
    return { chain: chainId, address, balances: [], error: `Unsupported Solana chain: ${chainId}` };
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const pubkey = new PublicKey(address);
  const result: BalanceResult = { chain: chainId, address, balances: [] };

  try {
    const lamports = await connection.getBalance(pubkey);
    result.balances.push({
      token: "SOL",
      balance: (lamports / 1e9).toFixed(9),
      raw: lamports.toString(),
    });
  } catch (err) {
    result.balances.push({ token: "SOL", error: (err as Error).message });
  }

  const tokens = getTokensForChain(chainId);
  for (const token of tokens) {
    try {
      const mintPubkey = new PublicKey(token.address);
      const ata = getAssociatedTokenAddressSync(mintPubkey, pubkey);
      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        result.balances.push({ token: token.symbol, balance: "0", raw: "0" });
        continue;
      }
      const account = await getAccount(connection, ata);
      const balance = Number(account.amount) / 10 ** token.decimals;
      result.balances.push({
        token: token.symbol,
        balance: balance.toFixed(token.decimals),
        raw: account.amount.toString(),
      });
    } catch {
      result.balances.push({ token: token.symbol, balance: "0", raw: "0" });
    }
  }

  return result;
}

export async function cmdBalance(args: ParsedArgs): Promise<void> {
  const sessions = loadSessions();

  let accountsToCheck: { address: string; chain: string }[] = [];

  if (args.topic) {
    const sessionData = requireSession(sessions, args.topic);
    const chainsToCheck = args.chain
      ? [args.chain]
      : [
          ...new Set(
            (sessionData.accounts || []).map((a) => {
              const parts = a.split(":");
              return parts.slice(0, 2).join(":");
            }),
          ),
        ];

    for (const chain of chainsToCheck) {
      const acct = findAccount(sessionData.accounts, chain);
      if (acct) {
        const { address } = parseAccount(acct);
        accountsToCheck.push({ address, chain });
      }
    }
  } else if (args.address) {
    const chain = args.chain || "eip155:1";
    accountsToCheck.push({ address: args.address, chain });
  } else {
    const chain = args.chain;
    for (const [, sessionData] of Object.entries(sessions)) {
      for (const acctStr of sessionData.accounts || []) {
        const { address, chainId } = parseAccount(acctStr);
        const acctChain = chainId;
        if (!chain || acctChain === chain) {
          accountsToCheck.push({ address, chain: acctChain });
        }
      }
    }
  }

  if (accountsToCheck.length === 0) {
    console.log(
      JSON.stringify({
        error: "No accounts found. Use --topic, --address, or ensure sessions exist.",
      }),
    );
    return;
  }

  const seen = new Set<string>();
  accountsToCheck = accountsToCheck.filter(({ address, chain }) => {
    const key = `${chain}:${address.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const results: BalanceResult[] = [];
  for (const { address, chain } of accountsToCheck) {
    if (chain.startsWith("solana:")) {
      results.push(await getSolanaBalance(address, chain));
    } else if (chain.startsWith("eip155:")) {
      results.push(await getEvmBalance(address, chain));
    } else {
      results.push({ chain, address, balances: [], error: `Unknown namespace for chain ${chain}` });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}
