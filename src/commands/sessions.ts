/**
 * Session management commands -- list, whoami, delete.
 */

import { loadSessions, saveSessions } from "../storage.js";
import { findSessionByAddress } from "../client.js";
import type { ParsedArgs } from "../types.js";

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

export async function cmdStatus(args: ParsedArgs): Promise<void> {
  args = resolveAddress(args);
  if (!args.topic) {
    console.error(JSON.stringify({ error: "--topic or --address required" }));
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

export async function cmdSessions(): Promise<void> {
  const sessions = loadSessions();
  console.log(JSON.stringify(sessions, null, 2));
}

export async function cmdListSessions(): Promise<void> {
  const sessions = loadSessions();
  const entries = Object.entries(sessions);
  if (entries.length === 0) {
    console.log("No saved sessions.");
    return;
  }
  for (const [topic, s] of entries) {
    const accounts = (s.accounts || []).map((a) => {
      const parts = a.split(":");
      const chain = parts.slice(0, 2).join(":");
      const addr = parts.slice(2).join(":");
      return `  ${chain} -> ${addr}`;
    });
    const auth = s.authenticated ? " authenticated" : "";
    const date = s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 16) : "unknown";
    console.log(`Topic: ${topic.slice(0, 12)}...`);
    console.log(`  Peer: ${s.peerName || "unknown"}${auth}`);
    console.log(`  Created: ${date}`);
    console.log(`  Accounts:`);
    accounts.forEach((a) => console.log(`  ${a}`));
    console.log();
  }
}

export async function cmdWhoami(args: ParsedArgs): Promise<void> {
  args = resolveAddress(args);
  const sessions = loadSessions();

  if (args.topic) {
    const session = sessions[args.topic];
    if (!session) {
      console.error(JSON.stringify({ error: "Session not found", topic: args.topic }));
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        {
          topic: args.topic,
          peerName: session.peerName,
          accounts: session.accounts,
          authenticated: session.authenticated || false,
          createdAt: session.createdAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  const entries = Object.entries(sessions);
  if (entries.length === 0) {
    console.log(JSON.stringify({ error: "No sessions found" }));
    return;
  }
  entries.sort((a, b) =>
    (b[1].updatedAt || b[1].createdAt || "").localeCompare(
      a[1].updatedAt || a[1].createdAt || "",
    ),
  );
  const [topic, session] = entries[0];
  console.log(
    JSON.stringify(
      {
        topic,
        peerName: session.peerName,
        accounts: session.accounts,
        authenticated: session.authenticated || false,
        createdAt: session.createdAt,
      },
      null,
      2,
    ),
  );
}

export async function cmdDeleteSession(args: ParsedArgs): Promise<void> {
  args = resolveAddress(args);
  if (!args.topic) {
    console.error(JSON.stringify({ error: "--topic or --address required" }));
    process.exit(1);
  }
  const sessions = loadSessions();
  if (!sessions[args.topic]) {
    console.log(JSON.stringify({ status: "not_found", topic: args.topic }));
    return;
  }
  const { peerName, accounts } = sessions[args.topic];
  delete sessions[args.topic];
  saveSessions(sessions);
  console.log(JSON.stringify({ status: "deleted", topic: args.topic, peerName, accounts }));
}
