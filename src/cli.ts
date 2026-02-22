#!/usr/bin/env tsx
/**
 * wallet-connect-skill CLI entry point.
 *
 * Commands:
 *   pair             Create a new pairing session
 *   status           Check session status
 *   auth             Send consent sign request
 *   sign             Sign an arbitrary message
 *   send-tx          Send a transaction
 *   balance          Check wallet balances via public RPC (no wallet needed)
 *   tokens           List supported tokens for a given chain
 *   sessions         List active sessions (raw JSON)
 *   list-sessions    List sessions with accounts, peer, and date
 *   whoami           Show account info for a session
 *   delete-session   Remove a saved session
 *   sign-typed-data  Sign EIP-712 typed data (EVM only)
 *   health           Ping session(s) to check liveness (--all, --clean)
 */

import { parseArgs } from "util";
import { cmdPair } from "./commands/pair.js";
import { cmdAuth } from "./commands/auth.js";
import { cmdSign } from "./commands/sign.js";
import { cmdSignTypedData } from "./commands/sign-typed-data.js";
import { cmdSendTx } from "./commands/send-tx.js";
import { cmdBalance } from "./commands/balance.js";
import { cmdHealth } from "./commands/health.js";
import {
  cmdStatus,
  cmdSessions,
  cmdListSessions,
  cmdWhoami,
  cmdDeleteSession,
} from "./commands/sessions.js";
import { getTokensForChain } from "./commands/tokens.js";
import { loadSessions } from "./storage.js";
import { findSessionByAddress } from "./client.js";
import type { ParsedArgs } from "./types.js";

function resolveAddress(args: ParsedArgs): ParsedArgs {
  if (args.address && !args.topic) {
    const sessions = loadSessions();
    const match = findSessionByAddress(sessions, args.address);
    if (!match) {
      console.error(
        JSON.stringify({ error: "No session found for address", address: args.address }),
      );
      process.exit(1);
    }
    args.topic = match.topic;
  }
  return args;
}

async function cmdTokens(args: ParsedArgs): Promise<void> {
  const chain = args.chain || "eip155:1";
  const tokens = getTokensForChain(chain);
  if (tokens.length === 0) {
    console.log(
      JSON.stringify({ chain, tokens: [], message: "No tokens configured for this chain" }),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          chain,
          tokens: tokens.map((t) => ({
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            address: t.address,
          })),
        },
        null,
        2,
      ),
    );
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    chains: { type: "string" },
    topic: { type: "string" },
    address: { type: "string" },
    message: { type: "string" },
    chain: { type: "string" },
    to: { type: "string" },
    amount: { type: "string" },
    token: { type: "string" },
    data: { type: "string" },
    all: { type: "boolean" },
    clean: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const command = positionals[0];
const args = values as ParsedArgs;

if (!command || args.help) {
  console.log(`Usage: cli.ts <command> [options]

Commands:
  pair             Create pairing session (--chains eip155:1,solana:...)
  status           Check session (--topic <topic> | --address <addr>)
  auth             Send consent sign (--topic <topic> | --address <addr>)
  sign             Sign message (--topic <topic> | --address <addr>) --message <msg>
  sign-typed-data  Sign EIP-712 typed data (--topic | --address) --data <json|@file> [--chain eip155:1]
  send-tx          Send transaction (--topic <topic> | --address <addr>) --chain <chain> --to <addr> --amount <n> [--token USDC]
  balance          Check wallet balances (--topic <topic> | --address <addr> [--chain <chain>])
  tokens           List supported tokens for a chain (--chain <chain>)
  sessions         List all sessions (raw JSON)
  list-sessions    List sessions (human-readable)
  whoami           Show account info (--topic <topic> | --address <addr>)
  delete-session   Remove a saved session (--topic <topic> | --address <addr>)
  health           Ping session to check liveness (--topic | --address | --all) [--clean]

Options:
  --address <0x...>  Select session by wallet address (case-insensitive)
  --all              (health) Ping all sessions
  --clean            (health) Remove dead sessions from storage`);
  process.exit(0);
}

const commands: Record<string, (args: ParsedArgs) => Promise<void>> = {
  pair: cmdPair,
  status: cmdStatus,
  auth: (a) => {
    a = resolveAddress(a);
    return cmdAuth(a);
  },
  sign: (a) => {
    a = resolveAddress(a);
    return cmdSign(a);
  },
  "sign-typed-data": (a) => {
    a = resolveAddress(a);
    return cmdSignTypedData(a);
  },
  "send-tx": (a) => {
    a = resolveAddress(a);
    return cmdSendTx(a);
  },
  balance: (a) => {
    if (a.address || a.topic) a = resolveAddress(a);
    return cmdBalance(a);
  },
  tokens: cmdTokens,
  sessions: cmdSessions,
  "list-sessions": cmdListSessions,
  whoami: cmdWhoami,
  "delete-session": cmdDeleteSession,
  health: cmdHealth,
};

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

commands[command](args).catch((err: Error) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
