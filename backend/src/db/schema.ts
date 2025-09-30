import { pgTable, varchar, timestamp, decimal, jsonb, uuid, integer, boolean, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
  walletAddress: varchar('wallet_address', { length: 44 }).notNull(),
  privateKey: text('private_key').notNull(), // Encrypted
  contractAddress: varchar('contract_address', { length: 44 }).notNull(),
  fundingTier: varchar('funding_tier', { length: 20 }).default('small'),
  tokenSymbol: varchar('token_symbol', { length: 20 }),
  fundingAmount: decimal('funding_amount', { precision: 18, scale: 9 }),
  lastTradeType: varchar('last_trade_type', { length: 10 }), 
  currentBalance: decimal('current_balance', { precision: 18, scale: 9 }),
  initialBalance: decimal('initial_balance', { precision: 18, scale: 9 }),
  initialFundedAmount: decimal('initial_funded_amount', { precision: 18, scale: 9 }),
  revenueTransferred: decimal('revenue_transferred', { precision: 18, scale: 9 }),
  revenueSignature: varchar('revenue_signature', { length: 88 }),
  totalTraded: decimal('total_traded', { precision: 18, scale: 9 }).default('0'),
  tradesCount: integer('trades_count').default(0),
  status: varchar('status', { length: 20 }).default('created'), // created, funded, trading, completed, stopped
  tradingStatus: varchar('trading_status', { length: 30 }).default('idle'), // e.g., idle, funding_ephemeral, sweeping
  isPrivileged: boolean('is_privileged').default(false),
  autoTradingActive: boolean('auto_trading_active').default(false),
  targetDepletion: decimal('target_depletion', { precision: 5, scale: 2 }).default('75'), // 75%
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  fundedAt: timestamp('funded_at'),
  completedAt: timestamp('completed_at')
});

export const ephemeralWallets = pgTable('ephemeral_wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  walletAddress: varchar('wallet_address', { length: 44 }).notNull().unique(),
  privateKey: text('private_key').notNull(), // Encrypted
  status: varchar('status', { length: 20 }).default('created'), // created, funded, swept, failed
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const tokens = pgTable('tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractAddress: varchar('contract_address', { length: 44 }).notNull().unique(),
  symbol: varchar('symbol', { length: 20 }),
  name: varchar('name', { length: 255 }),
  decimals: integer('decimals'),
  supply: varchar('supply', { length: 50 }),
  verified: boolean('verified').default(false),
  metadata: jsonb('metadata'),
  poolData: jsonb('pool_data'), // Store pool information
  bestPoolAddress: varchar('best_pool_address', { length: 44 }),
  primaryDex: varchar('primary_dex', { length: 50 }),
  liquidityUsd: decimal('liquidity_usd', { precision: 18, scale: 2 }),
  lastValidated: timestamp('last_validated'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  ephemeralWalletAddress: varchar('ephemeral_wallet_address', { length: 44 }),
  signature: varchar('signature', { length: 88 }).notNull(),
  type: varchar('type', { length: 10 }).notNull(), // 'buy' or 'sell'
  tokenAmount: decimal('token_amount', { precision: 18, scale: 9 }),
  solAmount: decimal('sol_amount', { precision: 18, scale: 9 }),
  price: decimal('price', { precision: 18, scale: 9 }),
  slippage: decimal('slippage', { precision: 5, scale: 2 }),
  dexUsed: varchar('dex_used', { length: 50 }),
  poolAddress: varchar('pool_address', { length: 44 }),
  status: varchar('status', { length: 20 }).default('pending'), // pending, confirmed, failed
  errorMessage: text('error_message'),
  blockTime: timestamp('block_time'),
  slot: integer('slot'),
  confirmations: integer('confirmations').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at')
});

export const walletBalances = pgTable('wallet_balances', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: varchar('wallet_address', { length: 44 }).notNull().unique(),
  sessionId: varchar('session_id', { length: 255 }),
  solBalance: decimal('sol_balance', { precision: 18, scale: 9 }).default('0'),
  tokenBalance: decimal('token_balance', { precision: 18, scale: 9 }).default('0'),
  tokenMintAddress: varchar('token_mint_address', { length: 44 }),
  lastUpdated: timestamp('last_updated').defaultNow()
});

export const botMetrics = pgTable('bot_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: timestamp('date').defaultNow(),
  totalSessions: integer('total_sessions').default(0),
  activeSessions: integer('active_sessions').default(0),
  totalVolume: decimal('total_volume', { precision: 18, scale: 2 }).default('0'),
  totalRevenue: decimal('total_revenue', { precision: 18, scale: 9 }).default('0'),
  totalTrades: integer('total_trades').default(0),
  successfulTrades: integer('successful_trades').default(0),
  failedTrades: integer('failed_trades').default(0),
  averageTradeSize: decimal('average_trade_size', { precision: 18, scale: 9 }).default('0'),
  uniqueTokensTraded: integer('unique_tokens_traded').default(0),
  privilegedWalletsCount: integer('privileged_wallets_count').default(0),
  createdAt: timestamp('created_at').defaultNow()
});

// Relations
export const userSessionsRelations = relations(userSessions, ({ one, many }) => ({
  token: one(tokens, {
    fields: [userSessions.contractAddress],
    references: [tokens.contractAddress]
  }),
  transactions: many(transactions),
  walletBalance: one(walletBalances, {
    fields: [userSessions.sessionId],
    references: [walletBalances.sessionId]
  })
}));

export const tokensRelations = relations(tokens, ({ many }) => ({
  sessions: many(userSessions)
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  session: one(userSessions, {
    fields: [transactions.sessionId],
    references: [userSessions.sessionId]
  })
}));

export const walletBalancesRelations = relations(walletBalances, ({ one }) => ({
  session: one(userSessions, {
    fields: [walletBalances.sessionId],
    references: [userSessions.sessionId]
  })
}));

// Types for TypeScript inference
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type WalletBalance = typeof walletBalances.$inferSelect;
export type NewWalletBalance = typeof walletBalances.$inferInsert;
export type BotMetric = typeof botMetrics.$inferSelect;
export type NewBotMetric = typeof botMetrics.$inferInsert;