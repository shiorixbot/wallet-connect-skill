/**
 * Pair command — create a new WalletConnect pairing session.
 */

import QRCode from "qrcode";
import { mkdirSync } from "fs";
import { join } from "path";
import { parseChainId } from "@walletconnect/utils";
import { getClient, saveSession, SESSIONS_DIR } from "./client.mjs";

// WC methods we request per namespace
const NAMESPACE_CONFIG = {
  eip155: {
    methods: ["personal_sign", "eth_sendTransaction", "eth_signTypedData_v4"],
    events: ["chainChanged", "accountsChanged"],
  },
  solana: {
    methods: ["solana_signMessage", "solana_signTransaction", "solana_signAndSendTransaction"],
    events: [],
  },
};

export async function cmdPair(args) {
  const chains = args.chains ? args.chains.split(",") : ["eip155:1"];

  // Group chains by namespace using WC utils
  const byNamespace = {};
  for (const chain of chains) {
    const { namespace } = parseChainId(chain);
    if (!NAMESPACE_CONFIG[namespace]) {
      console.error(JSON.stringify({ error: `Unsupported namespace: ${namespace}` }));
      process.exit(1);
    }
    if (!byNamespace[namespace]) byNamespace[namespace] = [];
    byNamespace[namespace].push(chain);
  }

  // Build required namespaces
  const requiredNamespaces = {};
  for (const [ns, nsChains] of Object.entries(byNamespace)) {
    requiredNamespaces[ns] = {
      chains: nsChains,
      ...NAMESPACE_CONFIG[ns],
    };
  }

  const client = await getClient();
  const { uri, approval } = await client.connect({ requiredNamespaces });

  // Generate QR code
  const qrPath = join(SESSIONS_DIR, `qr-${Date.now()}.png`);
  mkdirSync(SESSIONS_DIR, { recursive: true });
  await QRCode.toFile(qrPath, uri, { width: 400, margin: 2 });

  // Output immediately so agent can send URI while waiting
  console.log(JSON.stringify({ uri, qrPath, status: "waiting_for_approval" }, null, 2));

  // Wait for approval (blocking)
  try {
    const session = await approval();
    const accounts = Object.values(session.namespaces).flatMap((ns) => ns.accounts || []);

    saveSession(session.topic, {
      accounts,
      chains,
      peerName: session.peer?.metadata?.name || "Unknown Wallet",
      createdAt: new Date().toISOString(),
    });

    console.log(
      JSON.stringify(
        {
          status: "paired",
          topic: session.topic,
          accounts,
          peerName: session.peer?.metadata?.name,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.log(JSON.stringify({ status: "rejected", error: err.message }));
  }

  await client.core.relayer.transportClose();
}
