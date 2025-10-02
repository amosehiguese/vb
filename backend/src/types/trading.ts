import { PublicKey, Transaction } from '@solana/web3.js';

export interface TradeParams {
  sessionId: string;
  tokenAddress: string;
  walletKeypair: any; // Keypair type
  type: TradeType;
  amount: number; // in SOL for buy, in tokens for sell
  slippage: number;
  poolAddress?: string;
  dex: DexType;
}

export interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  transaction?: Transaction;
  amountIn: number;
  amountOut: number;
  priceImpact: number;
  actualSlippage: number;
  fees: number;
  timestamp: Date;
  venue?: string;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: RoutePlan[];
  contextSlot: number;
  timeTaken: number;
}

export interface TradingVenue {
  dex: 'jupiter' | 'raydium';
  tradable: boolean;
  priority: number;
  quote?: any;
}

export interface LiquidityAvailability {
  tradable: boolean;
  venues: TradingVenue[];
  preferredVenue: string | null;
  error?: string;
}

export interface RaydiumQuote {
  poolInfo: any;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  priceImpact: number;
  venue: 'raydium';
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  amountOut: number;
  priceImpact: number;
  venue?: string;
  error?: string;
}

export interface TradingStrategy {
  name: string;
  description: string;
  targetDepletion: number; // Percentage of total balance to use (75%)
  tradeSizeRange: {
    min: number;
    max: number;
  };
  intervalRange: {
    min: number; // milliseconds
    max: number; // milliseconds  
  };
  maxConsecutiveSameTrades: number;
  emergencyStopConditions: EmergencyStopCondition[];
}

export interface AutoTradingState {
  sessionId: string;
  status: TradingStatus;
  tradingStatus?: string;
  isLoopRunning: boolean;
  currentBalance: number;
  totalTrades: number;
  lastTradeAt?: Date;
  nextTradeAt?: Date;
  pauseReason?: string;
  errors: TradingError[];
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterSwapResponse {
  txid: string;
  inAmount: number;
  outAmount: number;
  priceImpact: number;
  error?: string;
}

export interface SwapInstruction {
  programId: PublicKey;
  accounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: Buffer;
}

export interface TradingStrategy {
  name: string;
  minTradeSize: number;
  maxTradeSize: number;
  tradeInterval: number; // milliseconds
  buyFrequency: number; // percentage (e.g., 60 = 60% buy, 40% sell)
  slippageTolerance: number;
  stopLossPercentage?: number;
  maxConsecutiveFailures: number;
}

export interface TradingSession {
  sessionId: string;
  isActive: boolean;
  strategy: TradingStrategy;
  stats: TradingStats;
  lastTradeAt?: Date;
  nextTradeAt?: Date;
  pauseReason?: string;
  errors: TradingError[];
}

export interface TradingStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolume: number;
  totalFees: number;
  averageTradeSize: number;
  averageSlippage: number;
  profitLoss: number;
  winRate: number;
  largestTrade: number;
  smallestTrade: number;
  tradingDuration: number; // milliseconds
}

export interface TradingError {
  timestamp: Date;
  type: TradingErrorType;
  message: string;
  tradeParams?: Partial<TradeParams>;
  recoverable: boolean;
}

export interface MarketData {
  tokenAddress: string;
  price: number;
  volume24h: number;
  liquidity: number;
  priceChange24h: number;
  lastUpdated: Date;
  source: DexType;
}

export interface BalanceSnapshot {
  timestamp: Date;
  solBalance: number;
  tokenBalance: number;
  totalValueUsd: number;
  sessionId: string;
}

export enum TradeType {
  BUY = 'buy',
  SELL = 'sell',
  UNKNOWN = 'unknown'
}

export enum DexType {
  JUPITER = 'jupiter',
  RAYDIUM = 'raydium',
  ORCA = 'orca',
  SERUM = 'serum'
}

export enum TradingErrorType {
  INSUFFICIENT_BALANCE = 'insufficient_balance',
  SLIPPAGE_EXCEEDED = 'slippage_exceeded',
  NETWORK_ERROR = 'network_error',
  TRANSACTION_FAILED = 'transaction_failed',
  QUOTE_FAILED = 'quote_failed',
  POOL_NOT_FOUND = 'pool_not_found',
  RATE_LIMITED = 'rate_limited',
  UNKNOWN_ERROR = 'unknown_error'
}

export enum TradingStatus {
  IDLE = 'idle',
  ACTIVE = 'active',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export interface AutoTradingConfig {
  enabled: boolean;
  strategy: TradingStrategy;
  targetDepletion: number; // 75%
  revenuePercentage: number; // 25%
  monitoringInterval: number;
  balanceCheckInterval: number;
  emergencyStopConditions: EmergencyStopCondition[];
}

export interface EmergencyStopCondition {
  type: 'max_consecutive_failures' | 'min_balance' | 'max_slippage' | 'time_limit';
  threshold: number;
  enabled: boolean;
}

export interface TradeSizeCalculator {
  calculateBuyAmount(availableBalance: number, strategy: TradingStrategy): number;
  calculateSellAmount(tokenBalance: number, strategy: TradingStrategy): number;
  adjustForSlippage(amount: number, slippage: number, type: TradeType): number;
}

export interface PriceOracle {
  getCurrentPrice(tokenAddress: string): Promise<number>;
  getPriceHistory(tokenAddress: string, hours: number): Promise<number[]>;
  subscribeToPrice(tokenAddress: string, callback: (price: number) => void): void;
  unsubscribe(tokenAddress: string): void;
}