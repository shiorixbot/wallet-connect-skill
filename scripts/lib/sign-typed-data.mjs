/**
 * Sign-typed-data command — sign EIP-712 typed data (EVM only).
 */

import { readFileSync } from "fs";
import { getClient, loadSessions } from "./client.mjs";
import {
  requireSession,
  findAccount,
  parseAccount,
  requestWithTimeout,
} from "./helpers.mjs";

/**
 * Parse and validate typed data from a JSON string or @file path.
 * Returns the parsed object.
 */
export function parseTypedData(raw) {
  let json;
  if (typeof raw === "string" && raw.startsWith("@")) {
    const filePath = raw.slice(1);
    try {
      json = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (err) {
      throw new Error(`Failed to read typed data from file "${filePath}": ${err.message}`);
    }
  } else {
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error("--data must be valid JSON or a @file path");
    }
  }

  if (!json || typeof json !== "object") {
    throw new Error("Typed data must be a JSON object");
  }

  const missing = ["domain", "types", "message"].filter((k) => !(k in json));
  if (missing.length > 0) {
    throw new Error(`Typed data missing required field(s): ${missing.join(", ")}`);
  }

  if (typeof json.types !== "object" || Array.isArray(json.types)) {
    throw new Error("Typed data 'types' must be an object");
  }

  return json;
}

/**
 * Infer primaryType from the types object.
 * Returns the first key that isn't "EIP712Domain".
 */
export function inferPrimaryType(types) {
  const candidates = Object.keys(types).filter((k) => k !== "EIP712Domain");
  if (candidates.length === 0) {
    throw new Error(
      "Cannot infer primaryType: no types defined besides EIP712Domain — provide it explicitly",
    );
  }
  return candidates[0];
}

export async function cmdSignTypedData(args) {
  if ((!args.topic && !args.address) || !args.data) {
    console.error(
      JSON.stringify({ error: "--topic (or --address) and --data required" }),
    );
    process.exit(1);
  }

  // Parse and validate typed data
  let typedData;
  try {
    typedData = parseTypedData(args.data);
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }

  // Resolve primaryType
  const primaryType =
    typedData.primaryType ||
    (() => {
      try {
        return inferPrimaryType(typedData.types);
      } catch (err) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    })();

  const client = await getClient();
  const sessionData = requireSession(loadSessions(), args.topic);

  // EIP-712 is EVM-only — require an eip155 account
  const account = findAccount(
    sessionData.accounts,
    args.chain?.startsWith("eip155") ? args.chain : "eip155",
  );

  if (!account) {
    console.error(
      JSON.stringify({
        error: "No EVM (eip155) account found in session — EIP-712 is EVM-only",
      }),
    );
    process.exit(1);
  }

  const { chainId, address } = parseAccount(account);

  // Build the full typed data payload (ensure primaryType is present)
  const payload = { ...typedData, primaryType };

  const signature = await requestWithTimeout(client, {
    topic: args.topic,
    chainId,
    request: {
      method: "eth_signTypedData_v4",
      params: [address, JSON.stringify(payload)],
    },
  });

  const result = { status: "signed", address, signature, chain: chainId, primaryType };
  console.log(JSON.stringify(result, null, 2));
  await client.core.relayer.transportClose();
}
