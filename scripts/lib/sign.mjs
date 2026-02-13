/**
 * Sign command — sign an arbitrary message.
 */

import { getClient, loadSessions } from "./client.mjs";

export async function cmdSign(args) {
  if (!args.topic || !args.message) {
    console.error(JSON.stringify({ error: "--topic and --message required" }));
    process.exit(1);
  }

  const client = await getClient();
  const sessions = loadSessions();
  const sessionData = sessions[args.topic];
  if (!sessionData) {
    console.error(JSON.stringify({ error: "Session not found" }));
    process.exit(1);
  }

  const evmAccount = sessionData.accounts.find((a) => a.startsWith("eip155:"));
  const solAccount = sessionData.accounts.find((a) => a.startsWith("solana:"));

  let result;
  if (evmAccount) {
    const [ns, chainId, address] = evmAccount.split(":");
    const hexMsg = "0x" + Buffer.from(args.message, "utf8").toString("hex");
    const signature = await client.request({
      topic: args.topic,
      chainId: `${ns}:${chainId}`,
      request: {
        method: "personal_sign",
        params: [hexMsg, address],
      },
    });
    result = { status: "signed", address, signature, chain: `${ns}:${chainId}` };
  } else if (solAccount) {
    const [ns, chainId, address] = solAccount.split(":");
    const encoded = Buffer.from(args.message, "utf8").toString("base64");
    const signature = await client.request({
      topic: args.topic,
      chainId: `${ns}:${chainId}`,
      request: {
        method: "solana_signMessage",
        params: { message: encoded, pubkey: address },
      },
    });
    result = { status: "signed", address, signature, chain: `${ns}:${chainId}` };
  } else {
    result = { status: "error", error: "No supported account found" };
  }

  console.log(JSON.stringify(result, null, 2));
  await client.core.relayer.transportClose();
}
