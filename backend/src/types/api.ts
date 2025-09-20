import { z } from 'zod';
import { FundingTierName } from './session';

// Request schemas
export const validateTokenRequestSchema = z.object({
  contractAddress: z.string().min(32).max(44)
});

export const createSessionRequestSchema = z.object({
  contractAddress: z.string().min(32).max(44),
  tokenSymbol: z.string().optional()
});

// Response types
export interface TokenValidationResponse {
  success: boolean;
  valid: boolean;
  contractAddress: string;
  token: {
    symbol: string;
    name: string;
    decimals: number;
    supply: string;
  };
  primaryDex: string;
  liquidityUsd: number;
  pools: PoolInfo[];
  bestPool: BestPoolInfo;
  error?: string;
}

export interface SessionCreationResponse {
  success: boolean;
  sessionId: string;
  wallet: {
    publicKey: string;
  };
  userWallet: {
    address: string;
    privateKey: string; // Only in response, encrypted in DB
  };
  token: {
    contractAddress: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  primaryDex: string;
  fundingTier: FundingTierName;
  tierConfig: {
    name: string;
    description: string;
    minFunding: number;
    maxFunding: number;
  };
  instructions: TradingInstruction[];
  estimatedTrades: number;
  createdAt: Date;
  error?: string;
}

export interface PoolInfo {
  address: string;
  dex: string;
  liquidity: number;
  volume24h: number;
  priceUsd: number;
  verified: boolean;
}

export interface BestPoolInfo {
  address: string;
  dex: string;
  liquidity: number;
  volume24h: number;
  priceUsd: number;
  reason: string;
}

export interface TradingInstruction {
  step: number;
  action: string;
  description: string;
  minimumAmount: number;
}

export interface AutoTradingConfig {
  enabled: boolean;
  minDeposit: number;
  targetDepletion: number;
  revenuePercentage: number;
  tradingInterval: number;
  isPrivileged: boolean;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, any>;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: string;
}

// Request types
export type ValidateTokenRequest = z.infer<typeof validateTokenRequestSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;