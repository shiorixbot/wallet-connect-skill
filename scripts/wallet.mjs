#!/usr/bin/env node
/**
 * agent-wallet — WalletConnect v2 CLI for AI agents
 *
 * Commands:
 *   pair     Create a new pairing session
 *   status   Check session status
 *   auth     Send consent sign request
 *   sign     Sign an arbitrary message
 *   send-tx  Send a transaction
 *   sessions List active sessions
 */

import SignClient from "@walletconnect/sign-client";
import QRCode from "qrcode";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { parseArgs } from "util";

const SESSIONS_DIR = join(
  process.env.HOME || "/tmp",
  ".agent-wallet"
);
const SESSIONS_FILE = join(SESSIONS_DIR, "sessions.json");

// --- Session persistence ---

function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function saveSession(topic, data) {
  const sessions = loadSessions();
  sessions[topic] = { ...data, updatedAt: new Date().toISOString() };
  saveSessions(sessions);
}

// --- WalletConnect client ---

async function getClient() {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    console.error(
      JSON.stringify({ error: "WALLETCONNECT_PROJECT_ID env var required" })
    );
    process.exit(1);
  }

  const client = await SignClient.init({
    projectId,
    metadata: {
      name: "AgentWallet",
      description: "AI Agent Wallet Connection",
      url: "https://github.com/shiorixbot/agent-wallet",
      icons: ["https://avatars.githubusercontent.com/u/258157775"],
    },
  });

  return client;
}

// --- Commands ---

async function cmdPair(args) {
  const chains = args.chains
    ? args.chains.split(",")
    : ["eip155:1"];

  const evmChains = chains.filter((c) => c.startsWith("eip155:"));
  const solanaChains = chains.filter((c) => c.startsWith("solana:"));

  const namespaces = {};
  if (evmChains.length > 0) {
    namespaces.eip155 = {
      chains: evmChains,
      methods: [
        "personal_sign",
        "eth_sendTransaction",
        "eth_signTypedData_v4",
      ],
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
    deepLinks: {
      trust: `trust://wc?uri=${encodeURIComponent(uri)}`,
      metamask: `metamask://wc?uri=${encodeURIComponent(uri)}`,
    },
    status: "waiting_for_approval",
  };
  console.log(JSON.stringify(result, null, 2));

  // Wait for approval (blocking)
  try {
    const session = await approval();
    const accounts = Object.values(session.namespaces)
      .flatMap((ns) => ns.accounts || []);

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
    console.log(
      JSON.stringify({ status: "rejected", error: err.message })
    );
  }

  await client.core.relayer.transportClose();
}

async function cmdStatus(args) {
  if (!args.topic) {
    console.error(JSON.stringify({ error: "--topic required" }));
    process.exit(1);
  }

  const sessions = loadSessions();
  const session = sessions[args.topic];
  if (!session) {
    console.log(JSON.stringify({ status: "not_found", topic: args.topic }));
    return;
  }

  console.log(JSON.stringify({ status: "active", ...session }));
}

async function cmdAuth(args) {
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
  const evmAccount = sessionData.accounts.find((a) =>
    a.startsWith("eip155:")
  );
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

    // Update session with auth info
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
    console.log(
      JSON.stringify({ status: "rejected", error: err.message })
    );
  }

  await client.core.relayer.transportClose();
}

async function cmdSign(args) {
  if (!args.topic || !args.message) {
    console.error(
      JSON.stringify({ error: "--topic and --message required" })
    );
    process.exit(1);
  }

  const client = await getClient();
  const sessions = loadSessions();
  const sessionData = sessions[args.topic];
  if (!sessionData) {
    console.error(JSON.stringify({ error: "Session not found" }));
    process.exit(1);
  }

  // Try EVM first, then Solana
  const evmAccount = sessionData.accounts.find((a) =>
    a.startsWith("eip155:")
  );
  const solAccount = sessionData.accounts.find((a) =>
    a.startsWith("solana:")
  );

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

async function cmdSendTx(args) {
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

  const chain = args.chain || "eip155:1";

  if (chain.startsWith("eip155:")) {
    const evmAccount = sessionData.accounts.find((a) =>
      a.startsWith(chain)
    );
    if (!evmAccount) {
      console.error(JSON.stringify({ error: `No account for chain ${chain}` }));
      process.exit(1);
    }

    const [, , from] = evmAccount.split(":");

    // Build transaction
    let tx;
    if (args.token && args.token !== "ETH") {
      // ERC-20 transfer
      const tokenAddresses = {
        USDC: {
          "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        },
        USDT: {
          "eip155:1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          "eip155:56": "0x55d398326f99059fF775485246999027B3197955",
        },
      };

      const tokenAddr = tokenAddresses[args.token]?.[chain];
      if (!tokenAddr) {
        console.error(
          JSON.stringify({
            error: `Token ${args.token} not supported on ${chain}`,
          })
        );
        process.exit(1);
      }

      // ERC-20 transfer(address,uint256) selector: 0xa9059cbb
      const decimals = args.token === "USDC" ? 6 : (args.token === "USDT" ? 6 : 18);
      const amount = BigInt(Math.round(parseFloat(args.amount) * 10 ** decimals));
      const toAddr = args.to.replace("0x", "").padStart(64, "0");
      const amountHex = amount.toString(16).padStart(64, "0");
      const data = `0xa9059cbb${toAddr}${amountHex}`;

      tx = { from, to: tokenAddr, data };
    } else {
      // Native ETH transfer
      const weiAmount = BigInt(
        Math.round(parseFloat(args.amount || "0") * 1e18)
      );
      tx = {
        from,
        to: args.to,
        value: "0x" + weiAmount.toString(16),
      };
    }

    try {
      const txHash = await client.request({
        topic: args.topic,
        chainId: chain,
        request: {
          method: "eth_sendTransaction",
          params: [tx],
        },
      });
      console.log(
        JSON.stringify({
          status: "sent",
          txHash,
          chain,
          from,
          to: args.to,
          amount: args.amount,
          token: args.token || "ETH",
        })
      );
    } catch (err) {
      console.log(
        JSON.stringify({ status: "rejected", error: err.message })
      );
    }
  } else if (chain.startsWith("solana:")) {
    // Solana transaction — for now just output that it needs a serialized tx
    console.log(
      JSON.stringify({
        status: "error",
        error: "Solana send-tx not yet implemented. Use sign for message signing.",
      })
    );
  }

  await client.core.relayer.transportClose();
}

async function cmdSessions() {
  const sessions = loadSessions();
  console.log(JSON.stringify(sessions, null, 2));
}

// --- CLI ---

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    chains: { type: "string" },
    topic: { type: "string" },
    message: { type: "string" },
    chain: { type: "string" },
    to: { type: "string" },
    amount: { type: "string" },
    token: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const command = positionals[0];

if (!command || values.help) {
  console.log(`Usage: wallet.mjs <command> [options]

Commands:
  pair       Create pairing session (--chains eip155:1,solana:...)
  status     Check session (--topic <topic>)
  auth       Send consent sign (--topic <topic>)
  sign       Sign message (--topic <topic> --message <msg>)
  send-tx    Send transaction (--topic <topic> --chain <chain> --to <addr> --amount <n> [--token USDC])
  sessions   List all sessions`);
  process.exit(0);
}

const commands = {
  pair: cmdPair,
  status: cmdStatus,
  auth: cmdAuth,
  sign: cmdSign,
  "send-tx": cmdSendTx,
  sessions: cmdSessions,
};

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

commands[command](values).catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
