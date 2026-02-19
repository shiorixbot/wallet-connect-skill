/**
 * Shared helpers for wallet-connect-skill.
 */

import { parseAccountId } from "@walletconnect/utils";
import bs58 from "bs58";
import { normalize } from "viem/ens";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

// --- Account lookup ---

/**
 * Find an account in session matching a namespace (e.g. "eip155" or "solana").
 * If chainHint is a full chain id like "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", matches exactly.
 * If just a namespace like "solana", matches any account starting with it.
 */
export function findAccount(accounts, chainHint) {
  if (!chainHint) return accounts[0] || null;
  // Full chain id match first
  const exact = accounts.find((a) => a.startsWith(chainHint + ":") || a.startsWith(chainHint));
  if (exact) return exact;
  // Namespace prefix match
  const ns = chainHint.split(":")[0];
  return accounts.find((a) => a.startsWith(ns + ":")) || null;
}

/**
 * Parse an account string into { namespace, reference, address, chainId }.
 */
export function parseAccount(accountStr) {
  const parsed = parseAccountId(accountStr);
  return {
    ...parsed,
    chainId: `${parsed.namespace}:${parsed.reference}`,
    address: parsed.address,
  };
}

// --- Address formatting ---

/**
 * Redact middle of an address: 0xC36edF48...3db87e81b
 * Shows first `keep` and last `keep` chars after any prefix.
 */
export function redactAddress(address, keep = 7) {
  if (!address) return address;
  // For 0x-prefixed (EVM)
  if (address.startsWith("0x")) {
    const hex = address.slice(2);
    if (hex.length <= keep * 2) return address;
    return `0x${hex.slice(0, keep)}...${hex.slice(-keep)}`;
  }
  // For base58 (Solana) or other
  if (address.length <= keep * 2) return address;
  return `${address.slice(0, keep)}...${address.slice(-keep)}`;
}

// --- Message encoding ---

/**
 * Encode a UTF-8 message for EVM personal_sign (hex).
 */
export function encodeEvmMessage(message) {
  return "0x" + Buffer.from(message, "utf8").toString("hex");
}

/**
 * Encode a UTF-8 message for Solana signMessage (bs58).
 */
export function encodeSolMessage(message) {
  return bs58.encode(Buffer.from(message, "utf8"));
}

// --- Session helpers ---

/**
 * Get session data or exit with error.
 */
export function requireSession(sessions, topic) {
  const data = sessions[topic];
  if (!data) {
    console.error(JSON.stringify({ error: "Session not found", topic }));
    process.exit(1);
  }
  return data;
}

/**
 * Require an account matching a chain hint in session, or exit.
 */
export function requireAccount(sessionData, chainHint, label = "matching") {
  const account = findAccount(sessionData.accounts, chainHint);
  if (!account) {
    console.error(JSON.stringify({ error: `No ${label} account found`, chainHint }));
    process.exit(1);
  }
  return account;
}

// --- ENS Resolution ---

/**
 * Resolve an ENS name to an EVM address. Pass-through if not .eth.
 */
export async function resolveAddress(addressOrEns) {
  if (!addressOrEns.endsWith(".eth")) return addressOrEns;
  const client = createPublicClient({ chain: mainnet, transport: http() });
  const resolved = await client.getEnsAddress({ name: normalize(addressOrEns) });
  if (!resolved) throw new Error(`Could not resolve ENS name: ${addressOrEns}`);
  return resolved;
}

// --- Request with Timeout ---

/**
 * Wrap client.request with timeout and periodic polling status on stderr.
 */
export async function requestWithTimeout(
  client,
  requestParams,
  { pollIntervalMs = 10000, timeoutMs = 300000 } = {},
) {
  const start = Date.now();

  const pollTimer = setInterval(() => {
    const elapsed = Date.now() - start;
    console.error(JSON.stringify({ waiting: true, elapsed, timeout: timeoutMs }));
  }, pollIntervalMs);

  try {
    const result = await Promise.race([
      client.request(requestParams),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Request timed out after 5 minutes — user did not respond")),
          timeoutMs,
        );
      }),
    ]);
    return result;
  } finally {
    clearInterval(pollTimer);
  }
}
