import { Keypair } from '@solana/web3.js';

export interface WalletInfo {
  publicKey: string;
  address: string;
  keypair?: Keypair; // Only in memory, never stored
  privateKey: string; // Encrypted when stored
  balance?: number;
  isPrivileged: boolean;
  minDeposit: number;
}

export interface SessionConfig {
  sessionId: string;
  contractAddress: string;
  tokenSymbol?: string;
  wallet: WalletInfo;
  tradingConfig: TradingConfiguration;
  autoTradingEnabled: boolean;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  fundedAt?: Date;
  completedAt?: Date;
}

export interface TradingConfiguration {
  minDeposit: number;
  targetDepletion: number; // 75%
  revenuePercentage: number; // 25%
  tradingInterval: number; // milliseconds
  maxSlippage: number;
  tradeSize: {
    min: number;
    max: number;
  };
  isPrivileged: boolean;
  fundingTier: FundingTierName;
}

export enum SessionStatus {
  CREATED = 'created',
  FUNDING_DETECTED = 'funding_detected',
  FUNDED = 'funded', 
  TRADING = 'trading',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export interface FundingEvent {
  sessionId: string;
  walletAddress: string;
  amount: number;
  signature: string;
  blockTime: Date;
  detectedAt: Date;
}

export interface SessionMetrics {
  sessionId: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolume: number;
  totalFees: number;
  currentBalance: number;
  initialBalance: number;
  depletionPercentage: number;
  averageTradeSize: number;
  tradingDuration: number; // milliseconds
  lastTradeAt?: Date;
}

export interface AutoTradingState {
  sessionId: string;
  isLoopActive: boolean;
  status: SessionStatus; 
  tradingStatus?: string; 
  lastTradeAt: Date | null;
}

export interface SessionCreationData {
  contractAddress: string;
  tokenSymbol?: string;
  isPrivileged?: boolean;
  customMinDeposit?: number;
}

export interface SessionValidationResult {
  valid: boolean;
  session: SessionConfig | null;
  errors: string[];
  canTrade: boolean;
  fundingRequired: number;
}

export type FundingTierName = 'micro' | 'small' | 'standard' | 'high';

export interface FundingTier {
  name: FundingTierName;
  minFunding: number;
  maxFunding: number;
  buyPercentageMin: number;
  buyPercentageMax: number;
  sellPercentageMin: number;
  sellPercentageMax: number;
  minBuyUSD?: number;
  maxBuyUSD: number;
  description: string;
}