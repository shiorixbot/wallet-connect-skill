/**
 * Universal Router calldata builder for Uniswap V3 swaps.
 *
 * Encodes `execute(bytes commands, bytes[] inputs, uint256 deadline)` calls
 * for V3_SWAP_EXACT_IN, V3_SWAP_EXACT_OUT, and PERMIT2_PERMIT commands.
 *
 * Reference: https://docs.uniswap.org/contracts/universal-router/overview
 */

import { encodeAbiParameters, encodeFunctionData } from "viem";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Universal Router v2 on Ethereum mainnet */
export const UNIVERSAL_ROUTER_ADDRESS = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

/** Universal Router command bytes */
export const Commands = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_PERMIT: 0x0a,
} as const;

/** Sentinel for "msg.sender" as recipient in Universal Router commands */
export const MSG_SENDER = "0x0000000000000000000000000000000000000001";

/** Sentinel for "router itself" as recipient */
export const ROUTER_ADDRESS = "0x0000000000000000000000000000000000000002";

// ---------------------------------------------------------------------------
// V3 path encoding
// ---------------------------------------------------------------------------

/**
 * Encode a Uniswap V3 swap path.
 *
 * Path format: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes) [+ fee + token2 ...]
 *
 * @param tokens - Array of token addresses (at least 2)
 * @param fees - Array of pool fees in hundredths of a bip (e.g. 3000 = 0.3%). Length = tokens.length - 1
 */
export function encodeV3Path(tokens: string[], fees: number[]): string {
  if (tokens.length < 2) throw new Error("Path must have at least 2 tokens");
  if (fees.length !== tokens.length - 1) throw new Error("fees.length must equal tokens.length - 1");

  let path = "";
  for (let i = 0; i < tokens.length; i++) {
    // 20 bytes for token address (strip 0x, lowercase, pad to 40 hex chars)
    path += tokens[i].replace("0x", "").toLowerCase().padStart(40, "0");
    if (i < fees.length) {
      // 3 bytes for fee tier (6 hex chars)
      path += fees[i].toString(16).padStart(6, "0");
    }
  }
  return "0x" + path;
}

// ---------------------------------------------------------------------------
// Command input encoding
// ---------------------------------------------------------------------------

const SWAP_EXACT_IN_PARAMS = [
  { name: "recipient", type: "address" },
  { name: "amountIn", type: "uint256" },
  { name: "amountOutMin", type: "uint256" },
  { name: "path", type: "bytes" },
  { name: "payerIsUser", type: "bool" },
] as const;

const SWAP_EXACT_OUT_PARAMS = [
  { name: "recipient", type: "address" },
  { name: "amountOut", type: "uint256" },
  { name: "amountInMax", type: "uint256" },
  { name: "path", type: "bytes" },
  { name: "payerIsUser", type: "bool" },
] as const;

const PERMIT2_PERMIT_PARAMS = [
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
] as const;

/**
 * Encode V3_SWAP_EXACT_IN command input.
 */
export function encodeV3SwapExactIn(
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  path: string,
  payerIsUser: boolean,
): string {
  return encodeAbiParameters(SWAP_EXACT_IN_PARAMS, [
    recipient as `0x${string}`,
    amountIn,
    amountOutMin,
    path as `0x${string}`,
    payerIsUser,
  ]);
}

/**
 * Encode V3_SWAP_EXACT_OUT command input.
 */
export function encodeV3SwapExactOut(
  recipient: string,
  amountOut: bigint,
  amountInMax: bigint,
  path: string,
  payerIsUser: boolean,
): string {
  return encodeAbiParameters(SWAP_EXACT_OUT_PARAMS, [
    recipient as `0x${string}`,
    amountOut,
    amountInMax,
    path as `0x${string}`,
    payerIsUser,
  ]);
}

/**
 * Encode PERMIT2_PERMIT command input.
 */
