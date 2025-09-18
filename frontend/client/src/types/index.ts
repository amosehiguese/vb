import { z } from "zod";

// Bot Configuration Schema
export const botConfigSchema = z.object({
  id: z.string().optional(),
  rpcUrl: z.string(),
  mainWalletPrivateKey: z.string(),
  bonkProgramId: z.string(),
  pumpProgramId: z.string(),
  isActive: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// User Sessions Schema
export const userSessionSchema = z.object({
  id: z.string().optional(),
  userWallet: z.string(), // User's funding wallet address
  fundingAmount: z.string(), // SOL deposited (decimal as string)
  availableBalance: z.string(), // 75% for trading (decimal as string)
  revenueCollected: z.string().default("0"), // 25% revenue (decimal as string)
  revenueWallet: z.string().default("8oj8bJ43BPE7818Pj3CAUnAe5gqGHHMKTCiMF4aCEtW6"),
  minDeposit: z.string().default("0.15"), // 0.15 SOL minimum (decimal as string)
  isActive: z.boolean().default(false), // Only active when funded
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// Tokens Schema
export const tokenSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  name: z.string(),
  type: z.enum(['spl', 'bonkfun', 'pumpfun']),
  mint: z.string().optional(), // for SPL tokens
  bonding: z.string().optional(), // for bonkfun/pumpfun tokens
  userWallet: z.string(), // Owner of this token config
  volumeGenerated: z.string().default("0"), // decimal as string
  totalSpent: z.string().default("0"), // Total SOL used for this token (decimal as string)
  isActive: z.boolean().default(false), // Only active when session is funded
  createdAt: z.string().optional(),
});

// Transactions Schema
export const transactionSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  tokenId: z.string().optional(),
  type: z.enum(['jupiter_swap', 'bonk_bond', 'pump_bond', 'revenue_collection']),
  walletAddress: z.string(),
  signature: z.string().optional(),
  amount: z.string().default("0"), // decimal as string
  revenueGenerated: z.string().default("0"), // decimal as string
  status: z.enum(['success', 'failed', 'pending', 'critical_failure']),
  errorMessage: z.string().optional(),
  error: z.string().optional(), // Additional error field for detailed logging
  timestamp: z.string().optional(),
});

// Bot Metrics Schema
export const botMetricsSchema = z.object({
  id: z.string().optional(),
  totalTransactions: z.number().default(0),
  successfulTransactions: z.number().default(0),
  failedTransactions: z.number().default(0),
  volumeGenerated: z.string().default("0"), // decimal as string
  activeTokens: z.number().default(0),
  lastUpdated: z.string().optional(),
});

// Wallet Balances Schema
export const walletBalanceSchema = z.object({
  id: z.string().optional(),
  address: z.string(),
  balance: z.string().default("0"), // decimal as string
  lastUpdated: z.string().optional(),
});

// WebSocket Message Schema - More flexible to handle various message formats
export const webSocketMessageSchema = z.object({
  type: z.enum([
    'bot_status',
    'transaction_completed', 
    'session_stats',
    'connection',
    'error',
    'wallet_balance_update',
    'new_transaction',
    'metrics_update',
    'all_sessions_update'
  ]),
  sessionId: z.string().optional(),
  amount: z.string().optional(),
  signature: z.string().optional(),
  status: z.string().optional(),
  transactions: z.number().optional(),
  volume: z.number().optional(),
  message: z.string().optional(),
  timestamp: z.string().optional(),
  payload: z.record(z.any()).optional(),
  data: z.record(z.any()).optional(),
  sessions: z.array(z.any()).optional(),
  totalSessions: z.number().optional(),
  totalTransactions: z.number().optional(),
  totalVolume: z.number().optional(),
});

// Insert Schemas (for creating new records)
export const insertBotConfigSchema = botConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSessionSchema = userSessionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTokenSchema = tokenSchema.omit({
  id: true,
  createdAt: true,
});

export const insertTransactionSchema = transactionSchema.omit({
  id: true,
  timestamp: true,
});

export const insertBotMetricsSchema = botMetricsSchema.omit({
  id: true,
  lastUpdated: true,
});

export const insertWalletBalanceSchema = walletBalanceSchema.omit({
  id: true,
  lastUpdated: true,
});

// Type exports
export type BotConfig = z.infer<typeof botConfigSchema>;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;

export type UserSession = z.infer<typeof userSessionSchema>;
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;

export type Token = z.infer<typeof tokenSchema>;
export type InsertToken = z.infer<typeof insertTokenSchema>;

export type Transaction = z.infer<typeof transactionSchema>;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

export type BotMetrics = z.infer<typeof botMetricsSchema>;
export type InsertBotMetrics = z.infer<typeof insertBotMetricsSchema>;

export type WalletBalance = z.infer<typeof walletBalanceSchema>;
export type InsertWalletBalance = z.infer<typeof insertWalletBalanceSchema>;

export type WebSocketMessage = z.infer<typeof webSocketMessageSchema>;

// Legacy interface for backward compatibility (matches original WebSocketMessage interface)
export interface WebSocketMessageInterface {
  type: 'bot_status' | 'transaction_completed' | 'session_stats' | 'connection' | 'error' | 'wallet_balance_update' | 'new_transaction' | 'metrics_update' | 'all_sessions_update';
  sessionId?: string;
  amount?: string;
  signature?: string;
  status?: string;
  transactions?: number;
  volume?: number;
  message?: string;
  timestamp?: string;
  payload?: Record<string, any>;
  data?: Record<string, any>;
  sessions?: any[];
  totalSessions?: number;
  totalTransactions?: number;
  totalVolume?: number;
}

// Additional utility types for better error handling
export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

// Recovery session type for backup dashboard
export interface RecoverySession {
  id: string;
  status: 'idle' | 'in-progress' | 'completed' | 'failed';
  progress: number;
  message: string;
  errors: string[];
}

// Backup status type
export interface BackupStatus {
  lastBackup: string | null;
  interval: number;
  retention: number;
  isEnabled: boolean;
}
