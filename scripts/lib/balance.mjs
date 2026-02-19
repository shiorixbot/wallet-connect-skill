/**
 * Balance command — check wallet balances via public RPC (no wallet interaction needed).
 * Supports EVM (ETH + ERC-20) and Solana (SOL + SPL tokens).
 */

import { createPublicClient, http, formatUnits, formatEther } from "viem";
import { mainnet, arbitrum, base, optimism, polygon, bsc } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { loadSessions } from "./client.mjs";
import { requireSession, findAccount, parseAccount } from "./helpers.mjs";
import { getTokensForChain } from "./tokens.mjs";

// Public RPC endpoints per chain
const EVM_CHAINS = {
  "eip155:1": { chain: mainnet, rpc: "https://eth.llamarpc.com", native: "ETH" },
  "eip155:42161": { chain: arbitrum, rpc: "https://arb1.arbitrum.io/rpc", native: "ETH" },
  "eip155:8453": { chain: base, rpc: "https://mainnet.base.org", native: "ETH" },
  "eip155:10": { chain: optimism, rpc: "https://mainnet.optimism.io", native: "ETH" },
  "eip155:137": { chain: polygon, rpc: "https://polygon-rpc.com", native: "POL" },
  "eip155:56": { chain: bsc, rpc: "https://bsc-dataseed.binance.org", native: "BNB" },
};

const SOLANA_RPC = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
};

// --- EVM balance ---

async function getEvmBalance(address, chainId) {
  const chainConfig = EVM_CHAINS[chainId];
  if (!chainConfig) {
    return { error: `Unsupported EVM chain: ${chainId}` };
  }

  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
  });

  const result = { chain: chainId, address, balances: [] };

  // Native balance
  try {
    const rawBalance = await client.getBalance({ address });
    result.balances.push({
      token: chainConfig.native,
      balance: formatEther(rawBalance),
      raw: rawBalance.toString(),
    });
  } catch (err) {
    result.balances.push({ token: chainConfig.native, error: err.message });
  }

  // ERC-20 token balances
  const erc20Abi = [
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    },
  ];

  const tokens = getTokensForChain(chainId);
  for (const token of tokens) {
    try {
      const rawBalance = await client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      result.balances.push({
        token: token.symbol,
        balance: formatUnits(rawBalance, token.decimals),
        raw: rawBalance.toString(),
      });
    } catch (err) {
      result.balances.push({ token: token.symbol, error: err.message });
    }
  }

  return result;
}

// --- Solana balance ---

async function getSolanaBalance(address, chainId) {
  const rpcUrl = SOLANA_RPC[chainId];
  if (!rpcUrl) {
    return { error: `Unsupported Solana chain: ${chainId}` };
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const pubkey = new PublicKey(address);
  const result = { chain: chainId, address, balances: [] };

  // Native SOL
  try {
    const lamports = await connection.getBalance(pubkey);
    result.balances.push({
      token: "SOL",
      balance: (lamports / 1e9).toFixed(9),
      raw: lamports.toString(),
    });
  } catch (err) {
    result.balances.push({ token: "SOL", error: err.message });
  }

  // SPL tokens
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

// --- Command entry ---

export async function cmdBalance(args) {
  const sessions = loadSessions();

  // Determine addresses to check
  let accountsToCheck = [];

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
    // Direct address lookup — infer chain from args.chain or default to ETH
    const chain = args.chain || "eip155:1";
    accountsToCheck.push({ address: args.address, chain });
  } else {
    // No session/address — check all session accounts
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

  // Deduplicate
  const seen = new Set();
  accountsToCheck = accountsToCheck.filter(({ address, chain }) => {
    const key = `${chain}:${address.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const results = [];
  for (const { address, chain } of accountsToCheck) {
    if (chain.startsWith("solana:")) {
      results.push(await getSolanaBalance(address, chain));
    } else if (chain.startsWith("eip155:")) {
      results.push(await getEvmBalance(address, chain));
    } else {
      results.push({ chain, address, error: `Unknown namespace for chain ${chain}` });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}
