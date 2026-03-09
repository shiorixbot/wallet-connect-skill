/**
 * Jupiter Ultra API adapter — Solana swap provider.
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

const API_BASE = "https://api.jup.ag/ultra/v1";
const API_KEY = process.env.JUPITER_API_KEY ?? "";

const SOL_NATIVE_MINT = "So11111111111111111111111111111111111111112";
const SOLANA_CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// ---------------------------------------------------------------------------
// Raw API response types
// ---------------------------------------------------------------------------

interface JupiterOrderResponse {
  transaction?: string;
  requestId?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpact?: number;
  feeBps?: number;
  router?: string;
  errorCode?: number;
  errorMessage?: string;
}

interface JupiterExecuteResponse {
  status: string;
  signature?: string;
  code?: number;
  totalOutputAmount?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

export const jupiter: SwapProvider = {
  name: "Jupiter",
  supportedChains: [SOLANA_CHAIN_ID],

  nativeSymbol(): string {
    return "SOL";
  },

  placeholderSwapper(): string | null {
    return null; // Jupiter requires a real taker address
  },

  resolveToken(symbol: string, chainId: string): ResolvedToken {
    if (symbol.toUpperCase() === "SOL") {
      return { address: SOL_NATIVE_MINT, decimals: 9, symbol: "SOL" };
    }
    return resolveTokenFromRegistry(symbol, chainId);
  },

  async fetchOrder(req: SwapRequest): Promise<SwapOrder> {
    const params = new URLSearchParams({
      inputMint: req.tokenIn.address,
      outputMint: req.tokenOut.address,
      amount: req.rawAmount,
    });

    if (req.swapper) {
      params.set("taker", req.swapper);
    }

    const referralAccount = process.env.JUPITER_REFERRAL_ACCOUNT;
    const referralFee = process.env.JUPITER_REFERRAL_FEE;
    if (referralAccount) {
      params.set("referralAccount", referralAccount);
      if (referralFee) params.set("referralFee", referralFee);
    }

    const response = await fetch(`${API_BASE}/order?${params.toString()}`, {
      method: "GET",
      headers: apiHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jupiter API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as JupiterOrderResponse;
    if (data.errorCode) {
      throw new Error(`Jupiter error ${data.errorCode}: ${data.errorMessage}`);
    }

    return {
      quote: {
        inAmount: data.inAmount ?? req.rawAmount,
        outAmount: data.outAmount ?? "0",
        priceImpact: data.priceImpact != null ? String(data.priceImpact) : null,
        gasEstimate: null,
        router: data.router ?? null,
        requestId: data.requestId ?? null,
        providerMeta: {
          feeBps: data.feeBps ?? null,
        },
      },
      execution: data.transaction && data.requestId
        ? { data: data.transaction, requestId: data.requestId }
        : null,
    };
  },

  async execute(order, req, client, topic): Promise<SwapResult | null> {
    const exec = order.execution;
    if (!exec || !exec.data || !exec.requestId) {
      throw new Error("Jupiter API did not return a transaction");
    }

    const sessions = loadSessions();
    requireSession(sessions, topic);

    // Step 1: Sign via WalletConnect
    let signedTransaction: string;
    try {
      const result = await requestWithTimeout(client, {
        topic,
        chainId: req.chainId,
        request: {
          method: "solana_signTransaction",
          params: { transaction: exec.data },
        },
      });

      const resultObj = result as { signature?: string; transaction?: string } | string;
      if (typeof resultObj === "string") {
        signedTransaction = resultObj;
      } else if (resultObj.transaction) {
        signedTransaction = resultObj.transaction;
      } else {
        throw new Error("Wallet did not return a signed transaction");
      }
    } catch (err) {
      if ((err as Error).message.includes("timed out") || (err as Error).message.includes("rejected")) {
        return null;
      }
      throw err;
    }

    // Step 2: Submit to Jupiter /execute
    const execResponse = await fetch(`${API_BASE}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiHeaders() },
      body: JSON.stringify({
        signedTransaction,
        requestId: exec.requestId,
      }),
    });

    if (!execResponse.ok) {
      const text = await execResponse.text();
      throw new Error(`Jupiter execute error ${execResponse.status}: ${text}`);
    }

    const execResult = (await execResponse.json()) as JupiterExecuteResponse;

    if (execResult.status !== "Success") {
      throw new Error(execResult.error ?? `Jupiter execution failed (code ${execResult.code})`);
    }

    const txHash = execResult.signature ?? "";
    return {
      txHash,
      explorer: explorerUrl(req.chainId, txHash),
      actualOutAmount: execResult.totalOutputAmount,
    };
  },
};
