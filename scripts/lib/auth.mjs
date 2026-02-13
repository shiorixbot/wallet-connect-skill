/**
 * Auth command — send consent sign request for wallet verification.
 */

import { randomBytes } from "crypto";
import { getClient, loadSessions, saveSession } from "./client.mjs";

export async function cmdAuth(args) {
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

  // Find first EVM account
  const evmAccount = sessionData.accounts.find((a) => a.startsWith("eip155:"));
  if (!evmAccount) {
    console.error(JSON.stringify({ error: "No EVM account in session" }));
    process.exit(1);
  }

  const [namespace, chainId, address] = evmAccount.split(":");
  const nonce = randomBytes(16).toString("hex");
  const timestamp = new Date().toISOString();

  const message = [
    "AgentWallet Authentication",
    "",
    `I authorize this AI agent to request transactions on my behalf.`,
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");

  const hexMessage = "0x" + Buffer.from(message, "utf8").toString("hex");

  try {
    const signature = await client.request({
      topic: args.topic,
      chainId: `${namespace}:${chainId}`,
      request: {
        method: "personal_sign",
        params: [hexMessage, address],
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
        address,
        signature,
        nonce,
        message,
      })
    );
  } catch (err) {
    console.log(JSON.stringify({ status: "rejected", error: err.message }));
  }

  await client.core.relayer.transportClose();
}
