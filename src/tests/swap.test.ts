/**
 * Unit tests for swap command pure-function helpers:
 * toRaw, fromRaw, resolveToken — no network required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toRaw, fromRaw, resolveToken } from "../commands/swap.js";

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// toRaw — human amount → raw integer string
// ---------------------------------------------------------------------------

describe("toRaw", () => {
  it("converts whole ETH amount (18 decimals)", () => {
    assert.equal(toRaw("1", 18), "1000000000000000000");
  });

  it("converts 0.1 ETH to 100000000000000000", () => {
    assert.equal(toRaw("0.1", 18), "100000000000000000");
  });

  it("converts 1 USDC (6 decimals)", () => {
    assert.equal(toRaw("1", 6), "1000000");
  });

  it("converts 0.5 USDC (6 decimals)", () => {
    assert.equal(toRaw("0.5", 6), "500000");
  });

  it("converts 1000 USDC", () => {
    assert.equal(toRaw("1000", 6), "1000000000");
  });

  it("handles fractional with more precision than decimals (truncates)", () => {
    // 0.1234567 at 6 decimals → 123456 (truncated, not rounded)
    assert.equal(toRaw("0.1234567", 6), "123456");
  });

  it("converts zero", () => {
    assert.equal(toRaw("0", 18), "0");
  });

  it("converts fractional-only input (no whole part)", () => {
    // ".5" — whole defaults to 0
    assert.equal(toRaw(".5", 6), "500000");
  });

  it("converts 10.005 at 6 decimals", () => {
    assert.equal(toRaw("10.005", 6), "10005000");
  });

  it("converts 1.23456789 ETH (18 decimals, full precision)", () => {
    assert.equal(toRaw("1.23456789", 18), "1234567890000000000");
  });
});

// ---------------------------------------------------------------------------
// fromRaw — raw integer string → human-readable
// ---------------------------------------------------------------------------

describe("fromRaw", () => {
  it("converts 1 ETH from raw", () => {
    assert.equal(fromRaw("1000000000000000000", 18), "1");
  });

  it("converts 0.1 ETH from raw", () => {
    assert.equal(fromRaw("100000000000000000", 18), "0.1");
  });

  it("converts 1 USDC from raw (6 decimals)", () => {
    assert.equal(fromRaw("1000000", 6), "1");
  });

  it("converts 0.5 USDC from raw", () => {
    assert.equal(fromRaw("500000", 6), "0.5");
  });

  it("converts 0 from raw", () => {
    assert.equal(fromRaw("0", 18), "0");
  });

  it("strips trailing zeros from fractional part", () => {
    // 1.50 → "1.5"
    assert.equal(fromRaw("1500000", 6), "1.5");
  });

  it("round-trips with toRaw (18 decimals)", () => {
    const human = "2.5";
    const raw = toRaw(human, 18);
    const back = fromRaw(raw, 18);
    assert.equal(back, human);
  });

  it("round-trips with toRaw (6 decimals)", () => {
    const human = "100.25";
    const raw = toRaw(human, 6);
    const back = fromRaw(raw, 6);
    assert.equal(back, human);
  });

  it("trims fractional to 8 significant digits", () => {
    // Very small amount with many decimals: fromRaw should cap frac at 8 chars
    const result = fromRaw("1", 18); // 1 wei → 0.000000000000000001
    // fromRaw slices to 8 chars of frac then trims zeros — "00000000" → empty → should return "0"
    // Actually: "000000000000000001".padStart(18).slice(0,8) = "00000000" → trimmed = ""
    assert.equal(result, "0");
  });
});

// ---------------------------------------------------------------------------
// resolveToken — symbol → { address, decimals, symbol }
// ---------------------------------------------------------------------------

describe("resolveToken", () => {
  const ETH_CHAIN = "eip155:1";
  const POLYGON_CHAIN = "eip155:137";

  it("resolves ETH to native address on mainnet", () => {
    const t = resolveToken("ETH", ETH_CHAIN);
    assert.equal(t.address, NATIVE_ADDRESS);
    assert.equal(t.decimals, 18);
    assert.equal(t.symbol, "ETH");
  });

  it("resolves POL (native) to native address on Polygon", () => {
    const t = resolveToken("POL", POLYGON_CHAIN);
    assert.equal(t.address, NATIVE_ADDRESS);
    assert.equal(t.decimals, 18);
  });

  it("resolves ETH symbol to native on Polygon (aliased)", () => {
    // ETH on Polygon chain should still resolve via native-alias check
    const t = resolveToken("ETH", POLYGON_CHAIN);
    assert.equal(t.address, NATIVE_ADDRESS);
  });

  it("resolves USDC on mainnet to known address", () => {
    const t = resolveToken("USDC", ETH_CHAIN);
    assert.ok(t.address.startsWith("0x"), "should be a 0x address");
    assert.equal(t.decimals, 6);
    assert.equal(t.symbol, "USDC");
  });

  it("resolves WETH on mainnet", () => {
    const t = resolveToken("WETH", ETH_CHAIN);
    assert.ok(t.address.startsWith("0x"));
    assert.equal(t.decimals, 18);
    assert.equal(t.symbol, "WETH");
  });

  it("resolves DAI on mainnet", () => {
    const t = resolveToken("DAI", ETH_CHAIN);
    assert.ok(t.address.startsWith("0x"));
    assert.equal(t.decimals, 18);
    assert.equal(t.symbol, "DAI");
  });

  it("resolves USDC on Polygon", () => {
    const t = resolveToken("USDC", POLYGON_CHAIN);
    assert.ok(t.address.startsWith("0x"));
    assert.equal(t.decimals, 6);
  });

  it("is case-insensitive for symbol lookup", () => {
    const lower = resolveToken("usdc", ETH_CHAIN);
    const upper = resolveToken("USDC", ETH_CHAIN);
    assert.equal(lower.address, upper.address);
  });

  it("throws for unknown token symbol", () => {
    assert.throws(
      () => resolveToken("FAKECOIN", ETH_CHAIN),
      /Unknown token "FAKECOIN"/,
    );
  });

  it("error message includes the chain hint", () => {
    assert.throws(
      () => resolveToken("XYZ", ETH_CHAIN),
      /eip155:1/,
    );
  });
});
