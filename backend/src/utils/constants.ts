import { env } from '../config/environment';

// Solana Constants
export const SOLANA_CONSTANTS = {
  LAMPORTS_PER_SOL: 1_000_000_000,
  SOL_DECIMALS: 9,
  MAX_TRANSACTION_SIZE: 1232,
  CONFIRMATION_COMMITMENT: 'confirmed' as const,
  FINALIZED_COMMITMENT: 'finalized' as const,
  RECENT_BLOCKHASH_TIMEOUT: 150000, // 2.5 minutes
} as const;

// Trading Constants
export const TRADING_CONSTANTS = {
  TRADE_AMOUNT_USD: env.TRADE_AMOUNT_USD,
  MIN_WALLET_DEPOSIT: env.MIN_WALLET_DEPOSIT,
  MIN_PRIVILEGED_WALLET_DEPOSIT: env.MIN_PRIVILEGED_WALLET_DEPOSIT,
  MAX_PRIVILEGED_WALLETS: env.MAX_PRIVILEGED_WALLETS,
  REVENUE_PERCENTAGE: env.REVENUE_PERCENTAGE,
  TARGET_DEPLETION: 75, // 75%
  TRADING_BALANCE_DEPLETION_TARGET: 95, 
  DEFAULT_SLIPPAGE: 5, // 5%
  MAX_SLIPPAGE: 20, // 20%
  MIN_TRADE_SOL: 0.001,
  MIN_LIQUIDITY_USD: 1, // $1 minimum liquidity
  TRADE_INTERVAL_MS: 3000, // 3 seconds between trades
  MAX_CONSECUTIVE_FAILURES: 5,
  WALLET_BALANCE_CHECK_INTERVAL: 10000, // 10 seconds
  TRANSACTION_TIMEOUT: 30000, // 30 seconds
  JITO_TIP_LAMPORTS: 10000, // Jito tip amount in lamports (0.00001 SOL)
  ATA_CREATION_FEE_BUFFER: 0.00204, // (in SOL) A safe buffer for rent exemption on new token accounts.
  NETWORK_FEE_BUFFER: 0.00001, 
  JUPITER_FEE_BPS: 10, // Jupiter fee constant (0.1%) 
  MAX_TRADES_PER_SESSION: {
    MICRO: 2000,
    SMALL: 5000,
    STANDARD: 10000,
    HIGH: 20000
  },
  FUNDING_TIERS: {
    MICRO: {
      name: 'micro',
      minFunding: 0.01,
      maxFunding: 0.09,
      buyPercentageMin: 0.3,        // Changed from 15
      buyPercentageMax: 0.8,        // Changed from 25
      sellPercentageMin: 5,         // Changed from 30
      sellPercentageMax: 15,        // Changed from 60
      maxBuyUSD: 0.10,             // Changed from 20
      description: 'Micro funding (0.01-0.09 SOL) - Privileged wallets only'
    },
    SMALL: {
      name: 'small',
      minFunding: 0.1,
      maxFunding: 0.9,
      buyPercentageMin: 0.1,        // Changed from 5
      buyPercentageMax: 0.5,        // Changed from 15
      sellPercentageMin: 2,         // Changed from 25
      sellPercentageMax: 8,         // Changed from 50
      minBuyUSD: 0.01,             // Changed from 2
      maxBuyUSD: 0.50,             // Changed from 50
      description: 'Small funding (0.1-0.9 SOL)'
    },
    STANDARD: {
      name: 'standard',
      minFunding: 1.0,
      maxFunding: 9.0,
      buyPercentageMin: 0.02,       // Changed from 2
      buyPercentageMax: 0.15,       // Changed from 4
      sellPercentageMin: 1,         // Changed from 25
      sellPercentageMax: 5,         // Changed from 50
      minBuyUSD: 0.01,             // Changed from 5
      maxBuyUSD: 0.50,             // Changed from 100
      description: 'Standard funding (1-9 SOL)'
    },
    HIGH: {
      name: 'high',
      minFunding: 10.0,
      maxFunding: 100000.0,
      buyPercentageMin: 0.005,      // Changed from 1
      buyPercentageMax: 0.03,       // Changed from 3
      sellPercentageMin: 0.5,       // Changed from 20
      sellPercentageMax: 2,         // Changed from 40
      minBuyUSD: 0.01,             // Changed from 20
      maxBuyUSD: 0.50,             // Changed from 500
      description: 'High funding (10+ SOL)'
    }
  },
  BUY_BIAS_PERCENTAGE: 60, // 60% chance of buy, 40% chance of sell
  MIN_SAME_TYPE_STREAK: 1, // Minimum consecutive same trades
  MAX_SAME_TYPE_STREAK: 4, // Maximum consecutive same trades
  VARIANCE_THRESHOLD: 0.7, // When to add more randomness (70%)
} as const;

