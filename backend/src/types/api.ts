import { z } from 'zod';
import { FundingTierName } from './session';
import { TokenMetadata } from './token';
import { TradingVenue } from './trading';

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
  availableVenues?: TradingVenue[]; 
  error?: string;
}

export interface SessionCreationRequest {
  contractAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  primaryDex?: string;
  decimals?: number;
  fundingTierName: string;
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

export interface SessionStatusResponse {
  success: boolean;
  session: {
    sessionId: string;
    status: string;
    walletAddress: string;
    balance: number;
    contractAddress: string;
    tokenSymbol: string;
    fundingTier: string;
    autoTradingActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
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

export interface TradeExecutionRequest {
  sessionId: string;
  type: 'buy' | 'sell';
  amount?: number;
  slippage?: number;
}

export interface TradeExecutionResponse {
  success: boolean;
  signature?: string;
  amountIn: number;
  amountOut: number;
  priceImpact: number;
  fees: number;
  venue?: string; // NEW
  timestamp: Date;
  error?: string;
}

export interface SessionValidationResponse {
  valid: boolean;
  session: any;
  errors: string[];
  canTrade: boolean;
  fundingRequired: number;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, any>;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  uptime: number;
  version: string;
  services: {
    database: 'connected' | 'disconnected';
    solana: 'connected' | 'disconnected';
    jupiter: 'connected' | 'disconnected';
    raydium: 'connected' | 'disconnected'; // NEW
  };
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  error?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: any;
  timestamp: Date;
}

// Request types
export type ValidateTokenRequest = z.infer<typeof validateTokenRequestSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;