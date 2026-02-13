/**
 * Pair command — create a new WalletConnect pairing session.
 */

import QRCode from "qrcode";
import { mkdirSync } from "fs";
import { join } from "path";
import { getClient, saveSession, SESSIONS_DIR } from "./client.mjs";

export async function cmdPair(args) {
  const chains = args.chains ? args.chains.split(",") : ["eip155:1"];

  const evmChains = chains.filter((c) => c.startsWith("eip155:"));
  const solanaChains = chains.filter((c) => c.startsWith("solana:"));

  const namespaces = {};
  if (evmChains.length > 0) {
    namespaces.eip155 = {
      chains: evmChains,
      methods: ["personal_sign", "eth_sendTransaction", "eth_signTypedData_v4"],
      events: ["chainChanged", "accountsChanged"],
    };
  }
  if (solanaChains.length > 0) {
    namespaces.solana = {
      chains: solanaChains,
      methods: ["solana_signMessage", "solana_signTransaction"],
      events: [],
    };
  }

  const client = await getClient();
  const { uri, approval } = await client.connect({
    requiredNamespaces: namespaces,
  });

  // Generate QR code
  const qrPath = join(SESSIONS_DIR, `qr-${Date.now()}.png`);
  mkdirSync(SESSIONS_DIR, { recursive: true });
  await QRCode.toFile(qrPath, uri, { width: 400, margin: 2 });

  // Output immediately so agent can send QR while waiting
  const result = {
    uri,
    qrPath,
    status: "waiting_for_approval",
  };
  console.log(JSON.stringify(result, null, 2));

  // Wait for approval (blocking)
  try {
    const session = await approval();
    const accounts = Object.values(session.namespaces).flatMap(
      (ns) => ns.accounts || []
    );

    saveSession(session.topic, {
      accounts,
      chains,
      peerName: session.peer?.metadata?.name || "Unknown Wallet",
      createdAt: new Date().toISOString(),
    });

    const approved = {
      status: "paired",
      topic: session.topic,
      accounts,
      peerName: session.peer?.metadata?.name,
    };
    console.log(JSON.stringify(approved, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: "rejected", error: err.message }));
  }

  await client.core.relayer.transportClose();
}
