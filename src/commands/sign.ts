/**
 * Sign command -- sign an arbitrary message (EVM or Solana).
 */

import { getClient } from "../client.js";
import { loadSessions } from "../storage.js";
import {
  requireSession,
  findAccount,
  parseAccount,
  encodeEvmMessage,
  encodeSolMessage,
  requestWithTimeout,
} from "../helpers.js";
import type { ParsedArgs } from "../types.js";

export async function cmdSign(args: ParsedArgs): Promise<void> {
  if (!args.topic || !args.message) {
    console.error(JSON.stringify({ error: "--topic and --message required" }));
    process.exit(1);
  }

  const client = await getClient();
  const sessionData = requireSession(loadSessions(), args.topic);

  const chainHint = args.chain;

  const solAccount =
    findAccount(sessionData.accounts, chainHint?.startsWith("solana") ? chainHint : undefined) ||
    (!chainHint ? findAccount(sessionData.accounts, "solana") : null);
  const evmAccount =
    findAccount(sessionData.accounts, chainHint?.startsWith("eip155") ? chainHint : undefined) ||
    (!chainHint ? findAccount(sessionData.accounts, "eip155") : null);

  const useSolana = chainHint?.startsWith("solana") || (!chainHint && !evmAccount && solAccount);
  const account = useSolana ? solAccount : evmAccount;

  if (!account) {
    console.error(JSON.stringify({ error: "No supported account found", chainHint }));
    process.exit(1);
  }

  const { chainId, address } = parseAccount(account);
  let result;

  if (useSolana) {
    const signature = await requestWithTimeout(client, {
      topic: args.topic,
      chainId,
      request: {
        method: "solana_signMessage",
        params: { message: encodeSolMessage(args.message), pubkey: address },
      },
    });
    result = { status: "signed", address, signature, chain: chainId };
  } else {
    const signature = await requestWithTimeout(client, {
      topic: args.topic,
      chainId,
      request: {
        method: "personal_sign",
        params: [encodeEvmMessage(args.message), address],
      },
    });
    result = { status: "signed", address, signature, chain: chainId };
  }

  console.log(JSON.stringify(result, null, 2));
  await client.core.relayer.transportClose();
}