// DEX Configuration
export const DEX_CONFIG = {
  JUPITER: {
    name: 'Jupiter',
    api_url: env.JUPITER_API_URL,
    swap_endpoint: '/swap/v1/swap',
    quote_endpoint: 'swap/v1/quote',
    tokens_endpoint: '/tokens/v2',
    price_endpoint: '/price/v3',
    fee_bps: 0, // Jupiter aggregates fees
    priority: 1,
  },
  DEXSCREENER: {
    name: 'Dexscreener',
    api_url: 'https://api.dexscreener.com/latest/dex',
    tokens_endpoint: '/tokens'
  }
} as const;

// API Configuration
export const API_CONFIG = {
  COINGECKO: {
    base_url: env.COINGECKO_API_URL,
    coins_endpoint: '/coins',
    price_endpoint: '/simple/price',
    rate_limit_ms: 1000, // 1 second between requests
  },
  REQUEST_TIMEOUT: 1000000, // 10 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  CACHE_TTL: 300000, // 5 minutes
} as const;

// Session Constants
export const SESSION_CONSTANTS = {
  SESSION_ID_LENGTH: 32,
  SESSION_EXPIRY_HOURS: 24,
  MAX_ACTIVE_SESSIONS_PER_TOKEN: 10,
  FUNDING_DETECTION_TIMEOUT: 300000, // 5 minutes
  BALANCE_UPDATE_INTERVAL: 5000, // 5 seconds
} as const;

// Database Constants
export const DB_CONSTANTS = {
  MAX_QUERY_TIMEOUT: 30000, // 30 seconds
  CONNECTION_POOL_MAX: 20,
  CONNECTION_POOL_MIN: 5,
  CONNECTION_IDLE_TIMEOUT: 30000,
  BATCH_SIZE: 100,
} as const;

// Validation Constants
export const VALIDATION_CONSTANTS = {
  SOLANA_ADDRESS_LENGTH: 44,
  MIN_CONTRACT_ADDRESS_LENGTH: 32,
  MAX_TOKEN_SYMBOL_LENGTH: 20,
  MAX_TOKEN_NAME_LENGTH: 255,
  MIN_TOKEN_DECIMALS: 0,
  MAX_TOKEN_DECIMALS: 18,
} as const;

// Error Constants
export const ERROR_CODES = {
  // Token Validation Errors
  INVALID_CONTRACT_ADDRESS: 'INVALID_CONTRACT_ADDRESS',
  TOKEN_NOT_FOUND: 'TOKEN_NOT_FOUND',
  NO_POOLS_FOUND: 'NO_POOLS_FOUND',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  
  // Session Errors
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  WALLET_CREATION_FAILED: 'WALLET_CREATION_FAILED',
  INSUFFICIENT_FUNDING: 'INSUFFICIENT_FUNDING',
  MAX_SESSIONS_EXCEEDED: 'MAX_SESSIONS_EXCEEDED',
  
  // Trading Errors
  TRADE_EXECUTION_FAILED: 'TRADE_EXECUTION_FAILED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  
  // System Errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Privileged Wallets (if needed for testing)
export const PRIVILEGED_WALLET_ADDRESSES = [
  // Add specific wallet addresses that should be treated as privileged
  // These would be loaded from environment variables in production
] as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];