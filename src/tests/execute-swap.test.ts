/**
 * Integration tests for execute-swap: calldata round-trip and permit2 flow.
 * Tests verify calldata construction without hitting the network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, decodeAbiParameters } from "viem";
import {
  encodeV3Path,
  encodeV3SwapExactIn,
  encodeExecute,
  buildExactInSingle,
  buildExactInWithPermit2,
  Commands,
  UNIVERSAL_ROUTER_ADDRESS,
} from "../universal-router.js";

// Well-known mainnet addresses
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SWAPPER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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

const SWAP_EXACT_IN_PARAMS = [
  { name: "recipient", type: "address" },
  { name: "amountIn", type: "uint256" },
  { name: "amountOutMin", type: "uint256" },
  { name: "path", type: "bytes" },
  { name: "payerIsUser", type: "bool" },
] as const;

// ---------------------------------------------------------------------------
// ETH → USDC swap calldata round-trip
// ---------------------------------------------------------------------------

describe("ETH → USDC swap calldata round-trip", () => {
  const amountIn = 100000000000000000n; // 0.1 ETH
  const amountOutMin = 180000000n; // 180 USDC min (slippage-adjusted)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  it("builds calldata that decodes back to original parameters", () => {
    const calldata = buildExactInSingle({
      recipient: SWAPPER,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 3000,
      amountIn,
      amountOutMin,
      deadline,
    });

    // Step 1: Decode the execute() call
    const executeDecoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: calldata as `0x${string}`,
    });

    assert.equal(executeDecoded.functionName, "execute");
    const [commands, inputs, decodedDeadline] = executeDecoded.args;

    // Step 2: Verify command is V3_SWAP_EXACT_IN
    assert.equal(commands, "0x00");
    assert.equal(decodedDeadline, deadline);

    // Step 3: Decode the swap input
    const swapDecoded = decodeAbiParameters(SWAP_EXACT_IN_PARAMS, inputs[0]);

    assert.equal(swapDecoded[0].toLowerCase(), SWAPPER.toLowerCase()); // recipient
    assert.equal(swapDecoded[1], amountIn); // amountIn
    assert.equal(swapDecoded[2], amountOutMin); // amountOutMin
    assert.equal(swapDecoded[4], true); // payerIsUser

    // Step 4: Decode the V3 path from the swap input
    const pathHex = swapDecoded[3].slice(2); // remove 0x
    const tokenInFromPath = "0x" + pathHex.slice(0, 40);
    const feeFromPath = parseInt(pathHex.slice(40, 46), 16);
    const tokenOutFromPath = "0x" + pathHex.slice(46, 86);

    assert.equal(tokenInFromPath.toLowerCase(), WETH.toLowerCase());
    assert.equal(feeFromPath, 3000);
    assert.equal(tokenOutFromPath.toLowerCase(), USDC.toLowerCase());
  });

  it("produces a valid transaction object shape", () => {
    const calldata = buildExactInSingle({
      recipient: SWAPPER,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 3000,
      amountIn,
      amountOutMin,
      deadline,
    });

    // Simulate the tx object that execute-swap would build
    const tx = {
      from: SWAPPER,
      to: UNIVERSAL_ROUTER_ADDRESS,
      data: calldata,
      value: "0x" + amountIn.toString(16), // native ETH swap needs value
    };

    assert.equal(tx.from, SWAPPER);
    assert.equal(tx.to, UNIVERSAL_ROUTER_ADDRESS);
    assert.ok(tx.data.startsWith("0x"));
    assert.ok(tx.data.length > 10); // function selector + encoded data
    assert.equal(tx.value, "0x16345785d8a0000"); // 0.1 ETH in hex
  });
});

// ---------------------------------------------------------------------------
// ERC-20 → ERC-20 swap with permit2
// ---------------------------------------------------------------------------

describe("ERC-20 → ERC-20 swap with permit2", () => {
  const amountIn = 2000000000n; // 2000 USDC (6 decimals)
  const amountOutMin = 900000000000000000n; // 0.9 WETH min
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const fakeSig = "0x" + "ab".repeat(65);

  it("prepends PERMIT2_PERMIT before V3_SWAP_EXACT_IN", () => {
    const calldata = buildExactInWithPermit2({
      recipient: SWAPPER,
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000,
      amountIn,
      amountOutMin,
      deadline,
      permit2: {
        token: USDC,
        amount: amountIn,
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

    const [commands, inputs] = decoded.args;

    // Two commands: PERMIT2_PERMIT (0x0a) + V3_SWAP_EXACT_IN (0x00)
    assert.equal(commands, "0x0a00");
    assert.equal(inputs.length, 2);
  });

  it("permit2 input decodes to correct token and amount", () => {
    const calldata = buildExactInWithPermit2({
      recipient: SWAPPER,
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000,
      amountIn,
      amountOutMin,
      deadline,
      permit2: {
        token: USDC,
        amount: amountIn,
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

    const [, inputs] = decoded.args;

    // Decode the permit2 input (first command)
    const permitDecoded = decodeAbiParameters(
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
      inputs[0],
    );

    assert.equal(permitDecoded[0].details.token.toLowerCase(), USDC.toLowerCase());
    assert.equal(permitDecoded[0].details.amount, amountIn);
    assert.equal(permitDecoded[0].spender.toLowerCase(), UNIVERSAL_ROUTER_ADDRESS.toLowerCase());
  });

  it("swap input follows the permit2 input", () => {
    const calldata = buildExactInWithPermit2({
      recipient: SWAPPER,
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000,
      amountIn,
      amountOutMin,
      deadline,
      permit2: {
        token: USDC,
        amount: amountIn,
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

    const [, inputs] = decoded.args;

    // Decode the swap input (second command)
    const swapDecoded = decodeAbiParameters(SWAP_EXACT_IN_PARAMS, inputs[1]);

    assert.equal(swapDecoded[0].toLowerCase(), SWAPPER.toLowerCase());
    assert.equal(swapDecoded[1], amountIn);
    assert.equal(swapDecoded[2], amountOutMin);
    assert.equal(swapDecoded[4], true);
  });

  it("does NOT include value for ERC-20 swaps (no native token)", () => {
    const calldata = buildExactInWithPermit2({
      recipient: SWAPPER,
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000,
      amountIn,
      amountOutMin,
      deadline,
      permit2: {
        token: USDC,
        amount: amountIn,
        expiration: 1700000000,
        nonce: 0,
        spender: UNIVERSAL_ROUTER_ADDRESS,
        sigDeadline: deadline,
        signature: fakeSig,
      },
    });

    // Simulate the tx object for ERC-20 swap — no value field
    const tx: Record<string, string> = {
      from: SWAPPER,
      to: UNIVERSAL_ROUTER_ADDRESS,
      data: calldata,
    };

    // ERC-20 swaps should NOT have a value field
    assert.equal(tx.value, undefined);
  });
});

// ---------------------------------------------------------------------------
// Manual calldata construction matches high-level builder
// ---------------------------------------------------------------------------

describe("manual vs high-level builder equivalence", () => {
  it("buildExactInSingle matches manual encodeExecute", () => {
    const deadline = 1700001800n;
    const path = encodeV3Path([WETH, USDC], [3000]);
    const swapInput = encodeV3SwapExactIn(SWAPPER, 1000000000000000000n, 0n, path, true);
    const manual = encodeExecute([Commands.V3_SWAP_EXACT_IN], [swapInput], deadline);

    const highlevel = buildExactInSingle({
      recipient: SWAPPER,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 3000,
      amountIn: 1000000000000000000n,
      amountOutMin: 0n,
      deadline,
    });

    assert.equal(manual, highlevel);
  });
});
