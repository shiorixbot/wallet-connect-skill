/**
 * Auth command — send consent sign request for wallet verification.
 */

import { randomBytes } from "crypto";
import { getClient, loadSessions, saveSession } from "./client.mjs";
import {
  requireSession,
  requireAccount,
  parseAccount,
  redactAddress,
  encodeEvmMessage,
  requestWithTimeout,
} from "./helpers.mjs";

export async function cmdAuth(args) {
  if (!args.topic) {
    console.error(JSON.stringify({ error: "--topic required" }));
    process.exit(1);
  }

  const client = await getClient();
  const sessionData = requireSession(loadSessions(), args.topic);
  const evmAccountStr = requireAccount(sessionData, "eip155", "EVM");
  const { chainId, address } = parseAccount(evmAccountStr);

  const nonce = randomBytes(16).toString("hex");
  const timestamp = new Date().toISOString();
  const display = redactAddress(address);

  const message = [
    "AgentWallet Authentication",
    "",
    `I authorize this AI agent to request transactions on my behalf.`,
    "",
    `Address: ${display}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");

  try {
    const signature = await requestWithTimeout(client, {
      topic: args.topic,
      chainId,
      request: {
        method: "personal_sign",
        params: [encodeEvmMessage(message), address],
      },
    });

    saveSession(args.topic, {
      ...sessionData,
      authenticated: true,
      authAddress: address,
      authNonce: nonce,
      authSignature: signature,
      authTimestamp: timestamp,
    });

    console.log(
      JSON.stringify({
        status: "authenticated",
        address: display,
        signature,
        nonce,
        message,
      }),
    );
  } catch (err) {
    console.log(JSON.stringify({ status: "rejected", error: err.message }));
  }

  await client.core.relayer.transportClose();
}
