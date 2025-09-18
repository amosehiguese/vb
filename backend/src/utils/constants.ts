import { env } from '../config/environment';

// Solana Constants
export const SOLANA_CONSTANTS = {
  LAMPORTS_PER_SOL: 1_000_000_000,
  SOL_DECIMALS: 9,
  MAX_TRANSACTION_SIZE: 1232,
  CONFIRMATION_COMMITMENT: 'confirmed' as const,
} as const;

export const STRATEGY_CONSTANTS = {
  // Wallet Pool Configuration
  WALLET_POOL_SIZE: 50, // Total number of wallets to create per session
  WHALE_WALLET_PERCENTAGE: 0.04, // 4% of wallets will be "whales"
  INITIAL_GAS_PER_WALLET: 0.006, // SOL to send to each bot wallet for transaction fees

  // Distribution for Token Funding
  MIN_RETAIL_TOKEN_PERCENTAGE: 0.1, // Min % of total tokens for a retail wallet
  MAX_RETAIL_TOKEN_PERCENTAGE: 0.5, // Max % of total tokens for a retail wallet
  MIN_WHALE_TOKEN_PERCENTAGE: 5,   // Min % of total tokens for a whale wallet
  MAX_WHALE_TOKEN_PERCENTAGE: 15,  // Max % of total tokens for a whale wallet

  // Randomized Trading Behavior
  MIN_TRADE_PERCENTAGE: 10, // Min percentage of a wallet's token balance to trade
  MAX_TRADE_PERCENTAGE: 25, // Max percentage of a wallet's token balance to trade
  MIN_TRADE_DELAY_MS: 3000,   // Minimum delay between trades (3 seconds)
  MAX_TRADE_DELAY_MS: 9000,  // Maximum delay between trades (12 seconds)

  MIN_RETAIL_BUY_USD: 0.01, // $0.01
  MAX_RETAIL_BUY_USD: 0.03, // $0.03
  MIN_WHALE_BUY_USD: 0.04,  // $0.04
  MAX_WHALE_BUY_USD: 0.10,  // $0.10
  
  // Staggered Re-funding
  REFILL_BATCH_SIZE: 10, // Number of wallets to re-fund at a time
  REFILL_GAS_AMOUNT: 0.002, // Amount of SOL to send for a gas refill
  WALLET_GAS_LOW_THRESHOLD: 0.0005, // SOL balance below which a wallet is considered low on gas
} as const;

// Trading Constants
export const TRADING_CONSTANTS = {
  MIN_WALLET_DEPOSIT: env.MIN_WALLET_DEPOSIT,
  MIN_PRIVILEGED_WALLET_DEPOSIT: env.MIN_PRIVILEGED_WALLET_DEPOSIT,
  MAX_PRIVILEGED_WALLETS: env.MAX_PRIVILEGED_WALLETS,
  REVENUE_PERCENTAGE: env.REVENUE_PERCENTAGE,
  TARGET_DEPLETION: 95, // 95%
  DEFAULT_SLIPPAGE: 5, // 5%
  MAX_SLIPPAGE: 20, // 20%
  MIN_LIQUIDITY_USD: 1, // $1 minimum liquidity
  MAX_CONSECUTIVE_FAILURES: 10,
  WALLET_BALANCE_CHECK_INTERVAL: 10000, // 10 seconds
  TRANSACTION_TIMEOUT: 45000, // 30 seconds
  JITO_TIP_LAMPORTS: 10000, // Jito tip amount in lamports (0.00001 SOL)
  ATA_CREATION_FEE_BUFFER: 0.006, // (in SOL) A safe buffer for rent exemption on new token accounts.
  NETWORK_FEE_BUFFER: 0.00001, 
  JUPITER_FEE_BPS: 10, // Jupiter fee constant (0.1%) 
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
] as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];