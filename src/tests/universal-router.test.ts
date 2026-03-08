/**
 * Unit tests for Universal Router calldata builder.
 * All tests are pure encoding/decoding — no network required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, decodeFunctionData } from "viem";
import {
  encodeV3Path,
  encodeV3SwapExactIn,
  encodeV3SwapExactOut,
  encodePermit2Permit,
  encodeExecute,
  buildExactInSingle,
  buildExactOutSingle,
  buildExactInWithPermit2,
  Commands,
  MSG_SENDER,
  UNIVERSAL_ROUTER_ADDRESS,
} from "../universal-router.js";

// Well-known addresses for testing
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const RECIPIENT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const EXECUTE_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// ---------------------------------------------------------------------------
// encodeV3Path
// ---------------------------------------------------------------------------

describe("encodeV3Path", () => {
  it("encodes a single-hop path (WETH → USDC, 3000 fee)", () => {
    const path = encodeV3Path([WETH, USDC], [3000]);
    // 20 bytes WETH + 3 bytes fee + 20 bytes USDC = 43 bytes = 86 hex chars + 0x
    assert.equal(path.length, 2 + 86);
    assert.ok(path.startsWith("0x"));

    // Verify WETH address is at the start (lowercase, no 0x)
    const wethHex = WETH.slice(2).toLowerCase();
    assert.equal(path.slice(2, 42), wethHex);

    // Verify fee = 3000 = 0x000BB8 (3 bytes = 6 hex chars)
    assert.equal(path.slice(42, 48), "000bb8");

    // Verify USDC address at the end
    const usdcHex = USDC.slice(2).toLowerCase();
    assert.equal(path.slice(48), usdcHex);
  });

  it("encodes a multi-hop path (WETH → DAI → USDC)", () => {
    const path = encodeV3Path([WETH, DAI, USDC], [3000, 500]);
    // 20 + 3 + 20 + 3 + 20 = 66 bytes = 132 hex chars + 0x
    assert.equal(path.length, 2 + 132);

    // Second fee = 500 = 0x0001F4
    assert.equal(path.slice(88, 94), "0001f4");
  });

  it("throws if fewer than 2 tokens", () => {
    assert.throws(() => encodeV3Path([WETH], []), /at least 2 tokens/);
  });

  it("throws if fees length does not match", () => {
    assert.throws(() => encodeV3Path([WETH, USDC], [3000, 500]), /fees\.length must equal/);
  });

  it("handles 10000 fee tier", () => {
    const path = encodeV3Path([WETH, USDC], [10000]);
    // 10000 = 0x002710
    assert.equal(path.slice(42, 48), "002710");
  });

  it("handles 100 fee tier", () => {
    const path = encodeV3Path([WETH, USDC], [100]);
    // 100 = 0x000064
    assert.equal(path.slice(42, 48), "000064");
  });
});

// ---------------------------------------------------------------------------
// encodeV3SwapExactIn
// ---------------------------------------------------------------------------

describe("encodeV3SwapExactIn", () => {
  it("produces valid ABI-encoded data", () => {
    const path = encodeV3Path([WETH, USDC], [3000]);
    const encoded = encodeV3SwapExactIn(
      RECIPIENT,
      1000000000000000000n, // 1 ETH
      1800000000n, // 1800 USDC min
      path,
      true,
    );

    assert.ok(encoded.startsWith("0x"));

    // Decode it back
    const decoded = decodeAbiParameters(
      [
        { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMin", type: "uint256" },
        { name: "path", type: "bytes" },
        { name: "payerIsUser", type: "bool" },
      ],
      encoded as `0x${string}`,
    );

    assert.equal(decoded[0].toLowerCase(), RECIPIENT.toLowerCase());
    assert.equal(decoded[1], 1000000000000000000n);
    assert.equal(decoded[2], 1800000000n);
    assert.equal(decoded[3].toLowerCase(), path.toLowerCase());
    assert.equal(decoded[4], true);
  });

  it("encodes MSG_SENDER as recipient", () => {
    const path = encodeV3Path([WETH, USDC], [3000]);
    const encoded = encodeV3SwapExactIn(MSG_SENDER, 1n, 0n, path, true);

    const decoded = decodeAbiParameters(
      [
        { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMin", type: "uint256" },
        { name: "path", type: "bytes" },
        { name: "payerIsUser", type: "bool" },
      ],
      encoded as `0x${string}`,
    );

    assert.equal(decoded[0].toLowerCase(), MSG_SENDER.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// encodeV3SwapExactOut
// ---------------------------------------------------------------------------

describe("encodeV3SwapExactOut", () => {
  it("produces valid ABI-encoded data", () => {
    // V3 exact-out uses reversed path
    const path = encodeV3Path([USDC, WETH], [3000]);
    const encoded = encodeV3SwapExactOut(
      RECIPIENT,
      2000000000n, // 2000 USDC out
      2000000000000000000n, // 2 ETH max in
      path,
      true,
    );

    const decoded = decodeAbiParameters(
      [
        { name: "recipient", type: "address" },
        { name: "amountOut", type: "uint256" },
        { name: "amountInMax", type: "uint256" },
        { name: "path", type: "bytes" },
        { name: "payerIsUser", type: "bool" },
      ],
      encoded as `0x${string}`,
    );

    assert.equal(decoded[0].toLowerCase(), RECIPIENT.toLowerCase());
    assert.equal(decoded[1], 2000000000n);
    assert.equal(decoded[2], 2000000000000000000n);
    assert.equal(decoded[4], true);
  });
});

// ---------------------------------------------------------------------------
// encodePermit2Permit
// ---------------------------------------------------------------------------

describe("encodePermit2Permit", () => {
  it("encodes permit2 single permit", () => {
    const fakeSig = "0x" + "ab".repeat(65); // 65-byte signature
    const encoded = encodePermit2Permit(
      USDC,
      1000000000n, // amount
      1700000000, // expiration
      0, // nonce
      UNIVERSAL_ROUTER_ADDRESS,
      1700000000n, // sigDeadline
      fakeSig,
    );

    assert.ok(encoded.startsWith("0x"));
    // Should be decodable (just check it doesn't throw)
    const decoded = decodeAbiParameters(
      [
        {
          name: "permitSingle",
          type: "tuple",
          components: [
            {
              name: "details",
              type: "tuple",
              components: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
              ],
            },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
        },
        { name: "signature", type: "bytes" },
      ],
      encoded as `0x${string}`,
    );

    assert.equal(decoded[0].details.token.toLowerCase(), USDC.toLowerCase());
    assert.equal(decoded[0].details.amount, 1000000000n);
    assert.equal(decoded[0].spender.toLowerCase(), UNIVERSAL_ROUTER_ADDRESS.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// encodeExecute
// ---------------------------------------------------------------------------

describe("encodeExecute", () => {
  it("encodes a single-command execute call", () => {
    const path = encodeV3Path([WETH, USDC], [3000]);
    const swapInput = encodeV3SwapExactIn(RECIPIENT, 1000000000000000000n, 0n, path, true);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

    const calldata = encodeExecute([Commands.V3_SWAP_EXACT_IN], [swapInput], deadline);

    assert.ok(calldata.startsWith("0x"));

    // Decode the function call
    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calldata as `0x${string}`,
    });

    assert.equal(decoded.functionName, "execute");
    const [commands, inputs, decodedDeadline] = decoded.args;

    // Commands should be 0x00 (V3_SWAP_EXACT_IN)
    assert.equal(commands, "0x00");
    assert.equal(inputs.length, 1);
    assert.equal(decodedDeadline, deadline);
  });

  it("encodes a two-command execute call (permit2 + swap)", () => {
    const fakeSig = "0x" + "cd".repeat(65);
    const permitInput = encodePermit2Permit(
      USDC,
      1000000000n,
      1700000000,
      0,
      UNIVERSAL_ROUTER_ADDRESS,
      1700000000n,
      fakeSig,
    );

    const path = encodeV3Path([USDC, WETH], [3000]);
    const swapInput = encodeV3SwapExactIn(RECIPIENT, 1000000000n, 0n, path, true);
    const deadline = 1700001800n;

    const calldata = encodeExecute(
      [Commands.PERMIT2_PERMIT, Commands.V3_SWAP_EXACT_IN],
      [permitInput, swapInput],
      deadline,
    );

    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calldata as `0x${string}`,
    });

    const [commands, inputs] = decoded.args;
    // 0x0a (PERMIT2) + 0x00 (V3_SWAP_EXACT_IN) = 0x0a00
    assert.equal(commands, "0x0a00");
    assert.equal(inputs.length, 2);
  });

  it("throws when commands and inputs length mismatch", () => {
    assert.throws(
      () => encodeExecute([Commands.V3_SWAP_EXACT_IN], [], 0n),
      /same length/,
    );
  });
});

// ---------------------------------------------------------------------------
// buildExactInSingle (high-level)
// ---------------------------------------------------------------------------

describe("buildExactInSingle", () => {
  it("builds complete calldata for ETH → USDC single-hop swap", () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const calldata = buildExactInSingle({
      recipient: RECIPIENT,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 3000,
      amountIn: 1000000000000000000n, // 1 ETH
      amountOutMin: 1800000000n, // 1800 USDC
      deadline,
    });

    // Should decode as execute() with one V3_SWAP_EXACT_IN command
    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calldata as `0x${string}`,
    });

    assert.equal(decoded.functionName, "execute");
    const [commands, inputs, decodedDeadline] = decoded.args;
    assert.equal(commands, "0x00"); // V3_SWAP_EXACT_IN
    assert.equal(inputs.length, 1);
    assert.equal(decodedDeadline, deadline);

    // Decode the inner swap input
    const swapDecoded = decodeAbiParameters(
      [
        { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMin", type: "uint256" },
        { name: "path", type: "bytes" },
        { name: "payerIsUser", type: "bool" },
      ],
      inputs[0],
    );

    assert.equal(swapDecoded[0].toLowerCase(), RECIPIENT.toLowerCase());
    assert.equal(swapDecoded[1], 1000000000000000000n);
    assert.equal(swapDecoded[2], 1800000000n);
    assert.equal(swapDecoded[4], true);
  });
});

// ---------------------------------------------------------------------------
// buildExactOutSingle (high-level)
// ---------------------------------------------------------------------------

describe("buildExactOutSingle", () => {
  it("builds complete calldata for exact-output swap", () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const calldata = buildExactOutSingle({
      recipient: RECIPIENT,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 3000,
      amountOut: 2000000000n, // 2000 USDC
      amountInMax: 2000000000000000000n, // 2 ETH max
      deadline,
    });

    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calldata as `0x${string}`,
    });

    assert.equal(decoded.args[0], "0x01"); // V3_SWAP_EXACT_OUT
    assert.equal(decoded.args[1].length, 1);
  });
});

// ---------------------------------------------------------------------------
// buildExactInWithPermit2 (high-level)
// ---------------------------------------------------------------------------

describe("buildExactInWithPermit2", () => {
  it("builds calldata with PERMIT2_PERMIT + V3_SWAP_EXACT_IN", () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const fakeSig = "0x" + "ff".repeat(65);

    const calldata = buildExactInWithPermit2({
      recipient: RECIPIENT,
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000,
      amountIn: 2000000000n, // 2000 USDC
      amountOutMin: 900000000000000000n, // 0.9 ETH
      deadline,
      permit2: {
        token: USDC,
        amount: 2000000000n,
        expiration: 1700000000,
        nonce: 0,
        spender: UNIVERSAL_ROUTER_ADDRESS,
        sigDeadline: deadline,
        signature: fakeSig,
      },
    });

    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calldata as `0x${string}`,
    });

    // commands = 0x0a (PERMIT2) + 0x00 (SWAP_EXACT_IN) = 0x0a00
    assert.equal(decoded.args[0], "0x0a00");
    assert.equal(decoded.args[1].length, 2);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("has correct Universal Router address", () => {
    assert.equal(UNIVERSAL_ROUTER_ADDRESS, "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD");
  });

  it("has correct command bytes", () => {
    assert.equal(Commands.V3_SWAP_EXACT_IN, 0x00);
    assert.equal(Commands.V3_SWAP_EXACT_OUT, 0x01);
    assert.equal(Commands.PERMIT2_PERMIT, 0x0a);
  });

  it("MSG_SENDER is address(1)", () => {
    assert.equal(MSG_SENDER, "0x0000000000000000000000000000000000000001");
  });
});
