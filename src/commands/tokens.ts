/**
 * Token registry -- centralized metadata for ERC-20 and SPL tokens.
 */

import type { TokenConfig, Token } from "../types.js";

export const TOKENS: Record<string, TokenConfig> = {
  USDC: {
    name: "USD Coin",
    decimals: 6,
    addresses: {
      "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "eip155:10": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
  },
  USDT: {
    name: "Tether USD",
    decimals: 6,
    addresses: {
      "eip155:1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "eip155:10": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
      "eip155:137": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      "eip155:56": "0x55d398326f99059fF775485246999027B3197955",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    },
  },
  WETH: {
    name: "Wrapped Ether",
    decimals: 18,
    addresses: {
      "eip155:1": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "eip155:42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "eip155:8453": "0x4200000000000000000000000000000000000006",
      "eip155:10": "0x4200000000000000000000000000000000000006",
      "eip155:137": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    },
  },
  DAI: {
    name: "Dai Stablecoin",
    decimals: 18,
    addresses: {
      "eip155:1": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      "eip155:42161": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      "eip155:8453": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      "eip155:10": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      "eip155:137": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    },
  },
  WBTC: {
    name: "Wrapped Bitcoin",
    decimals: 8,
    addresses: {
      "eip155:1": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      "eip155:42161": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      "eip155:10": "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
      "eip155:137": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    },
  },
};

export function getTokenAddress(symbol: string, chainId: string): string | null {
  return TOKENS[symbol]?.addresses?.[chainId] || null;
}

export function getTokenDecimals(symbol: string): number {
  return TOKENS[symbol]?.decimals ?? 18;
}

export function isSplToken(symbol: string, chainId: string): boolean {
  return chainId.startsWith("solana:") && !!getTokenAddress(symbol, chainId);
}

export function getTokensForChain(chainId: string): Token[] {
  const result: Token[] = [];
  for (const [symbol, token] of Object.entries(TOKENS)) {
    if (token.addresses[chainId]) {
      result.push({ symbol, ...token, address: token.addresses[chainId] });
    }
  }
  return result;
}
