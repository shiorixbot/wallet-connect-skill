/**
 * WalletConnect client singleton with persistent storage.
 */

import { SignClient } from "@walletconnect/sign-client";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export const SESSIONS_DIR = join(
  process.env.HOME || "/tmp",
  ".agent-wallet"
);
export const SESSIONS_FILE = join(SESSIONS_DIR, "sessions.json");

// --- Metadata from env or defaults ---

function getMetadata() {
  return {
    name: process.env.WC_METADATA_NAME || "ShioriX",
    description: process.env.WC_METADATA_DESCRIPTION || "AI Agent Wallet Connection",
    url: process.env.WC_METADATA_URL || "https://shiorix.hewig.dev",
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

// --- WalletConnect client ---

export async function getClient() {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    console.error(
      JSON.stringify({ error: "WALLETCONNECT_PROJECT_ID env var required" })
    );
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
