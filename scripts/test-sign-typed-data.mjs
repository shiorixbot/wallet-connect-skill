#!/usr/bin/env node
/**
 * Unit tests for sign-typed-data parsing helpers.
 * Run: node scripts/test-sign-typed-data.mjs
 */

import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseTypedData, inferPrimaryType } from "./lib/sign-typed-data.mjs";

let passed = 0;
let failed = 0;

function assert(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assertThrows(label, fn, msgContains) {
  try {
    fn();
    console.error(`  ✗ ${label} (expected error, got none)`);
    failed++;
  } catch (err) {
    if (msgContains && !err.message.includes(msgContains)) {
      console.error(`  ✗ ${label} (wrong error: ${err.message})`);
      failed++;
    } else {
      console.log(`  ✓ ${label}`);
      passed++;
    }
  }
}

// Sample valid typed data
const VALID_DATA = {
  domain: { name: "MyApp", version: "1", chainId: 1 },
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
    ],
    Transfer: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  primaryType: "Transfer",
  message: { to: "0xdeadbeef", amount: "1000000000000000000" },
};

console.log("\nparseTypedData()");

assert("parses valid JSON string", () => {
  const result = parseTypedData(JSON.stringify(VALID_DATA));
  if (result.primaryType !== "Transfer") throw new Error("primaryType mismatch");
  if (result.domain.name !== "MyApp") throw new Error("domain.name mismatch");
});

assert("accepts object directly", () => {
  const result = parseTypedData(VALID_DATA);
  if (!result.message) throw new Error("missing message");
});

assert("reads from @file", () => {
  const tmpFile = join(tmpdir(), `eip712-test-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify(VALID_DATA), "utf8");
  try {
    const result = parseTypedData(`@${tmpFile}`);
    if (result.domain.name !== "MyApp") throw new Error("domain.name mismatch from file");
  } finally {
    unlinkSync(tmpFile);
  }
});

assertThrows("rejects missing domain", () => {
  const { domain: _d, ...bad } = VALID_DATA;
  parseTypedData(bad);
}, "domain");

assertThrows("rejects missing types", () => {
  const { types: _t, ...bad } = VALID_DATA;
  parseTypedData(bad);
}, "types");

assertThrows("rejects missing message", () => {
  const { message: _m, ...bad } = VALID_DATA;
  parseTypedData(bad);
}, "message");

assertThrows("rejects invalid JSON string", () => {
  parseTypedData("not-json");
}, "valid JSON");

assertThrows("rejects missing @file", () => {
  parseTypedData("@/nonexistent/path/eip712.json");
}, "Failed to read");

console.log("\ninferPrimaryType()");

assert("infers Transfer from types", () => {
  const pt = inferPrimaryType(VALID_DATA.types);
  if (pt !== "Transfer") throw new Error(`Expected Transfer, got ${pt}`);
});

assert("infers first non-EIP712Domain key", () => {
  const types = { EIP712Domain: [], Order: [], Item: [] };
  const pt = inferPrimaryType(types);
  if (pt !== "Order") throw new Error(`Expected Order, got ${pt}`);
});

assert("handles types without EIP712Domain", () => {
  const pt = inferPrimaryType({ Permit: [], Nonce: [] });
  if (pt !== "Permit") throw new Error(`Expected Permit, got ${pt}`);
});

assertThrows("throws when only EIP712Domain present", () => {
  inferPrimaryType({ EIP712Domain: [] });
}, "Cannot infer primaryType");

assertThrows("throws on empty types", () => {
  inferPrimaryType({});
}, "Cannot infer primaryType");

// Summary
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
