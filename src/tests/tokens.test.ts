/**
 * Unit tests for src/commands/tokens.ts — token registry lookups.
 * No network required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getTokenAddress,
  getTokenDecimals,
  isSplToken,
  getTokensForChain,
  TOKENS,
} from "../commands/tokens.js";

// ---------------------------------------------------------------------------
// getTokenAddress
// ---------------------------------------------------------------------------

describe("getTokenAddress", () => {
  it("returns USDC address on Ethereum mainnet", () => {
    const addr = getTokenAddress("USDC", "eip155:1");
    assert.equal(addr, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("returns USDC SPL address on Solana", () => {
    const addr = getTokenAddress("USDC", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    assert.equal(addr, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("returns WETH on Arbitrum", () => {
    const addr = getTokenAddress("WETH", "eip155:42161");
    assert.equal(addr, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1");
  });

  it("returns null for unknown symbol", () => {
    assert.equal(getTokenAddress("SHIB", "eip155:1"), null);
  });

  it("returns null for known symbol on unsupported chain", () => {
    assert.equal(getTokenAddress("USDC", "eip155:999"), null);
  });

  it("returns DAI on Optimism", () => {
    const addr = getTokenAddress("DAI", "eip155:10");
    assert.equal(addr, "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1");
  });
});

// ---------------------------------------------------------------------------
// getTokenDecimals
// ---------------------------------------------------------------------------

describe("getTokenDecimals", () => {
  it("returns 6 for USDC", () => {
    assert.equal(getTokenDecimals("USDC"), 6);
  });

  it("returns 6 for USDT", () => {
    assert.equal(getTokenDecimals("USDT"), 6);
  });

  it("returns 18 for WETH", () => {
    assert.equal(getTokenDecimals("WETH"), 18);
  });

  it("returns 18 for DAI", () => {
    assert.equal(getTokenDecimals("DAI"), 18);
  });

  it("returns 8 for WBTC", () => {
    assert.equal(getTokenDecimals("WBTC"), 8);
  });

  it("defaults to 18 for unknown token", () => {
    assert.equal(getTokenDecimals("UNKNOWN"), 18);
  });
});

// ---------------------------------------------------------------------------
// isSplToken
// ---------------------------------------------------------------------------

describe("isSplToken", () => {
  it("returns true for USDC on Solana", () => {
    assert.equal(isSplToken("USDC", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), true);
  });

  it("returns true for USDT on Solana", () => {
    assert.equal(isSplToken("USDT", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), true);
  });

  it("returns false for USDC on Ethereum (EVM, not SPL)", () => {
    assert.equal(isSplToken("USDC", "eip155:1"), false);
  });

  it("returns false for WETH on Solana (not in SPL registry)", () => {
    assert.equal(isSplToken("WETH", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), false);
  });

  it("returns false for unknown token on Solana", () => {
    assert.equal(isSplToken("SHIB", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), false);
  });
});

// ---------------------------------------------------------------------------
// getTokensForChain
// ---------------------------------------------------------------------------

describe("getTokensForChain", () => {
  it("returns array of tokens for Ethereum mainnet", () => {
    const tokens = getTokensForChain("eip155:1");
    assert.ok(Array.isArray(tokens));
    assert.ok(tokens.length > 0, "should have tokens on mainnet");
    const symbols = tokens.map((t) => t.symbol);
    assert.ok(symbols.includes("USDC"), "should include USDC");
    assert.ok(symbols.includes("WETH"), "should include WETH");
  });

  it("each token has required fields", () => {
    const tokens = getTokensForChain("eip155:1");
    for (const t of tokens) {
      assert.ok(typeof t.symbol === "string", "symbol should be string");
      assert.ok(typeof t.name === "string", "name should be string");
      assert.ok(typeof t.decimals === "number", "decimals should be number");
      assert.ok(typeof t.address === "string", "address should be string");
      assert.ok(t.address.length > 0, "address should be non-empty");
    }
  });

  it("returns empty array for unsupported chain", () => {
    const tokens = getTokensForChain("eip155:999999");
    assert.deepEqual(tokens, []);
  });

  it("returns SPL tokens for Solana", () => {
    const tokens = getTokensForChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    assert.ok(tokens.length > 0);
    const symbols = tokens.map((t) => t.symbol);
    assert.ok(symbols.includes("USDC"), "Solana should have SPL USDC");
    assert.ok(symbols.includes("USDT"), "Solana should have SPL USDT");
  });

  it("Solana tokens do not include WETH (EVM-only)", () => {
    const tokens = getTokensForChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    const symbols = tokens.map((t) => t.symbol);
    assert.ok(!symbols.includes("WETH"), "WETH should not appear on Solana");
  });

  it("Polygon has USDT support", () => {
    const tokens = getTokensForChain("eip155:137");
    const symbols = tokens.map((t) => t.symbol);
    assert.ok(symbols.includes("USDT"), "Polygon should have USDT");
  });
});

// ---------------------------------------------------------------------------
// TOKENS registry consistency checks
// ---------------------------------------------------------------------------

describe("TOKENS registry", () => {
  it("all EVM addresses start with 0x", () => {
    for (const [symbol, config] of Object.entries(TOKENS)) {
      for (const [chainId, address] of Object.entries(config.addresses)) {
        if (chainId.startsWith("eip155:")) {
          assert.ok(
            address.startsWith("0x"),
            `${symbol} on ${chainId}: expected 0x address, got ${address}`,
          );
        }
      }
    }
  });

  it("all decimals are positive integers", () => {
    for (const [symbol, config] of Object.entries(TOKENS)) {
      assert.ok(
        Number.isInteger(config.decimals) && config.decimals > 0,
        `${symbol}: decimals should be positive integer, got ${config.decimals}`,
      );
    }
  });

  it("all EVM addresses are the correct length (42 chars = 0x + 40 hex)", () => {
    for (const [symbol, config] of Object.entries(TOKENS)) {
      for (const [chainId, address] of Object.entries(config.addresses)) {
        if (chainId.startsWith("eip155:")) {
          assert.equal(
            address.length,
            42,
            `${symbol} on ${chainId}: address length should be 42, got ${address.length} (${address})`,
          );
        }
      }
    }
  });
});
