/**
 * Shared interfaces for wallet-connect-skill.
 */

export interface Session {
  accounts: string[];
  chains?: string[];
  peerName: string;
  authenticated?: boolean;
  authAddress?: string;
  authNonce?: string;
  authSignature?: string;
  authTimestamp?: string;
  createdAt: string;
  updatedAt?: string;
}

export type Sessions = Record<string, Session>;

export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
}

export interface TokenConfig {
  name: string;
  decimals: number;
  addresses: Record<string, string>;
}

export interface ParsedArgs {
  topic?: string;
  address?: string;
  message?: string;
  chain?: string;
  chains?: string;
  to?: string;
  out?: string;
  amount?: string;
  token?: string;
  data?: string;
  all?: boolean;
  clean?: boolean;
  help?: boolean;
}

export interface Eip712TypeEntry {
  name: string;
  type: string;
}

export interface TypedData {
  domain: Record<string, unknown>;
  types: Record<string, Eip712TypeEntry[]>;
  message: Record<string, unknown>;
  primaryType?: string;
}

export interface BalanceEntry {
  token: string;
  balance?: string;
  raw?: string;
  error?: string;
}

export interface BalanceResult {
  chain: string;
  address: string;
  balances: BalanceEntry[];
  error?: string;
}
