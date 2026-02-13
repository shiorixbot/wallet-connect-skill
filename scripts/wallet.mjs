#!/usr/bin/env node
/**
 * wallet-connect-skill CLI entry point.
 *
 * Commands:
 *   pair     Create a new pairing session
 *   status   Check session status
 *   auth     Send consent sign request
 *   sign     Sign an arbitrary message
 *   send-tx  Send a transaction
 *   sessions List active sessions
 */

import { parseArgs } from "util";
import { cmdPair } from "./lib/pair.mjs";
import { cmdAuth } from "./lib/auth.mjs";
import { cmdSign } from "./lib/sign.mjs";
import { cmdSendTx } from "./lib/send-tx.mjs";
import { loadSessions } from "./lib/client.mjs";

// --- Simple commands ---

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