export function encodePermit2Permit(
  token: string,
  amount: bigint,
  expiration: number,
  nonce: number,
  spender: string,
  sigDeadline: bigint,
  signature: string,
): string {
  return encodeAbiParameters(PERMIT2_PERMIT_PARAMS, [
    {
      details: {
        token: token as `0x${string}`,
        amount,
        expiration,
        nonce,
      },
      spender: spender as `0x${string}`,
      sigDeadline,
    },
    signature as `0x${string}`,
  ]);
}

// ---------------------------------------------------------------------------
// Top-level execute() encoding
// ---------------------------------------------------------------------------

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

/**
 * Encode a Universal Router `execute(bytes commands, bytes[] inputs, uint256 deadline)` call.
 *
 * @param commands - Array of command byte values (e.g. [Commands.V3_SWAP_EXACT_IN])
 * @param inputs - Array of ABI-encoded input data for each command
 * @param deadline - Unix timestamp deadline
 */
export function encodeExecute(
  commands: number[],
  inputs: string[],
  deadline: bigint,
): string {
  if (commands.length !== inputs.length) {
    throw new Error("commands and inputs must have the same length");
  }

  // Pack command bytes into a single bytes value
  const commandsHex = ("0x" +
    commands.map((c) => c.toString(16).padStart(2, "0")).join("")) as `0x${string}`;

  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: "execute",
    args: [commandsHex, inputs as `0x${string}`[], deadline],
  });
}

// ---------------------------------------------------------------------------
// High-level swap builders
// ---------------------------------------------------------------------------

export interface SwapExactInParams {
  recipient: string;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: bigint;
}

/**
 * Build complete calldata for a single-hop V3 exact-input swap via the Universal Router.
 */
export function buildExactInSingle(params: SwapExactInParams): string {
  const path = encodeV3Path([params.tokenIn, params.tokenOut], [params.fee]);
  const input = encodeV3SwapExactIn(
    params.recipient,
    params.amountIn,
    params.amountOutMin,
    path,
    true,
  );
  return encodeExecute([Commands.V3_SWAP_EXACT_IN], [input], params.deadline);
}

export interface SwapExactOutParams {
  recipient: string;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountOut: bigint;
  amountInMax: bigint;
  deadline: bigint;
}

/**
 * Build complete calldata for a single-hop V3 exact-output swap via the Universal Router.
 */
export function buildExactOutSingle(params: SwapExactOutParams): string {
  // Note: V3 exact-out paths are reversed (tokenOut first)
  const path = encodeV3Path([params.tokenOut, params.tokenIn], [params.fee]);
  const input = encodeV3SwapExactOut(
    params.recipient,
    params.amountOut,
    params.amountInMax,
    path,
    true,
  );
  return encodeExecute([Commands.V3_SWAP_EXACT_OUT], [input], params.deadline);
}

export interface SwapWithPermit2Params extends SwapExactInParams {
  permit2: {
    token: string;
    amount: bigint;
    expiration: number;
    nonce: number;
    spender: string;
    sigDeadline: bigint;
    signature: string;
  };
}

/**
 * Build calldata for an ERC-20 swap that includes a PERMIT2_PERMIT command
 * before the V3_SWAP_EXACT_IN command.
 */
export function buildExactInWithPermit2(params: SwapWithPermit2Params): string {
  const p = params.permit2;
  const permitInput = encodePermit2Permit(
    p.token,
    p.amount,
    p.expiration,
    p.nonce,
    p.spender,
    p.sigDeadline,
    p.signature,
  );

  const path = encodeV3Path([params.tokenIn, params.tokenOut], [params.fee]);
  const swapInput = encodeV3SwapExactIn(
    params.recipient,
    params.amountIn,
    params.amountOutMin,
    path,
    true,
  );

  return encodeExecute(
    [Commands.PERMIT2_PERMIT, Commands.V3_SWAP_EXACT_IN],
    [permitInput, swapInput],
    params.deadline,
  );
}
