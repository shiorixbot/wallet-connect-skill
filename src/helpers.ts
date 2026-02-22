/**
 * Shared helpers for wallet-connect-skill.
 */

import { parseAccountId } from "@walletconnect/utils";
import bs58 from "bs58";
import { normalize } from "viem/ens";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import type { SignClient } from "@walletconnect/sign-client";
import type { Sessions } from "./types.js";

/**
 * Find an account in session matching a namespace (e.g. "eip155" or "solana").
 */
export function findAccount(accounts: string[], chainHint: string | undefined): string | null {
  if (!chainHint) return accounts[0] || null;
  const exact = accounts.find((a) => a.startsWith(chainHint + ":") || a.startsWith(chainHint));
  if (exact) return exact;
  const ns = chainHint.split(":")[0];
  return accounts.find((a) => a.startsWith(ns + ":")) || null;
}

/**
 * Parse an account string into { namespace, reference, address, chainId }.
 */
export function parseAccount(accountStr: string) {
  const parsed = parseAccountId(accountStr);
  return {
    ...parsed,
    chainId: `${parsed.namespace}:${parsed.reference}`,
    address: parsed.address,
  };
}

/**
 * Redact middle of an address: 0xC36edF48...3db87e81b
 */
export function redactAddress(address: string, keep = 7): string {
  if (!address) return address;
  if (address.startsWith("0x")) {
    const hex = address.slice(2);
    if (hex.length <= keep * 2) return address;
    return `0x${hex.slice(0, keep)}...${hex.slice(-keep)}`;
  }
  if (address.length <= keep * 2) return address;
  return `${address.slice(0, keep)}...${address.slice(-keep)}`;
}

/**
 * Encode a UTF-8 message for EVM personal_sign (hex).
 */
export function encodeEvmMessage(message: string): string {
  return "0x" + Buffer.from(message, "utf8").toString("hex");
}

/**
 * Encode a UTF-8 message for Solana signMessage (bs58).
 */
export function encodeSolMessage(message: string): string {
  return bs58.encode(Buffer.from(message, "utf8"));
}

/**
 * Get session data or exit with error.
 */
export function requireSession(sessions: Sessions, topic: string): Sessions[string] {
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
export function requireAccount(
  sessionData: Sessions[string],
  chainHint: string,
  label = "matching",
): string {
  const account = findAccount(sessionData.accounts, chainHint);
  if (!account) {
    console.error(JSON.stringify({ error: `No ${label} account found`, chainHint }));
    process.exit(1);
  }
  return account;
}

/**
 * Resolve an ENS name to an EVM address. Pass-through if not .eth.
 */
export async function resolveAddress(addressOrEns: string): Promise<string> {
  if (!addressOrEns.endsWith(".eth")) return addressOrEns;
  const client = createPublicClient({ chain: mainnet, transport: http() });
  const resolved = await client.getEnsAddress({ name: normalize(addressOrEns) });
  if (!resolved) throw new Error(`Could not resolve ENS name: ${addressOrEns}`);
  return resolved;
}

/**
 * Wrap client.request with timeout and periodic polling status on stderr.
 */
export async function requestWithTimeout(
  client: InstanceType<typeof SignClient>,
  requestParams: Parameters<InstanceType<typeof SignClient>["request"]>[0],
  { pollIntervalMs = 10000, timeoutMs = 300000 } = {},
): Promise<unknown> {
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
          () => reject(new Error("Request timed out after 5 minutes -- user did not respond")),
          timeoutMs,
        );
      }),
    ]);
    return result;
  } finally {
    clearInterval(pollTimer);
  }
}
