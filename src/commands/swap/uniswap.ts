/**
 * Uniswap Trade API adapter — EVM swap provider.
 */

import { requestWithTimeout } from "../../helpers.js";
import { loadSessions } from "../../storage.js";
import { requireSession } from "../../helpers.js";
import type {
  SwapProvider,
  SwapRequest,
  SwapOrder,
  SwapResult,
  ResolvedToken,
} from "./lib.js";
import { resolveTokenFromRegistry, explorerUrl } from "./lib.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const API_KEY = process.env.UNISWAP_API_KEY ?? "XHr6wiQY0GVXwqTmQyW83Prk8vJCgIENlpuwCGuTlhQ";

const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

const CHAIN_ID_MAP: Record<string, number> = {
  "eip155:1": 1,
  "eip155:42161": 42161,
  "eip155:8453": 8453,
  "eip155:10": 10,
  "eip155:137": 137,
};

const NATIVE_SYMBOLS: Record<string, string> = {
  "eip155:1": "ETH",
  "eip155:42161": "ETH",
  "eip155:8453": "ETH",
  "eip155:10": "ETH",
  "eip155:137": "POL",
};

// ---------------------------------------------------------------------------
// Raw API response type
// ---------------------------------------------------------------------------

interface UniswapQuoteResponse {
  quote?: {
    input?: { amount: string; token: string };
    output?: { amount: string; token: string; minimumAmount: string };
    gasFeeUSD?: string;
    priceImpact?: string;
  };
  methodParameters?: { calldata: string; value: string; to: string };
  routing?: string;
  requestId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const uniswap: SwapProvider = {
  name: "Uniswap",
  supportedChains: Object.keys(CHAIN_ID_MAP),

  nativeSymbol(chainId: string): string {
    return NATIVE_SYMBOLS[chainId] ?? "ETH";
  },

  placeholderSwapper(): string {
    return "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth
  },

  resolveToken(symbol: string, chainId: string): ResolvedToken {
    const native = this.nativeSymbol(chainId);
    if (symbol.toUpperCase() === native.toUpperCase() || symbol.toUpperCase() === "ETH") {
      return { address: NATIVE_ADDRESS, decimals: 18, symbol: native };
    }
    return resolveTokenFromRegistry(symbol, chainId);
  },

  async fetchOrder(req: SwapRequest): Promise<SwapOrder> {
    const numericChainId = CHAIN_ID_MAP[req.chainId];
    if (!numericChainId) throw new Error(`Unsupported EVM chain: ${req.chainId}`);

    const body: Record<string, unknown> = {
      type: "EXACT_INPUT",
      amount: req.rawAmount,
      tokenInChainId: numericChainId,
      tokenOutChainId: numericChainId,
      tokenIn: req.tokenIn.address,
      tokenOut: req.tokenOut.address,
      swapper: req.swapper,
      autoSlippage: "DEFAULT",
      routingPreference: "BEST_PRICE",
      generatePermitAsTransaction: false,
    };

    if (req.slippage && req.slippage !== "auto") {
      body.autoSlippage = undefined;
      body.slippageTolerance = Number(req.slippage) / 100;
    }

    const feeBps = Number(process.env.UNISWAP_FEE_BPS ?? "25");
    const feeRecipient =
      process.env.UNISWAP_FEE_RECIPIENT ?? "0x349862C428A86660826966fDbC6a2b5A03c57420";
    if (feeBps > 0) {
      body.integratorFees = [{ bips: feeBps, recipient: feeRecipient }];
    }

    const response = await fetch(`${API_BASE}/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "x-universal-router-version": "2.0",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Uniswap API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as UniswapQuoteResponse;
    const q = data.quote ?? {};
    const mp = data.methodParameters;

    return {
      quote: {
        inAmount: q.input?.amount ?? req.rawAmount,
        outAmount: q.output?.amount ?? "0",
        outAmountMin: q.output?.minimumAmount,
        priceImpact: q.priceImpact ?? null,
        gasEstimate: q.gasFeeUSD ?? null,
        router: data.routing ?? null,
        requestId: data.requestId ?? null,
        providerMeta: feeBps > 0 ? { integratorFee: { bips: feeBps, recipient: feeRecipient } } : {},
      },
      execution: mp
        ? { data: mp.calldata, to: mp.to, value: mp.value }
        : null,
    };
  },

  async execute(order, req, client, topic): Promise<SwapResult | null> {
    const exec = order.execution;
    if (!exec || !exec.data || !exec.to) {
      throw new Error("Uniswap API did not return execution calldata");
    }

    const sessions = loadSessions();
    requireSession(sessions, topic);

    const tx: Record<string, string> = {
      from: req.swapper,
      to: exec.to,
      data: exec.data,
    };

    if (exec.value && exec.value !== "0x0" && exec.value !== "0x00" && exec.value !== "0") {
      tx.value = exec.value;
    } else if (req.tokenIn.address === NATIVE_ADDRESS) {
      tx.value = "0x" + BigInt(req.rawAmount).toString(16);
    }

    try {
      const txHash = (await requestWithTimeout(client, {
        topic,
        chainId: req.chainId,
        request: {
          method: "eth_sendTransaction",
          params: [tx],
        },
      })) as string;

      return {
        txHash,
        explorer: explorerUrl(req.chainId, txHash),
      };
    } catch (err) {
      if ((err as Error).message.includes("timed out") || (err as Error).message.includes("rejected")) {
        return null;
      }
      throw err;
    }
  },
};
