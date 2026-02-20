/**
 * WalletConnect client singleton with persistent storage.
 */

import { SignClient } from "@walletconnect/sign-client";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export const SESSIONS_DIR = join(process.env.HOME || "/tmp", ".agent-wallet");
export const SESSIONS_FILE = join(SESSIONS_DIR, "sessions.json");

// --- Metadata from env or defaults ---

function getMetadata() {
  return {
    name: process.env.WC_METADATA_NAME || "Agent Wallet",
    description: process.env.WC_METADATA_DESCRIPTION || "AI Agent Wallet Connection",
    url: process.env.WC_METADATA_URL || "https://shiorix.com",
    icons: [process.env.WC_METADATA_ICON || "https://avatars.githubusercontent.com/u/258157775"],
  };
}

// --- Session persistence ---

export function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveSessions(sessions) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

export function saveSession(topic, data) {
  const sessions = loadSessions();
  sessions[topic] = { ...data, updatedAt: new Date().toISOString() };
  saveSessions(sessions);
}

// --- Session lookup by address ---

/**
 * Find the most recent session containing the given address (case-insensitive).
 * Matches against the address portion of CAIP-10 account strings.
 * Returns { topic, session } or null.
 */
export function findSessionByAddress(sessions, address) {
  const needle = address.toLowerCase();
  const matches = [];
  for (const [topic, session] of Object.entries(sessions)) {
    const hasMatch = (session.accounts || []).some((acct) => {
      // CAIP-10: namespace:reference:address — compare the address part
      const parts = acct.split(":");
      const addr = parts.slice(2).join(":"); // address may contain colons (unlikely but safe)
      return addr.toLowerCase() === needle;
    });
    if (hasMatch) {
      matches.push({ topic, session });
    }
  }
  if (matches.length === 0) return null;
  // Return the most recently updated session
  matches.sort((a, b) =>
    (b.session.updatedAt || b.session.createdAt || "").localeCompare(
      a.session.updatedAt || a.session.createdAt || "",
    ),
  );
  return matches[0];
}

// --- WalletConnect client ---

export async function getClient() {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    console.error(JSON.stringify({ error: "WALLETCONNECT_PROJECT_ID env var required" }));
    process.exit(1);
  }

  const dbPath = join(SESSIONS_DIR, "wc-store");
  mkdirSync(SESSIONS_DIR, { recursive: true });

  const client = await SignClient.init({
    projectId,
    metadata: getMetadata(),
    storageOptions: {
      database: dbPath,
    },
  });

  return client;
}
